/**
 * Prism Queue - Native Bun SQLite Implementation
 * 
 * A lightweight, durable task queue built on bun:sqlite.
 * Inspired by liteque but adapted for Bun's native SQLite driver.
 * 
 * Features:
 * - SQLite persistence (survives crashes/restarts)
 * - Type-safe with Zod validation
 * - Configurable retry with backoff
 * - Concurrent processing
 * - Failed job retention
 * 
 * @ref worker/checklist
 * @since 2026-01-07
 */

import { Database } from 'bun:sqlite';
import { z } from 'zod';
import { log, logError, logWarn } from '../logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface QueueOptions {
  /** Number of retries before marking as failed (default: 3) */
  numRetries?: number;
  /** Keep failed jobs in DB for inspection (default: true) */
  keepFailedJobs?: boolean;
}

export interface RunnerOptions<T> {
  /** Number of concurrent workers (default: 1) */
  concurrency?: number;
  /** Poll interval in milliseconds (default: 5000) */
  pollIntervalMs?: number;
  /** Job timeout in seconds (default: 300) */
  timeoutSecs?: number;
  /** Zod schema for validation */
  validator?: z.ZodType;
}

export interface Job<T> {
  id: string;
  queue: string;
  data: T;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  runAt: string;
  lockedUntil?: string;
}

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

// =============================================================================
// QUEUE CLIENT
// =============================================================================

let db: Database | null = null;

/**
 * Initialize the queue database
 */
