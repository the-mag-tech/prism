/**
 * Pages Data Access Layer
 * 
 * Reads entity and page data from SQLite, returns PrismPage format.
 * Implements the Prism Contract.
 * 
 * Lazy Migration:
 * When a page is accessed, we check if any blocks are stale (need re-extraction).
 * If so, we trigger async refresh but return current data immediately (stale-while-revalidate).
 */

import { getDB } from './db.js';
import { validatePage } from '@prism/contract';
import type { PrismBlock, PrismPage, PrismRelation } from '@prism/contract';
import { isEntityStale } from './pipeline-version.js';
import { shouldShowPublicBlocks, getRelatedPublicContent, getPublicContent } from './public-content.js';

// =============================================================================
// TYPE DEFINITIONS (DB Row Types)
// =============================================================================

interface EntityRow {
  id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  tag: string | null;
  action: string | null;
}

interface PageBlockRow {
  block_id: string;
  position: number;
  target: string | null;
  // Schema V2: Layout hints (don't affect color)
  is_header: number;  // 0 or 1
  is_source: number;  // 0 or 1
  color_override: string | null;  // Explicit color override (rare)
  // Legacy field (for migration compatibility)
  tag_override: string | null;
  // Joined from entities
  title: string;
  subtitle: string | null;
  body: string | null;
  tag: string | null;
  action: string | null;
}

interface RelationRow {
  source: string;
  target: string;
  type: string;
  weight: number | null;
  evidence: string | null;
}

// =============================================================================
// DATA ACCESS FUNCTIONS
// =============================================================================

/**
 * Get a single entity by ID
 */
export function getEntity(entityId: string): EntityRow | null {
  const db = getDB();
  const row = db.query(`
    SELECT id, title, subtitle, body, tag, action
    FROM entities
    WHERE id = ?
  `).get(entityId) as EntityRow | undefined;

  return row || null;
}

/**
 * Get all blocks for a page, ordered by position
 */
export function getPageBlocks(pageId: string): PageBlockRow[] {
  const db = getDB();
  const rows = db.query(`
    SELECT 
      pb.block_id,
      pb.position,
      pb.target,
      COALESCE(pb.is_header, 0) as is_header,
      COALESCE(pb.is_source, 0) as is_source,
      pb.color_override,
      pb.tag_override,
      e.title,
      e.subtitle,
      e.body,
      e.tag,
      e.action
    FROM page_blocks pb
    JOIN entities e ON pb.block_id = e.id
    WHERE pb.page_id = ?
    ORDER BY pb.position ASC
  `).all(pageId) as PageBlockRow[];

  return rows;
}

/**
 * Get relations for a page (where source is any block on the page)
 */
export function getRelationsForPage(pageId: string): PrismRelation[] {
  const db = getDB();

  // Get all block IDs on this page
  const blockIds = db.query(`
    SELECT block_id FROM page_blocks WHERE page_id = ?
  `).all(pageId) as { block_id: string }[];

  if (blockIds.length === 0) return [];

  // Get relations where source is any of these blocks
  const placeholders = blockIds.map(() => '?').join(',');
  const rows = db.query(`
    SELECT source, target, type, weight, evidence
    FROM relations
    WHERE source IN (${placeholders})
  `).all(...blockIds.map(b => b.block_id)) as RelationRow[];

  return rows.map(r => ({
    source: r.source,
    target: r.target,
    type: r.type as PrismRelation['type'],
    weight: r.weight ?? undefined,
    evidence: r.evidence ?? undefined,
  }));
}

/**
 * Convert DB rows to PrismBlock
 * 
 * Schema V2 color logic (SSOT from entity ID):
 * - Frontend derives color from block.id prefix (news: → blue, event: → red, etc.)
 * - tag field is for DISPLAY only (e.g., "NEWS", "MEETING"), not color hints
 * - color_override is for rare explicit overrides
 * 
 * is_header/is_source are layout hints, NOT color hints.
 */
