/**
 * Recommendation & Search Module
 * 
 * Provides entity search and visit tracking.
 * Gravity calculations are delegated to PhysicsSystem.
 */

import { getDB } from './db.js';

// =============================================================================
// VISIT TRACKING
// =============================================================================

export function recordEntityVisit(entityId: string, source: string = 'navigation', dwellMs: number = 0): void {
  const db = getDB();
  db.query(`
    INSERT INTO entity_visits (entity_id, source, dwell_ms)
    VALUES (?, ?, ?)
  `).run(entityId, source, dwellMs);
}

export function getRecommendationStats() {
  const db = getDB();
  return {
    status: 'Gravity Engine Active',
    physicsCacheSize: db.query('SELECT COUNT(*) as c FROM entity_physics').get()
  };
}

// =============================================================================
// UNIFIED ENTITY SEARCH API
// =============================================================================

/**
 * Entity search parameters.
 * 
 * @see @prism/contract for the full type definition.
 * This local interface extends the contract with backward compatibility.
 */
export interface EntitySearchParams {
  q?: string;                // Text search query (FTS)
  types?: string[];          // DEPRECATED: Use `sources` instead. Kept for backward compat.
  sources?: string[];        // Source types: 'entity', 'finding', 'memory', 'public'
  categories?: string[];     // NEW: Entity ID prefixes to filter (e.g., ['event', 'decision'])
  limit?: number;            // Max results (default: 20)
  offset?: number;           // Pagination offset (default: 0)
  sort?: 'gravity' | 'created_at' | 'title' | 'relevance';  // Sort field
  order?: 'asc' | 'desc';    // Sort order
}

export interface EntitySearchResult {
  id: string;
  type: string;            // Entity type prefix (person, finding, memory, etc.)
  title: string;
  subtitle?: string;
  body?: string;
  tag: string;
  gravity: number;
  relevance?: number;      // FTS relevance score (bm25)
  created_at?: string;
  source_type: string;     // 'entity' | 'finding' | 'memory' | 'public'
  sourceUrl?: string;      // Original URL for "View Detail" navigation (findings)
}

export interface EntitySearchResponse {
  results: EntitySearchResult[];
  meta: {
    total: number;         // Total matching entities
    returned: number;      // Number returned in this page
    offset: number;        // Current offset
    query_ms: number;      // Query time in ms
  };
}

/**
 * Unified Entity Search
 * 
 * Inspired by Google Knowledge Graph API:
 * - Searches entities, not pages
 * - Returns scored/gravity-ranked results
 * - Filters by type
 * - Supports text search (FTS) via q parameter
 * - Supports pagination
 */
