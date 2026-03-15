/**
 * Migration V24: Entity Groups (Equivalence Classes)
 * 
 * Replaces unidirectional entity_aliases with bidirectional entity_groups.
 * All entities in the same group are considered equivalent.
 * 
 * Key benefits:
 * - Bidirectional linking (A=B means B=A)
 * - No need to update relations on merge
 * - Query-time equivalence resolution
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
    version: 24,
    name: 'entity_groups',
    description: 'Add entity_groups table for bidirectional entity equivalence',

    up: (db: Database) => {
        // 1. Create entity_groups table
        console.error('  Creating entity_groups table...');
        db.exec(`
      CREATE TABLE IF NOT EXISTS entity_groups (
        entity_id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        joined_at TEXT DEFAULT (datetime('now')),
        joined_by TEXT
      )
    `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_groups_group ON entity_groups(group_id)`);
        console.error('  ✓ entity_groups table created');

        // 2. Migrate existing aliases
        console.error('  Migrating existing aliases...');

        // Check if entity_aliases exists
        const aliasTableExists = db.query(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='entity_aliases'
    `).get();

        if (aliasTableExists) {
            // Add alias entities to groups
            db.exec(`
        INSERT OR IGNORE INTO entity_groups (entity_id, group_id, joined_by)
        SELECT alias_id, canonical_id, alias_type FROM entity_aliases
      `);

            // Ensure canonical entities are also in their groups
            db.exec(`
        INSERT OR IGNORE INTO entity_groups (entity_id, group_id, joined_by)
        SELECT DISTINCT canonical_id, canonical_id, 'canonical' FROM entity_aliases
      `);

            const count = db.query('SELECT COUNT(*) as c FROM entity_groups').get() as { c: number };
            console.error(`  ✓ Migrated ${count.c} entities to groups`);
        } else {
            console.error('  ✓ No existing aliases to migrate');
        }
    }
};