function rowToBlock(row: PageBlockRow): PrismBlock {
  // Determine display tag:
  // - Use color_override if explicitly set
  // - Otherwise use entity.tag
  // - Legacy: handle old tag_override values (HEADER/SOURCE → use entity.tag instead)
  let displayTag = row.tag ?? undefined;

  if (row.color_override) {
    // Explicit color override (rare)
    displayTag = row.color_override;
  } else if (row.tag_override && row.tag_override !== 'HEADER' && row.tag_override !== 'SOURCE') {
    // Legacy: semantic tag_override (ACTION/INTEL/SPARK/CONTEXT)
    displayTag = row.tag_override;
  }

  // Determine target:
  // - Finding blocks always navigate to their own page (for viewing details + related entities)
  // - Memory blocks always navigate to their own page (for viewing content)
  // - Other blocks use the page_blocks.target or fallback to block_id
  const isFinding = row.block_id.startsWith('finding:');
  const isMemory = row.block_id.startsWith('memory:');
  const blockTarget = (isFinding || isMemory) ? row.block_id : (row.target ?? row.block_id);

  return {
    id: row.block_id,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    body: row.body ?? undefined,
    tag: displayTag,
    action: row.action ?? undefined,
    target: blockTarget,
  };
}

// =============================================================================
// PUBLIC CONTENT PAGES (Scout Detail View)
// =============================================================================

/**
 * Generate a detail page for a public content item
 */
function getPublicContentPage(id: string): PrismPage | null {
  const content = getPublicContent(id);
  if (!content) return null;

  // Build the page structure
  const headerBlock: PrismBlock = {
    id: content.id,
    title: content.title,
    subtitle: content.source_name ? `${content.source_name} • ${content.published_at ? new Date(content.published_at).toLocaleDateString() : 'Unknown Date'}` : undefined,
    body: content.body ?? undefined,
    tag: 'SCOUT RESULT',
    // Important: Public content pages should allow reading the original
    action: content.source_url ? 'Read Original →' : undefined,
    // NOTE: target should be undefined for public content to prevent internal navigation
    // External links are handled via publicUrl by the frontend
    target: undefined,
    // Public markers - frontend uses these for external link handling
    isPublic: true,
    publicSource: content.source_name ?? 'Public',
    publicUrl: content.source_url ?? undefined,
    publicTime: content.published_at ?? undefined,
  };

  // Override layout for header
  (headerBlock as any).cols = 2;
  (headerBlock as any).rows = 2;
  (headerBlock as any).type = 'type-anchor'; // Anchor styling for main content

  const blocks: PrismBlock[] = [headerBlock];

  // Add related entities if any (from related_entities JSON)
  if (content.related_entities) {
    try {
      const relatedIds = JSON.parse(content.related_entities) as string[];
      for (const relatedId of relatedIds) {
        const entity = getEntity(relatedId);
        if (entity) {
          blocks.push({
            id: entity.id,
            title: entity.title,
            subtitle: entity.subtitle ?? undefined,
            tag: 'RELATED',
            target: entity.id,
            // Standard block
          });
        }
      }
    } catch (e) {
      console.warn(`[Pages] Failed to parse related_entities for ${id}`, e);
    }
  }

  return {
    id: content.id,
    blocks,
  };
}

/**
 * Get a page by ID, returns PrismPage format
 * 
 * Implements lazy migration: checks if any blocks are stale and
 * triggers background refresh while returning current data.
 */
