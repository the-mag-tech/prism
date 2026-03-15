/**
 * Migration V42: Clean Scout Metadata Prefix from Bodies
 * 
 * Removes the Scout metadata prefix from entity bodies that wasn't caught by v36.
 * v36 only fixed cases with HTML, this handles plain text cases.
 * 
 * Pattern: "[Scout Entity: X]\n[Type: Y]\n[Source: Z]\n\n..."
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

/**
 * Remove Scout metadata header from text
 */
function stripScoutHeader(text: string): string {
  if (!text) return '';
  
  // Remove the Scout metadata header (multiline)
  // Pattern: [Scout Entity: ...]\n[Type: ...]\n[Source: ...]\n\n
  return text.replace(
    /^\s*\[Scout Entity:[^\]]*\]\s*\n?\[Type:[^\]]*\]\s*\n?\[Source:[^\]]*\]\s*\n*/,
    ''
  ).trim();
}

export const migration: Migration = {
  version: 42,
  name: 'clean_scout_metadata_prefix',
  description: 'Remove Scout metadata prefix from entity bodies',
  
  up: (db: Database) => {
    console.error('  Scanning for entities with Scout metadata prefix...');
    
    // Find entities with Scout metadata prefix in body
    const entities = db.query(`
      SELECT id, body
      FROM entities
      WHERE body LIKE '%[Scout Entity:%'
        AND body LIKE '%[Type:%'
        AND body LIKE '%[Source:%'
    `).all() as Array<{ id: string; body: string }>;
    
    console.error(`  Found ${entities.length} entities with Scout metadata prefix`);
    
    if (entities.length === 0) {
      return;
    }
    
    let updated = 0;
    const updateStmt = db.query(`
      UPDATE entities SET body = ?, updated_at = datetime('now') WHERE id = ?
    `);
    
    for (const entity of entities) {
      const cleanedBody = stripScoutHeader(entity.body);
      
      // Only update if actually changed
      if (cleanedBody !== entity.body) {
        updateStmt.run(cleanedBody, entity.id);
        updated++;
      }
    }
    
    console.error(`  Migration complete: ${updated} entities cleaned`);
  },
};
