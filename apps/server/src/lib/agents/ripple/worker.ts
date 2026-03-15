/**
 * Ripple Worker
 * 
 * Processes ripple propagation tasks (profile generation, content onboarding).
 * 
 * Guards: Search availability + Quota
 * 
 * Flow:
 * 1. Check guards (search + quota)
 * 2. Call RippleSystem.handleEventDirect() for actual processing
 * 3. Quota is consumed inside handleEventDirect() on success
 * 4. Log results to agent_logs table via AgentLogger
 * 
 * @since 2026-01-07
 * @since 2026-01-08 Added AgentLogger for database persistence
 */

import { log, logError } from '../../logger.js';
import { AgentLogger } from '../../agent-logger.js';
import { executeGuard, guardSearchWorker } from '../../queue/guards.js';
import type { Job } from '../../queue/bun-queue.js';
import type { RippleTask } from '../../queue/types.js';

// Shared logger instance for all ripple operations
const logger = new AgentLogger('scout');  // Using 'scout' type as ripple is part of scout family

/**
 * Handle ripple task
 */
export async function handleRippleTask(job: Job<RippleTask>): Promise<void> {
  const { eventType, entityId, entityTitle, trigger } = job.data;
  
  // Start tracking operation (persisted to agent_logs table)
  const handle = logger.start(
    'ripple',
    { eventType, entityId, entityTitle, trigger, jobId: job.id },
    job.id,
    entityId
  );

  // Guard: Check search + quota
  const canProceed = await executeGuard(
    () => guardSearchWorker('RippleWorker'),
    'RippleWorker',
    job.id
  );
  
  if (!canProceed) {
    handle.skip('Guard blocked (search unavailable or quota exhausted)');
    return;
  }

  try {
    const { rippleSystem } = await import('../../../systems/RippleSystem.js');
    
    // Directly handle the ripple event (no re-queueing)
    const result = await rippleSystem.handleEventDirect(job.data);

    if (result?.profileGenerated) {
      // Success with profile generated
      handle.success({
        profileGenerated: true,
        contentIngested: result.contentIngested,
        entitiesDiscovered: result.entitiesDiscovered,
        relationsCreated: result.relationsCreated,
        surpriseScore: result.surpriseScore,
        duration: result.duration,
      });
    } else {
      // Skipped (non-profileable type or other reason)
      handle.skip('No profile generated (type not profileable or no search results)');
    }
  } catch (error) {
    handle.error(error);
    throw error;
  }
}
