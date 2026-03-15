/**
 * Runtime Settings - Controls for learning and tracking features
 * 
 * These settings can be toggled via API without restarting the server.
 */

import { getDB } from './db.js';

// =============================================================================
// TYPES
// =============================================================================

export interface LearningSettings {
  navigationTracking: boolean;   // Record navigation paths
  feedbackTracking: boolean;     // Record user feedback (click, dwell, copy)
  embeddingEnabled: boolean;     // Compute path embeddings (uses OpenAI API)
  associationLearning: boolean;  // Learn entity associations from paths
}

// =============================================================================
// DEFAULT SETTINGS
// =============================================================================

const DEFAULT_SETTINGS: LearningSettings = {
  navigationTracking: true,
  feedbackTracking: true,
  embeddingEnabled: true,
  associationLearning: true,
};

// In-memory cache (persisted to DB)
let currentSettings: LearningSettings = { ...DEFAULT_SETTINGS };

// =============================================================================
// DATABASE PERSISTENCE
// =============================================================================

/**
 * Initialize settings table and load from DB
 */
export function initSettings() {
  const db = getDB();

  // Create settings table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Load settings from DB
  const rows = db.query('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  
  for (const row of rows) {
    if (row.key in currentSettings) {
      (currentSettings as any)[row.key] = row.value === 'true';
    }
  }

  console.log('[Settings] Loaded:', currentSettings);
}

/**
 * Save a setting to DB
 */
function saveSetting(key: string, value: boolean) {
  const db = getDB();
  db.query(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = ?,
      updated_at = datetime('now')
  `).run(key, String(value), String(value));
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get current learning settings
 */
export function getSettings(): LearningSettings {
  return { ...currentSettings };
}

/**
 * Update learning settings
 */
export function updateSettings(updates: Partial<LearningSettings>): LearningSettings {
  for (const [key, value] of Object.entries(updates)) {
    if (key in currentSettings && typeof value === 'boolean') {
      (currentSettings as any)[key] = value;
      saveSetting(key, value);
    }
  }
  console.log('[Settings] Updated:', currentSettings);
  return { ...currentSettings };
}

/**
 * Check if navigation tracking is enabled
 */
export function isNavigationTrackingEnabled(): boolean {
  return currentSettings.navigationTracking;
}

/**
 * Check if feedback tracking is enabled
 */
export function isFeedbackTrackingEnabled(): boolean {
  return currentSettings.feedbackTracking;
}

/**
 * Check if embedding is enabled
 */
export function isEmbeddingEnabled(): boolean {
  return currentSettings.embeddingEnabled;
}

/**
 * Check if association learning is enabled
 */
export function isAssociationLearningEnabled(): boolean {
  return currentSettings.associationLearning;
}

/**
 * Reset all settings to defaults
 */
export function resetSettings(): LearningSettings {
  currentSettings = { ...DEFAULT_SETTINGS };
  const db = getDB();
  db.query('DELETE FROM settings').run();
  console.log('[Settings] Reset to defaults:', currentSettings);
  return { ...currentSettings };
}

