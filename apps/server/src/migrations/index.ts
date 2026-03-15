/**
 * Migration Manager
 * 
 * Production-ready versioned migration system using SQLite's PRAGMA user_version.
 * 
 * Uses Bun's native SQLite API (bun:sqlite) for single-binary compilation.
 * 
 * Design Principles:
 * 1. Schema migrations are STRICT - block startup until complete
 * 2. Use transactions for atomicity
 * 3. Version tracked via PRAGMA user_version
 * 4. Migrations are idempotent and ordered
 */

import { Database } from 'bun:sqlite';
import path from 'path';
import { v1_initial } from './v1_initial.js';
import { v2_ssot } from './v2_ssot.js';
import { v3_pipeline } from './v3_pipeline.js';
import { v4_fix_entity_types } from './v4_fix_entity_types.js';
import { v5_add_milestone_type } from './v5_add_milestone_type.js';
import { v6_link_project_milestones } from './v6_link_project_milestones.js';
import { v7_fix_milestone_tags } from './v7_fix_milestone_tags.js';
import { v8_visual_feedback } from './v8_visual_feedback.js';
import { v9_fts_triggers } from './v9_fts_triggers.js';
import { v10_public_content } from './v10_public_content.js';
import { v11_fix_fts_schema } from './v11_fix_fts_schema.js';
import { v12_remove_mock_public_content } from './v12_remove_mock_public_content.js';
import { v13_add_last_scouted_at } from './v13_add_last_scouted_at.js';
import * as v14_antigravity from './v14_antigravity.js';
import { v15_explore_logs } from './v15_explore_logs.js';
import { v16_ecs_refactor } from './v16_ecs_refactor.js';
import { v17_explore_public_id } from './v17_explore_public_id.js';
import { v18_gardener_v1 } from './v18_gardener_v1.js';
import { v19_gravity_signals } from './v19_gravity_signals.js';
import { v20_entity_metadata } from './v20_entity_metadata.js';
import { v21_trust_metrics } from './v21_trust_metrics.js';
import { v22_ensure_schema_integrity } from './v22_ensure_schema_integrity.js';
import { migration as v23_memories_discarded } from './v23_memories_discarded.js';
import { migration as v24_entity_groups } from './v24_entity_groups.js';
import { migration as v25_entity_type_differentiation } from './v25_entity_type_differentiation.js';
import { migration as v26_fix_finding_entity_ids } from './v26_fix_finding_entity_ids.js';
import { v28_backfill_memory_entities } from './v28_backfill_memory_entities.js';
import { v29_source_memo_id } from './v29_source_memo_id.js';
import { v30_navigation_sessions } from './v30_navigation_sessions.js';
import { v31_agent_logs } from './v31_agent_logs.js';
import { migration as v32_memories_text_content } from './v32_memories_text_content.js';
import { v33_fix_path_associations } from './v33_fix_path_associations.js';
import { migration as v34_unify_physics } from './v34_unify_physics.js';
import { migration as v35_backfill_memory_body_summary } from './v35_backfill_memory_body_summary.js';
import { migration as v36_fix_scout_header_bodies } from './v36_fix_scout_header_bodies.js';
import { migration as v37_cleanup_duplicate_scout_entities } from './v37_cleanup_duplicate_scout_entities.js';
import { migration as v38_fix_finding_links } from './v38_fix_finding_links.js';
import { migration as v39_unify_memo_id } from './v39_unify_memo_id.js';
import { migration as v40_extraction_status } from './v40_extraction_status.js';
import { v41_add_last_rippled_at } from './v41_add_last_rippled_at.js';
import { migration as v42_clean_scout_metadata_prefix } from './v42_clean_scout_metadata_prefix.js';
import { migration as v43_restore_emails_fts } from './v43_restore_emails_fts.js';
import { migration as v44_search_quality_logs } from './v44_search_quality_logs.js';
import { migration as v50_source_layer_split } from './v50_source_layer_split.js';
import { migration as v51_migrate_source_data } from './v51_migrate_source_data.js';
import { migration as v52_data_gap_detection } from './v52_data_gap_detection.js';

// =============================================================================
// TYPES
// =============================================================================

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: (db: Database) => void;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  migrationsRun: string[];
  success: boolean;
  error?: string;
}

// =============================================================================
// MIGRATION REGISTRY
// =============================================================================

/**
 * All migrations in order.
 * IMPORTANT: Never remove or reorder migrations. Only append new ones.
 */
