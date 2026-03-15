/**
 * Database Health Check
 * 
 * Performs integrity checks on startup and provides self-healing capabilities.
 * Local-first apps need to be resilient to corruption (user closing laptop, etc.)
 * 
 * Checks performed:
 * 1. SQLite integrity check (PRAGMA integrity_check)
 * 2. FTS index sync verification
 * 3. Orphaned page_blocks detection
 * 4. Pipeline version consistency
 */

import type { Database } from 'bun:sqlite';
import { checkPipelineVersionMismatch, markOutdatedEntitiesStale, getStaleEntityCount } from './pipeline-version.js';

// =============================================================================
// TYPES
// =============================================================================

export interface HealthIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  autoFixable: boolean;
}

export interface HealthReport {
  healthy: boolean;
  dbVersion: number;
  issues: HealthIssue[];
  stats: {
    totalEntities: number;
    staleEntities: number;
    totalMemories: number;
    totalPageBlocks: number;
    orphanedBlocks: number;
  };
  timestamp: string;
}

// =============================================================================
// HEALTH CHECK FUNCTIONS
// =============================================================================

/**
 * Run comprehensive health check on database.
 */
export function runHealthCheck(db: Database): HealthReport {
  const issues: HealthIssue[] = [];
  const startTime = Date.now();
  
  console.log('[Health] Running database health check...');
  
  // 1. SQLite Integrity Check
  const integrityResult = checkIntegrity(db);
  if (!integrityResult.ok) {
    issues.push({
      severity: 'error',
      code: 'INTEGRITY_FAILED',
      message: integrityResult.message,
      autoFixable: false,
    });
  }
  
  // 2. FTS Index Sync Check
  const ftsResult = checkFTSSync(db);
  if (!ftsResult.memoriesInSync) {
    issues.push({
      severity: 'warning',
      code: 'FTS_MEMORIES_DESYNC',
      message: `Memories FTS index out of sync: ${ftsResult.memoriesDiff} rows difference`,
      autoFixable: true,
    });
  }
  if (!ftsResult.emailsInSync) {
    issues.push({
      severity: 'warning',
      code: 'FTS_EMAILS_DESYNC',
      message: `Emails FTS index out of sync: ${ftsResult.emailsDiff} rows difference`,
      autoFixable: true,
    });
  }
  
  // 3. Orphaned Page Blocks Check
  const orphanedCount = checkOrphanedPageBlocks(db);
  if (orphanedCount > 0) {
    issues.push({
      severity: 'warning',
      code: 'ORPHANED_PAGE_BLOCKS',
      message: `Found ${orphanedCount} page_blocks referencing non-existent entities`,
      autoFixable: true,
    });
  }
  
  // 4. Pipeline Version Check
  const pipelineCheck = checkPipelineVersionMismatch();
  if (pipelineCheck.hasMismatch) {
    issues.push({
      severity: 'info',
      code: 'PIPELINE_VERSION_MISMATCH',
      message: `${pipelineCheck.outdatedCount} entities have outdated pipeline version (current: ${pipelineCheck.currentVersion})`,
      autoFixable: true,
    });
  }
  
  // Gather stats
  const stats = gatherStats(db);
  
  const report: HealthReport = {
    healthy: issues.filter(i => i.severity === 'error').length === 0,
    dbVersion: (db.query('PRAGMA user_version').get() as { user_version: number })?.user_version ?? 0,
    issues,
    stats: {
      ...stats,
      orphanedBlocks: orphanedCount,
    },
    timestamp: new Date().toISOString(),
  };
  
  const elapsed = Date.now() - startTime;
  console.log(`[Health] Check completed in ${elapsed}ms`);
  console.log(`[Health] Status: ${report.healthy ? '✓ Healthy' : '✗ Issues found'}`);
  
  if (issues.length > 0) {
    console.log('[Health] Issues:');
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '⚠' : 'ℹ';
      console.log(`  ${icon} [${issue.code}] ${issue.message}`);
    }
  }
  
  return report;
}

/**
 * Check SQLite database integrity.
 */
function checkIntegrity(db: Database): { ok: boolean; message: string } {
  try {
    const result = db.query('PRAGMA integrity_check').all() as { integrity_check: string }[];
    const status = result[0]?.integrity_check;
    
    if (status === 'ok') {
      return { ok: true, message: 'Database integrity verified' };
    } else {
      return { ok: false, message: `Integrity check failed: ${status}` };
    }
  } catch (error) {
    return { ok: false, message: `Integrity check error: ${error}` };
  }
}

/**
 * Check if FTS indexes are in sync with source tables.
 */
function checkFTSSync(db: Database): {
  memoriesInSync: boolean;
  memoriesDiff: number;
  emailsInSync: boolean;
  emailsDiff: number;
} {
  // Check memories FTS sync (user_memories + scout_findings)
  let memoriesCount = 0;
  let memoriesFTSCount = 0;
  try {
    const userCount = (db.query('SELECT COUNT(*) as c FROM user_memories').get() as { c: number }).c;
    const scoutCount = (db.query('SELECT COUNT(*) as c FROM scout_findings').get() as { c: number })?.c || 0;
    memoriesCount = userCount + scoutCount;
    const userFTSCount = (db.query('SELECT COUNT(*) as c FROM user_memories_fts').get() as { c: number }).c;
    const scoutFTSCount = (db.query('SELECT COUNT(*) as c FROM scout_findings_fts').get() as { c: number })?.c || 0;
    memoriesFTSCount = userFTSCount + scoutFTSCount;
  } catch {
    // Table might not exist yet
  }
  
  // Check emails FTS sync
  let emailsCount = 0;
  let emailsFTSCount = 0;
  try {
    emailsCount = (db.query('SELECT COUNT(*) as c FROM emails').get() as { c: number }).c;
    emailsFTSCount = (db.query('SELECT COUNT(*) as c FROM emails_fts').get() as { c: number }).c;
  } catch {
    // Table might not exist yet
  }
  
  return {
    memoriesInSync: memoriesCount === memoriesFTSCount,
    memoriesDiff: Math.abs(memoriesCount - memoriesFTSCount),
    emailsInSync: emailsCount === emailsFTSCount,
    emailsDiff: Math.abs(emailsCount - emailsFTSCount),
  };
}