export function getPageFromDB(pageId: string): PrismPage | null {
  const db = getDB();

  // Get all blocks for this page
  const blockRows = getPageBlocks(pageId);

  // If no blocks, check if page entity itself exists
  if (blockRows.length === 0) {
    // 1. Check if it's a public content page (Scout)
    if (pageId.startsWith('scout:') || pageId.startsWith('public:')) {
      const publicPage = getPublicContentPage(pageId);
      if (publicPage) return publicPage;
    }

    // 2. Fallback for memory pages without page_blocks (legacy data)
    // Note: New memories should have page_blocks created by ingestFinding + EntityExtractionAtom
    // This fallback handles old data or cases where extraction failed
    if (pageId.startsWith('memory:')) {
      const memoryId = parseInt(pageId.split(':')[1]);
      
      // Try entity first (has AI-generated summary in body)
      const entity = getEntity(pageId);
      if (entity) {
        const memoryBlock: PrismBlock = {
          id: pageId,
          title: entity.title || 'Untitled Memory',
          subtitle: entity.subtitle ?? undefined,
          body: entity.body ?? undefined,
          tag: 'MEMORY',
          action: 'VIEW FULL →',
          target: undefined,
        };

        (memoryBlock as any).cols = 4;
        (memoryBlock as any).rows = 2;
        (memoryBlock as any).type = 'type-context';

        return { id: pageId, blocks: [memoryBlock] };
      }

      // Last resort: query user_memories table directly (very old data)
      const memory = db.query(`
        SELECT id, title, content, ingested_at as created_at FROM user_memories WHERE id = ?
      `).get(memoryId) as { id: number; title: string; content: string; created_at: string } | undefined;

      if (memory) {
        const truncatedBody = memory.content.length > 500 
          ? memory.content.substring(0, 500) + '...' 
          : memory.content;

        const memoryBlock: PrismBlock = {
          id: pageId,
          title: memory.title || 'Untitled Memory',
          subtitle: new Date(memory.created_at).toLocaleString(),
          body: truncatedBody,
          tag: 'MEMORY',
          action: 'VIEW FULL →',
          target: undefined,
        };

        (memoryBlock as any).cols = 4;
        (memoryBlock as any).rows = 2;
        (memoryBlock as any).type = 'type-context';

        return { id: pageId, blocks: [memoryBlock] };
      }
    }

    // 3. Check if it's a regular entity
    const pageEntity = getEntity(pageId);
    if (!pageEntity) {
      return null;
    }

    // Check if page entity is stale
    if (isEntityStale(pageId)) {
      // Trigger async refresh (fire-and-forget)
      triggerEntityRefresh([pageId]);
    }

    // Page exists but has no blocks - return page entity as single block
    // Force ANCHOR styling for the self-reference block
    const selfBlock: PrismBlock = {
      id: pageEntity.id,
      title: pageEntity.title,
      subtitle: pageEntity.subtitle ?? undefined,
      body: pageEntity.body ?? undefined,
      tag: pageEntity.tag ?? undefined,
      action: pageEntity.action ?? undefined,
      target: pageEntity.id, // Make anchor clickable (self-reference)
    };

    // Apply size and type overrides for the anchor block
    // This makes the first block look like a "Hero" anchor
    (selfBlock as any).cols = 2;
    (selfBlock as any).rows = 2;
    (selfBlock as any).type = 'type-anchor';

    return {
      id: pageId,
      blocks: [selfBlock],
    };
  }

  // Build blocks array from page_blocks table
  const blocks: PrismBlock[] = blockRows.map(row => rowToBlock(row));

  // Ensure the first block is treated as an anchor if it matches the page ID
  // This restores the "Zoom In" feeling
  if (blocks.length > 0 && blocks[0].id === pageId) {
    const anchor = blocks[0] as any;
    anchor.cols = 2;
    anchor.rows = 2;
    anchor.type = 'type-anchor';
  }

  // Check for stale blocks and trigger refresh if needed
  const staleBlockIds = blocks
    .map(b => b.id)
    .filter(id => isEntityStale(id));

  if (staleBlockIds.length > 0) {
    console.log(`[Pages] Found ${staleBlockIds.length} stale blocks on page ${pageId}, triggering refresh`);
    // Trigger async refresh (fire-and-forget)
    triggerEntityRefresh(staleBlockIds);
  }

  // Get relations
  const relations = getRelationsForPage(pageId);

  // Inject public blocks if appropriate (Scout Anything Phase 1)
  let finalBlocks = blocks;
  if (shouldShowPublicBlocks(pageId)) {
    const publicBlocks = getRelatedPublicContent(pageId);
    if (publicBlocks.length > 0) {
      console.log(`[Pages] Injecting ${publicBlocks.length} public blocks into ${pageId}`);
      finalBlocks = [...blocks, ...publicBlocks];
    }
  }

  const page: PrismPage = {
    id: pageId,
    blocks: finalBlocks,
    relations: relations.length > 0 ? relations : undefined,
  };

  return page;
}

