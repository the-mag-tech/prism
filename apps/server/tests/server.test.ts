import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { build } from '../src/app.js'; // We will extract app factory
import { initDB, closeDB } from '../src/db.js';
import { ingestEmail } from '../src/ingest.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Use unique DB path per test to avoid WAL file locking issues
let testDbPath: string;

function cleanupTestDb(dbPath: string) {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch { /* ignore */ }
  }
}

describe('API Server', () => {
  let app: any;

  beforeEach(async () => {
    testDbPath = path.join(process.cwd(), `test-server-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
    initDB(testDbPath);
    
    app = build(); // Create app instance
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDB();
    cleanupTestDb(testDbPath);
  });

  it('GET /search should return FTS results', async () => {
    // Populate DB
    ingestEmail({
      id: 's1',
      subject: 'Secret Project',
      from: 'boss@example.com',
      to: 'me@example.com',
      bodyText: 'Top secret.',
      sentAt: new Date(),
      hasAttachments: false
    });

    const response = await app.inject({
      method: 'GET',
      url: '/search?q=Secret'
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.length).toBe(1);
    expect(json[0].subject).toBe('Secret Project');
  });

  it('GET /graph/:email should return connections', async () => {
    ingestEmail({
      id: 'g1',
      subject: 'Hi',
      from: 'alice@example.com',
      to: 'me@example.com',
      bodyText: 'Yo',
      sentAt: new Date(),
      hasAttachments: false
    });

    const response = await app.inject({
      method: 'GET',
      url: '/graph/me@example.com'
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json).toContain('alice@example.com');
  });
});

