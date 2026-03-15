/**
 * Migration v44: Search Quality Logs
 * 
 * Creates tables for tracking search operations and negative samples
 * to enable empirical quality analysis and optimization.
 * 
 * Tables:
 * - search_logs: Records every search call with context and metrics
 * - negative_samples: Tracks skipped/filtered results for learning
 * 
 * @since 2026-01-08
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 44,
  name: 'search_quality_logs',
  description: 'Add search_logs and negative_samples tables for quality tracking',

  up: (db: Database) => {
    // =============================================================================
    // SEARCH_LOGS - Every search call with quality metrics
    // =============================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        -- Basic info
        query TEXT NOT NULL,
        provider TEXT,                    -- 'tavily' | 'qveris' | 'none'
        trigger TEXT,                     -- 'ripple' | 'scout' | 'mcp' | 'explore'
        
        -- Results statistics
        results_count INTEGER DEFAULT 0,
        latency_ms INTEGER,
        
        -- Agentic evaluation (optional, filled by post-processing)
        quality_score REAL,               -- 0-1, AI-assessed result quality
        diversity_score REAL,             -- 0-1, result diversity
        relevance_score REAL,             -- 0-1, relevance to query
        
        -- Filtering statistics
        ingested_count INTEGER DEFAULT 0, -- Actually ingested
        skipped_count INTEGER DEFAULT 0,  -- Filtered out (negative samples)
        avg_surprise_score REAL,          -- Average surprise score of results
        
        -- Context
        entity_id TEXT,                   -- Entity that triggered the search
        session_id TEXT,                  -- Associated job/session ID
        
        -- Metadata
        feedback TEXT,                    -- Optional text feedback
        metadata TEXT,                    -- JSON extension field
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_search_logs_trigger ON search_logs(trigger);
      CREATE INDEX IF NOT EXISTS idx_search_logs_provider ON search_logs(provider);
      CREATE INDEX IF NOT EXISTS idx_search_logs_entity ON search_logs(entity_id);
      CREATE INDEX IF NOT EXISTS idx_search_logs_created ON search_logs(created_at);
    `);

    console.error('  ✓ Created search_logs table');

    // =============================================================================
    // NEGATIVE_SAMPLES - Skipped/filtered results for learning
    // =============================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS negative_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        -- Content identification
        url TEXT NOT NULL,
        domain TEXT,                      -- Extracted domain for blocklist analysis
        title TEXT,
        content_preview TEXT,             -- First 500 chars for context
        
        -- Skip reason
        skip_reason TEXT NOT NULL,        -- 'low_surprise' | 'duplicate' | 'user_reject' | 'domain_blocklist' | 'error'
        surprise_score REAL,              -- Score at time of skip (if applicable)
        
        -- Context
        query TEXT,                       -- Search query that found this
        entity_id TEXT,                   -- Related entity
        search_log_id INTEGER REFERENCES search_logs(id),
        
        -- Statistics (for repeated occurrences)
        occurrence_count INTEGER DEFAULT 1,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        
        -- Learning signals
        validated INTEGER DEFAULT 0,      -- 1 if user confirmed skip was correct
        notes TEXT,                       -- Optional notes
        
        UNIQUE(url)                       -- Dedupe by URL
      );

      CREATE INDEX IF NOT EXISTS idx_negative_samples_domain ON negative_samples(domain);
      CREATE INDEX IF NOT EXISTS idx_negative_samples_reason ON negative_samples(skip_reason);
      CREATE INDEX IF NOT EXISTS idx_negative_samples_score ON negative_samples(surprise_score);
    `);

    console.error('  ✓ Created negative_samples table');
  },
};
