
import { Database } from '../db.js';
import { Migration } from './index.js';

export const v21_trust_metrics: Migration = {
    version: 21,
    name: 'trust_metrics',
    description: 'Add tables for tracking automation trust and undo history',
    up: (db: Database) => {
        // 1. Trust Metrics Table
        db.exec(`
      CREATE TABLE IF NOT EXISTS trust_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER,
        method TEXT NOT NULL, -- 'auto_high_conf', 'auto_llm', 'manual'
        similarity REAL,
        outcome TEXT DEFAULT 'success', -- 'success', 'undone'
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_trust_metrics_outcome ON trust_metrics(outcome);
    `);

        // 2. Add decided_by to merge_candidates if not exists
        // SQLite doesn't support IF NOT EXISTS for columns, need try/catch or strict check
        try {
            db.exec(`ALTER TABLE merge_candidates ADD COLUMN decided_by TEXT DEFAULT NULL;`);
        } catch (e) {
            // Ignore if already exists
        }
    },
};
