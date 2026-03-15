/**
 * Migration V3: Pipeline Versioning
 * 
 * Adds columns to track which pipeline version was used to create entities.
 * This enables lazy migration when pipeline (prompt/model) changes.
 * 
 * Columns:
 * - pipeline_version: Hash of prompt + model used to create entity
 * - is_stale: Flag indicating entity needs re-extraction
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v3_pipeline: Migration = {
  version: 3,
  name: 'pipeline_versioning',
  description: 'Add pipeline_version and is_stale columns for lazy migration',
  
  up: (db: Database) => {
    // Check which columns need to be added
    const tableInfo = db.query("PRAGMA table_info(entities)").all() as { name: string }[];
    const existingColumns = new Set(tableInfo.map(c => c.name));
    
    // Add pipeline_version column if not exists
    if (!existingColumns.has('pipeline_version')) {
      db.exec('ALTER TABLE entities ADD COLUMN pipeline_version TEXT');
      console.error('  + Added pipeline_version column to entities');
    }
    
    // Add is_stale column if not exists
    if (!existingColumns.has('is_stale')) {
      db.exec('ALTER TABLE entities ADD COLUMN is_stale INTEGER DEFAULT 0');
      console.error('  + Added is_stale column to entities');
      
      // Create index for efficient stale entity queries
      db.exec('CREATE INDEX IF NOT EXISTS idx_entities_stale ON entities(is_stale)');
      console.error('  + Created index on is_stale');
    }
    
    // Count entities without pipeline_version (legacy data)
    const legacyCount = db.query(`
      SELECT COUNT(*) as count FROM entities WHERE pipeline_version IS NULL
    `).get() as { count: number };
    
    if (legacyCount.count > 0) {
      console.error(`  Found ${legacyCount.count} entities without pipeline_version`);
      console.error('  These will be marked as stale and re-extracted lazily');
      
      // Mark legacy entities as stale
      db.query(`
        UPDATE entities 
        SET is_stale = 1, pipeline_version = 'legacy'
        WHERE pipeline_version IS NULL
      `).run();
      
      console.error('  ✓ Marked legacy entities as stale');
    }
  },
};




