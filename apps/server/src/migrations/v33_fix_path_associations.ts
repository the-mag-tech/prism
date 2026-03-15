/**
 * Migration V33: Fix Path Associations
 * 
 * Recreates the path_associations table to match the schema expected by navigation.ts.
 * The previous version (v30) created it with incorrect columns (source_entity, target_entity)
 * instead of (entity_a, entity_b).
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v33_fix_path_associations: Migration = {
  version: 33,
  name: 'fix_path_associations',
  description: 'Recreate path_associations table with correct schema',
  
  up: (db: Database) => {
    console.error('  Recreating path_associations table...');
    
    // Drop the old table which had wrong schema
    db.exec(`DROP TABLE IF EXISTS path_associations`);
    
    db.exec(`
      CREATE TABLE path_associations (
        entity_a TEXT NOT NULL,
        entity_b TEXT NOT NULL,
        co_occurrence_count INTEGER DEFAULT 0,
        avg_path_similarity REAL DEFAULT 0,
        last_seen TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (entity_a, entity_b)
      );
      
      CREATE INDEX IF NOT EXISTS idx_path_assoc_a ON path_associations(entity_a);
      CREATE INDEX IF NOT EXISTS idx_path_assoc_b ON path_associations(entity_b);
    `);

    console.error('  path_associations table recreated');
  },
};







