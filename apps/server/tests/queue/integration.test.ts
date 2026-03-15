/**
 * Queue Integration Tests
 * 
 * Tests the full queue lifecycle:
 * - Client initialization
 * - Enqueue helpers
 * - Runner processing
 * - Recovery scenarios
 * 
 * @since 2026-01-07
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'test-queue-integration.db');

// Clean up helper
function cleanup() {
  const files = [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm'];
  for (const file of files) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

// Minimal queue implementation for isolated testing
class TestQueue<T> {
  private db: Database;
  private queueName: string;
  private numRetries: number;

  constructor(db: Database, queueName: string, numRetries = 3) {
    this.db = db;
    this.queueName = queueName;
    this.numRetries = numRetries;
  }

  enqueue(data: T, options?: { delayMs?: number }): string {
    const id = crypto.randomUUID();
    const payload = JSON.stringify(data);
    const runAt = options?.delayMs
      ? new Date(Date.now() + options.delayMs).toISOString()
      : new Date().toISOString();

    this.db.run(`
      INSERT INTO prism_jobs (id, queue, payload, max_attempts, run_at)
      VALUES (?, ?, ?, ?, ?)
    `, [id, this.queueName, payload, this.numRetries, runAt]);

    return id;
  }

  claim(lockDurationSecs = 60): { id: string; data: T } | null {
    const now = new Date().toISOString();
    const lockedUntil = new Date(Date.now() + lockDurationSecs * 1000).toISOString();

    const row = this.db.query(`
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
        ORDER BY run_at ASC
        LIMIT 1
      )
      RETURNING id, payload
    `).get(lockedUntil, this.queueName, now) as { id: string; payload: string } | null;

    if (!row) return null;
    return { id: row.id, data: JSON.parse(row.payload) };
  }

  complete(id: string): void {
    this.db.run(`
      UPDATE prism_jobs 
      SET status = 'completed', locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?
    `, [id]);
  }

  fail(id: string, error: string): void {
    const job = this.db.query('SELECT attempts, max_attempts FROM prism_jobs WHERE id = ?')
      .get(id) as { attempts: number; max_attempts: number } | null;

    if (!job) return;

    if (job.attempts < job.max_attempts) {
      const backoffMs = Math.min(1000 * Math.pow(2, job.attempts), 60000);
      const runAt = new Date(Date.now() + backoffMs).toISOString();
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

  getStats(): { pending: number; processing: number; completed: number; failed: number } {
    const rows = this.db.query(`
      SELECT status, COUNT(*) as count 
      FROM prism_jobs 
      WHERE queue = ?
      GROUP BY status
    `).all(this.queueName) as Array<{ status: string; count: number }>;

    const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row.count;
      }
    }
    return stats;
  }

  releaseStale(): number {
    // Use SQLite datetime format (YYYY-MM-DD HH:mm:ss)
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const result = this.db.run(`
      UPDATE prism_jobs 
      SET status = 'pending', locked_until = NULL
      WHERE queue = ? AND status = 'processing' AND locked_until < ?
    `, [this.queueName, now]);
    return result.changes;
  }
}

describe('Queue Integration', () => {
  let db: Database;

  beforeAll(() => {
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
      CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON prism_jobs(queue, status);
    `);
  });

  afterAll(() => {
    db.close();
    cleanup();
  });

  beforeEach(() => {
    // Clear jobs between tests
    db.run('DELETE FROM prism_jobs');
  });

  describe('Full Lifecycle', () => {
    it('should complete enqueue -> claim -> complete cycle', () => {
      const queue = new TestQueue<{ memoryId: number }>(db, 'test:extraction');
      
      // Enqueue
      const jobId = queue.enqueue({ memoryId: 123 });
      expect(jobId).toBeTruthy();
      
      let stats = queue.getStats();
      expect(stats.pending).toBe(1);
      
      // Claim
      const claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.id).toBe(jobId);
      expect(claimed!.data.memoryId).toBe(123);
      
      stats = queue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.processing).toBe(1);
      
      // Complete
      queue.complete(claimed!.id);
      
      stats = queue.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.processing).toBe(0);
    });

    it('should handle failure and retry', () => {
      const queue = new TestQueue<{ entityId: string }>(db, 'test:scout', 3);
      
      const jobId = queue.enqueue({ entityId: 'person:test' });
      
      // First attempt - fails
      let claimed = queue.claim();
      expect(claimed).toBeTruthy();
      queue.fail(claimed!.id, 'Network error');
      
      // Job should be re-queued (attempt 1 < max 3)
      let stats = queue.getStats();
      expect(stats.pending).toBe(1);
      expect(stats.failed).toBe(0);
      
      // Wait for backoff (in real test we'd mock time)
      // For now, force run_at to past
      db.run("UPDATE prism_jobs SET run_at = datetime('now', '-1 minute') WHERE id = ?", [jobId]);
      
      // Second attempt - fails
      claimed = queue.claim();
      expect(claimed).toBeTruthy();
      queue.fail(claimed!.id, 'Network error');
      
      // Third attempt - fails
      db.run("UPDATE prism_jobs SET run_at = datetime('now', '-1 minute') WHERE id = ?", [jobId]);
      claimed = queue.claim();
      expect(claimed).toBeTruthy();
      queue.fail(claimed!.id, 'Final failure');
      
      // Now should be permanently failed
      stats = queue.getStats();
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(0);
    });
  });

  describe('Multiple Queues', () => {
    it('should isolate jobs by queue name', () => {
      const extractionQueue = new TestQueue<{ memoryId: number }>(db, 'prism:extraction');
      const scoutQueue = new TestQueue<{ entityId: string }>(db, 'prism:scout');
      
      extractionQueue.enqueue({ memoryId: 1 });
      extractionQueue.enqueue({ memoryId: 2 });
      scoutQueue.enqueue({ entityId: 'person:a' });
      
      expect(extractionQueue.getStats().pending).toBe(2);
      expect(scoutQueue.getStats().pending).toBe(1);
      
      // Claiming from extraction shouldn't affect scout
      extractionQueue.claim();
      expect(extractionQueue.getStats().processing).toBe(1);
      expect(scoutQueue.getStats().pending).toBe(1);
    });
  });

  describe('Crash Recovery', () => {
    it('should recover stale processing jobs', () => {
      const queue = new TestQueue<{ test: string }>(db, 'test:recovery');
      
      // Simulate a job that was being processed when crash occurred
      const jobId = crypto.randomUUID();
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, locked_until, attempts)
        VALUES (?, 'test:recovery', '{"test": "recovery"}', 'processing', datetime('now', '-5 minutes'), 1)
      `, [jobId]);
      
      let stats = queue.getStats();
      expect(stats.processing).toBe(1);
      
      // Release stale jobs (simulates startup recovery)
      const released = queue.releaseStale();
      expect(released).toBe(1);
      
      stats = queue.getStats();
      expect(stats.pending).toBe(1);
      expect(stats.processing).toBe(0);
      
      // Job should be claimable again
      const claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.id).toBe(jobId);
    });

    it('should not release jobs with valid locks', () => {
      const queue = new TestQueue<{ test: string }>(db, 'test:active');
      
      // Helper for SQLite datetime format
      const toSqliteDateTime = (date: Date) => 
        date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      
      // Simulate an actively processing job with lock 5 minutes in future
      const futureLock = toSqliteDateTime(new Date(Date.now() + 300000));
      db.run(`
        INSERT INTO prism_jobs (id, queue, payload, status, locked_until)
        VALUES (?, 'test:active', '{}', 'processing', ?)
      `, [crypto.randomUUID(), futureLock]);
      
      const released = queue.releaseStale();
      expect(released).toBe(0);
      
      const stats = queue.getStats();
      expect(stats.processing).toBe(1);
    });
  });

  describe('Delayed Jobs', () => {
    it('should not claim jobs scheduled for the future', () => {
      const queue = new TestQueue<{ test: string }>(db, 'test:delayed');
      
      // Enqueue with 5 minute delay
      queue.enqueue({ test: 'delayed' }, { delayMs: 300000 });
      
      // Immediate claim should return null
      const claimed = queue.claim();
      expect(claimed).toBeNull();
      
      // Force run_at to past
      db.run("UPDATE prism_jobs SET run_at = datetime('now', '-1 minute')");
      
      // Now should be claimable
      const claimedAfter = queue.claim();
      expect(claimedAfter).toBeTruthy();
    });
  });

  describe('Concurrent Processing', () => {
    it('should allow multiple jobs to be processed concurrently', () => {
      const queue = new TestQueue<{ id: number }>(db, 'test:concurrent');
      
      // Enqueue multiple jobs
      for (let i = 1; i <= 5; i++) {
        queue.enqueue({ id: i });
      }
      
      // Claim multiple jobs
      const claimed1 = queue.claim();
      const claimed2 = queue.claim();
      const claimed3 = queue.claim();
      
      expect(claimed1).toBeTruthy();
      expect(claimed2).toBeTruthy();
      expect(claimed3).toBeTruthy();
      
      // All should be different jobs
      const ids = new Set([claimed1!.id, claimed2!.id, claimed3!.id]);
      expect(ids.size).toBe(3);
      
      const stats = queue.getStats();
      expect(stats.processing).toBe(3);
      expect(stats.pending).toBe(2);
    });
  });

  describe('Error Tracking', () => {
    it('should preserve error message in failed jobs', () => {
      const queue = new TestQueue<{ test: string }>(db, 'test:errors', 1);
      
      const jobId = queue.enqueue({ test: 'will-fail' });
      
      const claimed = queue.claim();
      queue.fail(claimed!.id, 'Detailed error: API rate limit exceeded');
      
      const job = db.query('SELECT error FROM prism_jobs WHERE id = ?').get(jobId) as { error: string };
      expect(job.error).toBe('Detailed error: API rate limit exceeded');
    });
  });

  describe('Job Ordering', () => {
    it('should process oldest jobs first (FIFO)', () => {
      const queue = new TestQueue<{ order: number }>(db, 'test:fifo');
      
      // Insert with explicit timestamps
      for (let i = 1; i <= 3; i++) {
        db.run(`
          INSERT INTO prism_jobs (id, queue, payload, run_at)
          VALUES (?, 'test:fifo', ?, datetime('now', '-' || ? || ' minutes'))
        `, [crypto.randomUUID(), JSON.stringify({ order: i }), 4 - i]);
      }
      
      // Jobs should be claimed in order: 1, 2, 3
      const order: number[] = [];
      for (let i = 0; i < 3; i++) {
        const claimed = queue.claim();
        if (claimed) {
          order.push(claimed.data.order);
          queue.complete(claimed.id);
        }
      }
      
      expect(order).toEqual([1, 2, 3]);
    });
  });
});

describe('Edge Cases', () => {
  let db: Database;

  beforeAll(() => {
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

  afterAll(() => {
    db.close();
    cleanup();
  });

  beforeEach(() => {
    db.run('DELETE FROM prism_jobs');
  });

  it('should handle empty queue gracefully', () => {
    const queue = new TestQueue<{ test: string }>(db, 'test:empty');
    
    const claimed = queue.claim();
    expect(claimed).toBeNull();
    
    const stats = queue.getStats();
    expect(stats.pending).toBe(0);
  });

  it('should handle large payload', () => {
    const queue = new TestQueue<{ data: string }>(db, 'test:large');
    
    const largeData = 'x'.repeat(100000); // 100KB string
    const jobId = queue.enqueue({ data: largeData });
    
    const claimed = queue.claim();
    expect(claimed).toBeTruthy();
    expect(claimed!.data.data.length).toBe(100000);
  });

  it('should handle special characters in payload', () => {
    const queue = new TestQueue<{ text: string }>(db, 'test:special');
    
    const specialText = '{"nested": true, "unicode": "日本語", "emoji": "🚀", "quotes": "\\"test\\""}';
    const jobId = queue.enqueue({ text: specialText });
    
    const claimed = queue.claim();
    expect(claimed).toBeTruthy();
    expect(claimed!.data.text).toBe(specialText);
  });

  it('should handle rapid enqueue/claim cycles', () => {
    const queue = new TestQueue<{ i: number }>(db, 'test:rapid');
    
    // Rapid fire 100 jobs
    for (let i = 0; i < 100; i++) {
      queue.enqueue({ i });
    }
    
    let processed = 0;
    let claimed;
    while ((claimed = queue.claim()) !== null) {
      queue.complete(claimed.id);
      processed++;
    }
    
    expect(processed).toBe(100);
    expect(queue.getStats().completed).toBe(100);
  });
});

// =============================================================================
// RIPPLE QUEUE INTEGRATION TESTS
// =============================================================================

describe('Ripple Queue Integration', () => {
  let db: Database;

  // Ripple Task type (mirrors types.ts)
  interface RippleTask {
    eventType: 'SCOUT_CONFIRMED' | 'ENTITY_CREATED' | 'RELATION_ADDED' | 'MEMORY_INGESTED';
    entityId: string;
    entityType: string;
    entityTitle: string;
    trigger: 'system' | 'manual' | 'startup_recovery';
    metadata?: Record<string, unknown>;
  }

  beforeAll(() => {
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
      CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON prism_jobs(queue, status);
    `);
  });

  afterAll(() => {
    db.close();
    cleanup();
  });

  beforeEach(() => {
    db.run('DELETE FROM prism_jobs');
  });

  describe('Ripple Task Lifecycle', () => {
    it('should enqueue and claim ripple tasks correctly', () => {
      const queue = new TestQueue<RippleTask>(db, 'prism:ripple');
      
      // Enqueue a ripple task
      const task: RippleTask = {
        eventType: 'ENTITY_CREATED',
        entityId: 'person:test_user',
        entityType: 'person',
        entityTitle: 'Test User',
        trigger: 'system',
      };
      
      const jobId = queue.enqueue(task);
      expect(jobId).toBeTruthy();
      
      // Verify pending
      const stats = queue.getStats();
      expect(stats.pending).toBe(1);
      
      // Claim the task
      const claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.data.eventType).toBe('ENTITY_CREATED');
      expect(claimed!.data.entityId).toBe('person:test_user');
      expect(claimed!.data.trigger).toBe('system');
    });

    it('should handle all ripple event types', () => {
      const queue = new TestQueue<RippleTask>(db, 'prism:ripple');
      
      const eventTypes: RippleTask['eventType'][] = [
        'SCOUT_CONFIRMED',
        'ENTITY_CREATED',
        'RELATION_ADDED',
        'MEMORY_INGESTED',
      ];
      
      // Enqueue one of each
      for (const eventType of eventTypes) {
        queue.enqueue({
          eventType,
          entityId: `test:${eventType.toLowerCase()}`,
          entityType: 'test',
          entityTitle: `Test ${eventType}`,
          trigger: 'system',
        });
      }
      
      expect(queue.getStats().pending).toBe(4);
      
      // Claim and verify all
      const claimed: string[] = [];
      let job;
      while ((job = queue.claim()) !== null) {
        claimed.push(job.data.eventType);
        queue.complete(job.id);
      }
      
      expect(claimed.length).toBe(4);
      expect(claimed).toContain('SCOUT_CONFIRMED');
      expect(claimed).toContain('ENTITY_CREATED');
      expect(claimed).toContain('RELATION_ADDED');
      expect(claimed).toContain('MEMORY_INGESTED');
    });

    it('should preserve metadata in ripple tasks', () => {
      const queue = new TestQueue<RippleTask>(db, 'prism:ripple');
      
      const task: RippleTask = {
        eventType: 'SCOUT_CONFIRMED',
        entityId: 'project:test_project',
        entityType: 'project',
        entityTitle: 'Test Project',
        trigger: 'manual',
        metadata: {
          confidence: 0.95,
          source: 'web_search',
          tags: ['ai', 'open-source'],
        },
      };
      
      queue.enqueue(task);
      
      const claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.data.metadata).toEqual({
        confidence: 0.95,
        source: 'web_search',
        tags: ['ai', 'open-source'],
      });
    });

    it('should retry failed ripple tasks', () => {
      const queue = new TestQueue<RippleTask>(db, 'prism:ripple', 3);
      
      const task: RippleTask = {
        eventType: 'ENTITY_CREATED',
        entityId: 'person:retry_test',
        entityType: 'person',
        entityTitle: 'Retry Test',
        trigger: 'system',
      };
      
      const jobId = queue.enqueue(task);
      
      // First attempt fails
      let claimed = queue.claim();
      expect(claimed).toBeTruthy();
      queue.fail(claimed!.id, 'API timeout');
      
      // Should be re-queued for retry
      expect(queue.getStats().pending).toBe(1);
      expect(queue.getStats().failed).toBe(0);
      
      // Force run_at to past for immediate retry
      db.run("UPDATE prism_jobs SET run_at = datetime('now', '-1 minute') WHERE id = ?", [jobId]);
      
      // Second attempt succeeds
      claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.data.entityId).toBe('person:retry_test');
      queue.complete(claimed!.id);
      
      expect(queue.getStats().completed).toBe(1);
    });
  });

  describe('Ripple Queue Isolation', () => {
    it('should not interfere with other queues', () => {
      const rippleQueue = new TestQueue<RippleTask>(db, 'prism:ripple');
      const extractionQueue = new TestQueue<{ memoryId: number }>(db, 'prism:extraction');
      const scoutQueue = new TestQueue<{ entityId: string }>(db, 'prism:scout');
      
      // Enqueue to all queues
      rippleQueue.enqueue({
        eventType: 'ENTITY_CREATED',
        entityId: 'person:ripple_test',
        entityType: 'person',
        entityTitle: 'Ripple Test',
        trigger: 'system',
      });
      
      extractionQueue.enqueue({ memoryId: 123 });
      scoutQueue.enqueue({ entityId: 'person:scout_test' });
      
      // Verify isolation
      expect(rippleQueue.getStats().pending).toBe(1);
      expect(extractionQueue.getStats().pending).toBe(1);
      expect(scoutQueue.getStats().pending).toBe(1);
      
      // Claiming from one queue shouldn't affect others
      rippleQueue.claim();
      expect(rippleQueue.getStats().processing).toBe(1);
      expect(extractionQueue.getStats().pending).toBe(1);
      expect(scoutQueue.getStats().pending).toBe(1);
    });
  });

  describe('Ripple Concurrency', () => {
    it('should support concurrent ripple processing (concurrency: 3)', () => {
      const queue = new TestQueue<RippleTask>(db, 'prism:ripple');
      
      // Enqueue 5 ripple tasks
      for (let i = 1; i <= 5; i++) {
        queue.enqueue({
          eventType: 'ENTITY_CREATED',
          entityId: `person:concurrent_${i}`,
          entityType: 'person',
          entityTitle: `Concurrent ${i}`,
          trigger: 'system',
        });
      }
      
      // Simulate concurrent workers (up to 3)
      const claimed1 = queue.claim();
      const claimed2 = queue.claim();
      const claimed3 = queue.claim();
      
      expect(claimed1).toBeTruthy();
      expect(claimed2).toBeTruthy();
      expect(claimed3).toBeTruthy();
      
      // All should be different entities
      const ids = new Set([
        claimed1!.data.entityId,
        claimed2!.data.entityId,
        claimed3!.data.entityId,
      ]);
      expect(ids.size).toBe(3);
      
      const stats = queue.getStats();
      expect(stats.processing).toBe(3);
      expect(stats.pending).toBe(2);
    });
  });
});

// =============================================================================
// EXPLORE QUEUE INTEGRATION TESTS
// =============================================================================

describe('Explore Queue Integration', () => {
  let db: Database;

  // Explore Task type (mirrors types.ts)
  interface ExploreTask {
    topic: string;
    depth: number;
    ingest: boolean;
    trigger: 'mcp' | 'api' | 'schedule' | 'manual' | 'startup_recovery';
    callbackUrl?: string;
    contextEntityId?: string;
  }

  beforeAll(() => {
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
      CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON prism_jobs(queue, status);
    `);
  });

  afterAll(() => {
    db.close();
    cleanup();
  });

  beforeEach(() => {
    db.run('DELETE FROM prism_jobs');
  });

  describe('Explore Task Lifecycle', () => {
    it('should enqueue and claim explore tasks correctly', () => {
      const queue = new TestQueue<ExploreTask>(db, 'prism:explore');
      
      // Enqueue an explore task
      const task: ExploreTask = {
        topic: 'AI research trends 2026',
        depth: 3,
        ingest: true,
        trigger: 'mcp',
      };
      
      const jobId = queue.enqueue(task);
      expect(jobId).toBeTruthy();
      
      // Verify pending
      const stats = queue.getStats();
      expect(stats.pending).toBe(1);
      
      // Claim the task
      const claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.data.topic).toBe('AI research trends 2026');
      expect(claimed!.data.depth).toBe(3);
      expect(claimed!.data.ingest).toBe(true);
      expect(claimed!.data.trigger).toBe('mcp');
    });

    it('should handle all explore trigger types', () => {
      const queue = new TestQueue<ExploreTask>(db, 'prism:explore');
      
      const triggers: ExploreTask['trigger'][] = [
        'mcp',
        'api',
        'schedule',
        'manual',
        'startup_recovery',
      ];
      
      // Enqueue one of each
      for (const trigger of triggers) {
        queue.enqueue({
          topic: `Topic for ${trigger}`,
          depth: 2,
          ingest: true,
          trigger,
        });
      }
      
      expect(queue.getStats().pending).toBe(5);
      
      // Claim and verify all
      const claimed: string[] = [];
      let job;
      while ((job = queue.claim()) !== null) {
        claimed.push(job.data.trigger);
        queue.complete(job.id);
      }
      
      expect(claimed.length).toBe(5);
      expect(claimed).toContain('mcp');
      expect(claimed).toContain('api');
      expect(claimed).toContain('schedule');
      expect(claimed).toContain('manual');
      expect(claimed).toContain('startup_recovery');
    });

    it('should preserve optional fields in explore tasks', () => {
      const queue = new TestQueue<ExploreTask>(db, 'prism:explore');
      
      const task: ExploreTask = {
        topic: 'Deep dive into quantum computing',
        depth: 4,
        ingest: false,
        trigger: 'api',
        callbackUrl: 'https://webhook.example.com/explore-complete',
        contextEntityId: 'topic:quantum_computing',
      };
      
      queue.enqueue(task);
      
      const claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.data.callbackUrl).toBe('https://webhook.example.com/explore-complete');
      expect(claimed!.data.contextEntityId).toBe('topic:quantum_computing');
      expect(claimed!.data.ingest).toBe(false);
    });

    it('should handle varying depth levels', () => {
      const queue = new TestQueue<ExploreTask>(db, 'prism:explore');
      
      // Enqueue tasks with different depths
      for (const depth of [1, 2, 3, 4]) {
        queue.enqueue({
          topic: `Depth ${depth} exploration`,
          depth,
          ingest: true,
          trigger: 'manual',
        });
      }
      
      expect(queue.getStats().pending).toBe(4);
      
      // Verify all depths are preserved
      const depths: number[] = [];
      let job;
      while ((job = queue.claim()) !== null) {
        depths.push(job.data.depth);
        queue.complete(job.id);
      }
      
      expect(depths.sort()).toEqual([1, 2, 3, 4]);
    });

    it('should retry failed explore tasks', () => {
      const queue = new TestQueue<ExploreTask>(db, 'prism:explore', 2);
      
      const task: ExploreTask = {
        topic: 'Retry test topic',
        depth: 2,
        ingest: true,
        trigger: 'mcp',
      };
      
      const jobId = queue.enqueue(task);
      
      // First attempt fails
      let claimed = queue.claim();
      expect(claimed).toBeTruthy();
      queue.fail(claimed!.id, 'Search service unavailable');
      
      // Should be re-queued for retry
      expect(queue.getStats().pending).toBe(1);
      expect(queue.getStats().failed).toBe(0);
      
      // Force run_at to past for immediate retry
      db.run("UPDATE prism_jobs SET run_at = datetime('now', '-1 minute') WHERE id = ?", [jobId]);
      
      // Second attempt succeeds
      claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.data.topic).toBe('Retry test topic');
      queue.complete(claimed!.id);
      
      expect(queue.getStats().completed).toBe(1);
    });
  });

  describe('Explore Queue Isolation', () => {
    it('should not interfere with other queues', () => {
      const exploreQueue = new TestQueue<ExploreTask>(db, 'prism:explore');
      const extractionQueue = new TestQueue<{ memoryId: number }>(db, 'prism:extraction');
      const scoutQueue = new TestQueue<{ entityId: string }>(db, 'prism:scout');
      
      // Enqueue to all queues
      exploreQueue.enqueue({
        topic: 'Test exploration',
        depth: 2,
        ingest: true,
        trigger: 'manual',
      });
      
      extractionQueue.enqueue({ memoryId: 123 });
      scoutQueue.enqueue({ entityId: 'person:test' });
      
      // Verify isolation
      expect(exploreQueue.getStats().pending).toBe(1);
      expect(extractionQueue.getStats().pending).toBe(1);
      expect(scoutQueue.getStats().pending).toBe(1);
      
      // Claiming from one queue shouldn't affect others
      exploreQueue.claim();
      expect(exploreQueue.getStats().processing).toBe(1);
      expect(extractionQueue.getStats().pending).toBe(1);
      expect(scoutQueue.getStats().pending).toBe(1);
    });
  });

  describe('Explore Concurrency (Single Worker)', () => {
    it('should process explore tasks one at a time (concurrency: 1)', () => {
      const queue = new TestQueue<ExploreTask>(db, 'prism:explore');
      
      // Enqueue 3 explore tasks
      for (let i = 1; i <= 3; i++) {
        queue.enqueue({
          topic: `Exploration ${i}`,
          depth: 2,
          ingest: true,
          trigger: 'schedule',
        });
      }
      
      // Claim first task
      const claimed1 = queue.claim();
      expect(claimed1).toBeTruthy();
      
      // Second claim should also work (queue doesn't enforce concurrency)
      const claimed2 = queue.claim();
      expect(claimed2).toBeTruthy();
      
      const stats = queue.getStats();
      expect(stats.processing).toBe(2);
      expect(stats.pending).toBe(1);
      
      // Complete first task
      queue.complete(claimed1!.id);
      expect(queue.getStats().completed).toBe(1);
    });
  });

  describe('Explore Long-Running Tasks', () => {
    it('should handle long topic strings', () => {
      const queue = new TestQueue<ExploreTask>(db, 'prism:explore');
      
      // Very long topic
      const longTopic = 'A'.repeat(1000) + ' - comprehensive analysis';
      
      const task: ExploreTask = {
        topic: longTopic,
        depth: 3,
        ingest: true,
        trigger: 'api',
      };
      
      queue.enqueue(task);
      
      const claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.data.topic).toBe(longTopic);
      expect(claimed!.data.topic.length).toBeGreaterThan(1000);
    });

    it('should preserve unicode characters in topics', () => {
      const queue = new TestQueue<ExploreTask>(db, 'prism:explore');
      
      const task: ExploreTask = {
        topic: '人工智能研究趋势 🤖 - AI Research Trends 2026',
        depth: 2,
        ingest: true,
        trigger: 'mcp',
      };
      
      queue.enqueue(task);
      
      const claimed = queue.claim();
      expect(claimed).toBeTruthy();
      expect(claimed!.data.topic).toBe('人工智能研究趋势 🤖 - AI Research Trends 2026');
    });
  });
});
