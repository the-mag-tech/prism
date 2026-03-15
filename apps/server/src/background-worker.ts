/**
 * Background Worker for Lazy Migration
 * 
 * Processes stale entities in the background at a controlled pace.
 * This enables "lazy migration" - only re-extract entities when:
 * 1. They are accessed (triggered by pages.ts)
 * 2. The background worker picks them up
 * 
 * Design Principles:
 * - Non-blocking: Never holds up user requests
 * - Rate-limited: Processes in small batches to avoid overwhelming API
 * - Resilient: Individual failures don't stop the worker
 */

import type { Database } from 'bun:sqlite';
import { getStaleEntities, markEntityFresh, getStaleEntityCount } from './pipeline-version.js';
import { setEntityRefreshCallback } from './pages.js';
import { graphReader } from './lib/graph-link/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const WORKER_CONFIG = {
  /** Interval between processing batches (ms) */
  pollInterval: 30000,  // 30 seconds
  
  /** Maximum entities to process per batch */
  batchSize: 5,
  
  /** Delay between processing individual entities in a batch (ms) */
  entityDelay: 1000,  // 1 second
  
  /** Maximum retries for failed entities */
  maxRetries: 3,
};

// =============================================================================
// TYPES
// =============================================================================

interface WorkerState {
  isRunning: boolean;
  intervalId: NodeJS.Timeout | null;
  processedCount: number;
  failedCount: number;
  lastRunTime: Date | null;
}

// Track entities that have failed and their retry count
const failedEntities = new Map<string, number>();

// =============================================================================
// WORKER STATE
// =============================================================================

const workerState: WorkerState = {
  isRunning: false,
  intervalId: null,
  processedCount: 0,
  failedCount: 0,
  lastRunTime: null,
};

// =============================================================================
// ENTITY REFRESH LOGIC
// =============================================================================

/**
 * Re-extract a single entity from its source memory.
 * 
 * For now, this marks the entity as fresh (actual re-extraction 
 * would require OpenAI API calls which we defer to manual CLI).
 * 
 * TODO: Implement actual re-extraction when needed:
 * 1. Get memo_id from entity
 * 2. Call extractEntities with that memory
 * 3. Update the entity record
 */
async function refreshEntity(entityId: string): Promise<boolean> {
  try {
    // For now, just mark as fresh
    // In production, this would:
    // 1. Get the source memory
    // 2. Re-run extraction
    // 3. Update entity record
    
    // Check if entity still exists (via GraphReader)
    const entity = graphReader.getEntity(entityId);
    
    if (!entity) {
      console.log(`[Worker] Entity ${entityId} no longer exists, skipping`);
      return true;
    }
    
    // Get memo_id from direct query (GraphReader doesn't expose this yet)
    // TODO: Consider adding getMemoId to GraphReader
    const { getDB } = await import('./db.js');
    const db = getDB();
    const entityRow = db.query(`SELECT memo_id FROM entities WHERE id = ?`).get(entityId) as { memo_id: number | null } | undefined;
    
    // For entities without memo_id (manually created),
    // just mark as fresh since there's nothing to re-extract
    if (!entityRow?.memo_id) {
      markEntityFresh(entityId);
      console.log(`[Worker] Entity ${entityId} has no source memory, marked fresh`);
      return true;
    }
    
    // TODO: Actual re-extraction logic would go here
    // For now, we just mark as fresh
    // This is intentional - full re-extraction should be done via CLI
    // to maintain user control over API costs
    
    markEntityFresh(entityId);
    console.log(`[Worker] Marked ${entityId} as fresh (memo_id: ${entityRow.memo_id})`);
    
    return true;
  } catch (error) {
    console.error(`[Worker] Failed to refresh entity ${entityId}:`, error);
    return false;
  }
}

/**
 * Process a batch of stale entities.
 */
async function processStaleBatch(): Promise<void> {
  const staleEntities = getStaleEntities(WORKER_CONFIG.batchSize);
  
  if (staleEntities.length === 0) {
    return;
  }
  
  console.log(`[Worker] Processing ${staleEntities.length} stale entities`);
  
  for (const entity of staleEntities) {
    // Check if entity has failed too many times
    const retryCount = failedEntities.get(entity.id) || 0;
    if (retryCount >= WORKER_CONFIG.maxRetries) {
      console.log(`[Worker] Skipping ${entity.id} (exceeded max retries)`);
      continue;
    }
    
    try {
      const success = await refreshEntity(entity.id);
      
      if (success) {
        workerState.processedCount++;
        failedEntities.delete(entity.id);
      } else {
        workerState.failedCount++;
        failedEntities.set(entity.id, retryCount + 1);
      }
    } catch (error) {
      workerState.failedCount++;
      failedEntities.set(entity.id, retryCount + 1);
      console.error(`[Worker] Error processing ${entity.id}:`, error);
    }
    
    // Rate limit between entities
    await new Promise(resolve => setTimeout(resolve, WORKER_CONFIG.entityDelay));
  }
}

/**
 * Handle on-demand refresh requests from pages.ts.
 * These are triggered when a user accesses a page with stale entities.
 */
async function handleOnDemandRefresh(entityIds: string[]): Promise<void> {
  console.log(`[Worker] On-demand refresh requested for ${entityIds.length} entities`);
  
  for (const entityId of entityIds) {
    try {
      await refreshEntity(entityId);
    } catch (error) {
      console.error(`[Worker] On-demand refresh failed for ${entityId}:`, error);
    }
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Start the background worker.
 * Should be called once after server starts.
 */
export function startBackgroundWorker(): void {
  if (workerState.isRunning) {
    console.log('[Worker] Already running');
    return;
  }
  
  console.log('[Worker] Starting background worker');
  console.log(`[Worker] Config: poll=${WORKER_CONFIG.pollInterval}ms, batch=${WORKER_CONFIG.batchSize}`);
  
  // Register callback for on-demand refresh from pages.ts
  setEntityRefreshCallback(handleOnDemandRefresh);
  
  // Initial check
  const staleCount = getStaleEntityCount();
  console.log(`[Worker] Found ${staleCount} stale entities on startup`);
  
  // Start periodic processing
  workerState.intervalId = setInterval(async () => {
    workerState.lastRunTime = new Date();
    await processStaleBatch();
  }, WORKER_CONFIG.pollInterval);
  
  workerState.isRunning = true;
  
  // Run first batch immediately
  setImmediate(() => processStaleBatch());
}

/**
 * Stop the background worker.
 */
export function stopBackgroundWorker(): void {
  if (!workerState.isRunning) {
    return;
  }
  
  console.log('[Worker] Stopping background worker');
  
  if (workerState.intervalId) {
    clearInterval(workerState.intervalId);
    workerState.intervalId = null;
  }
  
  workerState.isRunning = false;
}

/**
 * Get worker status for monitoring/debugging.
 */
export function getWorkerStatus(): {
  isRunning: boolean;
  processedCount: number;
  failedCount: number;
  lastRunTime: string | null;
  pendingCount: number;
  failedEntitiesCount: number;
} {
  return {
    isRunning: workerState.isRunning,
    processedCount: workerState.processedCount,
    failedCount: workerState.failedCount,
    lastRunTime: workerState.lastRunTime?.toISOString() ?? null,
    pendingCount: getStaleEntityCount(),
    failedEntitiesCount: failedEntities.size,
  };
}

/**
 * Force process a batch immediately (for testing/debugging).
 */
export async function forceBatchProcess(): Promise<void> {
  console.log('[Worker] Force processing batch');
  await processStaleBatch();
}




