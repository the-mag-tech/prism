/**
 * Ingest Module Tests
 * 
 * Tests email ingestion functionality.
 * Note: Memory ingestion now goes through graph-link layer (graphWriter.ingestFinding)
 * 
 * @since 2025-01-01
 * @updated 2026-01-07 - Removed deprecated ingestMemory/ingestMarkdownFile tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { initDB, getDB, closeDB } from '../src/db.js';
import { ingestEmail, getMemoriesCount } from '../src/ingest.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Helper to create unique temp DB path
function createTempDBPath(prefix: string): string {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `${prefix}_${uniqueId}.db`);
}

describe('Email Ingestion', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTempDBPath('test_email');
    initDB(dbPath);
  });

  afterEach(() => {
    closeDB();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('should ingest a parsed email into the database', () => {
    const db = getDB();
    const email = {
      id: 'msg-123',
      subject: 'Test Subject',
      from: 'sender@example.com',
      to: 'recipient@example.com',
      bodyText: 'This is the email body content.',
      sentAt: new Date(),
      hasAttachments: false
    };

    ingestEmail(email);

    const row = db.prepare('SELECT * FROM emails WHERE id = ?').get('msg-123') as any;
    expect(row).toBeDefined();
    expect(row.subject).toBe('Test Subject');
    expect(row.from_addr).toBe('sender@example.com');
  });

  it('should be idempotent (ignore duplicate IDs)', () => {
    const email = {
      id: 'msg-dup',
      subject: 'Original',
      from: 'me@example.com',
      to: 'you@example.com',
      bodyText: 'Body',
      sentAt: new Date(),
      hasAttachments: false
    };

    ingestEmail(email);
    
    // Try ingesting again with same ID but different subject
    ingestEmail({ ...email, subject: 'Changed' });

    const db = getDB();
    const row = db.prepare('SELECT * FROM emails WHERE id = ?').get('msg-dup') as any;
    expect(row.subject).toBe('Original'); // Should not update
  });
});

describe('Memories Count', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTempDBPath('test_count');
    initDB(dbPath);
  });

  afterEach(() => {
    closeDB();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('should return 0 for empty database', () => {
    expect(getMemoriesCount()).toBe(0);
  });

  it('should count memories correctly', () => {
    const db = getDB();
    
    // Insert test memories directly into user_memories (post v50 schema)
    db.prepare(`
      INSERT INTO user_memories (source_url, source_type, content, title)
      VALUES (?, ?, ?, ?)
    `).run('/test/1.md', 'markdown', 'First content', 'First');
    
    db.prepare(`
      INSERT INTO user_memories (source_url, source_type, content, title)
      VALUES (?, ?, ?, ?)
    `).run('/test/2.md', 'markdown', 'Second content', 'Second');

    expect(getMemoriesCount()).toBe(2);
  });
});
