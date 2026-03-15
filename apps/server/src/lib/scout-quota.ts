/**
 * Scout Quota System
 * 
 * Daily quota management for Scout operations to control API costs.
 * Extracted from server.ts to avoid circular dependency issues in MCP builds.
 * 
 * @since 2025-12-21
 */

import { log } from './logger.js';

// SSOT: Scout quota default from prism-contract
// Note: Inline constant to avoid complex relative path in Bun builds
// Keep in sync with: @prism/contract (constants)
const SCOUT_QUOTA_DEFAULT = 25;

// =============================================================================
// SCOUT QUOTA SYSTEM
// =============================================================================

interface ScoutQuota {
  daily: number;       // Max scouts per day (0 = unlimited)
  used: number;        // Today's usage
  resetAt: string;     // ISO timestamp for next reset (00:00 UTC)
}

let scoutQuota: ScoutQuota = {
  daily: SCOUT_QUOTA_DEFAULT,
  used: 0,
  resetAt: getNextResetTime(),
};

function getNextResetTime(): string {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return tomorrow.toISOString();
}

function checkAndResetQuota(): void {
  const now = new Date().toISOString();
  if (now >= scoutQuota.resetAt) {
    log(`[ScoutQuota] Daily reset: ${scoutQuota.used} → 0`);
    scoutQuota.used = 0;
    scoutQuota.resetAt = getNextResetTime();
  }
}

/**
 * Check if quota allows a scout operation
 */
export function canConsumeQuota(): boolean {
  checkAndResetQuota();
  // 0 = unlimited
  if (scoutQuota.daily === 0) return true;
  return scoutQuota.used < scoutQuota.daily;
}

/**
 * Consume one quota unit (call after successful scout)
 */
export function consumeQuota(): void {
  checkAndResetQuota();
  if (scoutQuota.daily === 0) return; // Unlimited
  scoutQuota.used++;
  log(`[ScoutQuota] Used: ${scoutQuota.used}/${scoutQuota.daily}`);
}

/**
 * Get current quota status
 */
export function getQuotaStatus(): ScoutQuota & { remaining: number } {
  checkAndResetQuota();
  return {
    ...scoutQuota,
    remaining: scoutQuota.daily === 0 ? -1 : scoutQuota.daily - scoutQuota.used,
  };
}

/**
 * Set daily quota limit
 */
export function setDailyQuota(limit: number): void {
  scoutQuota.daily = Math.max(0, Math.floor(limit));
  log(`[ScoutQuota] Daily limit set to: ${scoutQuota.daily}`);
}




