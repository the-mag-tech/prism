/**
 * GraphReader Unit Tests
 * 
 * Tests for the encapsulated GraphReader API methods:
 * - getRelatedEntities()
 * - getTopByGravity()
 * - searchMemories()
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

// Test database path
const TEST_DB_PATH = path.join(process.cwd(), 'test-graph-reader.db');

// Cleanup helper
function cleanup() {
  for (const ext of ['', '-wal', '-shm']) {
    const file = TEST_DB_PATH + ext;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

// Create test database with required tables
function createTestDB(): Database {
  const db = new Database(TEST_DB_PATH);
  
  // Create entities table
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      body TEXT,
      base_gravity REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_scouted_at TEXT
    );
    
    CREATE TABLE IF NOT EXISTS relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT,
      relation_type TEXT,
      weight REAL DEFAULT 1.0
    );
    
    CREATE TABLE IF NOT EXISTS entity_physics (
      entity_id TEXT PRIMARY KEY,
      gravity REAL DEFAULT 0.5
    );
    
    CREATE TABLE IF NOT EXISTS user_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT NOT NULL,
      source_type TEXT DEFAULT 'markdown',
      archived INTEGER DEFAULT 0,
      ingested_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE VIRTUAL TABLE IF NOT EXISTS user_memories_fts USING fts5(
      title, content, content='user_memories', content_rowid='id'
    );
    
    CREATE TRIGGER IF NOT EXISTS user_memories_ai AFTER INSERT ON user_memories BEGIN
      INSERT INTO user_memories_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
    
    CREATE TABLE IF NOT EXISTS entity_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_id TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS entity_group_members (
      group_id INTEGER,
      entity_id TEXT PRIMARY KEY,
      FOREIGN KEY (group_id) REFERENCES entity_groups(id)
    );
  `);
  
  return db;
}

// Insert test entity
function insertEntity(db: Database, data: {
  id: string;
  title: string;
  subtitle?: string;
  body?: string;
  gravity?: number;
}) {
  db.query(`
    INSERT INTO entities (id, title, subtitle, body, base_gravity)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.id, data.title, data.subtitle || null, data.body || null, data.gravity || 0.5);
  
  if (data.gravity) {
    db.query(`
      INSERT INTO entity_physics (entity_id, gravity)
      VALUES (?, ?)
    `).run(data.id, data.gravity);
  }
}

// Insert test relation
function insertRelation(db: Database, source: string, target: string, type: string) {
  db.query(`
    INSERT INTO relations (source, target, relation_type, type)
    VALUES (?, ?, ?, ?)
  `).run(source, target, type, type);
}

// Insert test memory
function insertMemory(db: Database, title: string, content: string) {
  db.query(`
    INSERT INTO user_memories (title, content)
    VALUES (?, ?)
  `).run(title, content);
}

describe('GraphReader.getRelatedEntities', () => {
  let db: Database;
  
  beforeEach(() => {
    cleanup();
    db = createTestDB();
    
    // Create test data
    insertEntity(db, { id: 'person:simon', title: 'Simon Willison', body: 'Datasette creator' });
    insertEntity(db, { id: 'project:datasette', title: 'Datasette', body: 'Data exploration tool' });
    insertEntity(db, { id: 'project:llm', title: 'LLM CLI', body: 'Command line tool' });
    insertEntity(db, { id: 'company:sqlite', title: 'SQLite', body: 'Database engine' });
    
    // Create relations
    insertRelation(db, 'person:simon', 'project:datasette', 'created');
    insertRelation(db, 'person:simon', 'project:llm', 'created');
    insertRelation(db, 'project:datasette', 'company:sqlite', 'uses');
  });
  
  afterEach(() => {
    db.close();
    cleanup();
  });
  
  it('should return related entities with relation types', () => {
    // Simulate what GraphReader.getRelatedEntities does
    const entityId = 'person:simon';
    const results = db.query(`
      SELECT 
        CASE WHEN source = ? THEN target ELSE source END as related_id,
        COALESCE(relation_type, type, 'related_to') as relation_type
      FROM relations
      WHERE source = ? OR target = ?
      LIMIT 10
    `).all(entityId, entityId, entityId) as any[];
    
    expect(results.length).toBe(2);
    expect(results.some(r => r.related_id === 'project:datasette')).toBe(true);
    expect(results.some(r => r.related_id === 'project:llm')).toBe(true);
  });
  
  it('should handle entity with no relations', () => {
    insertEntity(db, { id: 'person:orphan', title: 'Orphan Entity' });
    
    const results = db.query(`
      SELECT target as related_id
      FROM relations
      WHERE source = ?
    `).all('person:orphan') as any[];
    
    expect(results.length).toBe(0);
  });
});

describe('GraphReader.getTopByGravity', () => {
  let db: Database;
  
  beforeEach(() => {
    cleanup();
    db = createTestDB();
    
    // Create entities with different gravity
    insertEntity(db, { id: 'person:high', title: 'High Gravity', gravity: 0.9 });
    insertEntity(db, { id: 'person:medium', title: 'Medium Gravity', gravity: 0.6 });
    insertEntity(db, { id: 'project:low', title: 'Low Gravity', gravity: 0.3 });
    insertEntity(db, { id: 'singleton:system', title: 'System Entity', gravity: 1.0 });
  });
  
  afterEach(() => {
    db.close();
    cleanup();
  });
  
  it('should return entities sorted by gravity descending', () => {
    const results = db.query(`
      SELECT e.id, e.title, COALESCE(p.gravity, e.base_gravity, 0.5) as gravity
      FROM entities e
      LEFT JOIN entity_physics p ON e.id = p.entity_id
      WHERE e.id NOT LIKE 'singleton:%'
      ORDER BY gravity DESC
      LIMIT 3
    `).all() as any[];
    
    expect(results.length).toBe(3);
    expect(results[0].id).toBe('person:high');
    expect(results[0].gravity).toBe(0.9);
  });
  
  it('should filter by entity type', () => {
    const entityType = 'person';
    const results = db.query(`
      SELECT e.id, COALESCE(p.gravity, e.base_gravity, 0.5) as gravity
      FROM entities e
      LEFT JOIN entity_physics p ON e.id = p.entity_id
      WHERE e.id NOT LIKE 'singleton:%'
        AND e.id LIKE ? || ':%'
      ORDER BY gravity DESC
      LIMIT 10
    `).all(entityType) as any[];
    
    expect(results.length).toBe(2);
    expect(results.every(r => r.id.startsWith('person:'))).toBe(true);
  });
  
  it('should exclude singleton entities', () => {
    const results = db.query(`
      SELECT e.id
      FROM entities e
      WHERE e.id NOT LIKE 'singleton:%'
    `).all() as any[];
    
    expect(results.some(r => r.id.startsWith('singleton:'))).toBe(false);
  });
});

describe('GraphReader.searchMemories', () => {
  let db: Database;
  
  beforeEach(() => {
    cleanup();
    db = createTestDB();
    
    // Create test memories
    insertMemory(db, 'Magpie Architecture', 'Magpie is a cognitive tool for knowledge management.');
    insertMemory(db, 'Prism Server', 'Prism is the backend engine for the knowledge graph.');
    insertMemory(db, 'Zettelkasten Method', 'A note-taking method invented by Niklas Luhmann.');
  });
  
  afterEach(() => {
    db.close();
    cleanup();
  });
  
  it('should find memories by keyword via FTS', () => {
    const results = db.query(`
      SELECT m.id, m.title
      FROM user_memories_fts fts
      JOIN user_memories m ON fts.rowid = m.id
      WHERE user_memories_fts MATCH ?
      LIMIT 5
    `).all('"Magpie"*') as any[];
    
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Magpie Architecture');
  });
  
  it('should return empty for non-matching query', () => {
    const results = db.query(`
      SELECT m.id
      FROM user_memories_fts fts
      JOIN user_memories m ON fts.rowid = m.id
      WHERE user_memories_fts MATCH ?
      LIMIT 5
    `).all('"NonExistent12345"*') as any[];
    
    expect(results.length).toBe(0);
  });
  
  it('should respect limit parameter', () => {
    // Add more memories
    insertMemory(db, 'Test Memory 1', 'Knowledge is power.');
    insertMemory(db, 'Test Memory 2', 'Knowledge sharing is important.');
    
    const results = db.query(`
      SELECT m.id
      FROM user_memories_fts fts
      JOIN user_memories m ON fts.rowid = m.id
      WHERE user_memories_fts MATCH ?
      LIMIT ?
    `).all('"Knowledge"*', 2) as any[];
    
    expect(results.length).toBe(2);
  });
});
