/**
 * Migration V26: Fix Entity ID Conversion
 * 
 * Re-runs the entity ID conversion that may have failed in v25.
 * Converts scout_snapshot entities from memory:x to finding:x.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
    version: 26,
    name: 'fix_finding_entity_ids',
    description: 'Convert scout_snapshot entities from memory:x to finding:x',

    up: (db: Database) => {
        console.error('  Converting scout_snapshot entities to finding:x...');

        // 1. Get all scout_snapshot memories
        const scoutMemories = db.query(`
      SELECT id FROM memories WHERE source_type = 'scout_snapshot'
    `).all() as { id: number }[];

        console.error(`  Found ${scoutMemories.length} scout snapshots`);
        if (scoutMemories.length === 0) return;

        // 2. Temporarily drop FTS triggers to avoid issues
        console.error('  Disabling FTS triggers...');
        db.exec(`DROP TRIGGER IF EXISTS entities_fts_insert`);
        db.exec(`DROP TRIGGER IF EXISTS entities_fts_delete`);
        db.exec(`DROP TRIGGER IF EXISTS entities_fts_update`);

        let created = 0;
        let deleted = 0;

        for (const mem of scoutMemories) {
            const oldId = `memory:${mem.id}`;
            const newId = `finding:${mem.id}`;

            // Check if old entity exists
            const oldEntity = db.query('SELECT title, subtitle, body, created_at FROM entities WHERE id = ?').get(oldId) as { title: string; subtitle: string; body: string; created_at: string } | undefined;

            if (oldEntity) {
                // Insert new finding entity
                db.query(`
          INSERT OR REPLACE INTO entities (id, title, subtitle, body, tag, created_at)
          VALUES (?, ?, ?, ?, 'SPARK', ?)
        `).run(newId, oldEntity.title, oldEntity.subtitle, oldEntity.body, oldEntity.created_at);
                created++;

                // Delete old memory entity
                db.query('DELETE FROM entities WHERE id = ?').run(oldId);
                deleted++;
            }
        }

        console.error(`  Created ${created} finding:x entities`);
        console.error(`  Deleted ${deleted} memory:x entities`);

        // 3. Recreate FTS triggers
        console.error('  Recreating FTS triggers...');
        db.exec(`
      CREATE TRIGGER entities_fts_insert AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, title, subtitle, body) VALUES (new.rowid, new.title, new.subtitle, new.body);
      END
    `);
        db.exec(`
      CREATE TRIGGER entities_fts_delete AFTER DELETE ON entities BEGIN
        DELETE FROM entities_fts WHERE rowid = old.rowid;
      END
    `);
        db.exec(`
      CREATE TRIGGER entities_fts_update AFTER UPDATE ON entities BEGIN
        DELETE FROM entities_fts WHERE rowid = old.rowid;
        INSERT INTO entities_fts(rowid, title, subtitle, body) VALUES (new.rowid, new.title, new.subtitle, new.body);
      END
    `);

        // 4. Rebuild FTS index
        console.error('  Rebuilding FTS index...');
        db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);

        console.error(`  ✓ Migration complete`);
    }
};
