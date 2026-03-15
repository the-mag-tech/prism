/**
 * Feature Flags - Centralized Feature Toggle Management
 * 
 * @ref feature-flags/system
 * @doc docs/FEATURE-FLAGS.md
 * @since 2026-01-08
 * @updated 2026-01-08 Refactored: Code as SSOT, env > db > default
 * 
 * Design decisions (v2):
 * - **Code is SSOT**: DEFAULT_FLAGS in this file is the source of truth
 * - **Priority**: Environment Variable > DB Override > Code Default
 * - **DB stores overrides only**: Not a mirror of all flags
 * - **Env var format**: FEATURE_{FLAG_NAME}=true|false (e.g., FEATURE_RIPPLE_ENABLED=false)
 * 
 * This ensures:
 * - Git tracks the "intended" configuration
 * - CI/CD can override via env vars
 * - Runtime changes via API are possible but explicit
 * - New flags work immediately without DB setup
 */

import { getDB } from './db.js';
import { log, logWarn } from './lib/logger.js';

// =============================================================================
// FEATURE FLAG DEFINITIONS
// =============================================================================

/**
 * All available feature flags in Prism Server
 */
export interface FeatureFlags {
  // === SYSTEMS ===
  rippleEnabled: boolean;
  scoutEnabled: boolean;
  curatorEnabled: boolean;
  physicsTickEnabled: boolean;

  // === EXTRACTION ===
  autoExtractEnabled: boolean;
  rippleTriggerOnExtract: boolean;

  // === LEARNING ===
  navigationTracking: boolean;
  feedbackTracking: boolean;
  embeddingEnabled: boolean;
  associationLearning: boolean;

  // === EXPERIMENTAL ===
  serendipityEnabled: boolean;
  reactiveRippleEnabled: boolean;
  typeGraduationEnabled: boolean;
}

// =============================================================================
// SSOT: DEFAULT VALUES (This is the source of truth!)
// =============================================================================

/**
 * Default flag values - THE SINGLE SOURCE OF TRUTH
 * 
 * To change a flag's default:
 * 1. Change it HERE
 * 2. Commit to git
 * 3. Deploy
 * 
 * To override temporarily:
 * - Use env var: FEATURE_RIPPLE_ENABLED=false
 * - Or API: setFlag('rippleEnabled', false)
 */
export const DEFAULT_FLAGS: Readonly<FeatureFlags> = {
  // Systems - enabled by default
  rippleEnabled: true,
  scoutEnabled: true,
  curatorEnabled: true,
  physicsTickEnabled: true,
  
  // Extraction - critical pipeline
  autoExtractEnabled: true,
  rippleTriggerOnExtract: true,
  
  // Learning - enabled for personalization
  navigationTracking: true,
  feedbackTracking: true,
  embeddingEnabled: true,
  associationLearning: true,
  
  // Experimental - disabled until stable
  serendipityEnabled: false,
  reactiveRippleEnabled: false,
  typeGraduationEnabled: false,
};

// =============================================================================
// ENV VAR MAPPING
// =============================================================================

/**
 * Map flag keys to environment variable names
 * Format: FEATURE_{SCREAMING_SNAKE_CASE}
 */
function getEnvVarName(key: keyof FeatureFlags): string {
  // Convert camelCase to SCREAMING_SNAKE_CASE
  const snakeCase = key.replace(/([A-Z])/g, '_$1').toUpperCase();
  return `FEATURE_${snakeCase}`;
}

/**
 * Read a flag from environment variable
 * @returns undefined if not set, boolean if set
 */
function readEnvVar(key: keyof FeatureFlags): boolean | undefined {
  const envName = getEnvVarName(key);
  const value = process.env[envName];
  
  if (value === undefined) return undefined;
  
  // Accept: true, false, 1, 0, yes, no
  const normalized = value.toLowerCase().trim();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  
  logWarn(`[FeatureFlags] Invalid env var ${envName}=${value}, ignoring`);
  return undefined;
}

// =============================================================================
// STATE
// =============================================================================

let flags: FeatureFlags = { ...DEFAULT_FLAGS };
let dbOverrides: Partial<FeatureFlags> = {};
let initialized = false;

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize feature flags
 * 
 * Priority (highest to lowest):
 * 1. Environment variables (FEATURE_RIPPLE_ENABLED=false)
 * 2. DB overrides (user set via API)
 * 3. Code defaults (DEFAULT_FLAGS)
 */
