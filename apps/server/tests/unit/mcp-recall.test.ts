/**
 * MCP Recall Tool Unit Tests
 * 
 * 测试 prism_recall 工具的核心逻辑
 * 使用 mock 数据库，不依赖外部 API
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

// Test database path
const TEST_DB_PATH = path.join(process.cwd(), 'test-mcp-recall.db');

// Cleanup helper
function cleanup() {
  for (const ext of ['', '-wal', '-shm']) {
    const file = TEST_DB_PATH + ext;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

// Create test database with user_memories table
function createTestDB(): Database {
  const db = new Database(TEST_DB_PATH);
  
  // Create user_memories table (matching v50 schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT NOT NULL,
      text_content TEXT,
      source_type TEXT DEFAULT 'markdown',
      source_url TEXT,
      extraction_status TEXT DEFAULT 'pending',
      extraction_error TEXT,
      archived INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      ingested_at TEXT DEFAULT (datetime('now')),
      extracted_at TEXT,
      archived_at TEXT,
      entity_id TEXT
    );
    
    -- FTS5 index
    CREATE VIRTUAL TABLE IF NOT EXISTS user_memories_fts USING fts5(
      title, content, content='user_memories', content_rowid='id'
    );
    
    -- Triggers for FTS sync
    CREATE TRIGGER IF NOT EXISTS user_memories_ai AFTER INSERT ON user_memories BEGIN
      INSERT INTO user_memories_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
  `);
  
  return db;
}

// Insert test memory
function insertMemory(db: Database, data: {
  title: string;
  content: string;
  source_type?: string;
  source_url?: string;
}): number {
  const result = db.query(`
    INSERT INTO user_memories (title, content, source_type, source_url, ingested_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(data.title, data.content, data.source_type || 'markdown', data.source_url || '');
  
  return Number(result.lastInsertRowid);
}

describe('MCP Recall Tool', () => {
  let db: Database;
  
  beforeEach(() => {
    cleanup();
    db = createTestDB();
    
    // Insert test data
    insertMemory(db, {
      title: 'Magpie 项目文档',
      content: '# Magpie\n\nMagpie 是一个认知工具，帮助用户探索未知知识。核心理念是 Anti-Gravity。',
      source_type: 'markdown',
      source_url: '/docs/magpie.md'
    });
    
    insertMemory(db, {
      title: 'Prism Server 架构',
      content: '# Prism Server\n\nPrism 是 Magpie 的后端服务，负责知识图谱管理和实体抽取。',
      source_type: 'markdown',
      source_url: '/docs/prism.md'
    });
    
    insertMemory(db, {
      title: 'Zettelkasten 方法论',
      content: '# Zettelkasten\n\nZettelkasten 是德国社会学家 Niklas Luhmann 发明的卡片盒笔记法。',
      source_type: 'user_drop',
      source_url: 'file:///notes/zettelkasten.md'
    });
  });
  
  afterEach(() => {
    db.close();
    cleanup();
  });
  
  describe('FTS Search', () => {
    it('should find memories by keyword', () => {
      const results = db.query(`
        SELECT m.id, m.title, m.content, m.source_url as sourcePath
        FROM user_memories_fts fts
        JOIN user_memories m ON fts.rowid = m.id
        WHERE user_memories_fts MATCH ?
        LIMIT 10
      `).all('Magpie') as any[];
      
      // "Magpie" appears in both Magpie doc and Prism doc
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.title === 'Magpie 项目文档')).toBe(true);
    });
    
    it('should find memory by unique keyword', () => {
      const results = db.query(`
        SELECT m.id, m.title
        FROM user_memories_fts fts
        JOIN user_memories m ON fts.rowid = m.id
        WHERE user_memories_fts MATCH ?
        LIMIT 10
      `).all('Zettelkasten') as any[];
      
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Zettelkasten 方法论');
    });
    
    it('should return empty for non-existent keyword', () => {
      const results = db.query(`
        SELECT m.id, m.title
        FROM user_memories_fts fts
        JOIN user_memories m ON fts.rowid = m.id
        WHERE user_memories_fts MATCH ?
        LIMIT 10
      `).all('NonExistentKeyword12345') as any[];
      
      expect(results.length).toBe(0);
    });
    
    it('should support wildcard search', () => {
      const results = db.query(`
        SELECT m.id, m.title
        FROM user_memories_fts fts
        JOIN user_memories m ON fts.rowid = m.id
        WHERE user_memories_fts MATCH ?
        LIMIT 10
      `).all('Zett*') as any[];
      
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Zettelkasten 方法论');
    });
  });
  
  describe('LIKE Fallback Search', () => {
    it('should find memory with LIKE pattern', () => {
      const pattern = '%知识图谱%';
      const results = db.query(`
        SELECT id, title, content, source_url as sourcePath
        FROM user_memories
        WHERE content LIKE ? OR title LIKE ?
        ORDER BY ingested_at DESC
        LIMIT 10
      `).all(pattern, pattern) as any[];
      
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Prism Server 架构');
    });
  });
  
  describe('Source Type Filtering', () => {
    it('should count memories by source type', () => {
      const markdown = db.query(
        `SELECT COUNT(*) as count FROM user_memories WHERE source_type = 'markdown'`
      ).get() as { count: number };
      
      const userDrop = db.query(
        `SELECT COUNT(*) as count FROM user_memories WHERE source_type = 'user_drop'`
      ).get() as { count: number };
      
      expect(markdown.count).toBe(2);
      expect(userDrop.count).toBe(1);
    });
  });
  
  describe('Archive Filtering', () => {
    it('should exclude archived memories', () => {
      // Archive one memory
      db.query(`UPDATE user_memories SET archived = 1 WHERE title LIKE '%Zettelkasten%'`).run();
      
      const results = db.query(`
        SELECT COUNT(*) as count FROM user_memories WHERE archived = 0
      `).get() as { count: number };
      
      expect(results.count).toBe(2);
    });
  });
});

describe('Recall Response Format', () => {
  let db: Database;
  
  beforeEach(() => {
    cleanup();
    db = createTestDB();
    insertMemory(db, {
      title: 'Test Memory',
      content: 'This is a test memory for format validation.',
      source_type: 'markdown'
    });
  });
  
  afterEach(() => {
    db.close();
    cleanup();
  });
  
  it('should return correct fields', () => {
    const result = db.query(`
      SELECT 
        id,
        source_url as sourcePath,
        source_type as sourceType,
        title,
        content,
        ingested_at as createdAt
      FROM user_memories
      WHERE id = 1
    `).get() as any;
    
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('sourcePath');
    expect(result).toHaveProperty('sourceType');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('createdAt');
  });
});
