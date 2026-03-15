/**
 * Workers Module
 * 
 * Centralized worker lifecycle management.
 * 
 * All workers now live in agents/[name]/worker.ts:
 * - agents/extraction/worker.ts - Entity extraction worker
 * - agents/scout/worker.ts      - Entity scouting worker
 * - agents/ripple/worker.ts     - Ripple propagation worker
 * - agents/curator/worker.ts    - Deduplication worker
 * - agents/explorer/worker.ts   - Deep exploration worker
 * 
 * Shared infrastructure in queue/:
 * - queue/guards.ts           - Constraint checking (quota, search, AI)
 * - queue/workers/index.ts    - Lifecycle management (this file)
 * 
 * @since 2026-01-07
 * @since 2026-01-08 Moved extraction worker to agents/extraction/
 */

import { log, logError } from '../../logger.js';
import { BunRunner } from '../bun-queue.js';
import {
  getExtractionQueue,
  getScoutQueue,
  getRippleQueue,
  getCuratorQueue,
  getExploreQueue,
} from '../client.js';
import {
  QUEUE_NAMES,
  DEFAULT_QUEUE_CONFIGS,
  ExtractionTaskSchema,
  ScoutTaskSchema,
  RippleTaskSchema,
  CuratorTaskSchema,
  ExploreTaskSchema,
  type ExtractionTask,
  type ScoutTask,
  type RippleTask,
  type CuratorTask,
  type ExploreTask,
} from '../types.js';

// Import worker handlers from their respective agent directories
import { handleExtractionTask } from '../../agents/extraction/worker.js';
import { handleScoutTask } from '../../agents/scout/worker.js';
import { handleRippleTask } from '../../agents/ripple/worker.js';
import { handleCuratorTask } from '../../agents/curator/worker.js';
import { handleExploreTask } from '../../agents/explorer/worker.js';

// =============================================================================
// WORKER STATE
// =============================================================================

let extractionWorker: BunRunner<ExtractionTask> | null = null;
let scoutWorker: BunRunner<ScoutTask> | null = null;
let rippleWorker: BunRunner<RippleTask> | null = null;
let curatorWorker: BunRunner<CuratorTask> | null = null;
let exploreWorker: BunRunner<ExploreTask> | null = null;

let workersStarted = false;

// =============================================================================
// WORKER LIFECYCLE
// =============================================================================

/**
 * Start all queue workers
 */
export function startWorkers(): void {
  if (workersStarted) {
    log('[Workers] Already started, skipping');
    return;
  }

  log('[Workers] Starting all workers...');

  // Extraction Worker
  const extractionConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.EXTRACTION];
  extractionWorker = new BunRunner<ExtractionTask>(
    getExtractionQueue(),
    {
      run: handleExtractionTask,
      onComplete: async (job) => {
        log(`[ExtractionWorker] Job ${job.id} completed`);
      },
      onError: async (job) => {
        logError(`[ExtractionWorker] Job ${job.id} failed:`, job.errorObj);
      },
    },
    {
      concurrency: extractionConfig.concurrency,
      pollIntervalMs: extractionConfig.pollIntervalMs,
      timeoutSecs: extractionConfig.timeoutSecs,
      validator: ExtractionTaskSchema,
    }
  );

  // Scout Worker
  const scoutConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.SCOUT];
  scoutWorker = new BunRunner<ScoutTask>(
    getScoutQueue(),
    {
      run: handleScoutTask,
      onComplete: async (job) => {
        log(`[ScoutWorker] Job ${job.id} completed`);
      },
      onError: async (job) => {
        logError(`[ScoutWorker] Job ${job.id} failed:`, job.errorObj);
      },
    },
    {
      concurrency: scoutConfig.concurrency,
      pollIntervalMs: scoutConfig.pollIntervalMs,
      timeoutSecs: scoutConfig.timeoutSecs,
      validator: ScoutTaskSchema,
    }
  );

  // Ripple Worker
  const rippleConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.RIPPLE];
  rippleWorker = new BunRunner<RippleTask>(
    getRippleQueue(),
    {
      run: handleRippleTask,
      onComplete: async (job) => {
        log(`[RippleWorker] Job ${job.id} completed`);
      },
      onError: async (job) => {
        logError(`[RippleWorker] Job ${job.id} failed:`, job.errorObj);
      },
    },
    {
      concurrency: rippleConfig.concurrency,
      pollIntervalMs: rippleConfig.pollIntervalMs,
      timeoutSecs: rippleConfig.timeoutSecs,
      validator: RippleTaskSchema,
    }
  );

  // Curator Worker
  const curatorConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.CURATOR];
  curatorWorker = new BunRunner<CuratorTask>(
    getCuratorQueue(),
    {
      run: handleCuratorTask,
      onComplete: async (job) => {
        log(`[CuratorWorker] Job ${job.id} completed`);
      },
      onError: async (job) => {
        logError(`[CuratorWorker] Job ${job.id} failed:`, job.errorObj);
      },
    },
    {
      concurrency: curatorConfig.concurrency,
      pollIntervalMs: curatorConfig.pollIntervalMs,
      timeoutSecs: curatorConfig.timeoutSecs,
      validator: CuratorTaskSchema,
    }
  );

  // Explore Worker
  const exploreConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.EXPLORE];
  exploreWorker = new BunRunner<ExploreTask>(
    getExploreQueue(),
    {
      run: handleExploreTask,
      onComplete: async (job) => {
        log(`[ExploreWorker] Job ${job.id} completed`);
      },
      onError: async (job) => {
        logError(`[ExploreWorker] Job ${job.id} failed:`, job.errorObj);
      },
    },
    {
      concurrency: exploreConfig.concurrency,
      pollIntervalMs: exploreConfig.pollIntervalMs,
      timeoutSecs: exploreConfig.timeoutSecs,
      validator: ExploreTaskSchema,
    }
  );

  workersStarted = true;
  log('[Workers] ✓ All workers started');
}

/**
 * Stop all queue workers gracefully
 */
export async function stopWorkers(): Promise<void> {
  if (!workersStarted) {
    log('[Workers] Not started, nothing to stop');
    return;
  }

  log('[Workers] Stopping all workers...');

  if (extractionWorker) extractionWorker.stop();
  if (scoutWorker) scoutWorker.stop();
  if (rippleWorker) rippleWorker.stop();
  if (curatorWorker) curatorWorker.stop();
  if (exploreWorker) exploreWorker.stop();

  extractionWorker = null;
  scoutWorker = null;
  rippleWorker = null;
  curatorWorker = null;
  exploreWorker = null;
  workersStarted = false;

  log('[Workers] ✓ All workers stopped');
}

/**
 * Check if workers are running
 */
export function areWorkersRunning(): boolean {
  return workersStarted;
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

// Re-export guards for external use
export * from '../guards.js';

// Re-export individual handlers for testing
export { handleExtractionTask } from '../../agents/extraction/worker.js';
export { handleScoutTask } from '../../agents/scout/worker.js';
export { handleRippleTask } from '../../agents/ripple/worker.js';
export { handleCuratorTask } from '../../agents/curator/worker.js';
export { handleExploreTask } from '../../agents/explorer/worker.js';