export function searchEntities(params: EntitySearchParams = {}): EntitySearchResponse {
  const startTime = Date.now();
  const db = getDB();

  // ==========================================================================
  // SCHEMA VALIDATION: Check for common migration issues
  // ==========================================================================
  try {
    // Quick check if entity_physics table exists (v34 migration)
    db.query('SELECT 1 FROM entity_physics LIMIT 1').get();
  } catch (err: any) {
    if (err.message?.includes('no such table')) {
      const missingTable = err.message.match(/no such table: (\w+)/)?.[1] || 'unknown';
      console.error(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ SCHEMA ERROR: Missing table "${missingTable}"

This usually means the prism-server binary is outdated.

🔧 FIX: Run these commands in apps/magpie:
   
   pnpm sync:sidecar --force
   
   Then restart the Tauri app.

📖 See: apps/magpie/AGENTS.md for development workflow
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
      throw new Error(`Schema outdated: ${missingTable} table missing. Run 'pnpm sync:sidecar --force' in apps/magpie to update.`);
    }
    throw err;
  }

  const q = params.q?.trim();
  // Add wildcard for prefix search (e.g., "Jul" -> "Jul*" matches "Julian")
  const searchQuery = q ? q.replace(/['"]/g, '') + '*' : undefined;
  
  // Backward compat: `types` is deprecated, prefer `sources`
  const sources = params.sources ?? params.types ?? ['entity', 'finding', 'memory', 'public'];
  // NEW: categories filter for entity ID prefixes
  const categories = params.categories;
  
  const limit = Math.min(params.limit ?? 20, 100);  // Cap at 100
  const offset = params.offset ?? 0;
  const sort = params.sort ?? (q ? 'relevance' : 'gravity');
  const order = params.order ?? 'desc';

  const results: EntitySearchResult[] = [];
  const now = Date.now();

  // ==========================================================================
  // 1. Query internal entities (non-memory, non-public)
  // ==========================================================================
  if (sources.includes('entity')) {
    let entities: any[];

    // Build category filter SQL if categories are specified
    const categoryFilter = categories?.length
      ? categories.map(c => `e.id LIKE '${c}:%'`).join(' OR ')
      : null;

    if (searchQuery) {
      const sql = `
        SELECT e.id, e.title, e.subtitle, e.body, e.tag, e.created_at,
               COALESCE(ph.gravity, 0.3) as gravity,
               bm25(entities_fts) as relevance
        FROM entities_fts fts
        JOIN entities e ON fts.rowid = e.rowid
        LEFT JOIN entity_physics ph ON e.id = ph.entity_id
        WHERE entities_fts MATCH ?
          AND e.id NOT LIKE 'memory:%'
          AND e.id NOT LIKE 'finding:%'
          AND e.id NOT LIKE 'public:%'
          ${categoryFilter ? `AND (${categoryFilter})` : ''}
        ORDER BY relevance
        LIMIT ?
      `;
      entities = db.query(sql).all(searchQuery, limit * 2) as any[];
    } else {
      const sql = `
        SELECT e.id, e.title, e.subtitle, e.body, e.tag, e.created_at,
               COALESCE(ph.gravity, 0.3) as gravity,
               0 as relevance
        FROM entities e
        LEFT JOIN entity_physics ph ON e.id = ph.entity_id
        WHERE e.id NOT LIKE 'memory:%'
          AND e.id NOT LIKE 'finding:%'
          AND e.id NOT LIKE 'public:%'
          AND e.title IS NOT NULL
          AND e.title != ''
          ${categoryFilter ? `AND (${categoryFilter})` : ''}
        ORDER BY gravity DESC
        LIMIT ?
      `;
      entities = db.query(sql).all(limit * 2) as any[];
    }

    for (const e of entities) {
      results.push({
        id: e.id,
        type: e.id.split(':')[0],
        title: e.title,
        subtitle: e.subtitle,
        body: e.body,
        tag: e.tag || e.id.split(':')[0].toUpperCase(),
        gravity: e.gravity,
        created_at: e.created_at,
        source_type: 'entity',
        relevance: e.relevance
      });
    }
  }

  // ==========================================================================
  // 2. Query findings (Scout discoveries)
  // ==========================================================================
  if (sources.includes('finding')) {
    let findings: any[];

    if (searchQuery) {
      // Use text_content (plain text) for fallback body, not HTML content
      findings = db.query(`
        SELECT m.id, m.title, m.fetched_at as created_at, m.url as source_path,
               COALESCE(e.body, substr(m.text_content, 1, 300), substr(m.content, 1, 300)) as body,
               e.subtitle,
               bm25(scout_findings_fts) as relevance
        FROM scout_findings_fts fts
        JOIN scout_findings m ON fts.rowid = m.id
        LEFT JOIN entities e ON e.id = 'finding:' || m.id
        WHERE scout_findings_fts MATCH ?
          AND m.archived = 0
        ORDER BY relevance
        LIMIT ?
      `).all(searchQuery, limit) as any[];
    } else {
      // Use text_content (plain text) for fallback body, not HTML content
      findings = db.query(`
        SELECT m.id, m.title, m.fetched_at as created_at, m.url as source_path,
               COALESCE(e.body, substr(m.text_content, 1, 300), substr(m.content, 1, 300)) as body,
               e.subtitle,
               0 as relevance
        FROM scout_findings m
        LEFT JOIN entities e ON e.id = 'finding:' || m.id
        WHERE m.archived = 0
        ORDER BY m.fetched_at DESC
        LIMIT ?
      `).all(limit) as any[];
    }

    for (const f of findings) {
      const ageHours = (now - new Date(f.created_at).getTime()) / (1000 * 60 * 60);
      const dynamicGravity = 0.5 + Math.max(0, 0.4 * (1 - ageHours / 12));

      results.push({
        id: `finding:${f.id}`,
        type: 'finding',
        title: f.title || 'Untitled Finding',
        subtitle: f.subtitle || 'Scout Discovery',
        body: f.body,
        tag: 'FINDING',
        gravity: dynamicGravity,
        relevance: f.relevance,
        created_at: f.created_at,
        source_type: 'finding',
        sourceUrl: f.source_path  // Original URL for "View Detail" navigation
      });
    }
  }

  // ==========================================================================
  // 3. Query user memories
  // ==========================================================================
  // Sort by ingested_at (when user dropped the file)
  if (sources.includes('memory')) {
    let memories: any[];

    if (searchQuery) {
      memories = db.query(`
        SELECT m.id, m.title, m.ingested_at,
               COALESCE(e.body, substr(m.content, 1, 300)) as body,
               e.subtitle,
               bm25(user_memories_fts) as relevance
        FROM user_memories_fts fts
        JOIN user_memories m ON fts.rowid = m.id
        LEFT JOIN entities e ON e.id = 'memory:' || m.id
        WHERE user_memories_fts MATCH ?
          AND m.archived = 0
        ORDER BY relevance
        LIMIT ?
      `).all(searchQuery, limit) as any[];
    } else {
      memories = db.query(`
        SELECT m.id, m.title, m.ingested_at,
               COALESCE(e.body, substr(m.content, 1, 300)) as body,
               e.subtitle,
               0 as relevance
        FROM user_memories m
        LEFT JOIN entities e ON e.id = 'memory:' || m.id
        WHERE m.archived = 0
        ORDER BY m.ingested_at DESC
        LIMIT ?
      `).all(limit) as any[];
    }

    for (const m of memories) {
      // Use ingested_at for freshness calculation
      const ingestTime = m.ingested_at ? new Date(m.ingested_at).getTime() : Date.now();
      const ageHours = (now - ingestTime) / (1000 * 60 * 60);
      const dynamicGravity = 0.5 + Math.max(0, 0.4 * (1 - ageHours / 12));

      results.push({
        id: `memory:${m.id}`,
        type: 'memory',
        title: m.title || 'Untitled Memory',
        subtitle: m.subtitle || 'Dropped Item',
        body: m.body,
        tag: 'MEMORY',
        gravity: dynamicGravity,
        created_at: m.ingested_at || m.created_at,  // Return ingested_at as the "created" time
        source_type: 'memory'
      });
    }
  }

  // ==========================================================================
  // 4. Query public content
  // ==========================================================================
  if (sources.includes('public')) {
    const publicContent = db.query(`
      SELECT id, title, source_name, body, fetched_at
      FROM public_content
      WHERE is_active = 1
      ORDER BY fetched_at DESC
      LIMIT ?
    `).all(limit) as any[];

    for (const p of publicContent) {
      results.push({
        id: `public:${p.id}`,
        type: 'public',
        title: p.title,
        subtitle: p.source_name,
        body: p.body,
        tag: 'PUBLIC',
        gravity: 0.4,
        created_at: p.fetched_at,
        source_type: 'public'
      });
    }
  }

  // 5. Sort results
  results.sort((a, b) => {
    let comparison = 0;
    switch (sort) {
      case 'relevance':
        comparison = (a.relevance ?? 0) - (b.relevance ?? 0);
        break;
      case 'gravity':
        comparison = b.gravity - a.gravity;
        break;
      case 'created_at':
        comparison = (new Date(b.created_at || 0).getTime()) - (new Date(a.created_at || 0).getTime());
        break;
      case 'title':
        comparison = (a.title || '').localeCompare(b.title || '');
        break;
    }
    return order === 'desc' ? comparison : -comparison;
  });

  // 6. Apply pagination
  const total = results.length;
  const paged = results.slice(offset, offset + limit);

  return {
    results: paged,
    meta: {
      total,
      returned: paged.length,
      offset,
      query_ms: Date.now() - startTime
    }
  };
}
