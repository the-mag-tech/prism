/**
 * Migration V4: Fix Misclassified Entity Types
 * 
 * Problem: AI extraction incorrectly classified several entities as 'event'
 * when they should be 'concept' (design patterns, product phases, etc.)
 * 
 * This migration reclassifies these entities by:
 * 1. Updating entity IDs (event:xxx → concept:xxx)
 * 2. Updating page_blocks references
 * 3. Updating relations references
 * 
 * Affected entities:
 * - Demo: Drop to Feed Interaction (design concept, not event)
 * - MVP Phase / Phase 1/2/3 (product stages, not events)
 * - Web MVP Built (milestone, but more of a concept/stage)
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

// Entities to reclassify from event → concept
const RECLASSIFY_RULES: Array<{
  pattern: string;        // SQL LIKE pattern to match current id
  oldPrefix: string;      // e.g., 'event:'
  newPrefix: string;      // e.g., 'concept:'
  reason: string;
}> = [
  {
    pattern: 'event:demo_%',
    oldPrefix: 'event:',
    newPrefix: 'concept:',
    reason: 'Demo/interaction patterns are design concepts',
  },
  {
    pattern: 'event:mvp_%',
    oldPrefix: 'event:',
    newPrefix: 'concept:',
    reason: 'MVP phases are product development concepts',
  },
  {
    pattern: 'event:phase_%',
    oldPrefix: 'event:',
    newPrefix: 'concept:',
    reason: 'Product phases are concepts, not time-bound events',
  },
  {
    pattern: 'event:web_mvp_%',
    oldPrefix: 'event:',
    newPrefix: 'concept:',
    reason: 'MVP milestones are better represented as concepts',
  },
];

export const v4_fix_entity_types: Migration = {
  version: 4,
  name: 'fix_entity_types',
  description: 'Reclassify mistyped entities (event→concept for design patterns and phases)',
  
  up: (db: Database) => {
    console.error('  Scanning for misclassified entities...');
    
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
        const newId = oldId.replace(rule.oldPrefix, rule.newPrefix);
        
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
      console.error(`  ✓ Reclassified ${totalUpdated} entities`);
    } else {
      console.error('  ✓ No entities needed reclassification');
    }
  },
};




