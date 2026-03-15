import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v22_ensure_schema_integrity: Migration = {
    version: 22,
    name: 'ensure_schema_integrity',
    description: 'Fix migration drift: ensure entity_metadata exists',
    up: (db: Database) => {
        // Re-run creation for any potentially missed tables in the v19-v21 gap
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
