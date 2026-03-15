/**
 * Migration V18: Gardener V1 Schema
 * 
 * Introduces conservative merge candidate tracking for the Gardener system.
 * 
 * V1 Strategy: "Record everything, decide nothing"
 * - merge_candidates: Track potential duplicates with source context
 * - merge_history: Full audit trail for all merge operations
 * 
 * Key insight: Same name ≠ Same entity. Source domain matters.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v18_gardener_v1: Migration = {
  version: 18,
  name: 'gardener_v1',
  description: 'Add merge_candidates and merge_history tables for conservative deduplication',
  
  up: (db: Database) => {
    // 1. merge_candidates: Track potential duplicates
    // V1: Only records, never auto-merges
    db.exec(`
      CREATE TABLE IF NOT EXISTS merge_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_a TEXT NOT NULL,
        entity_b TEXT NOT NULL,
        similarity REAL NOT NULL,
        
        -- Source context for smarter V2 strategies
        source_domain_a TEXT,  -- 'email', 'web', 'manual', 'scout'
        source_domain_b TEXT,
        
        -- Status tracking
        status TEXT DEFAULT 'pending',  -- pending | merged | rejected | deferred
        
        -- Decision record
        decided_by TEXT,        -- 'user' | 'auto_v2' | null
        decided_at TEXT,
        decision_reason TEXT,
        
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        
        UNIQUE(entity_a, entity_b)
      );
    `);
    
    // Indexes for efficient querying
    db.exec(`CREATE INDEX IF NOT EXISTS idx_merge_candidates_status ON merge_candidates(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_merge_candidates_similarity ON merge_candidates(similarity DESC);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_merge_candidates_entity_a ON merge_candidates(entity_a);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_merge_candidates_entity_b ON merge_candidates(entity_b);`);
    
    console.error('  ✓ Created merge_candidates table');

    // 2. merge_history: Full audit trail for reversibility
    db.exec(`
      CREATE TABLE IF NOT EXISTS merge_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_id TEXT NOT NULL,      -- The entity that remains
        source_id TEXT NOT NULL,      -- The entity that was merged into target
        
        -- Decision metadata
        decided_by TEXT NOT NULL,     -- 'user' | 'auto'
        decision_reason TEXT,
        
        -- Snapshot for undo capability
        source_snapshot TEXT,         -- JSON of original entity data
        affected_relations TEXT,      -- JSON array of affected relation IDs
        affected_page_blocks TEXT,    -- JSON array of affected page_block keys
        
        merged_at TEXT DEFAULT (datetime('now')),
        
        -- Undo tracking
        undone_at TEXT,               -- NULL if not undone
        undone_by TEXT
      );
    `);
    
    db.exec(`CREATE INDEX IF NOT EXISTS idx_merge_history_target ON merge_history(target_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_merge_history_source ON merge_history(source_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_merge_history_merged_at ON merge_history(merged_at DESC);`);
    
    console.error('  ✓ Created merge_history table');

    // 3. Add source_domain column to entities table if not exists
    // This helps track where each entity originated from
    const tableInfo = db.query("PRAGMA table_info(entities)").all() as { name: string }[];
    const existingColumns = new Set(tableInfo.map(c => c.name));
    
    if (!existingColumns.has('source_domain')) {
      db.exec(`ALTER TABLE entities ADD COLUMN source_domain TEXT;`);
      console.error('  ✓ Added source_domain column to entities table');
      
      // Backfill existing entities based on source_memory_id
      db.exec(`
        UPDATE entities 
        SET source_domain = 'memory'
        WHERE source_memory_id IS NOT NULL AND source_domain IS NULL;
      `);
      
      // Entities without source_memory_id are likely manual or imported
      db.exec(`
        UPDATE entities 
        SET source_domain = 'manual'
        WHERE source_memory_id IS NULL AND source_domain IS NULL;
      `);
      
      console.error('  ✓ Backfilled source_domain for existing entities');
    }

    // 4. Migrate existing entity_similarities data to merge_candidates
    // Preserve any pending decisions
    const existingSimilarities = db.query(`
      SELECT entity_a, entity_b, similarity, status 
      FROM entity_similarities 
      WHERE status = 'pending'
    `).all() as { entity_a: string; entity_b: string; similarity: number; status: string }[];
    
    if (existingSimilarities.length > 0) {
      console.error(`  Migrating ${existingSimilarities.length} pending similarities to merge_candidates...`);
      
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO merge_candidates 
        (entity_a, entity_b, similarity, status, created_at)
        VALUES (?, ?, ?, 'pending', datetime('now'))
      `);
      
      for (const row of existingSimilarities) {
        insertStmt.run(row.entity_a, row.entity_b, row.similarity);
      }
      
      console.error('  ✓ Migrated existing similarities');
    }

    console.error('  ✓ Gardener V1 schema complete');
  },
};

