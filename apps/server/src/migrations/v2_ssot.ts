/**
 * Migration V2: Schema V2 SSOT (Single Source of Truth)
 * 
 * Adds layout hint columns to page_blocks to properly separate:
 * - Layout hints (is_header, is_source) - don't affect color
 * - Color override (color_override) - explicit color, rarely used
 * 
 * Color is derived from entity.id prefix (SSOT).
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v2_ssot: Migration = {
  version: 2,
  name: 'schema_v2_ssot',
  description: 'Add is_header, is_source, color_override columns for SSOT color derivation',
  
  up: (db: Database) => {
    // Check which columns need to be added
    const tableInfo = db.query("PRAGMA table_info(page_blocks)").all() as { name: string }[];
    const existingColumns = new Set(tableInfo.map(c => c.name));
    
    // Add is_header column if not exists
    if (!existingColumns.has('is_header')) {
      db.exec('ALTER TABLE page_blocks ADD COLUMN is_header INTEGER DEFAULT 0');
      console.error('  + Added is_header column');
    }
    
    // Add is_source column if not exists
    if (!existingColumns.has('is_source')) {
      db.exec('ALTER TABLE page_blocks ADD COLUMN is_source INTEGER DEFAULT 0');
      console.error('  + Added is_source column');
    }
    
    // Add color_override column if not exists
    if (!existingColumns.has('color_override')) {
      db.exec('ALTER TABLE page_blocks ADD COLUMN color_override TEXT');
      console.error('  + Added color_override column');
    }
    
    // Migrate existing tag_override values
    // HEADER and SOURCE should become layout hints, not color hints
    
    // Count blocks to migrate
    const headerCount = db.query(`
      SELECT COUNT(*) as count FROM page_blocks WHERE tag_override = 'HEADER'
    `).get() as { count: number };
    
    const sourceCount = db.query(`
      SELECT COUNT(*) as count FROM page_blocks WHERE tag_override = 'SOURCE'
    `).get() as { count: number };
    
    if (headerCount.count > 0 || sourceCount.count > 0) {
      console.error(`  Migrating ${headerCount.count} HEADER blocks, ${sourceCount.count} SOURCE blocks`);
      
      // Update HEADER blocks
      db.query(`
        UPDATE page_blocks 
        SET is_header = 1, tag_override = NULL
        WHERE tag_override = 'HEADER'
      `).run();
      
      // Update SOURCE blocks
      db.query(`
        UPDATE page_blocks 
        SET is_source = 1, tag_override = NULL
        WHERE tag_override = 'SOURCE'
      `).run();
      
      console.error('  ✓ Migrated layout hint blocks');
    }
  },
};




