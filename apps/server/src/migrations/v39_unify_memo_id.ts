/**
 * Migration V39: Unify source_memo_id and source_memory_id into memo_id
 * 
 * Problem:
 * - source_memo_id: used by ingestFinding for content retrieval
 * - source_memory_id: used by extractEntities for tracking extraction source
 * - Both point to memories.id, but different code paths use different fields
 * - This caused data inconsistency and duplicate entity creation
 * 
 * Solution:
 * - Add new unified field: memo_id
 * - Merge values from both old fields (COALESCE)
 * - Keep old fields for now (will be removed in future migration)
 * - Clean up duplicate memory:xxx entities for scout_snapshot
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 39,
  name: 'unify_memo_id',
  description: 'Unify source_memo_id and source_memory_id into memo_id, cleanup duplicates',
  
  up: (db: Database) => {
    // 1. Add new unified column memo_id
    console.error('  Adding memo_id column...');
    try {
      db.run(`ALTER TABLE entities ADD COLUMN memo_id INTEGER REFERENCES memories(id)`);
    } catch (e) {
      // Column might already exist
      console.error('  memo_id column may already exist, continuing...');
    }

    // 2. Merge values: prefer source_memo_id, fallback to source_memory_id
    console.error('  Merging source_memo_id and source_memory_id into memo_id...');
    const mergeResult = db.run(`
      UPDATE entities 
      SET memo_id = COALESCE(source_memo_id, source_memory_id)
      WHERE memo_id IS NULL 
        AND (source_memo_id IS NOT NULL OR source_memory_id IS NOT NULL)
    `);
    console.error(`  Merged ${mergeResult.changes} entities`);

    // 3. Create index for fast lookups
    console.error('  Creating index on memo_id...');
    db.run(`CREATE INDEX IF NOT EXISTS idx_entities_memo_id ON entities(memo_id)`);

    // 4. Clean up duplicate memory:xxx entities for scout_snapshot
    // These were incorrectly created when finding:xxx already exists
    console.error('  Cleaning up duplicate memory:xxx entities for scout_snapshot...');
    
    const duplicates = db.query(`
      SELECT m.id as entity_id, f.id as finding_id, mem.id as memories_id
      FROM entities m
      JOIN memories mem ON m.id = 'memory:' || mem.id
      JOIN entities f ON f.id = 'finding:' || mem.id
      WHERE mem.source_type = 'scout_snapshot'
    `).all() as Array<{
      entity_id: string;
      finding_id: string;
      memories_id: number;
    }>;

    console.error(`  Found ${duplicates.length} duplicate memory:xxx entities to clean up`);

    for (const dup of duplicates) {
      // Move relations from memory:xxx to finding:xxx (ignore if already exists)
      db.run(`
        UPDATE OR IGNORE relations SET source = ? WHERE source = ?
      `, [dup.finding_id, dup.entity_id]);
      
      db.run(`
        UPDATE OR IGNORE relations SET target = ? WHERE target = ?
      `, [dup.finding_id, dup.entity_id]);
      
      // Delete relations that couldn't be moved (duplicates)
      db.run(`DELETE FROM relations WHERE source = ? OR target = ?`, [dup.entity_id, dup.entity_id]);

      // For page_blocks: delete duplicates first, then update remaining
      // Delete page_blocks that would conflict (already exist on finding page)
      db.run(`
        DELETE FROM page_blocks 
        WHERE page_id = ? 
          AND block_id IN (SELECT block_id FROM page_blocks WHERE page_id = ?)
      `, [dup.entity_id, dup.finding_id]);
      
      db.run(`
        DELETE FROM page_blocks 
        WHERE block_id = ? 
          AND page_id IN (SELECT page_id FROM page_blocks WHERE block_id = ?)
      `, [dup.entity_id, dup.finding_id]);

      // Now safely move remaining page_blocks
      db.run(`
        UPDATE page_blocks SET page_id = ? WHERE page_id = ?
      `, [dup.finding_id, dup.entity_id]);
      
      db.run(`
        UPDATE page_blocks SET block_id = ? WHERE block_id = ?
      `, [dup.finding_id, dup.entity_id]);

      // Delete duplicate entity
      db.run(`DELETE FROM entities WHERE id = ?`, [dup.entity_id]);
      
      console.error(`    Cleaned up ${dup.entity_id} → merged into ${dup.finding_id}`);
    }

    // 5. Ensure all finding:xxx have memo_id set
    console.error('  Ensuring all finding:xxx entities have memo_id...');
    const findingFix = db.run(`
      UPDATE entities
      SET memo_id = CAST(SUBSTR(id, 9) AS INTEGER)
      WHERE id LIKE 'finding:%' AND memo_id IS NULL
    `);
    console.error(`  Fixed ${findingFix.changes} finding entities`);

    // 6. Ensure all memory:xxx have memo_id set
    console.error('  Ensuring all memory:xxx entities have memo_id...');
    const memoryFix = db.run(`
      UPDATE entities
      SET memo_id = CAST(SUBSTR(id, 8) AS INTEGER)
      WHERE id LIKE 'memory:%' AND memo_id IS NULL
    `);
    console.error(`  Fixed ${memoryFix.changes} memory entities`);

    console.error('  ✓ Migration complete');
  },
};

