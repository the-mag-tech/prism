/**
 * Data Gap Detector
 *
 * @ref data-gap/detect-gaps
 * @doc docs/DATA-GAP-DETECTION.md#6
 *
 * Core logic for detecting missing relationships in the knowledge graph.
 * Integrated into the Search Module as the "security checkpoint".
 */

import { getDB } from '../../db.js';
import { log, logError } from '../logger.js';
import {
  ENTITY_SCHEMA_EXPECTATIONS,
  getExpectationsForType,
  getHighPriorityExpectations,
  generateGapQuery,
  type ExpectedRelation,
  type GapPriority,
} from '@prism/contract';

// ============================================
// Types
// ============================================

export interface DataGap {
  id?: number;
  entityId: string;
  entityType: string;
  missingRelation: string;
  expectedTargetType: string;
  priority: GapPriority;
  suggestedQueries: string[];
  reasoning: string;
  reasoningZh: string;
  status: 'open' | 'searching' | 'filled' | 'unfillable';
  searchAttempts: number;
}

export interface GapDetectionResult {
  entityId: string;
  gaps: DataGap[];
  existingRelations: string[];
  completeness: number; // 0-1: ratio of filled expectations
}

// ============================================
// Core Detection
// ============================================

/**
 * Detect gaps for a single entity
 */
export function detectGaps(entityId: string): GapDetectionResult {
  const db = getDB();
  const [entityType] = entityId.split(':');

  // 1. Get expectations for this entity type
  const expectations = getExpectationsForType(entityType);
  if (expectations.length === 0) {
    return {
      entityId,
      gaps: [],
      existingRelations: [],
      completeness: 1.0,
    };
  }

  // 2. Get existing relations for this entity
  const existingRelations = db
    .query(
      `
    SELECT DISTINCT type FROM relations 
    WHERE source = ? OR target = ?
  `
    )
    .all(entityId, entityId) as { type: string }[];

  const existingTypes = new Set(existingRelations.map((r) => r.type));

  // 3. Get entity title for query generation
  const entityRow = db
    .query(`SELECT title FROM entities WHERE id = ?`)
    .get(entityId) as { title: string } | null;
  const entityTitle = entityRow?.title || entityId.split(':')[1]?.replace(/_/g, ' ') || entityId;

  // 4. Identify gaps
  const gaps: DataGap[] = [];

  for (const exp of expectations) {
    if (!existingTypes.has(exp.relation)) {
      const query = generateGapQuery(exp.queryTemplate, entityTitle);

      gaps.push({
        entityId,
        entityType,
        missingRelation: exp.relation,
        expectedTargetType: exp.targetType,
        priority: exp.priority,
        suggestedQueries: [query],
        reasoning: exp.description,
        reasoningZh: exp.descriptionZh,
        status: 'open',
        searchAttempts: 0,
      });
    }
  }

  // 5. Calculate completeness
  const completeness = expectations.length > 0 ? (expectations.length - gaps.length) / expectations.length : 1.0;

  return {
    entityId,
    gaps,
    existingRelations: Array.from(existingTypes),
    completeness,
  };
}

/**
 * Detect gaps for multiple entities (batch)
 */
export function detectGapsForEntities(entityIds: string[]): DataGap[] {
  const allGaps: DataGap[] = [];

  for (const entityId of entityIds) {
    const result = detectGaps(entityId);
    allGaps.push(...result.gaps);
  }

  return allGaps;
}

/**
 * Get only high-priority gaps (critical + high)
 */
export function detectHighPriorityGaps(entityId: string): DataGap[] {
  const result = detectGaps(entityId);
  return result.gaps.filter((g) => g.priority === 'critical' || g.priority === 'high');
}

// ============================================
// Database Operations
// ============================================

/**
 * Insert or update a data gap
 */
