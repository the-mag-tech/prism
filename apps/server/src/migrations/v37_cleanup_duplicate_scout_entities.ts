/**
 * Migration V37: Cleanup Duplicate Scout Entities
 * 
 * Problem: Scout snapshots have both finding:xxx AND memory:xxx entities
 * for the same memories.id, causing duplicate blocks on pages.
 * 
 * Solution: Delete memory:xxx entities where a corresponding finding:xxx exists
 * for the same source memory.
 * 
 * Keep: finding:xxx (created by ingestFinding with AI-generated summary)
 * Delete: memory:xxx (incorrectly created by extract.ts)
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 37,
  name: 'cleanup_duplicate_scout_entities',
  description: 'Remove duplicate memory:xxx entities for scout_snapshot sources',
  
  up: (db: Database) => {
    console.error('  Finding duplicate memory:xxx entities for scout_snapshots...');
    
    // Find memory:xxx entities that have a corresponding finding:xxx
    // These are duplicates - the finding:xxx was created correctly by ingestFinding
    const duplicates = db.query(`
      SELECT m.id as memory_entity_id, f.id as finding_entity_id, mem.id as memories_id
      FROM entities m
      JOIN memories mem ON m.id = 'memory:' || mem.id
      JOIN entities f ON f.id = 'finding:' || mem.id
      WHERE mem.source_type = 'scout_snapshot'
    `).all() as Array<{
      memory_entity_id: string;
      finding_entity_id: string;
      memories_id: number;
    }>;
    
    console.error(`  Found ${duplicates.length} duplicate memory:xxx entities`);
    
    if (duplicates.length === 0) {
      return;
    }
    
    // Delete the duplicate memory:xxx entities
    // NOTE: finding:xxx blocks may already exist, so just delete memory:xxx references
    // instead of trying to update them (which would cause UNIQUE constraint violations)
    
    const deleteEntity = db.query('DELETE FROM entities WHERE id = ?');
    const deleteProfiles = db.query('DELETE FROM entity_profiles WHERE id = ?');
    const deletePhysics = db.query('DELETE FROM entity_physics WHERE entity_id = ?');
    
    let deleted = 0;
    
    for (const dup of duplicates) {
      const memoryId = dup.memory_entity_id;
      
      // Delete memory:xxx from page_blocks (finding:xxx should already exist there)
      db.query(`
        DELETE FROM page_blocks WHERE block_id = ?
      `).run(memoryId);
      
      db.query(`
        DELETE FROM page_blocks WHERE page_id = ?
      `).run(memoryId);
      
      // Delete memory:xxx from relations (finding:xxx should already exist there)
      db.query(`
        DELETE FROM relations WHERE source = ?
      `).run(memoryId);
      
      db.query(`
        DELETE FROM relations WHERE target = ?
      `).run(memoryId);
      
      // Delete the duplicate entity
      deleteProfiles.run(memoryId);
      deletePhysics.run(memoryId);
      deleteEntity.run(memoryId);
      
      deleted++;
      
      if (deleted % 50 === 0) {
        console.error(`  Progress: ${deleted}/${duplicates.length} deleted`);
      }
    }
    
    console.error(`  Migration complete: ${deleted} duplicate entities removed`);
  },
};

