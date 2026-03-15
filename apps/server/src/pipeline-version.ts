/**
 * Pipeline Version Management
 * 
 * Tracks versions of AI pipelines (extraction, embedding) to enable lazy migration.
 * When a pipeline changes (new prompt, new model), entities created with old versions
 * can be identified and re-processed.
 * 
 * Versioning Strategy:
 * 1. Each pipeline has a semantic version + content hash
 * 2. Content hash is computed from the actual prompt/config
 * 3. When hash changes, old entities become "stale"
 */

import crypto from 'crypto';
import { getDB } from './db.js';
import { ENTITY_TYPE_DEFINITIONS, EXTRACTABLE_TYPES } from '@prism/contract';
import { ENTITY_SCHEMA_EXPECTATIONS } from '@prism/contract';

// =============================================================================
// PROMPT GENERATION (from SSOT)
// =============================================================================

/**
 * Build entity type list for prompt injection.
 * Dynamically generated from ENTITY_TYPE_DEFINITIONS (SSOT).
 */
function buildExtractableTypeList(): string {
  return EXTRACTABLE_TYPES
    .map((type, idx) => `${idx + 1}. **${type}** - ${ENTITY_TYPE_DEFINITIONS[type]}`)
    .join('\n');
}

/**
 * Build type union for JSON schema hint.
 */
function buildTypeUnion(): string {
  return EXTRACTABLE_TYPES.join('|');
}

/**
 * Build semantic relation types for prompt injection.
 * Dynamically generated from ENTITY_SCHEMA_EXPECTATIONS (SSOT).
 */
function buildSemanticRelationList(): string {
  const relationSet = new Set<string>();
  
  // Collect all unique relation types from expectations
  for (const expectations of Object.values(ENTITY_SCHEMA_EXPECTATIONS)) {
    for (const exp of expectations) {
      relationSet.add(exp.relation);
    }
  }
  
  // Group relations by semantic category for clarity
  const relations = Array.from(relationSet).sort();
  
  return `SEMANTIC RELATION TYPES (use these instead of generic "relatedTo"):

**Employment/Affiliation:**
- works_at: person → company/organization
- founded_by / created_by: project/company → person
- owned_by: project → company/person

**Knowledge/Creation:**
- created / authored: person → project/concept/insight
- uses: project → technology/concept
- solves: project → problem
- derived_from / coined_by: concept → concept/person

**Social/Professional:**
- collaborates_with: person ↔ person
- educated_at: person → organization
- known_for: person → topic/project
- influenced_by: person → person/concept

**Timeline/Events:**
- involves: event → person/company/project
- happened_at / at_location: event/agenda → location
- made_by: decision → person/company
- achieved_by: milestone → person/project
- about: news → person/company/project

**Context/Relationships:**
- related_to: topic ↔ topic/concept (only when no specific relation applies)
- affects: decision/problem → person/company/project`;
}

// =============================================================================
// EXTRACTION PROMPT (dynamically generated) - v2.0 SEMANTIC RELATIONS
// =============================================================================

/**
 * The extraction prompt used by AI to identify entities and SEMANTIC relations.
 * 
 * v2.0 Changes:
 * - Explicit semantic relation types (works_at, created_by, etc.)
 * - Structured relations array instead of simple relatedTo
 * - Better examples to guide LLM behavior
 */
export const EXTRACTION_PROMPT = `You are an Anti-Gravity Field Sensor for a Knowledge Graph.
Your job is to extract Entities and SEMANTIC RELATIONS from text.

═══════════════════════════════════════════════════════════════════════════════
ENTITY TYPES (extract these)
═══════════════════════════════════════════════════════════════════════════════

${buildExtractableTypeList()}

═══════════════════════════════════════════════════════════════════════════════
${buildSemanticRelationList()}
═══════════════════════════════════════════════════════════════════════════════

EXTRACTION RULES:
1. Extract SPECIFIC entities (named people, companies, projects) - not generic concepts
2. Use SEMANTIC relation types - avoid generic "relatedTo" when a specific type fits
3. Every relation needs: source entity, relation type, target entity
4. Entity IDs must be snake_case (e.g., "simon_willison", "openai", "gpt_4")

DO NOT extract:
- Generic tasks or to-dos
- Vague concepts without clear identity
- Administrative debris

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (respond with valid JSON only)
═══════════════════════════════════════════════════════════════════════════════

{
  "entities": [
    {
      "type": "${buildTypeUnion()}",
      "name": "snake_case_id",
      "title": "Display Title",
      "subtitle": "Context/Role (optional)",
      "body": "Brief description (optional)"
    }
  ],
  "relations": [
    {
      "source": "type:name",
      "relation": "works_at|created|founded_by|uses|...",
      "target": "type:name",
      "context": "brief evidence from text (optional)"
    }
  ],
  "reasoning": "Brief analysis of what was extracted and why"
}

═══════════════════════════════════════════════════════════════════════════════
EXAMPLE
═══════════════════════════════════════════════════════════════════════════════

Input: "Simon Willison, creator of Datasette, announced that his SQLite-based tool now supports plugins."

Output:
{
  "entities": [
    {"type": "person", "name": "simon_willison", "title": "Simon Willison", "subtitle": "Creator of Datasette"},
    {"type": "project", "name": "datasette", "title": "Datasette", "subtitle": "SQLite-based data exploration tool"},
    {"type": "concept", "name": "sqlite", "title": "SQLite", "subtitle": "Embedded database"}
  ],
  "relations": [
    {"source": "person:simon_willison", "relation": "created", "target": "project:datasette"},
    {"source": "project:datasette", "relation": "uses", "target": "concept:sqlite"}
  ],
  "reasoning": "Extracted Simon Willison as creator of Datasette project, which uses SQLite technology."
}`;

