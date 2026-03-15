/**
 * Migration V12: Remove Mock Public Content
 * 
 * Removes the hardcoded 'test' data seeded in V10.
 * This clears the stage for real data from the Scout Engine.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v12_remove_mock_public_content: Migration = {
  version: 12,
  name: 'remove_mock_public_content',
  description: 'Remove hardcoded test data from public_content table',
  
  up: (db: Database) => {
    console.error('  Cleaning up test public content...');
    
    const result = db.query(`
      DELETE FROM public_content 
      WHERE source_type = 'test' OR id LIKE 'public:news-%' OR id LIKE 'public:article-%'
    `).run();
    
    console.error(`  ✓ Removed ${result.changes} mock items from public_content`);
  }
};