export function initFeatureFlags(): void {
  if (initialized) {
    log('[FeatureFlags] Already initialized');
    return;
  }

  const db = getDB();

  // Create table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by TEXT DEFAULT 'system'
    );
  `);

  // 1. Start with defaults
  flags = { ...DEFAULT_FLAGS };

  // 2. Load DB overrides
  const rows = db.query('SELECT key, value FROM feature_flags').all() as Array<{ key: string; value: number }>;
  for (const row of rows) {
    if (row.key in DEFAULT_FLAGS) {
      dbOverrides[row.key as keyof FeatureFlags] = row.value === 1;
      flags[row.key as keyof FeatureFlags] = row.value === 1;
    } else {
      logWarn(`[FeatureFlags] Unknown flag in DB: ${row.key}, cleaning up`);
      db.query('DELETE FROM feature_flags WHERE key = ?').run(row.key);
    }
  }

  // 3. Apply env var overrides (highest priority)
  const envOverrides: string[] = [];
  for (const key of Object.keys(DEFAULT_FLAGS) as Array<keyof FeatureFlags>) {
    const envValue = readEnvVar(key);
    if (envValue !== undefined) {
      flags[key] = envValue;
      envOverrides.push(`${key}=${envValue}`);
    }
  }

  initialized = true;

  // Log summary
  log('[FeatureFlags] Initialized');
  log(`  Defaults: ${Object.keys(DEFAULT_FLAGS).length} flags`);
  log(`  DB overrides: ${Object.keys(dbOverrides).length}`, dbOverrides);
  if (envOverrides.length > 0) {
    log(`  Env overrides: ${envOverrides.join(', ')}`);
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get all current flag values (after priority resolution)
 */
export function getFlags(): Readonly<FeatureFlags> {
  return { ...flags };
}

/**
 * Get a specific flag value
 */
export function getFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  return flags[key];
}

/**
 * Set a flag value (persisted to DB as override)
 * 
 * Note: Env vars still take precedence on next restart
 */
export function setFlag<K extends keyof FeatureFlags>(
  key: K, 
  value: FeatureFlags[K],
  updatedBy: string = 'api'
): void {
  if (!(key in DEFAULT_FLAGS)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }

  // Check if env var is set (warn if trying to override)
  const envValue = readEnvVar(key);
  if (envValue !== undefined) {
    logWarn(`[FeatureFlags] ${key} is set via env var (${getEnvVarName(key)}), DB override will only apply after env var is removed`);
  }

  // Update runtime state
  flags[key] = value;
  dbOverrides[key] = value;
  
  // Persist to DB
  const db = getDB();
  db.query(`
    INSERT INTO feature_flags (key, value, updated_at, updated_by)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(key) DO UPDATE SET
      value = ?,
      updated_at = datetime('now'),
      updated_by = ?
  `).run(key, value ? 1 : 0, updatedBy, value ? 1 : 0, updatedBy);
  
  log(`[FeatureFlags] ${key} = ${value} (by ${updatedBy})`);
}

/**
 * Set multiple flags at once
 */
export function setFlags(updates: Partial<FeatureFlags>, updatedBy: string = 'api'): void {
  for (const [key, value] of Object.entries(updates)) {
    if (key in DEFAULT_FLAGS && typeof value === 'boolean') {
      setFlag(key as keyof FeatureFlags, value, updatedBy);
    }
  }
}

/**
 * Clear a DB override (revert to default or env var)
 */
export function clearOverride<K extends keyof FeatureFlags>(key: K): void {
  const db = getDB();
  db.query('DELETE FROM feature_flags WHERE key = ?').run(key);
  delete dbOverrides[key];
  
  // Recalculate: env > default
  const envValue = readEnvVar(key);
  flags[key] = envValue !== undefined ? envValue : DEFAULT_FLAGS[key];
  
  log(`[FeatureFlags] Cleared override for ${key}, now = ${flags[key]}`);
}

/**
 * Reset all flags to defaults (clears DB and ignores env)
 */
export function resetFlags(): void {
  const db = getDB();
  db.query('DELETE FROM feature_flags').run();
  dbOverrides = {};
  flags = { ...DEFAULT_FLAGS };
  
  // Re-apply env vars
  for (const key of Object.keys(DEFAULT_FLAGS) as Array<keyof FeatureFlags>) {
    const envValue = readEnvVar(key);
    if (envValue !== undefined) {
      flags[key] = envValue;
    }
  }
  
  log('[FeatureFlags] Reset to defaults (env vars still apply)');
}

/**
 * Get flag metadata (for UI/API)
 */
export function getFlagMetadata(): Array<{
  key: string;
  value: boolean;
  default: boolean;
  source: 'default' | 'db' | 'env';
  envVar: string;
  category: string;
  description: string;
  safe: boolean;
}> {
  const definitions: Record<string, { category: string; description: string; safe: boolean }> = {
    rippleEnabled: { category: 'systems', description: 'Event-driven knowledge propagation', safe: true },
    scoutEnabled: { category: 'systems', description: 'External discovery via Tavily', safe: true },
    curatorEnabled: { category: 'systems', description: 'Graph hygiene and deduplication', safe: true },
    physicsTickEnabled: { category: 'systems', description: 'Automatic gravity calculation', safe: true },
    autoExtractEnabled: { category: 'extraction', description: 'Auto-extraction after ingest', safe: false },
    rippleTriggerOnExtract: { category: 'extraction', description: 'Trigger ripple after extraction', safe: true },
    navigationTracking: { category: 'learning', description: 'Navigation path tracking', safe: true },
    feedbackTracking: { category: 'learning', description: 'User feedback tracking', safe: true },
    embeddingEnabled: { category: 'learning', description: 'Path embedding (uses OpenAI)', safe: true },
    associationLearning: { category: 'learning', description: 'Entity association learning', safe: true },
    serendipityEnabled: { category: 'experimental', description: 'Cognitive loop detection', safe: true },
    reactiveRippleEnabled: { category: 'experimental', description: 'Re-contextualize on entity change', safe: true },
    typeGraduationEnabled: { category: 'experimental', description: 'AI discovers new entity types', safe: true },
  };
  
  return Object.entries(flags).map(([key, value]) => {
    const envValue = readEnvVar(key as keyof FeatureFlags);
    const dbValue = dbOverrides[key as keyof FeatureFlags];
    
    let source: 'default' | 'db' | 'env' = 'default';
    if (envValue !== undefined) source = 'env';
    else if (dbValue !== undefined) source = 'db';
    
    const def = definitions[key] || { category: 'unknown', description: '', safe: true };
    
    return {
      key,
      value: value as boolean,
      default: DEFAULT_FLAGS[key as keyof FeatureFlags],
      source,
      envVar: getEnvVarName(key as keyof FeatureFlags),
      ...def,
    };
  });
}

// =============================================================================
// CONVENIENCE CHECKERS
// =============================================================================

// Systems
export const isRippleEnabled = () => flags.rippleEnabled;
export const isScoutEnabled = () => flags.scoutEnabled;
export const isCuratorEnabled = () => flags.curatorEnabled;
export const isPhysicsTickEnabled = () => flags.physicsTickEnabled;

// Extraction
export const isAutoExtractEnabled = () => flags.autoExtractEnabled;
export const isRippleTriggerOnExtract = () => flags.rippleTriggerOnExtract;

// Learning
export const isNavigationTrackingEnabled = () => flags.navigationTracking;
export const isFeedbackTrackingEnabled = () => flags.feedbackTracking;
export const isEmbeddingEnabled = () => flags.embeddingEnabled;
export const isAssociationLearningEnabled = () => flags.associationLearning;

// Experimental
export const isSerendipityEnabled = () => flags.serendipityEnabled;
export const isReactiveRippleEnabled = () => flags.reactiveRippleEnabled;
export const isTypeGraduationEnabled = () => flags.typeGraduationEnabled;

// =============================================================================
// PROVIDER INTERFACE (for future FeatBit integration)
// =============================================================================

export interface FeatureFlagProvider {
  init(): Promise<void>;
  getFlag(key: string, defaultValue: boolean): boolean;
  setFlag(key: string, value: boolean): Promise<void>;
  close(): Promise<void>;
}

export class LocalFeatureFlagProvider implements FeatureFlagProvider {
  async init(): Promise<void> {
    initFeatureFlags();
  }
  
  getFlag(key: string, defaultValue: boolean): boolean {
    if (key in flags) {
      return flags[key as keyof FeatureFlags];
    }
    return defaultValue;
  }
  
  async setFlag(key: string, value: boolean): Promise<void> {
    if (key in DEFAULT_FLAGS) {
      setFlag(key as keyof FeatureFlags, value);
    }
  }
  
  async close(): Promise<void> {}
}

export const featureFlagProvider = new LocalFeatureFlagProvider();
