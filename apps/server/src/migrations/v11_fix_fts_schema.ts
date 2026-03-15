/**
 * Migration V11: Fix FTS Schema & Triggers (Systematic Fix)
 * 
 * PROBLEM: 
 * Previous migrations (v1 and v9) had mismatched definitions for FTS tables.
 * v1 defined memories_fts(title, content) but v9 triggers tried to insert (id, source_type, ...).
 * 
 * SOLUTION:
 * This migration systematically rebuilds the FTS infrastructure:
 * 1. Drops broken triggers and FTS tables
 * 2. Recreates FTS tables with ALL useful columns (including id, source_type for filtering)
 * 3. Recreates correct triggers matching the new schema
 * 4. Re-populates the FTS index from source tables
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v11_fix_fts_schema: Migration = {
  version: 11,
  name: 'fix_fts_schema_systematic',
  description: 'Rebuild FTS tables and triggers to ensure schema consistency',
  
  up: (db: Database) => {
    console.error('  [v11] Starting systematic FTS repair...');

    // =========================================================================
    // 1. CLEANUP (Drop everything related to FTS to start fresh)
    // =========================================================================
    const objectsToDrop = [
      // Triggers
      'memories_fts_insert', 'memories_fts_delete', 'memories_fts_update',
      'entities_fts_insert', 'entities_fts_delete', 'entities_fts_update',
      'emails_fts_insert', 'emails_fts_delete', 'emails_fts_update', // Legacy names
      'emails_ai', 'emails_ad', 'emails_au', // v1 names
      'memories_ai', 'memories_ad', 'memories_au', // v1 names
      
      // Tables
      'memories_fts', 'entities_fts', 'emails_fts'
    ];

    objectsToDrop.forEach(obj => {
      try {
        // Try dropping as table first, then trigger
        db.exec(`DROP TABLE IF EXISTS ${obj}`);
        db.exec(`DROP TRIGGER IF EXISTS ${obj}`);
      } catch (e) { /* ignore */ }
    });

    console.error('  [v11] Cleaned up old FTS objects');

    // =========================================================================
    // 2. REBUILD MEMORIES FTS (With correct columns)
    // =========================================================================
    // We want to index: title, content, and source_type (for filtering)
    // We also map it to the external content table 'memories'
    db.exec(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        title, 
        content, 
        source_type UNINDEXED, -- Store for retrieval but don't tokenize for full-text match logic
        content='memories', 
        content_rowid='id'
      );
    `);

    // Triggers for Memories
    db.exec(`
      CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, content, source_type) 
        VALUES (NEW.id, NEW.title, NEW.content, NEW.source_type);
      END;

      CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content, source_type) 
        VALUES ('delete', OLD.id, OLD.title, OLD.content, OLD.source_type);
      END;

      CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content, source_type) 
        VALUES ('delete', OLD.id, OLD.title, OLD.content, OLD.source_type);
        INSERT INTO memories_fts(rowid, title, content, source_type) 
        VALUES (NEW.id, NEW.title, NEW.content, NEW.source_type);
      END;
    `);

    console.error('  [v11] Rebuilt memories_fts with (title, content, source_type)');

    // =========================================================================
    // 3. REBUILD ENTITIES FTS
    // =========================================================================
    db.exec(`
      CREATE VIRTUAL TABLE entities_fts USING fts5(
        title, 
        subtitle, 
        body,
        content='entities', 
        content_rowid='rowid' -- Entities uses text ID, so we use internal rowid for FTS mapping
      );
    `);

    // Triggers for Entities
    db.exec(`
      CREATE TRIGGER entities_fts_insert AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, title, subtitle, body) 
        VALUES (NEW.rowid, NEW.title, NEW.subtitle, NEW.body);
      END;

      CREATE TRIGGER entities_fts_delete AFTER DELETE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, title, subtitle, body) 
        VALUES ('delete', OLD.rowid, OLD.title, OLD.subtitle, OLD.body);
      END;

      CREATE TRIGGER entities_fts_update AFTER UPDATE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, title, subtitle, body) 
        VALUES ('delete', OLD.rowid, OLD.title, OLD.subtitle, OLD.body);
        INSERT INTO entities_fts(rowid, title, subtitle, body) 
        VALUES (NEW.rowid, NEW.title, NEW.subtitle, NEW.body);
      END;
    `);

    console.error('  [v11] Rebuilt entities_fts');

    // =========================================================================
    // 4. REPOPULATE DATA
    // =========================================================================
    console.error('  [v11] Repopulating FTS indexes...');
    
    db.exec(`INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`);
    
    // For entities, 'rebuild' command works if table structure matches exactly.
    // If not, we might need manual population, but 'rebuild' is usually sufficient 
    // for content= tables.
    db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);
    
    console.error('  [v11] ✓ System repaired.');
  }
};

