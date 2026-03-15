/**
 * Migration V30: Navigation Sessions
 * 
 * Creates the navigation_sessions table for tracking user navigation paths.
 * This table was missing from the initial schema but used in navigation.ts.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v30_navigation_sessions: Migration = {
  version: 30,
  name: 'navigation_sessions',
  description: 'Create navigation_sessions table for path tracking',
  
  up: (db: Database) => {
    console.error('  Creating navigation_sessions table...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS navigation_sessions (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        path_text TEXT,
        final_entity TEXT,
        dwell_time_ms INTEGER,
        embedding BLOB,
        created_at TEXT DEFAULT (datetime('now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_nav_sessions_created ON navigation_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_nav_sessions_final ON navigation_sessions(final_entity);
    `);

    // Also create path_associations if missing (used in navigation stats)
    db.exec(`
      CREATE TABLE IF NOT EXISTS path_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_entity TEXT NOT NULL,
        target_entity TEXT NOT NULL,
        weight REAL DEFAULT 0.5,
        session_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(source_entity, target_entity)
      );
      
      CREATE INDEX IF NOT EXISTS idx_path_assoc_source ON path_associations(source_entity);
      CREATE INDEX IF NOT EXISTS idx_path_assoc_target ON path_associations(target_entity);
    `);

    console.error('  Navigation tables created');
  },
};

