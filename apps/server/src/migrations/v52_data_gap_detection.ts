/**
 * Migration: Data Gap Detection System
 *
 * @ref data-gap/tables
 * @doc docs/DATA-GAP-DETECTION.md#5
 *
 * Creates tables for:
 * 1. data_gaps - Central table for tracking missing relationships
 * 2. extraction_logs - Quality logging for extraction process
 * 3. scout_logs - Quality logging for scout process
 * 4. ripple_logs - Quality logging for ripple process
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 52,
  name: 'data_gap_detection',
  description: 'Add data gap detection and quality logging tables',

  up: (db: Database) => {
    // ============================================
    // 1. Data Gaps (Central)
    // ============================================
    console.error('  Creating data_gaps table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS data_gaps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        
        -- Gap description
        missing_relation TEXT NOT NULL,
        expected_target_type TEXT,
        priority TEXT DEFAULT 'medium',
        
        -- Suggested remediation
        suggested_queries TEXT,
        reasoning TEXT,
        reasoning_zh TEXT,
        
        -- Status tracking
        status TEXT DEFAULT 'open',
        search_attempts INTEGER DEFAULT 0,
        last_search_at TEXT,
        filled_at TEXT,
        filled_by TEXT,
        
        -- Timestamps
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        
        UNIQUE(entity_id, missing_relation)
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_data_gaps_entity ON data_gaps(entity_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_data_gaps_priority ON data_gaps(priority, status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_data_gaps_status ON data_gaps(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_data_gaps_type ON data_gaps(entity_type);`);

    // ============================================
    // 2. Extraction Logs
    // ============================================
    console.error('  Creating extraction_logs table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS extraction_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        
        -- Output statistics
        entities_extracted INTEGER DEFAULT 0,
        relations_extracted INTEGER DEFAULT 0,
        new_type_candidates TEXT,
        
        -- Quality assessment
        confidence_avg REAL,
        ambiguous_items TEXT,
        
        -- LLM feedback
        data_gaps_detected TEXT,
        missing_context TEXT,
        suggested_queries TEXT,
        
        -- Metadata
        model TEXT,
        latency_ms INTEGER,
        pipeline_version TEXT,
        trigger TEXT,
        
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_extraction_logs_source ON extraction_logs(source_type, source_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_extraction_logs_created ON extraction_logs(created_at);`);

    // ============================================
    // 3. Scout Logs
    // ============================================
    console.error('  Creating scout_logs table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS scout_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id TEXT NOT NULL,
        trigger TEXT,
        
        -- Profile quality assessment
        profile_completeness REAL,
        sources_count INTEGER,
        sources_diversity REAL,
        
        -- Data gap tracking
        gaps_before INTEGER,
        gaps_filled INTEGER,
        gaps_remaining TEXT,
        suggested_queries TEXT,
        
        -- Discovery statistics
        findings_count INTEGER,
        avg_surprise REAL,
        
        -- Metadata
        search_provider TEXT,
        latency_ms INTEGER,
        
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_scout_logs_entity ON scout_logs(entity_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scout_logs_created ON scout_logs(created_at);`);

    // ============================================
    // 4. Ripple Logs
    // ============================================
    console.error('  Creating ripple_logs table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS ripple_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_entity_id TEXT NOT NULL,
        trigger_type TEXT,
        
        -- Propagation statistics
        candidates_evaluated INTEGER,
        candidates_ingested INTEGER,
        candidates_skipped INTEGER,
        
        -- Quality assessment
        avg_surprise REAL,
        diversity_score REAL,
        
        -- Data gap tracking
        gaps_detected INTEGER,
        gap_driven_searches INTEGER,
        
        -- Skip reason breakdown
        skip_reasons TEXT,
        
        latency_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_ripple_logs_trigger ON ripple_logs(trigger_entity_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ripple_logs_created ON ripple_logs(created_at);`);

    console.error('  ✓ Created data_gaps, extraction_logs, scout_logs, ripple_logs tables');
  },
};
