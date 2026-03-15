import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v13_add_last_scouted_at: Migration = {
  version: 13,
  name: 'add_last_scouted_at',
  description: 'Add last_scouted_at column to entities table for patrol tracking',
  up: (db: Database) => {
    // Add last_scouted_at column
    try {
      db.query('ALTER TABLE entities ADD COLUMN last_scouted_at TEXT').run();
      console.error('  ✓ Added last_scouted_at column to entities');
    } catch (error: any) {
      if (!error.message.includes('duplicate column name')) {
        throw error;
      }
    }
  }
};

