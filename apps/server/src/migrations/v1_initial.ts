/**
 * Migration V1: Initial Schema
 * 
 * Creates all base tables for the Prism system.
 * Extracted from the original db.ts inline schema definitions.
 * 
 * MIGRATION NOTE: For databases created before the migration system,
 * tables may already exist with different structures. This migration
 * uses IF NOT EXISTS and handles legacy tables gracefully.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

/**
 * Check if a table exists in the database
 */
function tableExists(db: Database, tableName: string): boolean {
  const result = db.query(`
    SELECT name FROM sqlite_master WHERE type='table' AND name=?
  `).get(tableName);
  // bun:sqlite returns null (not undefined) when no row found
  return result !== null && result !== undefined;
}

/**
 * Check if a column exists in a table
 */
function columnExists(db: Database, tableName: string, columnName: string): boolean {
  // First check if the table exists
  if (!tableExists(db, tableName)) {
    return false;
  }
  try {
    const columns = db.query(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return columns.some(c => c.name === columnName);
  } catch (e) {
    return false;
  }
}

export const v1_initial: Migration = {
  version: 1,
  name: 'initial_schema',
  description: 'Create base tables: emails, memories, entities, page_blocks, relations, etc.',
  
  up: (db: Database) => {
    // Check if this is an existing database (created before migration system)
    const existingTables = tableExists(db, 'entities') || tableExists(db, 'memories');
    if (existingTables) {
      console.error('  Detected existing database, preserving data...');
    }
    // =========================================================================
    // EMAILS (legacy)
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS emails (
        internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE,
        subject TEXT,
        from_addr TEXT,
        to_addr TEXT,
        body_text TEXT,
        sent_at TEXT,
        raw_structure TEXT
      );
    `);

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
        subject,
        body_text,
        content='emails',
        content_rowid='internal_id'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
        INSERT INTO emails_fts(rowid, subject, body_text) VALUES (new.internal_id, new.subject, new.body_text);
      END;
      
      CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, subject, body_text) VALUES('delete', old.internal_id, old.subject, old.body_text);
      END;

      CREATE TRIGGER IF NOT EXISTS emails_au AFTER UPDATE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, subject, body_text) VALUES('delete', old.internal_id, old.subject, old.body_text);
        INSERT INTO emails_fts(rowid, subject, body_text) VALUES (new.internal_id, new.subject, new.body_text);
      END;
    `);

    // =========================================================================
    // MEMORIES (Recall feature)
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_path TEXT UNIQUE,
        source_type TEXT NOT NULL,
        content TEXT NOT NULL,
        title TEXT,
        created_at TEXT,
        ingested_at TEXT DEFAULT (datetime('now'))
      );
    `);

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        title, content,
        content='memories', content_rowid='id'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;
      
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
        INSERT INTO memories_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;
    `);

    // =========================================================================
    // MEMORY INTERACTIONS (User behavior tracking)
    // =========================================================================
    // Handle both new and legacy table structures
    if (!tableExists(db, 'memory_interactions')) {
      db.exec(`
        CREATE TABLE memory_interactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER NOT NULL,
          query_text TEXT,
          interaction_type TEXT NOT NULL,
          dwell_time_ms INTEGER,
          feedback_score INTEGER,
          context TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (memory_id) REFERENCES memories(id)
        );
      `);
    } else {
      // Legacy table exists - add missing columns
      if (!columnExists(db, 'memory_interactions', 'query_text')) {
        db.exec(`ALTER TABLE memory_interactions ADD COLUMN query_text TEXT;`);
      }
      if (!columnExists(db, 'memory_interactions', 'interaction_type')) {
        db.exec(`ALTER TABLE memory_interactions ADD COLUMN interaction_type TEXT;`);
      }
      if (!columnExists(db, 'memory_interactions', 'dwell_time_ms')) {
        db.exec(`ALTER TABLE memory_interactions ADD COLUMN dwell_time_ms INTEGER;`);
      }
      if (!columnExists(db, 'memory_interactions', 'feedback_score')) {
        db.exec(`ALTER TABLE memory_interactions ADD COLUMN feedback_score INTEGER;`);
      }
      if (!columnExists(db, 'memory_interactions', 'context')) {
        db.exec(`ALTER TABLE memory_interactions ADD COLUMN context TEXT;`);
      }
    }
    
    // Create indexes (safe to run even if they exist)
    if (columnExists(db, 'memory_interactions', 'memory_id')) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_interactions_memory ON memory_interactions(memory_id);`);
    }
    if (columnExists(db, 'memory_interactions', 'interaction_type')) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_interactions_type ON memory_interactions(interaction_type);`);
    }
    if (columnExists(db, 'memory_interactions', 'created_at')) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_interactions_date ON memory_interactions(created_at);`);
    }

    // =========================================================================
    // FEEDBACK LEARNING (Phase 3)
    // =========================================================================
    
    // Memory weights - based on historical feedback
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_weights (
        memory_id INTEGER PRIMARY KEY,
        base_weight REAL DEFAULT 1.0,
        interaction_score REAL DEFAULT 0.0,
        recency_factor REAL DEFAULT 1.0,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Learned associations - from user behavior
    db.exec(`
      CREATE TABLE IF NOT EXISTS learned_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        concept_a TEXT NOT NULL,
        concept_b TEXT NOT NULL,
        strength REAL DEFAULT 0.0,
        co_occurrence_count INTEGER DEFAULT 0,
        click_through_count INTEGER DEFAULT 0,
        last_seen TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(concept_a, concept_b)
      );
      CREATE INDEX IF NOT EXISTS idx_associations_concept_a ON learned_associations(concept_a);
      CREATE INDEX IF NOT EXISTS idx_associations_concept_b ON learned_associations(concept_b);
    `);

    // =========================================================================
    // ENTITY DEDUPLICATION (Phase 4)
    // =========================================================================

    // Entity aliases - merged relationships
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_id TEXT NOT NULL,
        alias_id TEXT NOT NULL,
        alias_type TEXT DEFAULT 'manual',
        confidence REAL DEFAULT 1.0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(alias_id)
      );
      CREATE INDEX IF NOT EXISTS idx_aliases_canonical ON entity_aliases(canonical_id);
    `);

    // Entity similarities cache - embedding calculation results
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity_similarities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_a TEXT NOT NULL,
        entity_b TEXT NOT NULL,
        similarity REAL NOT NULL,
        computed_at TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'pending',
        UNIQUE(entity_a, entity_b)
      );
      CREATE INDEX IF NOT EXISTS idx_similarities_status ON entity_similarities(status);
    `);

    // =========================================================================
    // ENTITIES
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT,
        body TEXT,
        tag TEXT,
        action TEXT,
        source_memory_id INTEGER,
        extraction_batch_id TEXT,
        is_auto_extracted INTEGER DEFAULT 0,
        default_priority REAL DEFAULT 0.5,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // =========================================================================
    // PAGE BLOCKS
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS page_blocks (
        page_id TEXT NOT NULL,
        block_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        target TEXT,
        tag_override TEXT,
        cols INTEGER DEFAULT 1,
        rows INTEGER DEFAULT 1,
        PRIMARY KEY (page_id, block_id)
      );
      CREATE INDEX IF NOT EXISTS idx_page_blocks_page ON page_blocks(page_id);
    `);

    // =========================================================================
    // RELATIONS
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        evidence TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(source, target, type)
      );
      CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target);
    `);

    // =========================================================================
    // EXTRACTION BATCHES
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS extraction_batches (
        id TEXT PRIMARY KEY,
        strategy_version TEXT NOT NULL,
        prompt_hash TEXT,
        source_type TEXT,
        description TEXT,
        entity_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // =========================================================================
    // NAVIGATION TRACKING
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS navigation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_page TEXT,
        to_page TEXT NOT NULL,
        method TEXT DEFAULT 'click',
        timestamp TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_nav_from ON navigation_history(from_page);
      CREATE INDEX IF NOT EXISTS idx_nav_to ON navigation_history(to_page);
      CREATE INDEX IF NOT EXISTS idx_nav_time ON navigation_history(timestamp);
    `);

    // =========================================================================
    // SETTINGS
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // =========================================================================
    // ENTITY VISITS (for recommendation)
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity_visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id TEXT NOT NULL,
        visit_count INTEGER DEFAULT 1,
        last_visited TEXT DEFAULT (datetime('now')),
        total_dwell_ms INTEGER DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_visits_id ON entity_visits(entity_id);
    `);
  },
};

