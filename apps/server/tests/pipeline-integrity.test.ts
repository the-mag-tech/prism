/**
 * Pipeline Integrity Tests
 * 
 * @ref worker/checklist
 * @ref infra/memo-id
 * @ref infra/agent-logger
 * 
 * Tests for the fixes implemented in 2025-12-24:
 * 1. AgentLogger.log() method (previously missing)
 * 2. extraction_status tracking
 * 3. Unified memo_id field
 * 4. DB path logging
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { initDB, getDB, closeDB } from '../src/db.js';
import { GraphWriter } from '../src/lib/graph-link/index.js';
import { AgentLogger } from '../src/lib/agent-logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Helper to create unique temp DB path
function createTempDBPath(prefix: string): string {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `${prefix}_${uniqueId}.db`);
}

// =============================================================================
// AgentLogger Tests
// =============================================================================

describe('AgentLogger', () => {
  it('should have log() method that does not throw', () => {
    const logger = new AgentLogger('graph_link');
    
    // This was the bug: logger.log() threw "not a function"
    expect(() => {
      logger.log('test message');
      logger.log('message with data', { key: 'value' });
    }).not.toThrow();
  });

  it('should track operations with start/success pattern', () => {
    let dbPath: string;
    
    dbPath = createTempDBPath('test_logger');
    initDB(dbPath);
    
    try {
      const logger = new AgentLogger('scout');
      const handle = logger.start('test_action', { input: 'data' });
      
      // Should not throw
      expect(() => handle.success({ result: 'ok' })).not.toThrow();
      
      // Check agent_logs table
      const db = getDB();
      const logs = db.query(`
        SELECT * FROM agent_logs WHERE agent = 'scout' AND action = 'test_action'
      `).all();
      
      expect(logs.length).toBe(1);
      expect((logs[0] as any).status).toBe('ok');
    } finally {
      closeDB();
      try { fs.unlinkSync(dbPath); } catch {}
    }
  });

  it('should persist errors to agent_logs', () => {
    let dbPath: string;
    
    dbPath = createTempDBPath('test_logger_error');
    initDB(dbPath);
    
    try {
      const logger = new AgentLogger('graph_link');
      const handle = logger.start('failing_action', { input: 'data' });
      
      handle.error(new Error('Test error message'));
      
      const db = getDB();
      const logs = db.query(`
        SELECT * FROM agent_logs WHERE agent = 'graph_link' AND action = 'failing_action'
      `).all() as any[];
      
      expect(logs.length).toBe(1);
      expect(logs[0].status).toBe('error');
      expect(logs[0].error).toContain('Test error message');
    } finally {
      closeDB();
      try { fs.unlinkSync(dbPath); } catch {}
    }
  });
});

// =============================================================================
// Extraction Status Tests
// =============================================================================

describe('Extraction Status Tracking', () => {
  let dbPath: string;
  let writer: GraphWriter;

  beforeEach(() => {
    dbPath = createTempDBPath('test_extraction_status');
    initDB(dbPath);
    writer = new GraphWriter();
  });

  afterEach(() => {
    closeDB();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it('should have extraction_status column in entities table', () => {
    const db = getDB();
    const columns = db.query(`PRAGMA table_info(entities)`).all() as any[];
    const statusColumn = columns.find(c => c.name === 'extraction_status');
    
    expect(statusColumn).toBeTruthy();
    expect(statusColumn.dflt_value).toBe("'completed'");
  });

  it('should set extraction_status to pending for new findings', async () => {
    const memoryId = await writer.ingestFinding(
      'https://test.com/article',
      'Test Article',
      'Test content for extraction',
      []
    );

    const db = getDB();
    const finding = db.query(`
      SELECT id, extraction_status FROM entities WHERE id = ?
    `).get(`finding:${memoryId}`) as any;

    expect(finding).toBeTruthy();
    expect(finding.extraction_status).toBe('pending');
  });

  it('should be able to query pending extractions', async () => {
    // Create two findings
    await writer.ingestFinding('https://test.com/1', 'Article 1', 'Content 1', []);
    await writer.ingestFinding('https://test.com/2', 'Article 2', 'Content 2', []);

    const db = getDB();
    const pending = db.query(`
      SELECT id FROM entities WHERE extraction_status = 'pending'
    `).all();

    expect(pending.length).toBe(2);
  });
});

// =============================================================================
// Unified memo_id Field Tests
// =============================================================================

describe('Unified memo_id Field', () => {
  let dbPath: string;
  let writer: GraphWriter;

  beforeEach(() => {
    dbPath = createTempDBPath('test_memo_id');
    initDB(dbPath);
    writer = new GraphWriter();
  });

  afterEach(() => {
    closeDB();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it('should have memo_id column in entities table', () => {
    const db = getDB();
    const columns = db.query(`PRAGMA table_info(entities)`).all() as any[];
    const memoIdColumn = columns.find(c => c.name === 'memo_id');
    
    expect(memoIdColumn).toBeTruthy();
  });

  it('should set memo_id when creating finding', async () => {
    const memoryId = await writer.ingestFinding(
      'https://test.com/memo',
      'Memo Test',
      'Content',
      []
    );

    const db = getDB();
    const finding = db.query(`
      SELECT id, memo_id FROM entities WHERE id = ?
    `).get(`finding:${memoryId}`) as any;

    expect(finding.memo_id).toBe(memoryId);
  });

  it('should link finding to memory via memo_id', async () => {
    const memoryId = await writer.ingestFinding(
      'https://test.com/link',
      'Link Test',
      'Content for linking',
      []
    );

    const db = getDB();
    
    // Verify scout finding exists (post v50 schema: scout_findings table)
    const scoutFinding = db.query(`SELECT * FROM scout_findings WHERE id = ?`).get(memoryId);
    expect(scoutFinding).toBeTruthy();

    // Verify finding entity has correct memo_id
    const findingEntity = db.query(`
      SELECT * FROM entities WHERE memo_id = ?
    `).get(memoryId) as any;
    
    expect(findingEntity).toBeTruthy();
    expect(findingEntity.id).toBe(`finding:${memoryId}`);
  });
});

// =============================================================================
// DB Path Logging Tests
// =============================================================================

describe('Database Initialization', () => {
  it('should support DB_PATH environment variable', () => {
    const customPath = createTempDBPath('test_env_path');
    
    // Set env var
    const originalEnv = process.env.DB_PATH;
    process.env.DB_PATH = customPath;
    
    try {
      initDB(); // Should use DB_PATH
      const db = getDB();
      expect(db).toBeTruthy();
      
      // Verify it's the right DB by checking schema
      const tables = db.query(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='entities'
      `).all();
      expect(tables.length).toBe(1);
    } finally {
      closeDB();
      process.env.DB_PATH = originalEnv;
      try { fs.unlinkSync(customPath); } catch {}
    }
  });

  it('should use explicit path over DB_PATH env var', () => {
    const explicitPath = createTempDBPath('test_explicit');
    const envPath = createTempDBPath('test_env_ignored');
    
    process.env.DB_PATH = envPath;
    
    try {
      initDB(explicitPath); // Explicit path should take precedence
      
      // Verify explicit path was used (env path should not exist)
      expect(fs.existsSync(explicitPath)).toBe(true);
      expect(fs.existsSync(envPath)).toBe(false);
    } finally {
      closeDB();
      delete process.env.DB_PATH;
      try { fs.unlinkSync(explicitPath); } catch {}
      try { fs.unlinkSync(envPath); } catch {}
    }
  });
});