/**
 * Check for page_blocks that reference non-existent entities.
 */
function checkOrphanedPageBlocks(db: Database): number {
  try {
    const result = db.query(`
      SELECT COUNT(*) as c FROM page_blocks pb
      LEFT JOIN entities e ON pb.block_id = e.id
      WHERE e.id IS NULL
    `).get() as { c: number };
    return result.c;
  } catch {
    return 0;
  }
}

/**
 * Gather database statistics.
 */
function gatherStats(db: Database): {
  totalEntities: number;
  staleEntities: number;
  totalMemories: number;
  totalPageBlocks: number;
} {
  let totalEntities = 0;
  let staleEntities = 0;
  let totalMemories = 0;
  let totalPageBlocks = 0;
  
  try {
    totalEntities = (db.query('SELECT COUNT(*) as c FROM entities').get() as { c: number }).c;
  } catch { /* ignore */ }
  
  try {
    staleEntities = getStaleEntityCount();
  } catch { /* ignore */ }
  
  try {
    totalMemories = (db.query('SELECT COUNT(*) as c FROM user_memories').get() as { c: number }).c;
  } catch { /* ignore */ }
  
  try {
    totalPageBlocks = (db.query('SELECT COUNT(*) as c FROM page_blocks').get() as { c: number }).c;
  } catch { /* ignore */ }
  
  return { totalEntities, staleEntities, totalMemories, totalPageBlocks };
}

// =============================================================================
// SELF-HEALING FUNCTIONS
// =============================================================================

/**
 * Attempt to fix auto-fixable issues.
 */
export function selfHeal(db: Database, report: HealthReport): {
  fixed: string[];
  failed: string[];
} {
  const fixed: string[] = [];
  const failed: string[] = [];
  
  console.log('[Health] Running self-heal for auto-fixable issues...');
  
  for (const issue of report.issues) {
    if (!issue.autoFixable) continue;
    
    try {
      switch (issue.code) {
        case 'FTS_MEMORIES_DESYNC':
          rebuildMemoriesFTS(db);
          fixed.push(issue.code);
          break;
          
        case 'FTS_EMAILS_DESYNC':
          rebuildEmailsFTS(db);
          fixed.push(issue.code);
          break;
          
        case 'ORPHANED_PAGE_BLOCKS':
          removeOrphanedPageBlocks(db);
          fixed.push(issue.code);
          break;
          
        case 'PIPELINE_VERSION_MISMATCH':
          const marked = markOutdatedEntitiesStale();
          console.log(`[Health] Marked ${marked} entities as stale for re-extraction`);
          fixed.push(issue.code);
          break;
          
        default:
          failed.push(issue.code);
      }
    } catch (error) {
      console.error(`[Health] Failed to fix ${issue.code}: ${error}`);
      failed.push(issue.code);
    }
  }
  
  if (fixed.length > 0) {
    console.log(`[Health] Fixed: ${fixed.join(', ')}`);
  }
  if (failed.length > 0) {
    console.log(`[Health] Failed to fix: ${failed.join(', ')}`);
  }
  
  return { fixed, failed };
}

/**
 * Rebuild memories FTS index from source table.
 */
function rebuildMemoriesFTS(db: Database): void {
  console.log('[Health] Rebuilding memories FTS index...');
  
  db.transaction(() => {
    // Clear and rebuild user_memories FTS
    db.exec("INSERT INTO user_memories_fts(user_memories_fts) VALUES('delete-all')");
    db.exec(`
      INSERT INTO user_memories_fts(rowid, title, content)
      SELECT id, title, content FROM user_memories
    `);
    
    // Clear and rebuild scout_findings FTS if table exists
    try {
      db.exec("INSERT INTO scout_findings_fts(scout_findings_fts) VALUES('delete-all')");
      db.exec(`
        INSERT INTO scout_findings_fts(rowid, title, content)
        SELECT id, title, content FROM scout_findings
      `);
    } catch { /* Table might not exist */ }
  })();
  
  console.log('[Health] Source layer FTS indexes rebuilt');
}

/**
 * Rebuild emails FTS index from source table.
 */
function rebuildEmailsFTS(db: Database): void {
  console.log('[Health] Rebuilding emails FTS index...');
  
  db.transaction(() => {
    // Clear FTS table
    db.exec("INSERT INTO emails_fts(emails_fts) VALUES('delete-all')");
    
    // Repopulate from source
    db.exec(`
      INSERT INTO emails_fts(rowid, subject, body_text)
      SELECT internal_id, subject, body_text FROM emails
    `);
  })();
  
  console.log('[Health] Emails FTS index rebuilt');
}

/**
 * Remove page_blocks that reference non-existent entities.
 */
function removeOrphanedPageBlocks(db: Database): void {
  console.log('[Health] Removing orphaned page_blocks...');
  
  const result = db.query(`
    DELETE FROM page_blocks WHERE block_id NOT IN (SELECT id FROM entities)
  `).run();
  
  console.log(`[Health] Removed ${result.changes} orphaned page_blocks`);
}




