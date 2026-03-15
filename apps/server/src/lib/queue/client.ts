/**
 * Prism Queue Client
 * 
 * Initializes the native Bun SQLite queue for durable task persistence.
 * Provides queue instances for all Prism background jobs.
 * 
 * Key Features:
 * - SQLite persistence (survives crashes/restarts)
 * - Type-safe task payloads with Zod validation
 * - Automatic retry with exponential backoff
 * - Failed job retention for debugging
 * 
 * @ref worker/checklist
 * @since 2026-01-07
 */

import { log, logError } from '../logger.js';
import { initQueueDB, isQueueDBInitialized, BunSqliteQueue } from './bun-queue.js';
import {
  QUEUE_NAMES,
  DEFAULT_QUEUE_CONFIGS,
  ExtractionTaskSchema,
  ScoutTaskSchema,
  RippleTaskSchema,
  CuratorTaskSchema,
  ExploreTaskSchema,
  type ExtractionTask,
  type ExtractionTaskInput,
  type ScoutTask,
  type ScoutTaskInput,
  type RippleTask,
  type RippleTaskInput,
  type CuratorTask,
  type CuratorTaskInput,
  type ExploreTask,
  type ExploreTaskInput,
} from './types.js';

// =============================================================================
// CLIENT STATE
// =============================================================================

let extractionQueue: BunSqliteQueue<ExtractionTask> | null = null;
let scoutQueue: BunSqliteQueue<ScoutTask> | null = null;
let rippleQueue: BunSqliteQueue<RippleTask> | null = null;
let curatorQueue: BunSqliteQueue<CuratorTask> | null = null;
let exploreQueue: BunSqliteQueue<ExploreTask> | null = null;

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize the queue system with SQLite backend.
 * 
 * @param dbPath - Path to the SQLite database file for queues
 */
export function initQueueClient(dbPath: string): void {
  if (isQueueDBInitialized()) {
    log('[Queue] Already initialized, skipping');
    return;
  }

  log(`[Queue] Initializing with database: ${dbPath}`);

  try {
    // Initialize the SQLite database
    initQueueDB(dbPath);

    // Create queue instances
    const extractionConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.EXTRACTION];
    extractionQueue = new BunSqliteQueue<ExtractionTask>(
      QUEUE_NAMES.EXTRACTION,
      {
        numRetries: extractionConfig.numRetries,
        keepFailedJobs: extractionConfig.keepFailedJobs,
      }
    );

    const scoutConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.SCOUT];
    scoutQueue = new BunSqliteQueue<ScoutTask>(
      QUEUE_NAMES.SCOUT,
      {
        numRetries: scoutConfig.numRetries,
        keepFailedJobs: scoutConfig.keepFailedJobs,
      }
    );

    const rippleConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.RIPPLE];
    rippleQueue = new BunSqliteQueue<RippleTask>(
      QUEUE_NAMES.RIPPLE,
      {
        numRetries: rippleConfig.numRetries,
        keepFailedJobs: rippleConfig.keepFailedJobs,
      }
    );

    const curatorConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.CURATOR];
    curatorQueue = new BunSqliteQueue<CuratorTask>(
      QUEUE_NAMES.CURATOR,
      {
        numRetries: curatorConfig.numRetries,
        keepFailedJobs: curatorConfig.keepFailedJobs,
      }
    );

    const exploreConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.EXPLORE];
    exploreQueue = new BunSqliteQueue<ExploreTask>(
      QUEUE_NAMES.EXPLORE,
      {
        numRetries: exploreConfig.numRetries,
        keepFailedJobs: exploreConfig.keepFailedJobs,
      }
    );

    log('[Queue] All queues initialized successfully');
  } catch (error) {
    logError('[Queue] Failed to initialize:', error);
    throw error;
  }
}

// =============================================================================
// QUEUE ACCESSORS
// =============================================================================

export function getExtractionQueue(): BunSqliteQueue<ExtractionTask> {
  if (!extractionQueue) {
    throw new Error('[Queue] Not initialized. Call initQueueClient() first.');
  }
  return extractionQueue;
}

export function getScoutQueue(): BunSqliteQueue<ScoutTask> {
  if (!scoutQueue) {
    throw new Error('[Queue] Not initialized. Call initQueueClient() first.');
  }
  return scoutQueue;
}

