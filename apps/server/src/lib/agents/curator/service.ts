/**
 * Curator Background Service
 * 
 * Runs periodic scans to detect duplicate entities and memories.
 * 
 * Behavior:
 * - Memory duplicates: Auto-merged (exact hash match, safe)
 * - Entity duplicates: Layered automation with user review
 * 
 * NOTE: Previously named "Gardener Service", renamed to "Curator Service".
 * Legacy function names are exported for backward compatibility.
 */

import { CuratorAgent, type CuratorReport } from './agent.js';

let timer: NodeJS.Timeout | null = null;
let lastReport: CuratorReport | null = null;
let cycleInProgress = false;

// Run every 24 hours
const CURATOR_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Delay before first run after startup (let server settle)
const STARTUP_DELAY_MS = 60 * 1000;

/**
 * Start the Curator background service.
 */
export function startCuratorService() {
  console.log(`[Curator] Starting service (Interval: ${CURATOR_INTERVAL_MS / 1000 / 3600}h)`);

  // Run after startup delay
  setTimeout(() => {
    runCycle();
  }, STARTUP_DELAY_MS);

  // Schedule periodic runs
  timer = setInterval(runCycle, CURATOR_INTERVAL_MS);
}

/**
 * Stop the service.
 */
export function stopCuratorService() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Curator] Service stopped');
  }
}

/**
 * Check if a curator cycle is currently in progress.
 */
export function isCuratorBusy(): boolean {
  return cycleInProgress;
}

/**
 * Get the last run report.
 */
export function getLastReport(): CuratorReport | null {
  return lastReport;
}

/**
 * Get current curator metrics.
 */
export function getCuratorMetrics() {
  const agent = new CuratorAgent();
  const status = agent.getStatus();
  return {
    ...status,
    lastReport,
  };
}

/**
 * Manually trigger a curator cycle.
 */
export async function triggerCycle(): Promise<CuratorReport> {
  return runCycle();
}

/**
 * Run a single governance cycle.
 */
async function runCycle(): Promise<CuratorReport> {
  if (cycleInProgress) {
    console.log('[Curator] Cycle already in progress, skipping');
    return lastReport || { memoryDuplicates: { found: 0, merged: 0 }, entityCandidates: { found: 0, recorded: 0, pendingTotal: 0 }, timestamp: new Date().toISOString() };
  }

  cycleInProgress = true;
  console.log('[Curator] 📚 Scheduled cycle starting...');

  try {
    const agent = new CuratorAgent();

    // Auto-merge memories (safe), layered automation for entity candidates
    lastReport = await agent.run(true); // autoMergeMemories = true

    console.log('[Curator] Cycle finished successfully');
    console.log(`[Curator] Report: ${JSON.stringify(lastReport, null, 2)}`);

    return lastReport;
  } catch (error) {
    console.error('[Curator] Cycle failed:', error);
    throw error;
  } finally {
    cycleInProgress = false;
  }
}

// =============================================================================
// LEGACY ALIASES (for backward compatibility)
// =============================================================================

/** @deprecated Use startCuratorService instead */
export const startGardenerService = startCuratorService;

/** @deprecated Use stopCuratorService instead */
export const stopGardenerService = stopCuratorService;

/** @deprecated Use isCuratorBusy instead */
export const isGardenerBusy = isCuratorBusy;

/** @deprecated Use getCuratorMetrics instead */
export const getGardenerMetrics = getCuratorMetrics;

// Re-export types with legacy names
export type { CuratorReport as GardenerReport } from './agent.js';





