/**
 * Migration V29: Add source_memo_id to entities
 * 
 * Adds a direct link from entities to memories table.
 * This cleanly separates:
 * - entity.id (e.g., "memory:35") - the entity identifier
 * - entity.source_memo_id (e.g., 12) - the memories table id for full content
 * 
 * ID Convention:
 * - memo:<id> - references memories.id (for content retrieval)
 * - memory:<id> - entity id (for navigation/display)
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v29_source_memo_id: Migration = {
  version: 29,
  name: 'source_memo_id',
  description: 'Add source_memo_id field to entities for direct memory linking',
  
  up: (db: Database) => {
    // 1. Add source_memo_id column
    console.error('  Adding source_memo_id column to entities...');
    db.run(`
      ALTER TABLE entities ADD COLUMN source_memo_id INTEGER REFERENCES memories(id)
    `);

    // 2. Backfill existing memory entities by matching title
    console.error('  Backfilling source_memo_id for existing memory entities...');
    
    const memoryEntities = db.query(`
      SELECT e.id, e.title, m.id as memo_id
      FROM entities e
      JOIN memories m ON m.title = e.title
      WHERE e.id LIKE 'memory:%' OR e.id LIKE 'finding:%'
    `).all() as Array<{ id: string; title: string; memo_id: number }>;

    console.error(`  Found ${memoryEntities.length} entities to link`);

    const updateStmt = db.query(`
      UPDATE entities SET source_memo_id = ? WHERE id = ?
    `);

    let linked = 0;
    for (const entity of memoryEntities) {
      updateStmt.run(entity.memo_id, entity.id);
      linked++;
    }

    console.error(`  Linked ${linked} entities to their source memories`);

    // 3. Create index for fast lookups
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_entities_source_memo_id ON entities(source_memo_id)
    `);

    console.error('  Migration complete');
  },
};

