/**
 * Migration V43: Restore emails_fts table
 * 
 * PROBLEM:
 * The v11 migration deleted emails_fts table but did not recreate it.
 * This broke the /search API endpoint and related tests.
 * 
 * SOLUTION:
 * Recreate emails_fts table with proper triggers, matching v1 schema.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 43,
  name: 'restore_emails_fts',
  description: 'Restore emails_fts table that was deleted in v11',
  
  up: (db: Database) => {
    console.error('  Recreating emails_fts table...');

    // Check if emails_fts already exists (idempotency)
    const exists = db.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='emails_fts'
    `).get();
    
    if (exists) {
      console.error('  ✓ emails_fts already exists, skipping');
      return;
    }

    // Create emails_fts table (matches v1 schema)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
        subject,
        body_text,
        content='emails',
        content_rowid='internal_id'
      );
    `);

    console.error('  ✓ emails_fts table created');

    // Create triggers (same as v1, but with unique names to avoid conflicts)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS emails_fts_insert AFTER INSERT ON emails BEGIN
        INSERT INTO emails_fts(rowid, subject, body_text) 
        VALUES (new.internal_id, new.subject, new.body_text);
      END;
      
      CREATE TRIGGER IF NOT EXISTS emails_fts_delete AFTER DELETE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, subject, body_text) 
        VALUES('delete', old.internal_id, old.subject, old.body_text);
      END;

      CREATE TRIGGER IF NOT EXISTS emails_fts_update AFTER UPDATE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, subject, body_text) 
        VALUES('delete', old.internal_id, old.subject, old.body_text);
        INSERT INTO emails_fts(rowid, subject, body_text) 
        VALUES (new.internal_id, new.subject, new.body_text);
      END;
    `);

    console.error('  ✓ emails_fts triggers created');

    // Rebuild FTS index from existing emails data
    try {
      db.exec(`INSERT INTO emails_fts(emails_fts) VALUES('rebuild')`);
      console.error('  ✓ emails_fts index rebuilt');
    } catch (e) {
      // If emails table is empty or has schema mismatch, rebuild will fail gracefully
      console.error('  ⚠️ Could not rebuild emails_fts index (table may be empty)');
    }
  }
};
