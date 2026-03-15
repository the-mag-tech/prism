import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

/**
 * Generate a short, URL-safe public ID
 * Uses base62 encoding (a-z, A-Z, 0-9)
 * 
 * @deprecated Moved to cognitive-arena's db.ts
 */
function generatePublicId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * @deprecated This table has been moved to cognitive-arena.
 * Keep this migration for backwards compatibility with existing databases.
 */
export const v17_explore_public_id: Migration = {
  version: 17,
  name: 'explore_public_id',
  description: '[DEPRECATED] Add public_id to explore_logs - now managed by cognitive-arena',
  up: (db: Database) => {
    // Add public_id column (without UNIQUE constraint - SQLite limitation)
    db.query(`
      ALTER TABLE explore_logs ADD COLUMN public_id TEXT
    `).run();
    console.error('  ✓ Added public_id column to explore_logs');

    // Backfill existing rows with generated public_ids
    const existingRows = db.query(`
      SELECT id FROM explore_logs WHERE public_id IS NULL
    `).all() as { id: number }[];

    if (existingRows.length > 0) {
      console.error(`  ⏳ Backfilling ${existingRows.length} existing explorations...`);
      
      const updateStmt = db.query(`
        UPDATE explore_logs SET public_id = ? WHERE id = ?
      `);

      for (const row of existingRows) {
        // Generate unique public_id with retry logic
        let publicId = generatePublicId();
        let attempts = 0;
        while (attempts < 10) {
          try {
            updateStmt.run(publicId, row.id);
            break;
          } catch {
            // Collision, try again
            publicId = generatePublicId();
            attempts++;
          }
        }
      }
      console.error(`  ✓ Backfilled ${existingRows.length} explorations with public_ids`);
    }

    // Create unique index for fast lookups (after backfill to avoid constraint violations)
    db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_explore_logs_public_id ON explore_logs(public_id)
    `).run();
    console.error('  ✓ Created unique index for public_id');
  }
};

// Export the generator for use in app.ts
export { generatePublicId };

