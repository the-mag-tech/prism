/**
 * Curator Worker
 * 
 * Processes deduplication and merge analysis tasks.
 * 
 * Guards: None (local database operations only)
 * 
 * Flow:
 * 1. Execute curator cycle (deduplication analysis)
 * 2. Log results to agent_logs table via AgentLogger
 * 
 * @since 2026-01-07
 * @since 2026-01-08 Added AgentLogger for database persistence
 */

import { log, logError } from '../../logger.js';
import { AgentLogger } from '../../agent-logger.js';
import type { Job } from '../../queue/bun-queue.js';
import type { CuratorTask } from '../../queue/types.js';

// Shared logger instance for all curator operations
const logger = new AgentLogger('curator');

/**
 * Handle curator task
 */
export async function handleCuratorTask(job: Job<CuratorTask>): Promise<void> {
  const { scope, trigger } = job.data;
  
  // Start tracking operation (persisted to agent_logs table)
  const handle = logger.start(
    'cycle',
    { scope, trigger, jobId: job.id },
    job.id
  );

  try {
    const { triggerCycle } = await import('./service.js');
    
    const report = await triggerCycle();
    
    log(`[CuratorWorker] ✓ Curator cycle complete: ${report.memoryDuplicates.merged} merges, ${report.entityCandidates.found} candidates`);
    
    // Log success to database
    handle.success({
      memoryDuplicatesMerged: report.memoryDuplicates.merged,
      entityCandidatesFound: report.entityCandidates.found,
      entityCandidatesRecorded: report.entityCandidates.recorded,
    });
  } catch (error) {
    handle.error(error);
    throw error;
  }
}
