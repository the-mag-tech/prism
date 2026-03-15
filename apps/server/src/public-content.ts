/**
 * Public Content Module
 * 
 * Manages external/public content that can appear contextually
 * on entity pages. Part of Scout Anything feature.
 * 
 * Design Principles:
 * - Public blocks are "guests" on entity pages, not primary content
 * - Limited to 1-2 blocks per page
 * - Never appear on Origin/Daily (keep homepage personal)
 * - Visual distinction: dashed border + source label
 */

import { getDB } from './db.js';
import type { PrismBlock } from '@prism/contract';

// =============================================================================
// TYPES
// =============================================================================

interface PublicContentRow {
  id: string;
  source_type: string;
  source_name: string | null;
  source_url: string | null;
  title: string;
  body: string | null;
  topics: string;           // JSON array
  related_entities: string; // JSON array
  published_at: string | null;
  is_active: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Maximum public blocks to show per entity page */
const MAX_PUBLIC_BLOCKS_PER_PAGE = 2;

/** Entity types that can have public blocks */
const ALLOWED_ENTITY_TYPES = ['person', 'company', 'topic', 'project'];

/** Entity types that should NEVER show public blocks */
const BLOCKED_ENTITY_TYPES = ['daily', 'event'];

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Check if public blocks should be shown for a given page
 */
export function shouldShowPublicBlocks(pageId: string): boolean {
  // Explicit blocklist
  if (BLOCKED_ENTITY_TYPES.some(type => pageId.startsWith(type + ':') || pageId === type)) {
    return false;
  }
  
  // Check if it's an allowed type
  const entityType = pageId.split(':')[0];
  return ALLOWED_ENTITY_TYPES.includes(entityType);
}

/**
 * Get related public content for an entity
 * 
 * Matching logic:
 * 1. Direct match: entity ID in related_entities
 * 2. Topic match: entity's topics overlap with public content's topics
 */
export function getRelatedPublicContent(entityId: string): PrismBlock[] {
  const db = getDB();
  
  // Get public content that directly references this entity
  const directMatches = db.query(`
    SELECT * FROM public_content
    WHERE is_active = 1
      AND related_entities LIKE ?
    ORDER BY published_at DESC
    LIMIT ?
  `).all(`%"${entityId}"%`, MAX_PUBLIC_BLOCKS_PER_PAGE) as PublicContentRow[];
  
  // If we have enough direct matches, return them
  if (directMatches.length >= MAX_PUBLIC_BLOCKS_PER_PAGE) {
    return directMatches.map(rowToBlock);
  }
  
  // Otherwise, try topic-based matching
  const entityType = entityId.split(':')[0];
  const entitySlug = entityId.split(':')[1];
  
  // Extract potential topics from entity ID
  // e.g., "topic:ai-agents" → ["ai", "agents"]
  // e.g., "company:ponder" → ["ponder"]
  const entityTopics = entitySlug?.split(/[-_]/) || [];
  
  if (entityTopics.length > 0) {
    // Build LIKE conditions for topic matching
    const topicConditions = entityTopics
      .filter(t => t.length > 2) // Skip short words
      .map(t => `topics LIKE '%${t}%'`)
      .join(' OR ');
    
    if (topicConditions) {
      const topicMatches = db.query(`
        SELECT * FROM public_content
        WHERE is_active = 1
          AND id NOT IN (${directMatches.map(m => `'${m.id}'`).join(',') || "''"})
          AND (${topicConditions})
        ORDER BY published_at DESC
        LIMIT ?
      `).all(MAX_PUBLIC_BLOCKS_PER_PAGE - directMatches.length) as PublicContentRow[];
      
      return [...directMatches, ...topicMatches].map(rowToBlock);
    }
  }
  
  return directMatches.map(rowToBlock);
}

/**
 * Get a single public content item by ID
 */
export function getPublicContent(id: string): PublicContentRow | null {
  const db = getDB();
  return db.query('SELECT * FROM public_content WHERE id = ?').get(id) as PublicContentRow | null;
}

/**
 * Convert database row to PrismBlock with public markers
 * 
 * Public blocks are "invitations" - they show information
 * but don't navigate when clicked. External links are
 * available via the "Read original →" link in the footer.
 */
function rowToBlock(row: PublicContentRow): PrismBlock {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? undefined,
    tag: 'DISCOVERY',
    // Public content markers (Scout Anything)
    isPublic: true,
    publicSource: row.source_name ?? 'Public',
    publicUrl: row.source_url ?? undefined,
    publicTime: row.published_at ?? undefined,
  };
}

// =============================================================================
// ADMIN FUNCTIONS
// =============================================================================

/**
 * Toggle public content batch on/off (for testing)
 */
export function setPublicContentActive(active: boolean): number {
  const db = getDB();
  const result = db.query(`
    UPDATE public_content SET is_active = ?
  `).run(active ? 1 : 0);
  return result.changes;
}

/**
 * Get public content statistics
 */
export function getPublicContentStats() {
  const db = getDB();
  
  const total = db.query('SELECT COUNT(*) as count FROM public_content').get() as { count: number };
  const active = db.query('SELECT COUNT(*) as count FROM public_content WHERE is_active = 1').get() as { count: number };
  const bySource = db.query(`
    SELECT source_name, COUNT(*) as count 
    FROM public_content 
    GROUP BY source_name
  `).all() as { source_name: string; count: number }[];
  
  return {
    total: total.count,
    active: active.count,
    bySource,
  };
}