// =============================================================================
// VERSION CONSTANTS
// =============================================================================

/**
 * Compute a short hash of the extraction prompt.
 * Used to detect when prompt changes.
 */
function computePromptHash(prompt: string): string {
  return crypto.createHash('md5').update(prompt).digest('hex').substring(0, 8);
}

/**
 * Pipeline versions for different AI components.
 * Update semantic version when making intentional changes.
 * Hash is computed automatically from content.
 */
export const PIPELINE_VERSION = {
  extraction: {
    version: '2.0.0',  // MAJOR: Semantic relations (works_at, created, uses, etc.)
    promptHash: computePromptHash(EXTRACTION_PROMPT),
    model: 'gpt-4o',  // Using gpt-4o for better relation extraction
  },
  embedding: {
    version: '1.0.0',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
};

/**
 * Get a combined version string for extraction pipeline.
 * Format: "v{version}_{hash}"
 */
export function getExtractionVersion(): string {
  return `v${PIPELINE_VERSION.extraction.version}_${PIPELINE_VERSION.extraction.promptHash}`;
}

/**
 * Get a combined version string for embedding pipeline.
 */
export function getEmbeddingVersion(): string {
  return `v${PIPELINE_VERSION.embedding.version}_${PIPELINE_VERSION.embedding.model}`;
}

// =============================================================================
// STALENESS DETECTION
// =============================================================================

/**
 * Check if an entity is stale (needs re-extraction).
 */
export function isEntityStale(entityId: string): boolean {
  const db = getDB();
  const row = db.query(`
    SELECT is_stale, pipeline_version FROM entities WHERE id = ?
  `).get(entityId) as { is_stale: number; pipeline_version: string | null } | undefined;
  
  if (!row) return false;
  
  // Explicitly marked as stale
  if (row.is_stale === 1) return true;
  
  // Check if pipeline version is outdated
  if (!row.pipeline_version) return true;
  if (row.pipeline_version === 'legacy') return true;
  if (row.pipeline_version !== getExtractionVersion()) return true;
  
  return false;
}

/**
 * Mark an entity as stale (needs re-extraction).
 */
export function markEntityStale(entityId: string): void {
  const db = getDB();
  db.query(`UPDATE entities SET is_stale = 1 WHERE id = ?`).run(entityId);
}

/**
 * Mark an entity as fresh (just extracted/updated).
 */
export function markEntityFresh(entityId: string): void {
  const db = getDB();
  const version = getExtractionVersion();
  db.query(`
    UPDATE entities SET is_stale = 0, pipeline_version = ? WHERE id = ?
  `).run(version, entityId);
}

/**
 * Mark entities from a specific memory as stale.
 * Used when re-extracting a memory.
 */
export function markMemoryEntitiesStale(memoryId: number): void {
  const db = getDB();
  db.query(`
    UPDATE entities SET is_stale = 1 WHERE memo_id = ?
  `).run(memoryId);
}

/**
 * Get count of stale entities.
 */
export function getStaleEntityCount(): number {
  const db = getDB();
  const row = db.query(`SELECT COUNT(*) as count FROM entities WHERE is_stale = 1`).get() as { count: number };
  return row.count;
}

/**
 * Get stale entities (limited batch for processing).
 */
export function getStaleEntities(limit: number = 10): Array<{ id: string; memo_id: number | null }> {
  const db = getDB();
  return db.query(`
    SELECT id, memo_id FROM entities WHERE is_stale = 1 LIMIT ?
  `).all(limit) as Array<{ id: string; memo_id: number | null }>;
}

/**
 * Check if current pipeline version matches what's in the database.
 * Used on startup to determine if entities need marking as stale.
 */
export function checkPipelineVersionMismatch(): { 
  hasMismatch: boolean; 
  outdatedCount: number;
  currentVersion: string;
} {
  const db = getDB();
  const currentVersion = getExtractionVersion();
  
  // Count entities with outdated pipeline version
  const row = db.query(`
    SELECT COUNT(*) as count FROM entities 
    WHERE pipeline_version IS NOT NULL 
      AND pipeline_version != ? 
      AND pipeline_version != 'legacy'
      AND is_stale = 0
  `).get(currentVersion) as { count: number };
  
  return {
    hasMismatch: row.count > 0,
    outdatedCount: row.count,
    currentVersion,
  };
}

/**
 * Mark all entities with outdated pipeline version as stale.
 */
export function markOutdatedEntitiesStale(): number {
  const db = getDB();
  const currentVersion = getExtractionVersion();
  
  const result = db.query(`
    UPDATE entities SET is_stale = 1 
    WHERE pipeline_version IS NOT NULL 
      AND pipeline_version != ? 
      AND is_stale = 0
  `).run(currentVersion);
  
  return result.changes;
}
