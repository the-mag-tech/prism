/**
 * Migration V31: Agent Logs
 * 
 * Creates a unified logging table for all agent operations.
 * Enables tracking, debugging, and analysis of agent behavior.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v31_agent_logs: Migration = {
  version: 31,
  name: 'agent_logs',
  description: 'Create agent_logs table for tracking agent operations',
  
  up: (db: Database) => {
    console.error('  Creating agent_logs table...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        -- Agent identification
        agent TEXT NOT NULL,           -- 'scout', 'gardener', 'deep_explorer', 'graph_link', 'mcp'
        action TEXT NOT NULL,          -- 'ingest', 'extract', 'explore', 'merge', 'dedupe', 'recall'
        
        -- Context
        entity_id TEXT,                -- Related entity (optional)
        session_id TEXT,               -- Group related operations
        
        -- Data
        input TEXT,                    -- Input data (JSON)
        output TEXT,                   -- Output/result data (JSON)
        
        -- Metrics
        duration_ms INTEGER,           -- Execution time in milliseconds
        tokens_used INTEGER,           -- LLM tokens consumed (if applicable)
        
        -- Status
        status TEXT DEFAULT 'ok',      -- 'ok', 'error', 'timeout', 'skipped'
        error TEXT,                    -- Error message if failed
        
        -- Timestamp
        created_at TEXT DEFAULT (datetime('now'))
      );
      
      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_action ON agent_logs(action);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_entity ON agent_logs(entity_id);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_session ON agent_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_status ON agent_logs(status);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC);
    `);

    console.error('  agent_logs table created');
  },
};
