/**
 * Shared Constants - SSOT for Prism/Magpie
 * 
 * This file contains constants shared between Prism Server and Magpie.
 * All magic numbers should be defined here to ensure consistency.
 * 
 * @ref contract/constants
 * @doc docs/CODE-DOC-SYNC.md#12-ssot-constants
 * @since 2025-12-27
 * 
 * Consumers:
 * - apps/magpie/src/components/overlays/SettingsPanel.tsx (direct import)
 * - apps/prism-server/src/lib/scout-quota.ts (inline + comment)
 * - apps/api-proxy/src/proxy.ts (inline + comment)
 * - apps/api-proxy/src/server.ts (inline + comment)
 */

// =============================================================================
// SCOUT QUOTA
// =============================================================================

/**
 * Default daily Scout quota limit.
 * User can adjust this in Settings, but this is the initial value.
 */
export const SCOUT_QUOTA_DEFAULT = 25;

/**
 * Estimated cost per Scout operation (USD).
 * Based on Tavily API pricing (~$0.04 per search).
 */
export const SCOUT_COST_PER_CALL = 0.04;

// =============================================================================
// API PROXY QUOTAS
// =============================================================================

/**
 * Daily Tavily search quota per user (via api-proxy).
 */
export const TAVILY_DAILY_QUOTA = 50;

/**
 * Daily Qveris execution quota per user (via api-proxy).
 */
export const QVERIS_DAILY_QUOTA = 30;

/**
 * Daily token quota for OpenAI (via api-proxy).
 */
export const OPENAI_TOKEN_DAILY_QUOTA = 100000;

