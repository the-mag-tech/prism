/**
 * Explore Worker
 * 
 * Processes deep exploration tasks using the DeepExplorer engine.
 * 
 * Guards: Search availability + Quota + AI availability
 * 
 * Flow:
 * 1. Check guards (search + quota + AI)
 * 2. Execute exploration via DeepExplorer.exploreAuto()
 * 3. On success: consume quota, optionally ingest findings
 * 4. Optionally: call callback URL with results
 * 5. Log results to agent_logs table via AgentLogger
 * 
 * @since 2026-01-07
 * @since 2026-01-08 Added AgentLogger for database persistence
 */

import { log, logError } from '../../logger.js';
import { AgentLogger } from '../../agent-logger.js';
import { executeGuard, guardSearchWorker, guardAIWorker, type GuardResult } from '../../queue/guards.js';
import type { Job } from '../../queue/bun-queue.js';
import type { ExploreTask } from '../../queue/types.js';

// Shared logger instance for all explore operations
const logger = new AgentLogger('deep_explorer');

/**
 * Combined guard for Explore Worker
 * Checks: Search + Quota + AI (most demanding worker)
 */
async function guardExploreWorker(workerName: string): Promise<GuardResult> {
  // Check search first
  const searchResult = await guardSearchWorker(workerName);
  if (!searchResult.canProceed) {
    return searchResult;
  }
  
  // Also need AI for intent extraction and strategy evaluation
  const aiResult = await guardAIWorker(workerName);
  if (!aiResult.canProceed) {
    return aiResult;
  }
  
  return { canProceed: true };
}

/**
 * Handle explore task
 */
export async function handleExploreTask(job: Job<ExploreTask>): Promise<void> {
  const { topic, depth, ingest, trigger, callbackUrl, contextEntityId } = job.data;
  
  // Start tracking operation (persisted to agent_logs table)
  const handle = logger.start(
    'explore',
    { topic: topic.substring(0, 100), depth, ingest, trigger, contextEntityId, jobId: job.id },
    job.id,
    contextEntityId
  );

  // Guard: Check search + quota + AI
  const canProceed = await executeGuard(
    () => guardExploreWorker('ExploreWorker'),
    'ExploreWorker',
    job.id
  );
  
  if (!canProceed) {
    handle.skip('Guard blocked (search/AI unavailable or quota exhausted)');
    return;
  }

  try {
    // Dynamic imports to avoid circular dependencies
    const { deepExplorer } = await import('./engine.js');
    const { consumeQuota, getQuotaStatus } = await import('../../scout-quota.js');
    const { getDB } = await import('../../../db.js');
    
    // Log quota status
    const quotaBefore = getQuotaStatus();
    log(`[ExploreWorker] Starting exploration (quota: ${quotaBefore.remaining}/${quotaBefore.daily})`);
    
    // Execute exploration
    const result = await deepExplorer.exploreAuto(topic, (status) => {
      log(`[ExploreWorker] Progress: ${status.phase} - ${status.message}`);
    });
    
    // Consume quota on successful exploration
    consumeQuota();
    
    const findingsCount = result.allDirections.reduce((acc, d) => acc + d.findings.length, 0);
    
    log(`[ExploreWorker] ✓ Exploration complete for "${topic.substring(0, 30)}..."`);
    log(`[ExploreWorker]   Strategy: ${result.strategy}`);
    log(`[ExploreWorker]   Depth level: ${result.score.level}`);
    log(`[ExploreWorker]   Findings: ${findingsCount}`);
    
    // Store result in database for retrieval
    const db = getDB();
    const resultJson = JSON.stringify({
      strategy: result.strategy,
      score: result.score,
      output: result.output,
      queryAnalysis: result.queryAnalysis,
      completedAt: new Date().toISOString(),
    });
    
    // Insert explore result
    db.query(`
      INSERT INTO explore_results (job_id, topic, result, created_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(job_id) DO UPDATE SET result = ?, updated_at = datetime('now')
    `).run(job.id, topic, resultJson, resultJson);
    
    // Optionally associate with context entity
    if (contextEntityId) {
      log(`[ExploreWorker] Associating findings with entity: ${contextEntityId}`);
      // The ingest option in deepExplorer.exploreAuto already handles this
    }
    
    // Call callback URL if provided
    if (callbackUrl) {
      try {
        await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.id,
            topic,
            status: 'completed',
            result: {
              strategy: result.strategy,
              depthLevel: result.score.level,
              findingsCount,
            },
          }),
        });
        log(`[ExploreWorker] Callback sent to ${callbackUrl}`);
      } catch (callbackError) {
        log(`[ExploreWorker] Callback failed:`, callbackError);
        // Don't throw - exploration succeeded, callback is optional
      }
    }
    
    // Log success to database
    handle.success({
      strategy: result.strategy,
      depthLevel: result.score.level,
      findingsCount,
      directionsExplored: result.allDirections.length,
      hasCallback: !!callbackUrl,
    });
    
  } catch (error) {
    // Log error to database
    handle.error(error);
    
    // Call callback URL with error if provided
    if (callbackUrl) {
      try {
        await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.id,
            topic,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        });
      } catch (_) {
        // Ignore callback errors on failure
      }
    }
    
    throw error;
  }
}