const MIGRATIONS: Migration[] = [
  v1_initial,
  v2_ssot,
  v3_pipeline,
  v4_fix_entity_types,
  v5_add_milestone_type,
  v6_link_project_milestones,
  v7_fix_milestone_tags,
  v8_visual_feedback,
  v9_fts_triggers,
  v10_public_content,
  v11_fix_fts_schema,
  v12_remove_mock_public_content,
  v13_add_last_scouted_at,
  {
    version: 14,
    name: 'antigravity_schema',
    description: 'Add gravity support: entity_gravity cache and field_snapshots',
    up: v14_antigravity.up
  },
  v15_explore_logs,
  v16_ecs_refactor,
  v17_explore_public_id,
  v18_gardener_v1,
  v19_gravity_signals,
  v20_entity_metadata,
  v21_trust_metrics,
  v22_ensure_schema_integrity,
  v23_memories_discarded,
  v24_entity_groups,
  v25_entity_type_differentiation,
  v26_fix_finding_entity_ids,
  v28_backfill_memory_entities,
  v29_source_memo_id,
  v30_navigation_sessions,
  v31_agent_logs,
  v32_memories_text_content,
  v33_fix_path_associations,
  v34_unify_physics,
  v35_backfill_memory_body_summary,
  v36_fix_scout_header_bodies,
  v37_cleanup_duplicate_scout_entities,
  v38_fix_finding_links,
  v39_unify_memo_id,
  v40_extraction_status,
  v41_add_last_rippled_at,
  v42_clean_scout_metadata_prefix,
  v43_restore_emails_fts,
  v44_search_quality_logs,
  v50_source_layer_split,
  v51_migrate_source_data,
  v52_data_gap_detection,
];

// Target version is the highest migration version
const TARGET_DB_VERSION = MIGRATIONS.length > 0
  ? Math.max(...MIGRATIONS.map(m => m.version))
  : 0;


// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Opens database and returns handle.
 * Does NOT run migrations - call runMigrations() separately.
 */
export function openDatabase(dbPath: string): Database {
  const finalPath = dbPath || path.join(process.cwd(), 'prism.db');
  const db = new Database(finalPath);
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

/**
 * Gets current database version from PRAGMA user_version
 */
export function getDBVersion(db: Database): number {
  const result = db.query('PRAGMA user_version').get() as { user_version: number } | null;
  return result?.user_version ?? 0;
}

/**
 * Sets database version via PRAGMA user_version
 */
function setDBVersion(db: Database, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}

/**
 * Runs all pending migrations.
 * 
 * This is a BLOCKING operation that must complete before server starts.
 * All migrations run in a transaction for atomicity.
 */
export function runMigrations(db: Database): MigrationResult {
  const currentVersion = getDBVersion(db);
  const migrationsRun: string[] = [];

  console.error(`[Migrations] Current DB version: ${currentVersion}, Target: ${TARGET_DB_VERSION}`);

  if (currentVersion >= TARGET_DB_VERSION) {
    console.error('[Migrations] Database is up to date');
    return {
      fromVersion: currentVersion,
      toVersion: currentVersion,
      migrationsRun: [],
      success: true,
    };
  }

  // Get migrations that need to run
  const pendingMigrations = MIGRATIONS
    .filter(m => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  console.error(`[Migrations] ${pendingMigrations.length} migration(s) to run`);

  try {
    // Run each migration in its own transaction
    for (const migration of pendingMigrations) {
      console.error(`[Migrations] Running v${migration.version}: ${migration.name}`);
      console.error(`             ${migration.description}`);

      db.transaction(() => {
        migration.up(db);
        setDBVersion(db, migration.version);
      })();

      migrationsRun.push(`v${migration.version}_${migration.name}`);
      console.error(`[Migrations] ✓ v${migration.version} complete`);
    }

    const finalVersion = getDBVersion(db);
    console.error(`[Migrations] All migrations complete. DB version: ${finalVersion}`);

    return {
      fromVersion: currentVersion,
      toVersion: finalVersion,
      migrationsRun,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Migrations] ✗ Migration failed: ${message}`);

    return {
      fromVersion: currentVersion,
      toVersion: getDBVersion(db),
      migrationsRun,
      success: false,
      error: message,
    };
  }
}

/**
 * Check if database needs migrations
 */
export function needsMigration(db: Database): boolean {
  return getDBVersion(db) < TARGET_DB_VERSION;
}

/**
 * Get list of pending migrations
 */
export function getPendingMigrations(db: Database): Migration[] {
  const currentVersion = getDBVersion(db);
  return MIGRATIONS
    .filter(m => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);
}

// =============================================================================
// EXPORTS
// =============================================================================

export { TARGET_DB_VERSION };