export function upsertGap(gap: DataGap): number {
  const db = getDB();

  const result = db
    .query(
      `
    INSERT INTO data_gaps (
      entity_id, entity_type, missing_relation, expected_target_type,
      priority, suggested_queries, reasoning, reasoning_zh, status, search_attempts
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_id, missing_relation) DO UPDATE SET
      expected_target_type = excluded.expected_target_type,
      priority = excluded.priority,
      suggested_queries = excluded.suggested_queries,
      reasoning = excluded.reasoning,
      reasoning_zh = excluded.reasoning_zh,
      updated_at = datetime('now')
  `
    )
    .run(
      gap.entityId,
      gap.entityType,
      gap.missingRelation,
      gap.expectedTargetType,
      gap.priority,
      JSON.stringify(gap.suggestedQueries),
      gap.reasoning,
      gap.reasoningZh,
      gap.status,
      gap.searchAttempts
    );

  // Get the ID of the inserted/updated row
  const row = db
    .query(`SELECT id FROM data_gaps WHERE entity_id = ? AND missing_relation = ?`)
    .get(gap.entityId, gap.missingRelation) as { id: number };

  return row.id;
}

/**
 * Batch insert gaps (more efficient)
 */
export function insertGaps(gaps: DataGap[]): number {
  if (gaps.length === 0) return 0;

  const db = getDB();
  let inserted = 0;

  db.transaction(() => {
    for (const gap of gaps) {
      try {
        upsertGap(gap);
        inserted++;
      } catch (e) {
        // Ignore duplicates
      }
    }
  })();

  return inserted;
}

/**
 * Get open gaps for an entity
 */
export function getOpenGaps(
  entityId: string,
  options?: { priority?: GapPriority[] }
): DataGap[] {
  const db = getDB();

  let query = `
    SELECT * FROM data_gaps 
    WHERE entity_id = ? AND status = 'open'
  `;
  const params: any[] = [entityId];

  if (options?.priority && options.priority.length > 0) {
    const placeholders = options.priority.map(() => '?').join(',');
    query += ` AND priority IN (${placeholders})`;
    params.push(...options.priority);
  }

  query += ` ORDER BY 
    CASE priority 
      WHEN 'critical' THEN 1 
      WHEN 'high' THEN 2 
      WHEN 'medium' THEN 3 
      ELSE 4 
    END`;

  const rows = db.query(query).all(...params) as any[];

  return rows.map(rowToGap);
}

/**
 * Get all open gaps, optionally filtered by priority
 */
export function getAllOpenGaps(options?: {
  priority?: GapPriority[];
  limit?: number;
  entityType?: string;
}): DataGap[] {
  const db = getDB();

  let query = `SELECT * FROM data_gaps WHERE status = 'open'`;
  const params: any[] = [];

  if (options?.priority && options.priority.length > 0) {
    const placeholders = options.priority.map(() => '?').join(',');
    query += ` AND priority IN (${placeholders})`;
    params.push(...options.priority);
  }

  if (options?.entityType) {
    query += ` AND entity_type = ?`;
    params.push(options.entityType);
  }

  query += ` ORDER BY 
    CASE priority 
      WHEN 'critical' THEN 1 
      WHEN 'high' THEN 2 
      WHEN 'medium' THEN 3 
      ELSE 4 
    END,
    search_attempts ASC,
    created_at ASC`;

  if (options?.limit) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  const rows = db.query(query).all(...params) as any[];

  return rows.map(rowToGap);
}

/**
 * Mark a gap as filled
 */
