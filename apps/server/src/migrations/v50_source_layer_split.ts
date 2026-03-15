/**
 * Migration v50: Source Layer Split
 * 
 * Splits the monolithic `memories` table into specialized source tables:
 * - user_memories: User-ingested content (markdown, email, pdf, mcp)
 * - scout_findings: Scout-fetched external snapshots
 * - candidate_types: Type graduation candidates (for future AI type discovery)
 * 
 * Design Philosophy (Four Tribes):
 * - Source layer is the "soil" where all knowledge grows
 * - User memories and Scout findings have different lifecycles
 * - Separation enables independent versioning, archiving, and health checks
 * 
 * @since 2026-01-08
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 50,
  name: 'source_layer_split',
  description: 'Split memories into user_memories and scout_findings tables',

  up: (db: Database) => {
    // ==========================================================================
    // USER_MEMORIES - User-ingested raw content
    // ==========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        -- Content
        title TEXT,
        content TEXT NOT NULL,              -- Markdown raw
        text_content TEXT,                  -- Plain text (for FTS)
        
        -- Source metadata
        source_type TEXT DEFAULT 'markdown', -- 'markdown' | 'email' | 'pdf' | 'mcp' | 'user_drop'
        source_url TEXT,                    -- Original URL or file path
        
        -- Pipeline status
        extraction_status TEXT DEFAULT 'pending', -- 'pending' | 'completed' | 'failed' | 'skipped'
        extraction_error TEXT,              -- Error message if failed
        
        -- Lifecycle
        archived INTEGER DEFAULT 0,         -- Soft delete
        version INTEGER DEFAULT 1,          -- For future versioning
        
        -- Timestamps
        ingested_at TEXT DEFAULT (datetime('now')),
        extracted_at TEXT,
        archived_at TEXT,
        
        -- Link to entity (memory:x maps to this)
        entity_id TEXT,                     -- e.g., 'memory:123'
        
        UNIQUE(source_url)                  -- Prevent duplicate imports
      );

      CREATE INDEX IF NOT EXISTS idx_user_memories_status ON user_memories(extraction_status);
      CREATE INDEX IF NOT EXISTS idx_user_memories_archived ON user_memories(archived);
      CREATE INDEX IF NOT EXISTS idx_user_memories_source_type ON user_memories(source_type);
      CREATE INDEX IF NOT EXISTS idx_user_memories_entity ON user_memories(entity_id);
    `);

    console.error('  ✓ Created user_memories table');

    // ==========================================================================
    // SCOUT_FINDINGS - Scout-fetched external snapshots
    // ==========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS scout_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        -- Content
        title TEXT,
        content TEXT,                       -- Snapshot content (markdown)
        text_content TEXT,                  -- Plain text (for FTS)
        
        -- Source metadata
        url TEXT NOT NULL,                  -- Source URL
        triggered_by TEXT,                  -- Entity ID that triggered this scout (e.g., 'person:simon')
        
        -- Pipeline status
        extraction_status TEXT DEFAULT 'pending', -- 'pending' | 'completed' | 'failed' | 'skipped'
        extraction_error TEXT,
        
        -- Health status (for link rot detection)
        health_status TEXT DEFAULT 'healthy', -- 'healthy' | 'stale' | 'dead' | 'unknown'
        last_health_check TEXT,
        http_status INTEGER,                -- Last HTTP status code
        
        -- Lifecycle
        archived INTEGER DEFAULT 0,
        version INTEGER DEFAULT 1,
        
        -- Timestamps
        fetched_at TEXT DEFAULT (datetime('now')),
        extracted_at TEXT,
        archived_at TEXT,
        
        -- Link to entity (finding:x maps to this)
        entity_id TEXT,                     -- e.g., 'finding:123'
        
        UNIQUE(url)                         -- Prevent duplicate snapshots
      );

      CREATE INDEX IF NOT EXISTS idx_scout_findings_status ON scout_findings(extraction_status);
      CREATE INDEX IF NOT EXISTS idx_scout_findings_archived ON scout_findings(archived);
      CREATE INDEX IF NOT EXISTS idx_scout_findings_triggered_by ON scout_findings(triggered_by);
      CREATE INDEX IF NOT EXISTS idx_scout_findings_health ON scout_findings(health_status);
      CREATE INDEX IF NOT EXISTS idx_scout_findings_entity ON scout_findings(entity_id);
      CREATE INDEX IF NOT EXISTS idx_scout_findings_url ON scout_findings(url);
    `);

    console.error('  ✓ Created scout_findings table');

    // ==========================================================================
    // CANDIDATE_TYPES - For Type Graduation (Phase 6)
    // ==========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS candidate_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        -- Type info
        type_name TEXT UNIQUE NOT NULL,     -- e.g., 'technique', 'workflow'
        suggested_tribe TEXT,               -- 'archivist' | 'salesman' | 'gardener' | 'logger'
        description TEXT,                   -- AI-generated description
        
        -- Statistics for graduation decision
        occurrences INTEGER DEFAULT 1,      -- Total times seen
        distinct_sources INTEGER DEFAULT 1, -- Unique memories/findings mentioning this
        distinct_entities INTEGER DEFAULT 0, -- Entities of this type created
        
        -- Lifecycle
        status TEXT DEFAULT 'candidate',    -- 'candidate' | 'graduated' | 'rejected' | 'merged'
        merged_into TEXT,                   -- If merged, target type name
        
        -- Timestamps
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        graduated_at TEXT,
        
        -- User decision
        user_approved INTEGER,              -- 1 = approved, 0 = rejected, NULL = pending
        user_notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_candidate_types_status ON candidate_types(status);
      CREATE INDEX IF NOT EXISTS idx_candidate_types_occurrences ON candidate_types(occurrences DESC);
    `);

    console.error('  ✓ Created candidate_types table');
  },
};
