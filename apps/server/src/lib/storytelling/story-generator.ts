/**
 * @module storytelling/story-generator
 * @description Graph data extraction utilities for storytelling
 * 
 * ============================================================================
 * DATA EXTRACTION TOOLKIT
 * ============================================================================
 * 
 * This module provides utilities to extract story-relevant data from the graph.
 * It does NOT generate narratives - that's done by Claude Agent using
 * the principles in `.claude/skills/storytelling/`.
 * 
 * Functions:
 * - buildGraphSnapshot(): Extract entities, relations, findings from DB
 * - buildGraphContext(): Convert snapshot to markdown for LLM context
 * - createTestSnapshot(): Create minimal test data
 */

import { getDB } from '../../db.js';
import { getUserMemories } from '../source-manager.js';
import type {
  GraphSnapshot,
  StoryEntity,
  StoryRelation,
  StoryFinding,
} from './types.js';

// =============================================================================
// GRAPH SNAPSHOT EXTRACTION
// =============================================================================

export interface BuildGraphSnapshotOptions {
  /** Maximum entities to fetch per category (default: 10) */
  limit?: number;
  /** Focus on a specific entity and its neighborhood */
  focusEntityId?: string;
  /** Include dormant entities (inactive > 14 days) */
  includeDormant?: boolean;
}

/**
 * Extract a snapshot of graph data suitable for storytelling.
 * 
 * Returns:
 * - topGravityEntities: High-gravity entities (main characters)
 * - recentSparks: Recently discovered entities (hooks)
 * - dormantEntities: Inactive but important entities
 * - relations: Connections between entities
 * - serendipityFindings: Recent discoveries from memories
 * 
 * @example
 * ```typescript
 * const snapshot = await buildGraphSnapshot({ limit: 5 });
 * // Use snapshot data in Claude Agent conversation
 * ```
 */
export async function buildGraphSnapshot(
  options: BuildGraphSnapshotOptions = {}
): Promise<GraphSnapshot> {
  const { limit = 10, includeDormant = true } = options;
  const db = getDB();

  // High gravity entities (main characters)
  const topGravityRows = db.query(`
    SELECT e.id, e.title, e.subtitle, ep.gravity, ep.spark
    FROM entities e
    LEFT JOIN entity_physics ep ON e.id = ep.entity_id
    WHERE ep.gravity > 0
    ORDER BY ep.gravity DESC
    LIMIT ?
  `).all(limit) as any[];

  const topGravityEntities: StoryEntity[] = topGravityRows.map(row => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    type: extractTypeFromId(row.id),
    gravity: row.gravity,
    spark: row.spark,
  }));

  // Recent sparks (new discoveries)
  const sparkRows = db.query(`
    SELECT e.id, e.title, e.subtitle, ep.gravity, ep.spark
    FROM entities e
    LEFT JOIN entity_physics ep ON e.id = ep.entity_id
    WHERE ep.spark > 0
    ORDER BY ep.spark DESC, e.created_at DESC
    LIMIT ?
  `).all(Math.min(limit, 5)) as any[];

  const recentSparks: StoryEntity[] = sparkRows.map(row => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    type: extractTypeFromId(row.id),
    gravity: row.gravity,
    spark: row.spark,
  }));

  // Dormant entities (sleeping connections)
  let dormantEntities: StoryEntity[] = [];
  if (includeDormant) {
    const dormantRows = db.query(`
      SELECT e.id, e.title, e.subtitle, ep.gravity
      FROM entities e
      LEFT JOIN entity_physics ep ON e.id = ep.entity_id
      WHERE ep.gravity > 0.1
      AND e.updated_at < datetime('now', '-14 days')
      ORDER BY ep.gravity DESC
      LIMIT ?
    `).all(Math.min(limit, 3)) as any[];

    dormantEntities = dormantRows.map(row => ({
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      type: extractTypeFromId(row.id),
      gravity: row.gravity,
    }));
  }

  // Relations between fetched entities
  const entityIds = [...topGravityEntities, ...recentSparks]
    .map(e => e.id)
    .slice(0, 10);

  let relations: StoryRelation[] = [];
  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => '?').join(',');
    const relationRows = db.query(`
      SELECT source, target, type, evidence
      FROM relations
      WHERE source IN (${placeholders}) OR target IN (${placeholders})
      LIMIT 20
    `).all(...entityIds, ...entityIds) as any[];

    relations = relationRows.map(row => ({
      from_id: row.source,
      to_id: row.target,
      type: row.type,
      description: row.evidence || '',
    }));
  }

  // Recent memories as serendipity source (via source-manager)
  const recentMemories = getUserMemories({ archived: false, limit: 5 })
    .filter(m => m.title && m.title.trim() !== '');

  const serendipityFindings: StoryFinding[] = recentMemories.map(mem => ({
    id: mem.id,
    title: mem.title || 'Untitled',
    snippet: (mem.text_content || mem.content || '').substring(0, 200),
    sourceType: mem.source_type || 'unknown',
    entityId: mem.entity_id || undefined,
  }));

  return {
    topGravityEntities,
    recentSparks,
    dormantEntities,
    relations,
    serendipityFindings,
    temporalPatterns: [], // TODO: Add pattern detection
    timestamp: new Date(),
  };
}

