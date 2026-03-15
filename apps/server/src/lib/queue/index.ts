/**
 * Prism Queue Module
 * 
 * Durable task queue system built on liteque + SQLite.
 * Provides crash-resilient background job processing for:
 * - Entity extraction
 * - Scout/research operations
 * - Ripple event propagation
 * - Curator deduplication
 * - Deep exploration
 * 
 * Key Features:
 * - ✅ Persistent: Tasks survive crashes and restarts
 * - ✅ Retries: Automatic retry with configurable limits
 * - ✅ Type-safe: Zod validation for all payloads
 * - ✅ Observable: Failed jobs retained for debugging
 * - ✅ Guards: Centralized constraint checking (quota, search, AI)
 * 
 * Usage:
 * ```typescript
 * import { initQueueSystem, enqueueExtraction, enqueueScout, enqueueExplore } from './lib/queue';
 * 
 * // Initialize (once at startup)
 * await initQueueSystem('/path/to/queue.db');
 * 
 * // Enqueue tasks
 * await enqueueExtraction({ memoryId: 123 });
 * await enqueueScout({ entityId: 'person:simon', entityTitle: 'Simon' });
 * await enqueueExplore({ topic: 'AI research trends', depth: 3 });
 * ```
 * 
 * @ref worker/checklist
 * @since 2026-01-07
 */

// Re-export types
export * from './types.js';

// Re-export client functions
export {
  initQueueClient,
  isQueueInitialized,
  getQueueStats,
  enqueueExtraction,
  enqueueScout,
  enqueueRipple,
  enqueueCurator,
  enqueueExplore,
  getExtractionQueue,
  getScoutQueue,
  getRippleQueue,
  getCuratorQueue,
  getExploreQueue,
} from './client.js';

// Re-export worker functions (from workers/ directory)
export {
  startWorkers,
  stopWorkers,
  areWorkersRunning,
} from './workers/index.js';

// Re-export recovery functions
export {
  runStartupRecovery,
  recoverPendingExtractions,
  recoverStaleScouts,
} from './recovery.js';

// =============================================================================
// CONVENIENCE: UNIFIED INIT
// =============================================================================

import { initQueueClient, isQueueInitialized } from './client.js';
import { startWorkers, stopWorkers } from './workers/index.js';
import { log, logError } from '../logger.js';

/**
 * Initialize the entire queue system (client + workers)
 * 
 * @param dbPath - Path to the queue SQLite database
 */
export async function initQueueSystem(dbPath: string): Promise<void> {
  log('[QueueSystem] Initializing...');
  
  try {
    // 1. Initialize the queue client
    initQueueClient(dbPath);
    
    // 2. Start workers
    startWorkers();
    
    log('[QueueSystem] ✓ Fully initialized');
  } catch (error) {
    logError('[QueueSystem] Failed to initialize:', error);
    throw error;
  }
}

/**
 * Shutdown the queue system gracefully
 */
export async function shutdownQueueSystem(): Promise<void> {
  log('[QueueSystem] Shutting down...');
  
  try {
    await stopWorkers();
    log('[QueueSystem] ✓ Shutdown complete');
  } catch (error) {
    logError('[QueueSystem] Error during shutdown:', error);
  }
}
