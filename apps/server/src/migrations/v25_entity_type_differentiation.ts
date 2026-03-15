/**
 * Migration V25: Entity Type Differentiation (Finding vs Memory)
 * 
 * Updates existing scout_snapshot entities to use finding:x ID instead of memory:x
 * 
 * Before: Scout discoveries → memory:x (MEMORY tag)
 * After:  Scout discoveries → finding:x (SPARK tag)
 *         User drops → memory:x (CONTEXT tag)
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
    version: 25,
    name: 'entity_type_differentiation',
    description: 'Differentiate Scout findings from user memories (finding:x vs memory:x)',

    up: (db: Database) => {
        console.error('  Migrating scout_snapshot entities to finding:x...');

        // 1. Get all scout_snapshot memories
        const scoutMemories = db.query(`
      SELECT id, title, source_path FROM memories WHERE source_type = 'scout_snapshot'
    `).all() as { id: number; title: string; source_path: string }[];

        console.error(`  Found ${scoutMemories.length} scout snapshots to migrate`);

        // 2. Temporarily drop FTS trigger
        db.exec(`DROP TRIGGER IF EXISTS entities_fts_update`);

        let migrated = 0;
        for (const mem of scoutMemories) {
            const oldId = `memory:${mem.id}`;
            const newId = `finding:${mem.id}`;

            // Check if old entity exists
            const oldEntity = db.query('SELECT id, body, subtitle FROM entities WHERE id = ?').get(oldId) as { id: string; body: string; subtitle: string } | undefined;

            if (oldEntity) {
                // Create new finding entity (copy from old memory entity)
                db.query(`
          INSERT OR REPLACE INTO entities (id, title, subtitle, body, tag, created_at)
          SELECT ?, title, subtitle, body, 'SPARK', created_at FROM entities WHERE id = ?
        `).run(newId, oldId);

                // Delete old memory entity
                db.query('DELETE FROM entities WHERE id = ?').run(oldId);

                migrated++;
            }
        }

        // 3. Recreate FTS trigger
        db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_fts_update AFTER UPDATE ON entities BEGIN
        DELETE FROM entities_fts WHERE rowid = old.rowid;
        INSERT INTO entities_fts(rowid, title, subtitle, body) VALUES (new.rowid, new.title, new.subtitle, new.body);
      END
    `);

        console.error(`  ✓ Migrated ${migrated} entities from memory:x to finding:x`);
    }
};
