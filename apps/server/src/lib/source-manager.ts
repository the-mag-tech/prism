/**
 * Source Manager - Query Utilities for Source Layer
 * 
 * Simple query functions for user_memories and scout_findings tables.
 * NOT an abstraction layer - just convenience functions.
 * 
 * Design Decision:
 * - No interface/class abstraction (violates "minimum complexity" principle)
 * - user_memories and scout_findings have different semantics
 * - Will consider abstraction if pattern appears 3+ times
 * 
 * @since 2026-01-08
 */

import { getDB } from '../db.js';
import type { Database } from 'bun:sqlite';

// =============================================================================
// TYPES
// =============================================================================

export interface UserMemory {
  id: number;
  title: string | null;
  content: string;
  text_content: string | null;
  source_type: string;
  source_url: string | null;
  extraction_status: 'pending' | 'completed' | 'failed' | 'skipped';
  extraction_error: string | null;
  archived: number;
  version: number;
  ingested_at: string;
  extracted_at: string | null;
  entity_id: string | null;
}

export interface ScoutFinding {
  id: number;
  title: string | null;
  content: string | null;
  text_content: string | null;
  url: string;
  triggered_by: string | null;
  extraction_status: 'pending' | 'completed' | 'failed' | 'skipped';
  extraction_error: string | null;
  health_status: 'healthy' | 'stale' | 'dead' | 'unknown';
  last_health_check: string | null;
  http_status: number | null;
  archived: number;
  version: number;
  fetched_at: string;
  extracted_at: string | null;
  entity_id: string | null;
}

export interface SourceStats {
  userMemories: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    archived: number;
  };
  scoutFindings: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    archived: number;
    healthy: number;
    stale: number;
    dead: number;
  };
}

// =============================================================================
// USER MEMORIES
// =============================================================================

/**
 * Get user memories with optional filters
 */
export function getUserMemories(options: {
  archived?: boolean;
  status?: 'pending' | 'completed' | 'failed' | 'skipped';
  sourceType?: string;
  limit?: number;
} = {}): UserMemory[] {
  const db = getDB();
  
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  
  if (options.archived !== undefined) {
    conditions.push('archived = ?');
    params.push(options.archived ? 1 : 0);
  }
  
  if (options.status) {
    conditions.push('extraction_status = ?');
    params.push(options.status);
  }
  
  if (options.sourceType) {
    conditions.push('source_type = ?');
    params.push(options.sourceType);
  }
  
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ? `LIMIT ${options.limit}` : '';
  
  return db.query(`
    SELECT * FROM user_memories ${where} ORDER BY ingested_at DESC ${limit}
  `).all(...params) as UserMemory[];
}

/**
 * Get a single user memory by ID
 */
export function getUserMemoryById(id: number): UserMemory | null {
  const db = getDB();
  return db.query('SELECT * FROM user_memories WHERE id = ?').get(id) as UserMemory | null;
}

/**
 * Get user memory by entity ID (e.g., 'memory:123')
 */
export function getUserMemoryByEntityId(entityId: string): UserMemory | null {
  const db = getDB();
  return db.query('SELECT * FROM user_memories WHERE entity_id = ?').get(entityId) as UserMemory | null;
}

/**
 * Mark user memory as extracted
 */
export function markUserMemoryExtracted(id: number, error?: string): void {
  const db = getDB();
  if (error) {
    db.query(`
      UPDATE user_memories 
      SET extraction_status = 'failed', extraction_error = ?, extracted_at = datetime('now')
      WHERE id = ?
    `).run(error, id);
  } else {
    db.query(`
      UPDATE user_memories 
      SET extraction_status = 'completed', extracted_at = datetime('now')
      WHERE id = ?
    `).run(id);
  }
}

/**
 * Archive a user memory (soft delete)
 */
