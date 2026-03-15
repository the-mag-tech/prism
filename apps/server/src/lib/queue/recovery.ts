/**
 * Prism Queue Recovery
 * 
 * Handles recovery of pending tasks after crash/restart.
 * Scans the main Prism database for entities/memories that
 * need processing and re-enqueues them.
 * 
 * Recovery scenarios:
 * 1. extraction_status = 'pending' → re-queue extraction
 * 2. Entities with stale profiles → re-queue scout
 * 
 * @ref worker/checklist
 * @since 2026-01-07
 */

import { getDB } from '../../db.js';
import { log, logWarn } from '../logger.js';
import {
  enqueueExtraction,
  enqueueScout,
  isQueueInitialized,
} from './client.js';

// =============================================================================
// RECOVERY FUNCTIONS
// =============================================================================

/**
 * Recover pending extraction tasks
 * 
 * Finds entities with extraction_status = 'pending' and re-queues them.
 */
export async function recoverPendingExtractions(): Promise<number> {
  if (!isQueueInitialized()) {
    logWarn('[Recovery] Queue not initialized, skipping extraction recovery');
    return 0;
  }

  const db = getDB();
  
  const pendingEntities = db.query(`
    SELECT id, memo_id 
    FROM entities 
    WHERE extraction_status = 'pending'
    AND memo_id IS NOT NULL
  `).all() as Array<{ id: string; memo_id: number }>;

  if (pendingEntities.length === 0) {
    log('[Recovery] No pending extractions to recover');
    return 0;
  }

  log(`[Recovery] Found ${pendingEntities.length} pending extractions, re-queueing...`);

  let queued = 0;
  for (const entity of pendingEntities) {
    try {
      await enqueueExtraction({
        memoryId: entity.memo_id,
        entityId: entity.id,
        trigger: 'startup_recovery',
      });
      queued++;
    } catch (error) {
      logWarn(`[Recovery] Failed to queue extraction for ${entity.id}:`, error);
    }
  }

  log(`[Recovery] ✓ Queued ${queued}/${pendingEntities.length} pending extractions`);
  return queued;
}

/**
 * Recover stale scout tasks
 * 
 * Finds high-gravity entities that haven't been scouted recently
 * and re-queues them.
 */
export async function recoverStaleScouts(): Promise<number> {
  if (!isQueueInitialized()) {
    logWarn('[Recovery] Queue not initialized, skipping scout recovery');
    return 0;
  }

  const db = getDB();
  
  // Find entities with high gravity that haven't been scouted in 24+ hours
  const staleEntities = db.query(`
    SELECT 
      p.id, 
      p.title,
      COALESCE(r.gravity_score, ph.gravity, 0.5) as gravity
    FROM entity_profiles p
    LEFT JOIN entity_physics ph ON p.id = ph.entity_id
    LEFT JOIN render_frame_buffer r ON p.id = r.entity_id AND r.frame_id = 'global'
    WHERE 
      p.id NOT LIKE 'system:%' 
      AND p.id NOT LIKE 'singleton:%'
      AND p.id NOT LIKE 'finding:%'
      AND p.id NOT LIKE 'memory:%'
      AND COALESCE(r.gravity_score, ph.gravity, 0.5) > 0.7
      AND (
        p.last_scouted_at IS NULL 
        OR (julianday('now') - julianday(p.last_scouted_at)) * 24 > 24
      )
    ORDER BY COALESCE(r.gravity_score, ph.gravity, 0.5) DESC
    LIMIT 10
  `).all() as Array<{ id: string; title: string; gravity: number }>;

  if (staleEntities.length === 0) {
    log('[Recovery] No stale scouts to recover');
    return 0;
  }

  log(`[Recovery] Found ${staleEntities.length} stale scouts, re-queueing...`);

  let queued = 0;
  for (const entity of staleEntities) {
    try {
      await enqueueScout({
        entityId: entity.id,
        entityTitle: entity.title,
        gravity: entity.gravity,
        trigger: 'startup_recovery',
      });
      queued++;
    } catch (error) {
      logWarn(`[Recovery] Failed to queue scout for ${entity.id}:`, error);
    }
  }

  log(`[Recovery] ✓ Queued ${queued}/${staleEntities.length} stale scouts`);
  return queued;
}

/**
 * Run all recovery tasks
 */
export async function runStartupRecovery(): Promise<{
  extractions: number;
  scouts: number;
}> {
  log('[Recovery] Starting recovery scan...');
  
  const extractions = await recoverPendingExtractions();
  const scouts = await recoverStaleScouts();
  
  log(`[Recovery] ✓ Recovery complete: ${extractions} extractions, ${scouts} scouts queued`);
  
  return { extractions, scouts };
}
