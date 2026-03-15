/**
 * Migration V5: Add Milestone Entity Type
 * 
 * Introduces the 'milestone' entity type to distinguish:
 * - concept: Abstract ideas, design patterns, mental models
 * - milestone: Project phases, stages, progress markers
 * 
 * This migration reclassifies existing concept:* entities that are
 * actually milestones (phases, MVP stages, etc.) to the new type.
 * 
 * Color mapping:
 * - milestone → intel → blue 🔵 (project progress information)
 * - concept → spark → yellow 🟡 (abstract ideas)
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

// Patterns to reclassify from concept → milestone
const RECLASSIFY_RULES: Array<{
  pattern: string;        // SQL LIKE pattern
  reason: string;
}> = [
  {
    pattern: 'concept:phase_%',
    reason: 'Product phases are milestones, not concepts',
  },
  {
    pattern: 'concept:mvp_%',
    reason: 'MVP stages are milestones, not concepts',
  },
  {
    pattern: 'concept:web_mvp_%',
    reason: 'MVP builds are milestones, not concepts',
  },
  {
    pattern: 'concept:%_phase',
    reason: 'Phases are milestones, not concepts',
  },
  {
    pattern: 'concept:%_completion',
    reason: 'Completions are milestones, not concepts',
  },
  {
    pattern: 'concept:%_release',
    reason: 'Releases are milestones, not concepts',
  },
  {
    pattern: 'concept:beta_%',
    reason: 'Beta stages are milestones, not concepts',
  },
  {
    pattern: 'concept:alpha_%',
    reason: 'Alpha stages are milestones, not concepts',
  },
];

export const v5_add_milestone_type: Migration = {
  version: 5,
  name: 'add_milestone_type',
  description: 'Add milestone entity type and reclassify phase/stage entities',
  
  up: (db: Database) => {
    console.error('  Introducing milestone entity type...');
    console.error('  Scanning for concept:* entities that should be milestones...');
    
    let totalUpdated = 0;
    
    for (const rule of RECLASSIFY_RULES) {
      // Find entities matching this pattern
      const entities = db.query(`
        SELECT id FROM entities WHERE id LIKE ?
      `).all(rule.pattern) as { id: string }[];
      
      if (entities.length === 0) continue;
      
      console.error(`  Found ${entities.length} entities matching '${rule.pattern}'`);
      console.error(`    Reason: ${rule.reason}`);
      
      for (const entity of entities) {
        const oldId = entity.id;
        const newId = oldId.replace('concept:', 'milestone:');
        
        // Skip if new ID already exists (avoid conflicts)
        const existing = db.query('SELECT 1 FROM entities WHERE id = ?').get(newId);
        if (existing) {
          console.error(`    [Skip] ${oldId} → ${newId} (target exists)`);
          continue;
        }
        
        // Update entity ID
        db.query('UPDATE entities SET id = ? WHERE id = ?').run(newId, oldId);
        
        // Update page_blocks references
        db.query('UPDATE page_blocks SET block_id = ? WHERE block_id = ?').run(newId, oldId);
        db.query('UPDATE page_blocks SET page_id = ? WHERE page_id = ?').run(newId, oldId);
        db.query('UPDATE page_blocks SET target = ? WHERE target = ?').run(newId, oldId);
        
        // Update relations references
        db.query('UPDATE relations SET source = ? WHERE source = ?').run(newId, oldId);
        db.query('UPDATE relations SET target = ? WHERE target = ?').run(newId, oldId);
        
        // Update entity_aliases references (if any)
        db.query('UPDATE entity_aliases SET canonical_id = ? WHERE canonical_id = ?').run(newId, oldId);
        db.query('UPDATE entity_aliases SET alias_id = ? WHERE alias_id = ?').run(newId, oldId);
        
        console.error(`    [Retype] ${oldId} → ${newId}`);
        totalUpdated++;
      }
    }
    
    if (totalUpdated > 0) {
      console.error(`  ✓ Reclassified ${totalUpdated} entities to milestone type`);
    } else {
      console.error('  ✓ No entities needed reclassification');
    }
    
    // Log final counts
    const conceptCount = (db.query(`SELECT COUNT(*) as c FROM entities WHERE id LIKE 'concept:%'`).get() as { c: number }).c;
    const milestoneCount = (db.query(`SELECT COUNT(*) as c FROM entities WHERE id LIKE 'milestone:%'`).get() as { c: number }).c;
    
    console.error(`  Final counts: ${conceptCount} concepts, ${milestoneCount} milestones`);
  },
};




