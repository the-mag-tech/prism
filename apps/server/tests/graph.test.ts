import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { initDB, getDB, closeDB } from '../src/db.js';
import { ingestEmail } from '../src/ingest.js';
import { getRelatedEntities } from '../src/graph.js';
import fs from 'fs';
import path from 'path';

// Use unique DB path per test to avoid file locking issues with WAL mode
let testDbPath: string;

function cleanupTestDb(dbPath: string) {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch { /* ignore */ }
  }
}

describe('Graph Logic', () => {
  beforeEach(() => {
    testDbPath = path.join(process.cwd(), `test-graph-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    initDB(testDbPath);
  });

  afterEach(() => {
    closeDB();
    cleanupTestDb(testDbPath);
  });

  it('should find people I communicated with', () => {
    ingestEmail({
      id: '1',
      subject: 'Hello',
      from: 'me@example.com',
      to: 'alice@example.com',
      bodyText: 'Hi Alice',
      sentAt: new Date(),
      hasAttachments: false
    });

    const related = getRelatedEntities('me@example.com');
    expect(related).toContain('alice@example.com');
  });

  it('should find people who emailed me', () => {
    ingestEmail({
      id: '2',
      subject: 'Hi',
      from: 'bob@example.com',
      to: 'me@example.com',
      bodyText: 'Hi Me',
      sentAt: new Date(),
      hasAttachments: false
    });

    const related = getRelatedEntities('me@example.com');
    expect(related).toContain('bob@example.com');
  });

  it('should find co-recipients', () => {
    ingestEmail({
      id: '3',
      subject: 'Project',
      from: 'boss@example.com',
      to: 'me@example.com, carl@example.com',
      bodyText: 'Work hard',
      sentAt: new Date(),
      hasAttachments: false
    });

    // If I am on a thread with Carl, is Carl related to me?
    // Yes, via "co-occurrence".
    const related = getRelatedEntities('me@example.com');
    expect(related).toContain('carl@example.com');
  });
});

