import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v20_entity_metadata: Migration = {
    version: 20,
    name: 'entity_metadata',
    description: 'Add entity_metadata table for flexible annotations (Serendipity, etc.)',
    up: (db: Database) => {
        db.exec(`
      CREATE TABLE IF NOT EXISTS entity_metadata (
        entity_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (entity_id, key),
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );
    `);
    },
};
