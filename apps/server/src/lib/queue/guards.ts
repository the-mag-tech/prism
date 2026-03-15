/**
 * Worker Guards
 * 
 * Centralized constraint checking for queue workers.
 * Each guard function returns a decision about whether a task can proceed.
 * 
 * Design:
 * - Guards are checked BEFORE task execution
 * - If guard fails, task can be skipped (soft) or requeued (hard)
 * - Keeps constraint logic DRY across workers
 * 
 * @since 2026-01-07
 */

import { log } from '../logger.js';

// =============================================================================
// GUARD RESULT TYPES
// =============================================================================

export interface GuardResult {
  /** Whether the task can proceed */
  canProceed: boolean;
  /** Reason for blocking (for logging) */
  reason?: string;
  /** 
   * Action when blocked:
   * - 'skip': Complete the job without processing (soft fail)
   * - 'requeue': Throw error to trigger retry with backoff (hard fail)
   */
  action?: 'skip' | 'requeue';
}

// =============================================================================
// INDIVIDUAL GUARDS
// =============================================================================

/**
 * Check if search service is available
 * 
 * Used by: RippleWorker, ScoutWorker
 */
export async function checkSearchAvailable(): Promise<GuardResult> {
  const { isSearchAvailable } = await import('../search-service.js');
  
  if (!isSearchAvailable()) {
    return {
      canProceed: false,
      reason: 'Search service unavailable',
      action: 'requeue', // Will become available later
    };
  }
  
  return { canProceed: true };
}

/**
 * Check if quota is available for consumption
 * 
 * Used by: RippleWorker, ScoutWorker
 */
export async function checkQuotaAvailable(): Promise<GuardResult> {
  const { canConsumeQuota, getQuotaStatus } = await import('../scout-quota.js');
  
  if (!canConsumeQuota()) {
    const quota = getQuotaStatus();
    return {
      canProceed: false,
      reason: `Quota exhausted (${quota.used}/${quota.daily})`,
      action: 'skip', // Don't retry, wait for next day
    };
  }
  
  return { canProceed: true };
}

/**
 * Check if OpenAI client is available
 * 
 * Used by: ExtractionWorker (entity extraction requires AI)
 */
export async function checkAIAvailable(): Promise<GuardResult> {
  const { getOpenAI } = await import('../ai-clients.js');
  
  const client = getOpenAI();
  if (!client) {
    return {
      canProceed: false,
      reason: 'OpenAI client not configured',
      action: 'requeue',
    };
  }
  
  return { canProceed: true };
}

// =============================================================================
// COMPOSITE GUARDS (Common combinations)
// =============================================================================

/**
 * Standard guard for search-based workers (Scout, Ripple)
 * Checks: Search availability + Quota
 */
export async function guardSearchWorker(workerName: string): Promise<GuardResult> {
  // Check search first (more likely to be temporary)
  const searchResult = await checkSearchAvailable();
  if (!searchResult.canProceed) {
    log(`[${workerName}] Guard blocked: ${searchResult.reason}`);
    return searchResult;
  }
  
  // Check quota
  const quotaResult = await checkQuotaAvailable();
  if (!quotaResult.canProceed) {
    log(`[${workerName}] Guard blocked: ${quotaResult.reason}`);
    return quotaResult;
  }
  
  return { canProceed: true };
}

/**
 * Standard guard for AI-based workers (Extraction)
 * Checks: AI availability
 */
export async function guardAIWorker(workerName: string): Promise<GuardResult> {
  const aiResult = await checkAIAvailable();
  if (!aiResult.canProceed) {
    log(`[${workerName}] Guard blocked: ${aiResult.reason}`);
    return aiResult;
  }
  
  return { canProceed: true };
}

// =============================================================================
// GUARD EXECUTOR
// =============================================================================

/**
 * Execute a guard and handle the result
 * 
 * @throws Error if guard action is 'requeue'
 * @returns false if task should be skipped, true if can proceed
 */
export async function executeGuard(
  guard: () => Promise<GuardResult>,
  workerName: string,
  taskId: string
): Promise<boolean> {
  const result = await guard();
  
  if (result.canProceed) {
    return true;
  }
  
  log(`[${workerName}] Task ${taskId} blocked: ${result.reason}`);
  
  if (result.action === 'requeue') {
    // Throw to trigger queue retry with backoff
    throw new Error(`GUARD_BLOCKED: ${result.reason}`);
  }
  
  // 'skip' action: return false, task will be marked complete but not processed
  return false;
}