export function getRippleQueue(): BunSqliteQueue<RippleTask> {
  if (!rippleQueue) {
    throw new Error('[Queue] Not initialized. Call initQueueClient() first.');
  }
  return rippleQueue;
}

export function getCuratorQueue(): BunSqliteQueue<CuratorTask> {
  if (!curatorQueue) {
    throw new Error('[Queue] Not initialized. Call initQueueClient() first.');
  }
  return curatorQueue;
}

export function getExploreQueue(): BunSqliteQueue<ExploreTask> {
  if (!exploreQueue) {
    throw new Error('[Queue] Not initialized. Call initQueueClient() first.');
  }
  return exploreQueue;
}

// =============================================================================
// ENQUEUE HELPERS
// =============================================================================

/**
 * Enqueue an extraction task
 * @param task - Task input (fields with defaults can be omitted)
 */
export async function enqueueExtraction(task: ExtractionTaskInput): Promise<string> {
  const queue = getExtractionQueue();
  const validated = ExtractionTaskSchema.parse(task);
  const job = await queue.enqueue(validated);
  log(`[Queue] Enqueued extraction task for memory ${task.memoryId}, job: ${job.id}`);
  return job.id;
}

/**
 * Enqueue a scout task
 * @param task - Task input (fields with defaults can be omitted)
 */
export async function enqueueScout(task: ScoutTaskInput): Promise<string> {
  const queue = getScoutQueue();
  const validated = ScoutTaskSchema.parse(task);
  const job = await queue.enqueue(validated);
  log(`[Queue] Enqueued scout task for ${task.entityId}, job: ${job.id}`);
  return job.id;
}

/**
 * Enqueue a ripple task
 * @param task - Task input (fields with defaults can be omitted)
 */
export async function enqueueRipple(task: RippleTaskInput): Promise<string> {
  const queue = getRippleQueue();
  const validated = RippleTaskSchema.parse(task);
  const job = await queue.enqueue(validated);
  log(`[Queue] Enqueued ripple task: ${task.eventType} for ${task.entityId}, job: ${job.id}`);
  return job.id;
}

/**
 * Enqueue a curator task
 * @param task - Task input (fields with defaults can be omitted)
 */
export async function enqueueCurator(task: CuratorTaskInput = {}): Promise<string> {
  const queue = getCuratorQueue();
  const validated = CuratorTaskSchema.parse(task);
  const job = await queue.enqueue(validated);
  log(`[Queue] Enqueued curator task (${validated.scope}), job: ${job.id}`);
  return job.id;
}

/**
 * Enqueue an explore task
 * 
 * @param task - Task input (fields with defaults can be omitted)
 * @returns Job ID for tracking
 */
export async function enqueueExplore(task: ExploreTaskInput): Promise<string> {
  const queue = getExploreQueue();
  const validated = ExploreTaskSchema.parse(task);
  const job = await queue.enqueue(validated);
  log(`[Queue] Enqueued explore task: "${task.topic.substring(0, 30)}..." (depth: ${validated.depth}), job: ${job.id}`);
  return job.id;
}

// =============================================================================
// STATUS
// =============================================================================

export function isQueueInitialized(): boolean {
  return isQueueDBInitialized();
}

/**
 * Get queue statistics for monitoring
 */
export async function getQueueStats(): Promise<{
  extraction: { pending: number; failed: number };
  scout: { pending: number; failed: number };
  ripple: { pending: number; failed: number };
  curator: { pending: number; failed: number };
  explore: { pending: number; failed: number };
}> {
  if (!isQueueInitialized()) {
    return {
      extraction: { pending: 0, failed: 0 },
      scout: { pending: 0, failed: 0 },
      ripple: { pending: 0, failed: 0 },
      curator: { pending: 0, failed: 0 },
      explore: { pending: 0, failed: 0 },
    };
  }

  const extractionStats = getExtractionQueue().getStats();
  const scoutStats = getScoutQueue().getStats();
  const rippleStats = getRippleQueue().getStats();
  const curatorStats = getCuratorQueue().getStats();
  const exploreStats = getExploreQueue().getStats();

  return {
    extraction: { pending: extractionStats.pending, failed: extractionStats.failed },
    scout: { pending: scoutStats.pending, failed: scoutStats.failed },
    ripple: { pending: rippleStats.pending, failed: rippleStats.failed },
    curator: { pending: curatorStats.pending, failed: curatorStats.failed },
    explore: { pending: exploreStats.pending, failed: exploreStats.failed },
  };
}
