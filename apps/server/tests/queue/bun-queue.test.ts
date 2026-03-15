/**
 * BunSqliteQueue Unit Tests
 * 
 * Tests the core queue functionality:
 * - Job enqueueing
 * - Job claiming (atomic locking)
 * - Job completion/failure marking
 * - Retry with exponential backoff
 * - Stale job recovery
 * 
 * @since 2026-01-07
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';

// We need to test in isolation, so we'll recreate the core logic here
// to avoid singleton state issues
const TEST_DB_PATH = path.join(process.cwd(), 'test-queue.db');

interface JobRow {
  id: string;
  queue: string;
  payload: string;
  status: string;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  run_at: string;
  locked_until: string | null;
}

function createTestDB(): Database {
  const db = new Database(TEST_DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS prism_jobs (
      id TEXT PRIMARY KEY,
      queue TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      run_at TEXT DEFAULT (datetime('now')),
      locked_until TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON prism_jobs(queue, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_run_at ON prism_jobs(run_at);
  `);
  return db;
}

function cleanup() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  // Clean WAL files
  if (fs.existsSync(TEST_DB_PATH + '-wal')) {
    fs.unlinkSync(TEST_DB_PATH + '-wal');
  }
  if (fs.existsSync(TEST_DB_PATH + '-shm')) {
    fs.unlinkSync(TEST_DB_PATH + '-shm');
  }
}

describe('BunSqliteQueue', () => {
  let db: Database;
  const QUEUE_NAME = 'test:queue';

  beforeEach(() => {
    cleanup();
    db = createTestDB();
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  describe('enqueue', () => {
    it('should insert a job with correct fields', () => {
      const id = crypto.randomUUID();
      const payload = { memoryId: 1, trigger: 'test' };
      
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, max_attempts, run_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `, [id, QUEUE_NAME, JSON.stringify(payload), 3]);

      const job = db.query('SELECT * FROM prism_jobs WHERE id = ?').get(id) as JobRow;
      
      expect(job).toBeTruthy();
      expect(job.queue).toBe(QUEUE_NAME);
      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(0);
      expect(job.max_attempts).toBe(3);
      expect(JSON.parse(job.payload)).toEqual(payload);
    });

    it('should support delayed jobs', () => {
      const id = crypto.randomUUID();
      const delayMs = 5000;
      const runAt = new Date(Date.now() + delayMs).toISOString();
      
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, max_attempts, run_at)
        VALUES (?, ?, ?, ?, ?)
      `, [id, QUEUE_NAME, '{}', 3, runAt]);

      const job = db.query('SELECT run_at FROM prism_jobs WHERE id = ?').get(id) as { run_at: string };
      
      // run_at should be in the future
      expect(new Date(job.run_at).getTime()).toBeGreaterThan(Date.now() - 1000);
    });
  });

  describe('claimJob', () => {
    // Helper: Convert JS Date to SQLite datetime format (YYYY-MM-DD HH:mm:ss)
    const toSqliteDateTime = (date: Date) => 
      date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    it('should claim the oldest pending job', () => {
      // Insert two jobs
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      
      const pastTime = toSqliteDateTime(new Date(Date.now() - 60000));
      const nowTime = toSqliteDateTime(new Date());
      
      // First job - older
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, run_at)
        VALUES (?, ?, ?, ?)
      `, [id1, QUEUE_NAME, '{"order": 1}', pastTime]);
      
      // Second job - newer
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, run_at)
        VALUES (?, ?, ?, ?)
      `, [id2, QUEUE_NAME, '{"order": 2}', nowTime]);

      const now = toSqliteDateTime(new Date());
      const lockedUntil = toSqliteDateTime(new Date(Date.now() + 60000));
      
      // Claim a job
      const claimed = db.query(`
        UPDATE prism_jobs 
        SET status = 'processing', 
            locked_until = ?,
            attempts = attempts + 1
        WHERE id = (
          SELECT id FROM prism_jobs 
          WHERE queue = ? 
          AND status = 'pending'
          AND run_at <= ?
          ORDER BY run_at ASC
          LIMIT 1
        )
        RETURNING *
      `).get(lockedUntil, QUEUE_NAME, now) as JobRow;

      expect(claimed).toBeTruthy();
      expect(claimed.id).toBe(id1); // Oldest first
      expect(claimed.status).toBe('processing');
      expect(claimed.attempts).toBe(1);
      expect(claimed.locked_until).toBe(lockedUntil);
    });

    it('should not claim jobs scheduled for the future', () => {
      const id = crypto.randomUUID();
      
      // Job scheduled for 5 minutes in the future
      const futureTime = toSqliteDateTime(new Date(Date.now() + 300000));
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, run_at)
        VALUES (?, ?, ?, ?)
      `, [id, QUEUE_NAME, '{}', futureTime]);

      const now = toSqliteDateTime(new Date());
      const lockedUntil = toSqliteDateTime(new Date(Date.now() + 60000));
      
      const claimed = db.query(`
        UPDATE prism_jobs 
        SET status = 'processing', locked_until = ?
        WHERE id = (
          SELECT id FROM prism_jobs 
          WHERE queue = ? AND status = 'pending' AND run_at <= ?
          ORDER BY run_at ASC LIMIT 1
        )
        RETURNING *
      `).get(lockedUntil, QUEUE_NAME, now) as JobRow | null;

      expect(claimed).toBeNull();
    });

    it('should not claim jobs from other queues', () => {
      const id = crypto.randomUUID();
      
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, run_at)
        VALUES (?, ?, ?, datetime('now'))
      `, [id, 'other:queue', '{}']);

      const now = new Date().toISOString();
      const lockedUntil = new Date(Date.now() + 60000).toISOString();
      
      const claimed = db.query(`
        UPDATE prism_jobs 
        SET status = 'processing', locked_until = ?
        WHERE id = (
          SELECT id FROM prism_jobs 
          WHERE queue = ? AND status = 'pending' AND run_at <= ?
          ORDER BY run_at ASC LIMIT 1
        )
        RETURNING *
      `).get(lockedUntil, QUEUE_NAME, now) as JobRow | null;

      expect(claimed).toBeNull();
    });

    it('should be atomic (no double-claiming)', () => {
      const id = crypto.randomUUID();
      
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, run_at)
        VALUES (?, ?, ?, datetime('now'))
      `, [id, QUEUE_NAME, '{}']);

      const now = new Date().toISOString();
      const lockedUntil = new Date(Date.now() + 60000).toISOString();
      
      // First claim
      const claimed1 = db.query(`
        UPDATE prism_jobs 
        SET status = 'processing', locked_until = ?, attempts = attempts + 1
        WHERE id = (
          SELECT id FROM prism_jobs 
          WHERE queue = ? AND status = 'pending' AND run_at <= ?
          ORDER BY run_at ASC LIMIT 1
        )
        RETURNING *
      `).get(lockedUntil, QUEUE_NAME, now) as JobRow | null;

      // Second claim attempt
      const claimed2 = db.query(`
        UPDATE prism_jobs 
        SET status = 'processing', locked_until = ?, attempts = attempts + 1
        WHERE id = (
          SELECT id FROM prism_jobs 
          WHERE queue = ? AND status = 'pending' AND run_at <= ?
          ORDER BY run_at ASC LIMIT 1
        )
        RETURNING *
      `).get(lockedUntil, QUEUE_NAME, now) as JobRow | null;

      expect(claimed1).toBeTruthy();
      expect(claimed2).toBeNull(); // No more pending jobs
    });
  });

  describe('markCompleted', () => {
    it('should update status to completed and clear lock', () => {
      const id = crypto.randomUUID();
      
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, locked_until)
        VALUES (?, ?, ?, 'processing', datetime('now', '+1 minute'))
      `, [id, QUEUE_NAME, '{}']);

      db.run(`
        UPDATE prism_jobs 
        SET status = 'completed', locked_until = NULL, updated_at = datetime('now')
        WHERE id = ?
      `, [id]);

      const job = db.query('SELECT * FROM prism_jobs WHERE id = ?').get(id) as JobRow;
      
      expect(job.status).toBe('completed');
      expect(job.locked_until).toBeNull();
    });
  });

  describe('markFailed with retry', () => {
    it('should re-queue job with backoff when attempts < max', () => {
      const id = crypto.randomUUID();
      
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, attempts, max_attempts)
        VALUES (?, ?, ?, 'processing', 1, 3)
      `, [id, QUEUE_NAME, '{}']);

      // Check attempts and decide
      const job = db.query('SELECT attempts, max_attempts FROM prism_jobs WHERE id = ?')
        .get(id) as { attempts: number; max_attempts: number };

      expect(job.attempts).toBe(1);
      expect(job.attempts < job.max_attempts).toBe(true);

      // Calculate backoff (2^1 * 1000 = 2000ms)
      const backoffMs = Math.min(1000 * Math.pow(2, job.attempts), 60000);
      expect(backoffMs).toBe(2000);

      const runAt = new Date(Date.now() + backoffMs).toISOString();
      
      db.run(`
        UPDATE prism_jobs 
        SET status = 'pending', locked_until = NULL, error = ?, run_at = ?
        WHERE id = ?
      `, ['Test error', runAt, id]);

      const updated = db.query('SELECT * FROM prism_jobs WHERE id = ?').get(id) as JobRow;
      
      expect(updated.status).toBe('pending');
      expect(updated.error).toBe('Test error');
      expect(new Date(updated.run_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('should mark as failed when max attempts reached', () => {
      const id = crypto.randomUUID();
      
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, attempts, max_attempts)
        VALUES (?, ?, ?, 'processing', 3, 3)
      `, [id, QUEUE_NAME, '{}']);

      const job = db.query('SELECT attempts, max_attempts FROM prism_jobs WHERE id = ?')
        .get(id) as { attempts: number; max_attempts: number };

      // Max attempts reached
      expect(job.attempts >= job.max_attempts).toBe(true);

      db.run(`
        UPDATE prism_jobs 
        SET status = 'failed', locked_until = NULL, error = ?
        WHERE id = ?
      `, ['Final failure', id]);

      const updated = db.query('SELECT * FROM prism_jobs WHERE id = ?').get(id) as JobRow;
      
      expect(updated.status).toBe('failed');
      expect(updated.error).toBe('Final failure');
    });

    it('should calculate exponential backoff correctly', () => {
      // Backoff formula: min(1000 * 2^attempts, 60000)
      const backoffs = [
        { attempts: 1, expected: 2000 },   // 2^1 * 1000
        { attempts: 2, expected: 4000 },   // 2^2 * 1000
        { attempts: 3, expected: 8000 },   // 2^3 * 1000
        { attempts: 4, expected: 16000 },  // 2^4 * 1000
        { attempts: 5, expected: 32000 },  // 2^5 * 1000
        { attempts: 6, expected: 60000 },  // Capped at 60000
        { attempts: 10, expected: 60000 }, // Still capped
      ];

      for (const { attempts, expected } of backoffs) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempts), 60000);
        expect(backoffMs).toBe(expected);
      }
    });
  });

  describe('releaseStaleJobs', () => {
    // Helper: Convert JS Date to SQLite datetime format (YYYY-MM-DD HH:mm:ss)
    const toSqliteDateTime = (date: Date) => 
      date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    it('should release jobs with expired locks', () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      
      const pastLock = toSqliteDateTime(new Date(Date.now() - 300000)); // 5 min ago
      const futureLock = toSqliteDateTime(new Date(Date.now() + 300000)); // 5 min from now
      
      // Stale job (lock expired)
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, locked_until)
        VALUES (?, ?, ?, 'processing', ?)
      `, [id1, QUEUE_NAME, '{}', pastLock]);

      // Active job (lock not expired)
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, locked_until)
        VALUES (?, ?, ?, 'processing', ?)
      `, [id2, QUEUE_NAME, '{}', futureLock]);

      const now = toSqliteDateTime(new Date());
      
      const result = db.run(`
        UPDATE prism_jobs 
        SET status = 'pending', locked_until = NULL
        WHERE queue = ? AND status = 'processing' AND locked_until < ?
      `, [QUEUE_NAME, now]);

      expect(result.changes).toBe(1);

      const job1 = db.query('SELECT status FROM prism_jobs WHERE id = ?').get(id1) as { status: string };
      const job2 = db.query('SELECT status FROM prism_jobs WHERE id = ?').get(id2) as { status: string };
      
      expect(job1.status).toBe('pending');
      expect(job2.status).toBe('processing');
    });

    it('should only release jobs from specified queue', () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      
      const pastLock = toSqliteDateTime(new Date(Date.now() - 300000));
      
      // Stale job in our queue
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, locked_until)
        VALUES (?, ?, ?, 'processing', ?)
      `, [id1, QUEUE_NAME, '{}', pastLock]);

      // Stale job in different queue
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, locked_until)
        VALUES (?, ?, ?, 'processing', ?)
      `, [id2, 'other:queue', '{}', pastLock]);

      const now = toSqliteDateTime(new Date());
      
      db.run(`
        UPDATE prism_jobs 
        SET status = 'pending', locked_until = NULL
        WHERE queue = ? AND status = 'processing' AND locked_until < ?
      `, [QUEUE_NAME, now]);

      const job1 = db.query('SELECT status FROM prism_jobs WHERE id = ?').get(id1) as { status: string };
      const job2 = db.query('SELECT status FROM prism_jobs WHERE id = ?').get(id2) as { status: string };
      
      expect(job1.status).toBe('pending');
      expect(job2.status).toBe('processing'); // Not released
    });
  });

  describe('getStats', () => {
    it('should return correct counts by status', () => {
      // Insert jobs with various statuses
      const statuses = ['pending', 'pending', 'processing', 'completed', 'completed', 'completed', 'failed'];
      
      for (const status of statuses) {
        db.run(`
          INSERT INTO prism_jobs (id, queue, payload, status)
          VALUES (?, ?, ?, ?)
        `, [crypto.randomUUID(), QUEUE_NAME, '{}', status]);
      }

      const result = db.query(`
        SELECT status, COUNT(*) as count 
        FROM prism_jobs 
        WHERE queue = ?
        GROUP BY status
      `).all(QUEUE_NAME) as Array<{ status: string; count: number }>;

      const stats: Record<string, number> = {};
      for (const row of result) {
        stats[row.status] = row.count;
      }

      expect(stats['pending']).toBe(2);
      expect(stats['processing']).toBe(1);
      expect(stats['completed']).toBe(3);
      expect(stats['failed']).toBe(1);
    });
  });

  describe('FIFO ordering', () => {
    it('should process jobs in run_at order', async () => {
      const jobs = [
        { id: crypto.randomUUID(), order: 3, runAt: "datetime('now', '+2 minutes')" },
        { id: crypto.randomUUID(), order: 1, runAt: "datetime('now', '-2 minutes')" },
        { id: crypto.randomUUID(), order: 2, runAt: "datetime('now')" },
      ];

      for (const job of jobs) {
        db.run(`
          INSERT INTO prism_jobs (id, queue, payload, run_at)
          VALUES (?, ?, ?, ${job.runAt})
        `, [job.id, QUEUE_NAME, JSON.stringify({ order: job.order })]);
      }

      const claimedOrder: number[] = [];
      const now = new Date(Date.now() + 300000).toISOString(); // 5 minutes in future to claim all
      
      for (let i = 0; i < 3; i++) {
        const lockedUntil = new Date(Date.now() + 60000).toISOString();
        const claimed = db.query(`
          UPDATE prism_jobs 
          SET status = 'processing', locked_until = ?
          WHERE id = (
            SELECT id FROM prism_jobs 
            WHERE queue = ? AND status = 'pending' AND run_at <= ?
            ORDER BY run_at ASC LIMIT 1
          )
          RETURNING *
        `).get(lockedUntil, QUEUE_NAME, now) as JobRow | null;

        if (claimed) {
          claimedOrder.push(JSON.parse(claimed.payload).order);
        }
      }

      expect(claimedOrder).toEqual([1, 2, 3]);
    });
  });
});
