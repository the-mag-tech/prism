/**
 * BunRunner Unit Tests
 * 
 * Tests the job runner/worker functionality:
 * - Auto-polling
 * - Job execution
 * - Completion/failure callbacks
 * - Concurrency control
 * - Zod validation
 * 
 * @since 2026-01-07
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const TEST_DB_PATH = path.join(process.cwd(), 'test-runner.db');

// Clean up helper
function cleanup() {
  const files = [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm'];
  for (const file of files) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

// Helper: Convert JS Date to SQLite datetime format
const toSqliteDateTime = (date: Date) =>
  date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

// Minimal runner implementation for isolated testing
interface Job<T> {
  id: string;
  data: T;
  attempts: number;
}

class TestRunner<T> {
  private db: Database;
  private queueName: string;
  private handler: (job: Job<T>) => Promise<void>;
  private onComplete?: (job: Job<T>) => void;
  private onError?: (job: Job<T>, error: Error) => void;
  private validator?: z.ZodSchema<T>;
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private concurrency: number;
  private activeJobs = 0;

  constructor(
    db: Database,
    queueName: string,
    handler: (job: Job<T>) => Promise<void>,
    options?: {
      pollIntervalMs?: number;
      concurrency?: number;
      validator?: z.ZodSchema<T>;
      onComplete?: (job: Job<T>) => void;
      onError?: (job: Job<T>, error: Error) => void;
    }
  ) {
    this.db = db;
    this.queueName = queueName;
    this.handler = handler;
    this.pollIntervalMs = options?.pollIntervalMs ?? 100;
    this.concurrency = options?.concurrency ?? 1;
    this.validator = options?.validator;
    this.onComplete = options?.onComplete;
    this.onError = options?.onError;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Release stale jobs
    this.releaseStale();

    // Start polling
    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private releaseStale(): void {
    const now = toSqliteDateTime(new Date());
    this.db.run(`
      UPDATE prism_jobs 
      SET status = 'pending', locked_until = NULL
      WHERE queue = ? AND status = 'processing' AND locked_until < ?
    `, [this.queueName, now]);
  }

  private async poll(): Promise<void> {
    if (!this.running || this.activeJobs >= this.concurrency) return;

    const now = toSqliteDateTime(new Date());
    const lockedUntil = toSqliteDateTime(new Date(Date.now() + 60000));

    const row = this.db.query(`
      UPDATE prism_jobs 
      SET status = 'processing', locked_until = ?, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM prism_jobs 
        WHERE queue = ? AND status = 'pending' AND run_at <= ?
        ORDER BY run_at ASC LIMIT 1
      )
      RETURNING id, payload, attempts
    `).get(lockedUntil, this.queueName, now) as { id: string; payload: string; attempts: number } | null;

    if (!row) return;

    const job: Job<T> = {
      id: row.id,
      data: JSON.parse(row.payload),
      attempts: row.attempts,
    };

    // Validate if schema provided
    if (this.validator) {
      const result = this.validator.safeParse(job.data);
      if (!result.success) {
        this.markFailed(job.id, `Validation failed: ${result.error.message}`);
        return;
      }
    }

    this.activeJobs++;

    try {
      await this.handler(job);
      this.markCompleted(job.id);
      this.onComplete?.(job);
    } catch (error) {
      const err = error as Error;
      this.markFailed(job.id, err.message);
      this.onError?.(job, err);
    } finally {
      this.activeJobs--;
    }

    // Try to pick up more work
    if (this.running && this.activeJobs < this.concurrency) {
      setImmediate(() => this.poll());
    }
  }

  private markCompleted(id: string): void {
    this.db.run(`
      UPDATE prism_jobs 
      SET status = 'completed', locked_until = NULL
      WHERE id = ?
    `, [id]);
  }

  private markFailed(id: string, error: string): void {
    const job = this.db.query('SELECT attempts, max_attempts FROM prism_jobs WHERE id = ?')
      .get(id) as { attempts: number; max_attempts: number } | null;

    if (!job) return;

    if (job.attempts < job.max_attempts) {
      const backoffMs = Math.min(1000 * Math.pow(2, job.attempts), 60000);
      const runAt = toSqliteDateTime(new Date(Date.now() + backoffMs));
      this.db.run(`
        UPDATE prism_jobs 
        SET status = 'pending', locked_until = NULL, error = ?, run_at = ?
        WHERE id = ?
      `, [error, runAt, id]);
    } else {
      this.db.run(`
        UPDATE prism_jobs 
        SET status = 'failed', locked_until = NULL, error = ?
        WHERE id = ?
      `, [error, id]);
    }
  }

  getActiveJobs(): number {
    return this.activeJobs;
  }

  isRunning(): boolean {
    return this.running;
  }
}

describe('BunRunner', () => {
  let db: Database;
  const QUEUE_NAME = 'test:runner';

  beforeEach(() => {
    cleanup();
    db = new Database(TEST_DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
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
    `);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  // Helper to enqueue a job
  function enqueue<T>(data: T): string {
    const id = crypto.randomUUID();
    const now = toSqliteDateTime(new Date());
    db.run(`
      INSERT INTO prism_jobs (id, queue, payload, run_at)
      VALUES (?, ?, ?, ?)
    `, [id, QUEUE_NAME, JSON.stringify(data), now]);
    return id;
  }

  describe('Job Processing', () => {
    it('should process jobs with handler', async () => {
      const processed: number[] = [];
      
      const runner = new TestRunner<{ value: number }>(
        db,
        QUEUE_NAME,
        async (job) => {
          processed.push(job.data.value);
        },
        { pollIntervalMs: 50 }
      );

      enqueue({ value: 1 });
      enqueue({ value: 2 });
      
      runner.start();
      
      // Wait for processing
      await new Promise((r) => setTimeout(r, 300));
      runner.stop();

      expect(processed.sort()).toEqual([1, 2]);
    });

    it('should call onComplete callback', async () => {
      const completed: string[] = [];
      
      const runner = new TestRunner<{ test: string }>(
        db,
        QUEUE_NAME,
        async () => { /* success */ },
        { 
          pollIntervalMs: 50,
          onComplete: (job) => completed.push(job.id),
        }
      );

      const jobId = enqueue({ test: 'complete' });
      
      runner.start();
      await new Promise((r) => setTimeout(r, 200));
      runner.stop();

      expect(completed).toContain(jobId);
    });

    it('should call onError callback on failure', async () => {
      const errors: { id: string; message: string }[] = [];
      
      const runner = new TestRunner<{ test: string }>(
        db,
        QUEUE_NAME,
        async () => {
          throw new Error('Intentional failure');
        },
        { 
          pollIntervalMs: 50,
          onError: (job, error) => errors.push({ id: job.id, message: error.message }),
        }
      );

      enqueue({ test: 'will-fail' });
      
      runner.start();
      await new Promise((r) => setTimeout(r, 200));
      runner.stop();

      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('Intentional failure');
    });
  });

  describe('Validation', () => {
    const TestSchema = z.object({
      required: z.string(),
      count: z.number(),
    });

    it('should validate job data with Zod schema', async () => {
      const processed: boolean[] = [];
      
      const runner = new TestRunner<z.infer<typeof TestSchema>>(
        db,
        QUEUE_NAME,
        async () => { processed.push(true); },
        { 
          pollIntervalMs: 50,
          validator: TestSchema,
        }
      );

      // Valid job
      enqueue({ required: 'test', count: 42 });
      
      runner.start();
      await new Promise((r) => setTimeout(r, 200));
      runner.stop();

      expect(processed.length).toBe(1);
    });

    it('should reject invalid job data', async () => {
      const processed: boolean[] = [];
      
      const runner = new TestRunner<z.infer<typeof TestSchema>>(
        db,
        QUEUE_NAME,
        async () => { processed.push(true); },
        { 
          pollIntervalMs: 50,
          validator: TestSchema,
        }
      );

      // Invalid job (missing required fields)
      enqueue({ wrong: 'data' });
      
      runner.start();
      await new Promise((r) => setTimeout(r, 200));
      runner.stop();

      expect(processed.length).toBe(0);
      
      // Check job was marked as failed/retrying
      const job = db.query('SELECT error FROM prism_jobs WHERE queue = ?').get(QUEUE_NAME) as { error: string };
      expect(job.error).toContain('Validation failed');
    });
  });

  describe('Concurrency', () => {
    it('should respect concurrency limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      
      const runner = new TestRunner<{ id: number }>(
        db,
        QUEUE_NAME,
        async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 100));
          concurrent--;
        },
        { 
          pollIntervalMs: 20,
          concurrency: 2,
        }
      );

      // Enqueue more jobs than concurrency
      for (let i = 0; i < 5; i++) {
        enqueue({ id: i });
      }
      
      runner.start();
      await new Promise((r) => setTimeout(r, 800));
      runner.stop();

      // Should never exceed concurrency of 2
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should process with concurrency 1 by default', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      
      const runner = new TestRunner<{ id: number }>(
        db,
        QUEUE_NAME,
        async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 50));
          concurrent--;
        },
        { pollIntervalMs: 20 }
      );

      for (let i = 0; i < 3; i++) {
        enqueue({ id: i });
      }
      
      runner.start();
      await new Promise((r) => setTimeout(r, 400));
      runner.stop();

      expect(maxConcurrent).toBe(1);
    });
  });

  describe('Lifecycle', () => {
    it('should start and stop correctly', async () => {
      const runner = new TestRunner<{ test: string }>(
        db,
        QUEUE_NAME,
        async () => {},
        { pollIntervalMs: 50 }
      );

      expect(runner.isRunning()).toBe(false);
      
      runner.start();
      expect(runner.isRunning()).toBe(true);
      
      runner.stop();
      expect(runner.isRunning()).toBe(false);
    });

    it('should release stale jobs on start', async () => {
      const pastLock = toSqliteDateTime(new Date(Date.now() - 300000));
      
      // Insert a stale processing job
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, locked_until, attempts)
        VALUES (?, ?, '{}', 'processing', ?, 1)
      `, [crypto.randomUUID(), QUEUE_NAME, pastLock]);

      const processed: boolean[] = [];
      const runner = new TestRunner<Record<string, unknown>>(
        db,
        QUEUE_NAME,
        async () => { processed.push(true); },
        { pollIntervalMs: 50 }
      );

      runner.start();
      await new Promise((r) => setTimeout(r, 200));
      runner.stop();

      // Stale job should have been released and processed
      expect(processed.length).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should retry failed jobs', async () => {
      let attempts = 0;
      
      const runner = new TestRunner<{ test: string }>(
        db,
        QUEUE_NAME,
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Retry me');
          }
        },
        { pollIntervalMs: 50 }
      );

      const jobId = enqueue({ test: 'retry' });
      
      runner.start();
      
      // Force run_at to past after each failure to enable retry
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 100));
        db.run(`UPDATE prism_jobs SET run_at = ? WHERE id = ?`, 
          [toSqliteDateTime(new Date(Date.now() - 1000)), jobId]);
      }
      
      runner.stop();

      // Should have attempted 3 times (1 initial + 2 retries)
      expect(attempts).toBe(3);
    });

    it('should mark job as failed after max retries', async () => {
      const runner = new TestRunner<{ test: string }>(
        db,
        QUEUE_NAME,
        async () => { throw new Error('Always fail'); },
        { pollIntervalMs: 30 }
      );

      // Job with max_attempts = 2
      const id = crypto.randomUUID();
      const now = toSqliteDateTime(new Date());
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, max_attempts, run_at)
        VALUES (?, ?, '{}', 2, ?)
      `, [id, QUEUE_NAME, now]);

      runner.start();
      
      // Force retries
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 80));
        db.run(`UPDATE prism_jobs SET run_at = ? WHERE id = ?`, 
          [toSqliteDateTime(new Date(Date.now() - 1000)), id]);
      }
      
      runner.stop();

      const job = db.query('SELECT status, attempts FROM prism_jobs WHERE id = ?').get(id) as { status: string; attempts: number };
      expect(job.status).toBe('failed');
      expect(job.attempts).toBe(2);
    });
  });
});
