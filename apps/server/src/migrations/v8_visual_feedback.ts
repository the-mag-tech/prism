/**
 * Migration V8: Visual Feedback System
 * 
 * Adds visual_issues table to store user-reported UI issues.
 * This enables the Migration Lifecycle to receive user feedback as input.
 * 
 * Issue types:
 * - duplicate_entity: Same entity appears multiple times
 * - wrong_color: Entity has incorrect color/classification
 * - missing_relation: Related entities not linked
 * - other: Any other UI issue
 * 
 * Status flow:
 * open → analyzed → migrated → closed
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v8_visual_feedback: Migration = {
  version: 8,
  name: 'visual_feedback',
  description: 'Add visual_issues table for user feedback',
  
  up: (db: Database) => {
    console.error('  Creating visual_issues table...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS visual_issues (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        comment TEXT,
        page_data TEXT,
        status TEXT DEFAULT 'open',
        migration_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_visual_issues_status ON visual_issues(status);
      CREATE INDEX IF NOT EXISTS idx_visual_issues_type ON visual_issues(issue_type);
      CREATE INDEX IF NOT EXISTS idx_visual_issues_page ON visual_issues(page_id);
    `);
    
    console.error('  ✓ visual_issues table created');
  },
};




