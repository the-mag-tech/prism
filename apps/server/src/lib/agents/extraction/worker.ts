/**
 * Extraction Worker
 * 
 * Processes entity extraction tasks from memories.
 * 
 * Guards: AI availability (extraction requires OpenAI)
 * 
 * Flow:
 * 1. Check guards (AI availability)
 * 2. Execute extraction via ExtractionAgent
 * 3. Log results to agent_logs table via AgentLogger
 * 
 * @since 2026-01-07
 * @since 2026-01-08 Moved to agents/extraction/, added AgentLogger
 */

import { log, logError } from '../../logger.js';
import { AgentLogger } from '../../agent-logger.js';
import { executeGuard, guardAIWorker } from '../../queue/guards.js';
import type { Job } from '../../queue/bun-queue.js';
import type { ExtractionTask } from '../../queue/types.js';

// Shared logger instance for all extraction operations
const logger = new AgentLogger('extraction');

/**
 * Handle extraction task
 */
export async function handleExtractionTask(job: Job<ExtractionTask>): Promise<void> {
  const { memoryId, entityId, trigger, priority } = job.data;
  
  // Start tracking operation (persisted to agent_logs table)
  const handle = logger.start(
    'extract',
    { memoryId, entityId, trigger, priority, jobId: job.id },
    job.id,
    entityId || `memory:${memoryId}`
  );

  // Guard: Check AI availability
  const canProceed = await executeGuard(
    () => guardAIWorker('ExtractionWorker'),
    'ExtractionWorker',
    job.id
  );
  
  if (!canProceed) {
    handle.skip('Guard blocked (AI unavailable)');
    return;
  }

  try {
    const { extractEntities } = await import('../../../extract.js');
    
    const result = await extractEntities({
      memoryIds: [memoryId],
      newOnly: false,
    });

    // Log success with metrics
    handle.success({
      batchId: result.batchId,
      entitiesCreated: result.entitiesCreated,
      entitiesSkipped: result.entitiesSkipped,
      memoriesProcessed: result.memoriesProcessed,
      entityIds: result.entities.map(e => e.id),
    });
  } catch (error) {
    handle.error(error);
    throw error; // Let queue handle retry
  }
}