export function markGapFilled(gapId: number, filledBy: string): void {
  const db = getDB();

  db.query(
    `
    UPDATE data_gaps SET 
      status = 'filled',
      filled_at = datetime('now'),
      filled_by = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(filledBy, gapId);
}

/**
 * Mark a gap as filled by entity_id and relation
 */
export function markGapFilledByRelation(
  entityId: string,
  relation: string,
  filledBy: string
): void {
  const db = getDB();

  db.query(
    `
    UPDATE data_gaps SET 
      status = 'filled',
      filled_at = datetime('now'),
      filled_by = ?,
      updated_at = datetime('now')
    WHERE entity_id = ? AND missing_relation = ?
  `
  ).run(filledBy, entityId, relation);
}

/**
 * Increment search attempts for a gap
 */
export function incrementSearchAttempts(gapId: number): void {
  const db = getDB();

  db.query(
    `
    UPDATE data_gaps SET 
      search_attempts = search_attempts + 1,
      last_search_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(gapId);
}

/**
 * Mark gap as unfillable (after too many failed attempts)
 */
export function markGapUnfillable(gapId: number): void {
  const db = getDB();

  db.query(
    `
    UPDATE data_gaps SET 
      status = 'unfillable',
      updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(gapId);
}

// ============================================
// Statistics
// ============================================

export interface GapStats {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byEntityType: Record<string, number>;
  avgSearchAttempts: number;
  recentlyFilled: number;
}

export function getGapStats(): GapStats {
  const db = getDB();

  const total = (db.query(`SELECT COUNT(*) as cnt FROM data_gaps`).get() as { cnt: number }).cnt;

  const byStatus = db
    .query(`SELECT status, COUNT(*) as cnt FROM data_gaps GROUP BY status`)
    .all() as { status: string; cnt: number }[];

  const byPriority = db
    .query(`SELECT priority, COUNT(*) as cnt FROM data_gaps GROUP BY priority`)
    .all() as { priority: string; cnt: number }[];

  const byEntityType = db
    .query(`SELECT entity_type, COUNT(*) as cnt FROM data_gaps GROUP BY entity_type ORDER BY cnt DESC LIMIT 10`)
    .all() as { entity_type: string; cnt: number }[];

  const avgRow = db
    .query(`SELECT AVG(search_attempts) as avg FROM data_gaps WHERE status = 'open'`)
    .get() as { avg: number };

  const recentlyFilled = (
    db
      .query(`SELECT COUNT(*) as cnt FROM data_gaps WHERE filled_at > datetime('now', '-7 days')`)
      .get() as { cnt: number }
  ).cnt;

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.cnt])),
    byPriority: Object.fromEntries(byPriority.map((r) => [r.priority, r.cnt])),
    byEntityType: Object.fromEntries(byEntityType.map((r) => [r.entity_type, r.cnt])),
    avgSearchAttempts: avgRow.avg || 0,
    recentlyFilled,
  };
}

// ============================================
// Helpers
// ============================================

function rowToGap(row: any): DataGap {
  return {
    id: row.id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    missingRelation: row.missing_relation,
    expectedTargetType: row.expected_target_type,
    priority: row.priority as GapPriority,
    suggestedQueries: JSON.parse(row.suggested_queries || '[]'),
    reasoning: row.reasoning,
    reasoningZh: row.reasoning_zh,
    status: row.status,
    searchAttempts: row.search_attempts,
  };
}

// ============================================
// Integration: Detect and Store
// ============================================

/**
 * Detect gaps for entities and store them in the database
 * Returns the number of new gaps stored
 */
export function detectAndStoreGaps(entityIds: string[]): number {
  const gaps = detectGapsForEntities(entityIds);
  const inserted = insertGaps(gaps);

  if (inserted > 0) {
    log(`[DataGap] Detected and stored ${inserted} gaps for ${entityIds.length} entities`);
  }

  return inserted;
}

/**
 * Check if a newly created relation fills any gaps
 */
export function checkRelationFillsGap(
  sourceId: string,
  targetId: string,
  relationType: string,
  filledBy: string
): boolean {
  const db = getDB();

  // Check if source has a gap for this relation type
  const sourceGap = db
    .query(
      `
    SELECT id FROM data_gaps 
    WHERE entity_id = ? AND missing_relation = ? AND status = 'open'
  `
    )
    .get(sourceId, relationType) as { id: number } | null;

  if (sourceGap) {
    markGapFilled(sourceGap.id, filledBy);
    log(`[DataGap] ✓ Filled gap: ${sourceId} → ${relationType}`);
    return true;
  }

  // Check reverse: target has a gap that this relation fills
  // (e.g., company:x has gap 'founded_by', and we add person:y → founded → company:x)
  const reverseRelationType = getReverseRelation(relationType);
  if (reverseRelationType) {
    const targetGap = db
      .query(
        `
      SELECT id FROM data_gaps 
      WHERE entity_id = ? AND missing_relation = ? AND status = 'open'
    `
      )
      .get(targetId, reverseRelationType) as { id: number } | null;

    if (targetGap) {
      markGapFilled(targetGap.id, filledBy);
      log(`[DataGap] ✓ Filled gap (reverse): ${targetId} → ${reverseRelationType}`);
      return true;
    }
  }

  return false;
}

/**
 * Get reverse relation type (e.g., 'created' ↔ 'created_by')
 */
function getReverseRelation(relationType: string): string | null {
  const reverseMap: Record<string, string> = {
    created: 'created_by',
    created_by: 'created',
    works_at: 'employs',
    employs: 'works_at',
    founded_by: 'founded',
    founded: 'founded_by',
    owns: 'owned_by',
    owned_by: 'owns',
    // Add more as needed
  };

  return reverseMap[relationType] || null;
}
