/**
 * Migration V38: Fix Finding Links
 * 
 * Ensures all scout_snapshot findings have proper:
 * 1. page_blocks linking to extracted entities
 * 2. relations (contains/containedIn) for graph traversal
 * 3. All entities have header blocks
 * 
 * This fixes a bug where extractEntities only created page_blocks
 * but not relations between findings and their extracted entities.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

interface MemoryRow {
  id: number;
  title: string;
}

interface EntityRow {
  id: string;
}

export const migration: Migration = {
  version: 38,
  name: 'fix_finding_links',
  description: 'Add missing relations between findings and extracted entities',

  up: (db: Database) => {
    console.error('  Fixing finding links...');

    // PART 0: Ensure ALL entities have header blocks
    const allEntities = db.query(`SELECT id FROM entities`).all() as EntityRow[];
    let headersAdded = 0;
    
    for (const entity of allEntities) {
      const headerExists = db.query(`
        SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ? AND is_header = 1
      `).get(entity.id, entity.id);
      
      if (!headerExists) {
        db.query(`
          INSERT OR IGNORE INTO page_blocks (page_id, block_id, position, is_header)
          VALUES (?, ?, -1, 1)
        `).run(entity.id, entity.id);
        headersAdded++;
      }
    }
    
    console.error(`  ✓ Added ${headersAdded} missing header blocks`);

    // Get all scout_snapshot memories
    const scoutMemories = db.query(`
      SELECT id, title FROM memories WHERE source_type = 'scout_snapshot'
    `).all() as MemoryRow[];

    console.error(`  Found ${scoutMemories.length} scout_snapshot memories`);

    let blocksAdded = 0;
    let relationsAdded = 0;
    let findingsFixed = 0;

    for (const memory of scoutMemories) {
      const findingId = `finding:${memory.id}`;

      // Check if finding entity exists
      const findingExists = db.query('SELECT id FROM entities WHERE id = ?').get(findingId);
      if (!findingExists) continue;

      // Get entities extracted from this memory
      // Note: uses source_memory_id for backwards compatibility (before v39 unification)
      const extractedEntities = db.query(`
        SELECT id FROM entities
        WHERE source_memory_id = ?
          AND id != ?
          AND id NOT LIKE 'memory:%'
      `).all(memory.id, findingId) as EntityRow[];

      if (extractedEntities.length === 0) continue;

      let modified = false;

      // Ensure header block exists
      const headerExists = db.query(`
        SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ? AND is_header = 1
      `).get(findingId, findingId);

      if (!headerExists) {
        const maxPos = (db.query(`
          SELECT COALESCE(MAX(position), -1) as max_pos FROM page_blocks WHERE page_id = ?
        `).get(findingId) as { max_pos: number }).max_pos;

        db.query(`
          INSERT OR IGNORE INTO page_blocks (page_id, block_id, position, is_header)
          VALUES (?, ?, ?, 1)
        `).run(findingId, findingId, maxPos + 1);
        blocksAdded++;
        modified = true;
      }

      for (const entity of extractedEntities) {
        // Check/add page_block: finding → entity
        const blockExists = db.query(`
          SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ?
        `).get(findingId, entity.id);

        if (!blockExists) {
          const maxPos = (db.query(`
            SELECT COALESCE(MAX(position), -1) as max_pos FROM page_blocks WHERE page_id = ?
          `).get(findingId) as { max_pos: number }).max_pos;

          db.query(`
            INSERT OR IGNORE INTO page_blocks (page_id, block_id, position, target)
            VALUES (?, ?, ?, ?)
          `).run(findingId, entity.id, maxPos + 1, entity.id);
          blocksAdded++;
          modified = true;
        }

        // Check/add page_block: entity → finding (source link)
        const reverseBlockExists = db.query(`
          SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ?
        `).get(entity.id, findingId);

        if (!reverseBlockExists) {
          const maxPos = (db.query(`
            SELECT COALESCE(MAX(position), -1) as max_pos FROM page_blocks WHERE page_id = ?
          `).get(entity.id) as { max_pos: number }).max_pos;

          db.query(`
            INSERT OR IGNORE INTO page_blocks (page_id, block_id, position, target, is_source)
            VALUES (?, ?, ?, ?, 1)
          `).run(entity.id, findingId, maxPos + 1, findingId);
          blocksAdded++;
          modified = true;
        }

        // Check/add relation: finding → entity (contains)
        const containsExists = db.query(`
          SELECT 1 FROM relations WHERE source = ? AND target = ? AND type = 'contains'
        `).get(findingId, entity.id);

        if (!containsExists) {
          db.query(`
            INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
            VALUES (?, ?, 'contains', 0.8, datetime('now'))
          `).run(findingId, entity.id);
          relationsAdded++;
          modified = true;
        }

        // Check/add relation: entity → finding (containedIn)
        const containedInExists = db.query(`
          SELECT 1 FROM relations WHERE source = ? AND target = ? AND type = 'containedIn'
        `).get(entity.id, findingId);

        if (!containedInExists) {
          db.query(`
            INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
            VALUES (?, ?, 'containedIn', 0.8, datetime('now'))
          `).run(entity.id, findingId);
          relationsAdded++;
          modified = true;
        }
      }

      if (modified) {
        findingsFixed++;
      }
    }

    console.error(`  ✓ Fixed ${findingsFixed} findings`);
    console.error(`    - ${blocksAdded} page_blocks added`);
    console.error(`    - ${relationsAdded} relations added`);
  }
};

