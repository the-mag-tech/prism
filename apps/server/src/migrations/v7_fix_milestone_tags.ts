/**
 * Migration V7: Fix Milestone Tags and Deduplicate
 * 
 * Problems found via UI inspection:
 * 1. milestone:* entities still have tag="EVENT" instead of "MILESTONE"
 * 2. milestone:phase_1_mvp and milestone:mvp_completion have same title
 * 
 * This migration:
 * 1. Updates tag field for all milestone entities
 * 2. Merges duplicate milestone entities with same title
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v7_fix_milestone_tags: Migration = {
  version: 7,
  name: 'fix_milestone_tags',
  description: 'Fix milestone tags and deduplicate entities with same title',
  
  up: (db: Database) => {
    // =================================================================
    // Part 1: Fix tag field for milestone entities
    // =================================================================
    console.error('  Part 1: Fixing milestone tags...');
    
    const milestoneTagUpdate = db.query(`
      UPDATE entities SET tag = 'MILESTONE' WHERE id LIKE 'milestone:%'
    `).run();
    
    console.error(`  ✓ Updated ${milestoneTagUpdate.changes} milestone tags`);
    
    // =================================================================
    // Part 2: Deduplicate entities with same title
    // =================================================================
    console.error('  Part 2: Finding duplicate titles...');
    
    // Find entities with duplicate titles
    const duplicates = db.query(`
      SELECT title, GROUP_CONCAT(id) as ids, COUNT(*) as cnt
      FROM entities
      WHERE id LIKE 'milestone:%'
      GROUP BY title
      HAVING cnt > 1
    `).all() as { title: string; ids: string; cnt: number }[];
    
    if (duplicates.length === 0) {
      console.error('  ✓ No duplicate milestone titles found');
      return;
    }
    
    console.error(`  Found ${duplicates.length} groups of duplicates`);
    
    // Merge duplicates: keep the first one (canonical), alias the rest
    const insertAlias = db.query(`
      INSERT OR IGNORE INTO entity_aliases (canonical_id, alias_id, created_at)
      VALUES (?, ?, datetime('now'))
    `);
    const deleteEntity = db.query(`
      DELETE FROM entities WHERE id = ?
    `);
    
    let mergedCount = 0;
    
    for (const dup of duplicates) {
      const ids = dup.ids.split(',');
      const canonicalId = ids[0];  // Keep the first one
      const aliasIds = ids.slice(1);
      
      console.error(`  Merging "${dup.title}": ${canonicalId} ← ${aliasIds.join(', ')}`);
      
      for (const aliasId of aliasIds) {
        // 1. Record alias relationship
        insertAlias.run(canonicalId, aliasId);
        
        // 2. Update page_blocks where block_id is the alias (skip if would cause conflict)
        //    First, delete any that would conflict
        db.query(`
          DELETE FROM page_blocks 
          WHERE block_id = ? 
            AND page_id IN (SELECT page_id FROM page_blocks WHERE block_id = ?)
        `).run(aliasId, canonicalId);
        
        //    Then update remaining
        db.query(`
          UPDATE page_blocks SET block_id = ?, target = ? WHERE block_id = ?
        `).run(canonicalId, canonicalId, aliasId);
        
        // 3. Merge alias page into canonical page
        //    First, delete blocks from alias page that already exist in canonical page
        db.query(`
          DELETE FROM page_blocks 
          WHERE page_id = ? 
            AND block_id IN (SELECT block_id FROM page_blocks WHERE page_id = ?)
        `).run(aliasId, canonicalId);
        
        //    Then move remaining blocks to canonical page
        db.query(`
          UPDATE page_blocks SET page_id = ? WHERE page_id = ?
        `).run(canonicalId, aliasId);
        
        // 4. Delete alias entity
        deleteEntity.run(aliasId);
        
        mergedCount++;
      }
    }
    
    console.error(`  ✓ Merged ${mergedCount} duplicate entities`);
    
    // Clean up any orphaned page_blocks after merge
    const orphanedBlocks = db.query(`
      DELETE FROM page_blocks 
      WHERE block_id NOT IN (SELECT id FROM entities)
        AND block_id NOT LIKE 'memory:%'
    `).run();
    
    if (orphanedBlocks.changes > 0) {
      console.error(`  ✓ Cleaned ${orphanedBlocks.changes} orphaned page_blocks`);
    }
  },
};