// =============================================================================
// LAZY MIGRATION HELPERS
// =============================================================================

/** Callback for entity refresh - set by background-worker.ts */
let entityRefreshCallback: ((entityIds: string[]) => void) | null = null;

/**
 * Register a callback to be called when entities need refresh.
 * Called by background-worker.ts to wire up the refresh mechanism.
 */
export function setEntityRefreshCallback(callback: (entityIds: string[]) => void): void {
  entityRefreshCallback = callback;
}

/**
 * Trigger async refresh for stale entities.
 * Returns immediately (fire-and-forget).
 */
function triggerEntityRefresh(entityIds: string[]): void {
  if (entityRefreshCallback && entityIds.length > 0) {
    // Use setImmediate to not block the current request
    setImmediate(() => {
      try {
        entityRefreshCallback!(entityIds);
      } catch (error) {
        console.error('[Pages] Error in entity refresh callback:', error);
      }
    });
  }
}

/**
 * List all pages (entities that have page_blocks entries or are standalone pages)
 * 
 * Excludes alias entities (those that have been merged into a canonical entity)
 */
export function listPagesFromDB(): Array<{ id: string; title: string }> {
  const db = getDB();

  // Get all unique page_ids from page_blocks, plus all entities
  // A "page" is any entity that either:
  // 1. Has entries in page_blocks (is a page with blocks)
  // 2. Is a standalone entity (can be viewed as its own page)
  // 
  // EXCLUDES: alias entities (merged into canonical)
  const rows = db.query(`
    SELECT DISTINCT e.id, e.title
    FROM entities e
    WHERE (
      EXISTS (SELECT 1 FROM page_blocks pb WHERE pb.page_id = e.id)
       OR e.id LIKE 'daily%'
       OR e.id LIKE 'event:%'
       OR e.id LIKE 'person:%'
       OR e.id LIKE 'company:%'
       OR e.id LIKE 'topic:%'
    )
    AND NOT EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.alias_id = e.id)
    ORDER BY e.title
  `).all() as { id: string; title: string }[];

  return rows;
}

/**
 * Check if a page exists
 */
export function hasPage(pageId: string): boolean {
  const db = getDB();

  // Special handling for public content pages
  if (pageId.startsWith('scout:') || pageId.startsWith('public:')) {
    const result = db.query('SELECT 1 FROM public_content WHERE id = ?').get(pageId);
    // bun:sqlite returns null (not undefined) when no results
    return result != null;
  }

  // Check if entity exists OR if there are page_blocks for this page
  const result = db.query(`
    SELECT 1 FROM entities WHERE id = ?
    UNION
    SELECT 1 FROM page_blocks WHERE page_id = ?
    LIMIT 1
  `).get(pageId, pageId);

  // bun:sqlite returns null (not undefined) when no results
  return result != null;
}

// =============================================================================
// CATEGORY PAGES (for Omnibar quick access)
// =============================================================================

/**
 * Category metadata for display
 */
