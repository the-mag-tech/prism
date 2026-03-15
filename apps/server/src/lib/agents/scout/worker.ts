/**
 * Scout Worker
 * 
 * Processes entity scouting/research tasks.
 * 
 * Guards: Search availability + Quota
 * 
 * Flow:
 * 1. Check guards (search + quota)
 * 2. Execute patrol via ScoutAgent
 * 3. On success: consume quota, update last_scouted_at, trigger Ripple
 * 4. Log results to agent_logs table via AgentLogger
 * 
 * @since 2026-01-07
 * @since 2026-01-08 Added AgentLogger for database persistence
 */

import { log, logError } from '../../logger.js';
import { AgentLogger } from '../../agent-logger.js';
import { executeGuard, guardSearchWorker } from '../../queue/guards.js';
import type { Job } from '../../queue/bun-queue.js';
import type { ScoutTask } from '../../queue/types.js';

// Shared logger instance for all scout operations
const logger = new AgentLogger('scout');

/**
 * Handle scout task
 */
export async function handleScoutTask(job: Job<ScoutTask>): Promise<void> {
  const { entityId, entityTitle, trigger, gravity } = job.data;
  
  // Start tracking operation (persisted to agent_logs table)
  const handle = logger.start(
    'patrol',
    { entityId, entityTitle, trigger, gravity, jobId: job.id },
    job.id,
    entityId
  );

  // Guard: Check search + quota
  const canProceed = await executeGuard(
    () => guardSearchWorker('ScoutWorker'),
    'ScoutWorker',
    job.id
  );
  
  if (!canProceed) {
    handle.skip('Guard blocked (search unavailable or quota exhausted)');
    return;
  }

  try {
    // Dynamic imports to avoid circular dependencies
    const { ScoutAgent } = await import('./agent.js');
    const { consumeQuota } = await import('../../scout-quota.js');
    const { rippleSystem } = await import('../../../systems/RippleSystem.js');
    const { getDB } = await import('../../../db.js');
    
    const scoutAgent = new ScoutAgent();
    const result = await scoutAgent.patrol(entityId);
    
    if (result && result.confidence > 0.5) {
      // Consume quota on successful scout
      consumeQuota();
      
      // Update last_scouted_at
      const db = getDB();
      db.query(`
        UPDATE entity_profiles 
        SET last_scouted_at = datetime('now')
        WHERE id = ?
      `).run(entityId);
      
      log(`[ScoutWorker] ✓ Scout confirmed for ${entityId} (confidence: ${result.confidence}), triggering Ripple`);
      
      // Trigger Ripple propagation
      rippleSystem.emit({
        type: 'SCOUT_CONFIRMED',
        entityId,
        entityType: entityId.split(':')[0] as any,
        entityTitle,
        trigger: 'scout',
      });
      
      // Log success to database
      handle.success({
        confidence: result.confidence,
        foundUrl: result.foundUrl,
        foundMemoryId: result.foundMemoryId,
        extractedEntitiesCount: result.extractedEntitiesCount,
        serendipityReason: result.serendipityReason,
        rippleTriggered: true,
      });
    } else {
      // Low confidence - skip ripple
      handle.success({
        confidence: result?.confidence ?? 0,
        foundUrl: result?.foundUrl,
        rippleTriggered: false,
        reason: 'Low confidence, no ripple triggered',
      });
    }
  } catch (error) {
    handle.error(error);
    throw error;
  }
}