export function initQueueDB(dbPath: string): void {
  if (db) {
    log('[BunQueue] Already initialized');
    return;
  }

  log(`[BunQueue] Initializing database: ${dbPath}`);
  db = new Database(dbPath);
  
  // Enable WAL mode for better concurrency
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  
  // Create tables
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
    CREATE INDEX IF NOT EXISTS idx_jobs_locked_until ON prism_jobs(locked_until);
  `);
  
  log('[BunQueue] ✓ Database initialized');
}

export function getQueueDB(): Database {
  if (!db) {
    throw new Error('[BunQueue] Not initialized. Call initQueueDB() first.');
  }
  return db;
}

export function isQueueDBInitialized(): boolean {
  return db !== null;
}

// =============================================================================
// SQLITE QUEUE CLASS
// =============================================================================

export class BunSqliteQueue<T> {
  private queueName: string;
  private options: Required<QueueOptions>;

  constructor(name: string, options: QueueOptions = {}) {
    this.queueName = name;
    this.options = {
      numRetries: options.numRetries ?? 3,
      keepFailedJobs: options.keepFailedJobs ?? true,
    };
  }

  /**
   * Add a job to the queue
   */
  async enqueue(data: T, options?: { delayMs?: number }): Promise<{ id: string }> {
    const db = getQueueDB();
    const id = crypto.randomUUID();
    const payload = JSON.stringify(data);
    const runAt = options?.delayMs 
      ? new Date(Date.now() + options.delayMs).toISOString()
      : new Date().toISOString();

    db.run(`
      INSERT INTO prism_jobs (id, queue, payload, max_attempts, run_at)
      VALUES (?, ?, ?, ?, ?)
    `, [id, this.queueName, payload, this.options.numRetries, runAt]);

    log(`[BunQueue] Job ${id} enqueued to ${this.queueName}`);
    return { id };
  }

  /**
   * Get queue statistics
   */
  getStats(): { pending: number; processing: number; failed: number; completed: number } {
    const db = getQueueDB();
    const result = db.query(`
      SELECT status, COUNT(*) as count 
      FROM prism_jobs 
      WHERE queue = ?
      GROUP BY status
    `).all(this.queueName) as Array<{ status: string; count: number }>;

    const stats = { pending: 0, processing: 0, failed: 0, completed: 0 };
    for (const row of result) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row.count;
      }
    }
    return stats;
  }

  /**
   * Claim a job for processing (atomic operation)
   */
  claimJob(lockDurationSecs: number = 60): Job<T> | null {
    const db = getQueueDB();
    const now = new Date().toISOString();
    const lockedUntil = new Date(Date.now() + lockDurationSecs * 1000).toISOString();

    // Find and lock a job atomically
    const result = db.query(`
      UPDATE prism_jobs 
      SET status = 'processing', 
          locked_until = ?,
          attempts = attempts + 1,
          updated_at = datetime('now')
      WHERE id = (
        SELECT id FROM prism_jobs 
        WHERE queue = ? 
        AND status = 'pending'
        AND run_at <= ?
        AND (locked_until IS NULL OR locked_until < ?)
        ORDER BY run_at ASC
        LIMIT 1
      )
      RETURNING *
    `).get(lockedUntil, this.queueName, now, now) as JobRow | null;

    if (!result) return null;

    return this.rowToJob(result);
  }

  /**
   * Mark a job as completed
   */
  markCompleted(jobId: string): void {
    const db = getQueueDB();
    db.run(`
      UPDATE prism_jobs 
      SET status = 'completed', 
          locked_until = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `, [jobId]);
  }

  /**
   * Mark a job as failed
   */
  markFailed(jobId: string, error: string): void {
    const db = getQueueDB();
    
    // Check if we should retry
    const job = db.query(`SELECT attempts, max_attempts FROM prism_jobs WHERE id = ?`)
      .get(jobId) as { attempts: number; max_attempts: number } | null;

    if (!job) return;

    if (job.attempts < job.max_attempts) {
      // Retry with exponential backoff
      const backoffMs = Math.min(1000 * Math.pow(2, job.attempts), 60000);
      const runAt = new Date(Date.now() + backoffMs).toISOString();
      
      db.run(`
        UPDATE prism_jobs 
        SET status = 'pending', 
            locked_until = NULL,
            error = ?,
            run_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `, [error, runAt, jobId]);
      
      log(`[BunQueue] Job ${jobId} will retry in ${backoffMs}ms (attempt ${job.attempts}/${job.max_attempts})`);
    } else {
      // Max retries reached
      if (this.options.keepFailedJobs) {
        db.run(`
          UPDATE prism_jobs 
          SET status = 'failed', 
              locked_until = NULL,
              error = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `, [error, jobId]);
        logWarn(`[BunQueue] Job ${jobId} failed permanently after ${job.max_attempts} attempts`);
      } else {
        db.run(`DELETE FROM prism_jobs WHERE id = ?`, [jobId]);
      }
    }
  }

  /**
   * Release stale locked jobs (for recovery after crash)
   */
  releaseStaleJobs(): number {
    const db = getQueueDB();
    const now = new Date().toISOString();
    
    const result = db.run(`
      UPDATE prism_jobs 
      SET status = 'pending', 
          locked_until = NULL,
          updated_at = datetime('now')
      WHERE queue = ?
      AND status = 'processing'
      AND locked_until < ?
    `, [this.queueName, now]);

    if (result.changes > 0) {
      log(`[BunQueue] Released ${result.changes} stale jobs in ${this.queueName}`);
    }
    return result.changes;
  }

  private rowToJob(row: JobRow): Job<T> {
    return {
      id: row.id,
      queue: row.queue,
      data: JSON.parse(row.payload) as T,
      status: row.status as Job<T>['status'],
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      error: row.error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      runAt: row.run_at,
      lockedUntil: row.locked_until ?? undefined,
    };
  }
}

// =============================================================================
// RUNNER CLASS
// =============================================================================

/** Job with error details for error handler */
export interface FailedJob<T> extends Job<T> {
  errorObj: Error;
}

export class BunRunner<T> {
  private queue: BunSqliteQueue<T>;
  private handlers: {
    run: (job: Job<T>) => Promise<void>;
    onComplete?: (job: Job<T>) => Promise<void>;
    onError?: (job: FailedJob<T>) => Promise<void>;
  };
  private options: Required<RunnerOptions<T>>;
  private running: boolean = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private activeJobs: number = 0;

  constructor(
    queue: BunSqliteQueue<T>,
    handlers: {
      run: (job: Job<T>) => Promise<void>;
      onComplete?: (job: Job<T>) => Promise<void>;
      onError?: (job: FailedJob<T>) => Promise<void>;
    },
    options: RunnerOptions<T> = {}
  ) {
    this.queue = queue;
    this.handlers = handlers;
    this.options = {
      concurrency: options.concurrency ?? 1,
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      timeoutSecs: options.timeoutSecs ?? 300,
      validator: options.validator as any,
    };

    // Auto-start
    this.start();
  }

  private start(): void {
    if (this.running) return;
    this.running = true;

    // Release any stale jobs from previous crash
    this.queue.releaseStaleJobs();

    // Start polling
    this.intervalId = setInterval(() => this.poll(), this.options.pollIntervalMs);
    
    // Initial poll
    this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    if (this.activeJobs >= this.options.concurrency) return;

    const job = this.queue.claimJob(this.options.timeoutSecs);
    if (!job) return;

    // Validate if schema provided
    if (this.options.validator) {
      try {
        this.options.validator.parse(job.data);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.queue.markFailed(job.id, `Validation failed: ${errMsg}`);
        return;
      }
    }

    this.activeJobs++;
    
    try {
      await this.handlers.run(job);
      this.queue.markCompleted(job.id);
      
      if (this.handlers.onComplete) {
        await this.handlers.onComplete(job);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.queue.markFailed(job.id, errMsg);
      
      if (this.handlers.onError) {
        await this.handlers.onError({ ...job, errorObj: error as Error });
      }
    } finally {
      this.activeJobs--;
    }

    // Try to pick up more work immediately
    if (this.activeJobs < this.options.concurrency) {
      setImmediate(() => this.poll());
    }
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