/**
 * Extract entity type from ID (e.g., "person:john" → "person")
 */
function extractTypeFromId(id: string): string {
  const colonIndex = id.indexOf(':');
  return colonIndex > 0 ? id.substring(0, colonIndex) : 'unknown';
}

// =============================================================================
// CONTEXT FORMATTING
// =============================================================================

/**
 * Convert a GraphSnapshot into markdown text for LLM context.
 * 
 * This is useful when you want to include graph data in a Claude Agent
 * conversation without structured tool calls.
 * 
 * @example
 * ```typescript
 * const snapshot = await buildGraphSnapshot();
 * const context = buildGraphContext(snapshot);
 * // Include `context` in your prompt to Claude
 * ```
 */
export function buildGraphContext(snapshot: GraphSnapshot): string {
  const sections: string[] = [];

  // High gravity entities (main characters)
  if (snapshot.topGravityEntities.length > 0) {
    const entities = snapshot.topGravityEntities.slice(0, 5);
    sections.push(`## Key Entities (High Gravity)
${entities.map(e => `- **${e.title}** (${e.type})${e.subtitle ? `: ${e.subtitle}` : ''}${e.gravity ? ` [gravity: ${e.gravity.toFixed(2)}]` : ''}`).join('\n')}`);
  }

  // Recent sparks (new discoveries)
  if (snapshot.recentSparks.length > 0) {
    const sparks = snapshot.recentSparks.slice(0, 3);
    sections.push(`## Recent Discoveries (Sparks)
${sparks.map(e => `- **${e.title}** (${e.type})${e.subtitle ? `: ${e.subtitle}` : ''} [NEW]`).join('\n')}`);
  }

  // Dormant entities (sleeping connections)
  if (snapshot.dormantEntities.length > 0) {
    const dormant = snapshot.dormantEntities.slice(0, 3);
    sections.push(`## Dormant Connections
${dormant.map(e => `- **${e.title}** (${e.type}) - hasn't been active recently`).join('\n')}`);
  }

  // Relations (plot connections)
  if (snapshot.relations.length > 0) {
    const relations = snapshot.relations.slice(0, 8);
    // Build a lookup for entity titles
    const allEntities = [
      ...snapshot.topGravityEntities,
      ...snapshot.recentSparks,
      ...snapshot.dormantEntities,
    ];
    const entityTitles = new Map(allEntities.map(e => [e.id, e.title]));

    sections.push(`## Connections
${relations.map(r => {
  const from = entityTitles.get(r.from_id) || r.from_id;
  const to = entityTitles.get(r.to_id) || r.to_id;
  return `- ${from} → ${to} (${r.type})${r.description ? `: ${r.description}` : ''}`;
}).join('\n')}`);
  }

  // Serendipity findings (twists)
  if (snapshot.serendipityFindings.length > 0) {
    const findings = snapshot.serendipityFindings.slice(0, 3);
    sections.push(`## Recent Discoveries
${findings.map(f => `- **${f.title}**: ${f.snippet}`).join('\n')}`);
  }

  // Temporal patterns
  if (snapshot.temporalPatterns.length > 0) {
    sections.push(`## Patterns Observed
${snapshot.temporalPatterns.map(p => `- [${p.type}] ${p.description} (${p.timeframe})`).join('\n')}`);
  }

  return sections.join('\n\n');
}

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a minimal graph snapshot for testing.
 */
export function createTestSnapshot(): GraphSnapshot {
  return {
    topGravityEntities: [
      { id: 'person:test-user', title: 'Test User', type: 'person', gravity: 0.8 },
    ],
    recentSparks: [
      { id: 'topic:test-topic', title: 'Test Topic', type: 'topic', spark: 1 },
    ],
    dormantEntities: [],
    relations: [],
    serendipityFindings: [],
    temporalPatterns: [],
    timestamp: new Date(),
  };
}