export function archiveUserMemory(id: number): void {
  const db = getDB();
  db.query(`
    UPDATE user_memories 
    SET archived = 1, archived_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

/**
 * Delete a user memory (hard delete)
 * Used by Curator/Merger when consolidating duplicate memories
 */
export function deleteUserMemory(id: number): void {
  const db = getDB();
  db.query(`DELETE FROM user_memories WHERE id = ?`).run(id);
}

// =============================================================================
// SCOUT FINDINGS
// =============================================================================

/**
 * Get scout findings with optional filters
 */
export function getScoutFindings(options: {
  archived?: boolean;
  status?: 'pending' | 'completed' | 'failed' | 'skipped';
  triggeredBy?: string;
  healthStatus?: 'healthy' | 'stale' | 'dead' | 'unknown';
  limit?: number;
} = {}): ScoutFinding[] {
  const db = getDB();
  
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  
  if (options.archived !== undefined) {
    conditions.push('archived = ?');
    params.push(options.archived ? 1 : 0);
  }
  
  if (options.status) {
    conditions.push('extraction_status = ?');
    params.push(options.status);
  }
  
  if (options.triggeredBy) {
    conditions.push('triggered_by = ?');
    params.push(options.triggeredBy);
  }
  
  if (options.healthStatus) {
    conditions.push('health_status = ?');
    params.push(options.healthStatus);
  }
  
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ? `LIMIT ${options.limit}` : '';
  
  return db.query(`
    SELECT * FROM scout_findings ${where} ORDER BY fetched_at DESC ${limit}
  `).all(...params) as ScoutFinding[];
}

/**
 * Get a single scout finding by ID
 */
export function getScoutFindingById(id: number): ScoutFinding | null {
  const db = getDB();
  return db.query('SELECT * FROM scout_findings WHERE id = ?').get(id) as ScoutFinding | null;
}

/**
 * Get scout finding by entity ID (e.g., 'finding:123')
 */
export function getScoutFindingByEntityId(entityId: string): ScoutFinding | null {
  const db = getDB();
  return db.query('SELECT * FROM scout_findings WHERE entity_id = ?').get(entityId) as ScoutFinding | null;
}

/**
 * Get scout finding by URL
 */
export function getScoutFindingByUrl(url: string): ScoutFinding | null {
  const db = getDB();
  return db.query('SELECT * FROM scout_findings WHERE url = ?').get(url) as ScoutFinding | null;
}

/**
 * Mark scout finding as extracted
 */
export function markScoutFindingExtracted(id: number, error?: string): void {
  const db = getDB();
  if (error) {
    db.query(`
      UPDATE scout_findings 
      SET extraction_status = 'failed', extraction_error = ?, extracted_at = datetime('now')
      WHERE id = ?
    `).run(error, id);
  } else {
    db.query(`
      UPDATE scout_findings 
      SET extraction_status = 'completed', extracted_at = datetime('now')
      WHERE id = ?
    `).run(id);
  }
}

/**
 * Update health status for a scout finding
 */
export function updateScoutFindingHealth(
  id: number, 
  status: 'healthy' | 'stale' | 'dead' | 'unknown',
  httpStatus?: number
): void {
  const db = getDB();
  db.query(`
    UPDATE scout_findings 
    SET health_status = ?, http_status = ?, last_health_check = datetime('now')
    WHERE id = ?
  `).run(status, httpStatus ?? null, id);
}

/**
 * Archive a scout finding (soft delete)
 */
export function archiveScoutFinding(id: number): void {
  const db = getDB();
  db.query(`
    UPDATE scout_findings 
    SET archived = 1, archived_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

// =============================================================================
// COMBINED QUERIES
// =============================================================================

/**
 * Get counts of pending sources for extraction pipeline
 */
export function getPendingSources(): { memories: number; findings: number } {
  const db = getDB();
  
  const memories = db.query(`
    SELECT COUNT(*) as count FROM user_memories 
    WHERE extraction_status = 'pending' AND archived = 0
  `).get() as { count: number };
  
  const findings = db.query(`
    SELECT COUNT(*) as count FROM scout_findings 
    WHERE extraction_status = 'pending' AND archived = 0
  `).get() as { count: number };
  
  return {
    memories: memories.count,
    findings: findings.count,
  };
}

/**
 * Get comprehensive source statistics
 */
export function getSourceStats(): SourceStats {
  const db = getDB();
  
  // User memories stats
  const userStats = db.query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN extraction_status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN extraction_status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN extraction_status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) as archived
    FROM user_memories
  `).get() as { total: number; pending: number; completed: number; failed: number; archived: number };
  
  // Scout findings stats
  const scoutStats = db.query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN extraction_status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN extraction_status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN extraction_status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) as archived,
      SUM(CASE WHEN health_status = 'healthy' THEN 1 ELSE 0 END) as healthy,
      SUM(CASE WHEN health_status = 'stale' THEN 1 ELSE 0 END) as stale,
      SUM(CASE WHEN health_status = 'dead' THEN 1 ELSE 0 END) as dead
    FROM scout_findings
  `).get() as { 
    total: number; pending: number; completed: number; failed: number; archived: number;
    healthy: number; stale: number; dead: number;
  };
  
  return {
    userMemories: userStats,
    scoutFindings: scoutStats,
  };
}

/**
 * Search across both source tables using FTS
 */
export function searchSources(query: string, limit: number = 20): Array<{
  type: 'memory' | 'finding';
  id: number;
  title: string | null;
  snippet: string;
  source_url: string | null;
}> {
  const db = getDB();
  const results: Array<{ type: 'memory' | 'finding'; id: number; title: string | null; snippet: string; source_url: string | null }> = [];
  
  // Search user_memories
  const memories = db.query(`
    SELECT um.id, um.title, um.source_url,
           snippet(user_memories_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
    FROM user_memories_fts
    JOIN user_memories um ON um.id = user_memories_fts.rowid
    WHERE user_memories_fts MATCH ?
    AND um.archived = 0
    LIMIT ?
  `).all(query, Math.floor(limit / 2)) as Array<{ id: number; title: string | null; source_url: string | null; snippet: string }>;
  
  for (const m of memories) {
    results.push({ type: 'memory', ...m });
  }
  
  // Search scout_findings
  const findings = db.query(`
    SELECT sf.id, sf.title, sf.url as source_url,
           snippet(scout_findings_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
    FROM scout_findings_fts
    JOIN scout_findings sf ON sf.id = scout_findings_fts.rowid
    WHERE scout_findings_fts MATCH ?
    AND sf.archived = 0
    LIMIT ?
  `).all(query, Math.floor(limit / 2)) as Array<{ id: number; title: string | null; source_url: string | null; snippet: string }>;
  
  for (const f of findings) {
    results.push({ type: 'finding', ...f });
  }
  
  return results;
}
