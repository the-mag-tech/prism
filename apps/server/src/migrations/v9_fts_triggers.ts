/**
 * Migration V9: FTS Sync Triggers
 * 
 * Adds triggers to keep FTS5 indexes synchronized with source tables.
 * 
 * For external content FTS5 tables (content='entities'), SQLite doesn't
 * automatically sync data. We need triggers on INSERT/UPDATE/DELETE.
 * 
 * This ensures real-time search works without manual rebuild.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v9_fts_triggers: Migration = {
  version: 9,
  name: 'fts_triggers',
  description: 'Add triggers to sync FTS5 indexes automatically',
  
  up: (db: Database) => {
    console.error('  Creating FTS sync triggers for entities...');
    
    // Entities FTS triggers
    // Note: entities_fts was defined in v2_ssot.ts with (id, title, subtitle, body)
    // We assume v2 schema here.
    db.exec(`
      DROP TRIGGER IF EXISTS entities_fts_insert;
      DROP TRIGGER IF EXISTS entities_fts_delete;
      DROP TRIGGER IF EXISTS entities_fts_update;

      -- After INSERT: add to FTS
      CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, id, title, subtitle, body) 
        VALUES (NEW.rowid, NEW.id, NEW.title, NEW.subtitle, NEW.body);
      END;
      
      -- After DELETE: remove from FTS
      CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, id, title, subtitle, body) 
        VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.subtitle, OLD.body);
      END;
      
      -- After UPDATE: remove old, add new
      CREATE TRIGGER IF NOT EXISTS entities_fts_update AFTER UPDATE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, id, title, subtitle, body) 
        VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.subtitle, OLD.body);
        INSERT INTO entities_fts(rowid, id, title, subtitle, body) 
        VALUES (NEW.rowid, NEW.id, NEW.title, NEW.subtitle, NEW.body);
      END;
    `);
    
    console.error('  ✓ entities FTS triggers created');
    
    console.error('  Creating FTS sync triggers for memories...');
    
    // Memories FTS triggers
    // Note: memories_fts was defined in v1_initial.ts with (title, content)
    // FIX: Removed 'id' and 'source_type' from INSERT statements as they don't exist in FTS table
    db.exec(`
      DROP TRIGGER IF EXISTS memories_fts_insert;
      DROP TRIGGER IF EXISTS memories_fts_delete;
      DROP TRIGGER IF EXISTS memories_fts_update;

      -- After INSERT: add to FTS
      CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, content) 
        VALUES (NEW.rowid, NEW.title, NEW.content);
      END;
      
      -- After DELETE: remove from FTS
      CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content) 
        VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
      END;
      
      -- After UPDATE: remove old, add new
      CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content) 
        VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
        INSERT INTO memories_fts(rowid, title, content) 
        VALUES (NEW.rowid, NEW.title, NEW.content);
      END;
    `);
    
    console.error('  ✓ memories FTS triggers created');
    
    // Rebuild indexes to ensure current data is indexed
    console.error('  Rebuilding FTS indexes...');
    try {
      db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);
      db.exec(`INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`);
      console.error('  ✓ FTS indexes rebuilt');
    } catch (e) {
      console.warn('  ⚠️ Could not rebuild FTS indexes (tables might be empty or missing columns)');
    }
  },
};
