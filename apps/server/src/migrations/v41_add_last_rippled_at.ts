/**
 * Migration v41: Add last_rippled_at column
 * 
 * Supports the Ripple System's passive tick feature by tracking
 * when an entity was last rippled (propagated through the knowledge graph).
 * 
 * @since 2025-12-27
 */
import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v41_add_last_rippled_at: Migration = {
  version: 41,
  name: 'add_last_rippled_at',
  description: 'Add last_rippled_at column to entity_profiles for Ripple tick scheduling',
  
  up: (db: Database) => {
    try {
      db.query('ALTER TABLE entity_profiles ADD COLUMN last_rippled_at TEXT').run();
      console.error('  ✓ Added last_rippled_at column to entity_profiles');
    } catch (error: any) {
      if (error.message.includes('duplicate column name')) {
        console.error('  ℹ last_rippled_at column already exists');
      } else {
        throw error;
      }
    }
  },
};



