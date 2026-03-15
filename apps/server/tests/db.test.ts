import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { initDB, getDB, closeDB } from '../src/db.js';
import fs from 'fs';
import path from 'path';

// Use unique DB path per test to avoid file locking issues with WAL mode
let testDbPath: string;

function cleanupTestDb(dbPath: string) {
  // Remove main db file and WAL mode auxiliary files
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe('Database Layer', () => {
  beforeEach(() => {
    // Generate unique path per test to avoid WAL file locking
    testDbPath = path.join(process.cwd(), `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  afterEach(() => {
    // Close DB before deleting file
    closeDB();
    cleanupTestDb(testDbPath);
  });

  it('should initialize the database and create tables', () => {
    initDB(testDbPath);
    const db = getDB();

    // Check if tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map((t: any) => t.name);

    expect(tableNames).toContain('emails');
    expect(tableNames).toContain('emails_fts'); // FTS virtual table
  });

  it('should support FTS5 queries', () => {
    initDB(testDbPath);
    const db = getDB();

    // Insert dummy data
    db.prepare(`
      INSERT INTO emails (id, subject, from_addr, to_addr, body_text, sent_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('1', 'Hello World', 'alice@example.com', 'bob@example.com', 'This is a test email about Magpie.', new Date().toISOString());

    // FTS trigger should automatically populate emails_fts
    // Verify FTS search
    const results = db.prepare("SELECT * FROM emails_fts WHERE emails_fts MATCH 'Magpie'").all();
    expect(results.length).toBeGreaterThan(0);
  });
});

