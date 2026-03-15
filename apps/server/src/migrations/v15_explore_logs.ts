import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

/**
 * @deprecated This table has been moved to cognitive-arena.
 * Keep this migration for backwards compatibility with existing databases.
 */
export const v15_explore_logs: Migration = {
  version: 15,
  name: 'explore_logs',
  description: '[DEPRECATED] Add explore_logs table - now managed by cognitive-arena',
  up: (db: Database) => {
    // Create explore_logs table
    db.query(`
      CREATE TABLE IF NOT EXISTS explore_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_id TEXT NOT NULL,
        word TEXT NOT NULL,
        winner_direction TEXT,
        winner_score INTEGER,
        explosive_point TEXT,
        one_liner TEXT,
        all_directions TEXT,  -- JSON array of all directions with scores
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    console.error('  ✓ Created explore_logs table');

    // Create indexes for common queries
    db.query(`CREATE INDEX IF NOT EXISTS idx_explore_logs_guest ON explore_logs(guest_id)`).run();
    db.query(`CREATE INDEX IF NOT EXISTS idx_explore_logs_word ON explore_logs(word)`).run();
    db.query(`CREATE INDEX IF NOT EXISTS idx_explore_logs_created ON explore_logs(created_at DESC)`).run();
    console.error('  ✓ Created indexes for explore_logs');
  }
};