const CATEGORY_META: Record<string, { label: string; labelSingular: string; icon: string }> = {
  person: { label: 'All People', labelSingular: 'Person', icon: '👤' },
  company: { label: 'All Companies', labelSingular: 'Company', icon: '🏢' },
  topic: { label: 'All Topics', labelSingular: 'Topic', icon: '🏷️' },
  event: { label: 'All Events', labelSingular: 'Event', icon: '📅' },
  project: { label: 'All Projects', labelSingular: 'Project', icon: '📁' },
};

/**
 * Generate a category listing page
 * 
 * A category page shows all entities of a given type (e.g., all people, all topics).
 * This is used for Omnibar "Browse All" quick access.
 */
export function getCategoryPage(categoryType: string): PrismPage | null {
  const db = getDB();

  // Validate category type
  const meta = CATEGORY_META[categoryType];
  if (!meta) {
    return null;
  }

  // Get all entities of this type
  const entities = db.query(`
    SELECT id, title, subtitle
    FROM entities
    WHERE id LIKE ?
      AND id NOT LIKE 'alias:%'
      AND id NOT LIKE 'singleton:%'
    ORDER BY title
  `).all(`${categoryType}:%`) as Array<{ id: string; title: string; subtitle: string | null }>;

  // Build header block
  const headerBlock: PrismBlock = {
    id: `category:${categoryType}`,
    title: meta.label,
    subtitle: `${entities.length} ${entities.length === 1 ? meta.labelSingular : categoryType + 's'}`,
    tag: meta.icon,
  };

  // Convert entities to blocks
  const entityBlocks: PrismBlock[] = entities.map(e => ({
    id: e.id,
    title: e.title,
    subtitle: e.subtitle ?? undefined,
    target: e.id,  // Clicking navigates to the entity page
    tag: meta.labelSingular.toUpperCase(),
  }));

  return {
    id: `category:${categoryType}`,
    blocks: [headerBlock, ...entityBlocks],
  };
}

/**
 * Check if a page ID is a category page
 */
export function isCategoryPage(pageId: string): boolean {
  return pageId.startsWith('category:');
}

/**
 * Extract category type from category page ID
 */
export function getCategoryType(pageId: string): string | null {
  if (!isCategoryPage(pageId)) return null;
  return pageId.split(':')[1];
}

// =============================================================================
// WRITE FUNCTIONS (for seed script and future use)
// =============================================================================

/**
 * Insert or update an entity
 */
export function upsertEntity(entity: {
  id: string;
  title: string;
  subtitle?: string;
  body?: string;
  tag?: string;
  action?: string;
}): void {
  const db = getDB();

  db.query(`
    INSERT INTO entities (id, title, subtitle, body, tag, action, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      subtitle = excluded.subtitle,
      body = excluded.body,
      tag = excluded.tag,
      action = excluded.action,
      updated_at = datetime('now')
  `).run(
    entity.id,
    entity.title,
    entity.subtitle ?? null,
    entity.body ?? null,
    entity.tag ?? null,
    entity.action ?? null
  );
}

/**
 * Add a block to a page
 */
export function addPageBlock(
  pageId: string,
  blockId: string,
  position: number,
  target?: string,
  tagOverride?: string
): void {
  const db = getDB();

  db.query(`
    INSERT OR REPLACE INTO page_blocks (page_id, block_id, position, target, tag_override)
    VALUES (?, ?, ?, ?, ?)
  `).run(pageId, blockId, position, target ?? null, tagOverride ?? null);
}

/**
 * Add a relation between entities
 */
export function addRelation(relation: {
  source: string;
  target: string;
  type: string;
  weight?: number;
  evidence?: string;
}): void {
  const db = getDB();

  db.query(`
    INSERT INTO relations (source, target, type, weight, evidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    relation.source,
    relation.target,
    relation.type,
    relation.weight ?? null,
    relation.evidence ?? null
  );
}

/**
 * Clear all page-related data (for re-seeding)
 */
export function clearPageData(): void {
  const db = getDB();

  db.exec(`
    DELETE FROM page_blocks;
    DELETE FROM relations;
    DELETE FROM entities;
  `);
}

