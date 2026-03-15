/**
 * Migration V23: Add discarded column to memories table
 * 
 * The discarded column is used to soft-delete memories (e.g. user swipe-to-dismiss)
 * without permanently removing them from the database.
 * 
 * Referenced in:
 * - recommend.ts (getDynamicOriginPage - exclude discarded memories)
 * - ingest.ts (ingestMemory - reset discarded on re-ingest)
 * - app.ts (discard endpoint)
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

function columnExists(db: Database, table: string, column: string): boolean {
    const info = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return info.some(col => col.name === column);
}

export const migration: Migration = {
    version: 23,
    name: 'memories_discarded',
    description: 'Add discarded column to memories table',

    up: (db: Database) => {
        if (!columnExists(db, 'memories', 'discarded')) {
            console.error('  Adding discarded column to memories...');
            db.exec(`ALTER TABLE memories ADD COLUMN discarded INTEGER DEFAULT 0`);
            console.error('  ✓ discarded column added');
        } else {
            console.error('  discarded column already exists, skipping');
        }
    }
};
