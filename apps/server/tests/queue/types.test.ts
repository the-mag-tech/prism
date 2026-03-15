/**
 * Queue Types & Schema Validation Tests
 * 
 * Tests Zod schema validation for all task types.
 * 
 * @since 2026-01-07
 */

import { describe, it, expect } from 'bun:test';
import {
  ExtractionTaskSchema,
  ScoutTaskSchema,
  RippleTaskSchema,
  CuratorTaskSchema,
  ExploreTaskSchema,
  QUEUE_NAMES,
  DEFAULT_QUEUE_CONFIGS,
  type ExtractionTask,
  type ScoutTask,
  type RippleTask,
  type CuratorTask,
  type ExploreTask,
} from '../../src/lib/queue/types.js';

describe('Queue Type Schemas', () => {
  describe('ExtractionTaskSchema', () => {
    it('should validate valid extraction task', () => {
      const task: ExtractionTask = {
        memoryId: 123,
        trigger: 'ingest',
        priority: 0,
      };
      
      const result = ExtractionTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it('should apply default values', () => {
      const task = { memoryId: 123 };
      
      const result = ExtractionTaskSchema.parse(task);
      expect(result.trigger).toBe('ingest');
      expect(result.priority).toBe(0);
    });

    it('should accept optional entityId', () => {
      const task = { memoryId: 123, entityId: 'person:test' };
      
      const result = ExtractionTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entityId).toBe('person:test');
      }
    });

    it('should reject invalid trigger values', () => {
      const task = { memoryId: 123, trigger: 'invalid' };
      
      const result = ExtractionTaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });

    it('should require memoryId', () => {
      const task = { trigger: 'ingest' };
      
      const result = ExtractionTaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });

    it('should reject non-numeric memoryId', () => {
      const task = { memoryId: 'abc' };
      
      const result = ExtractionTaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });
  });

  describe('ScoutTaskSchema', () => {
    it('should validate valid scout task', () => {
      const task: ScoutTask = {
        entityId: 'person:elon-musk',
        entityTitle: 'Elon Musk',
        trigger: 'schedule',
      };
      
      const result = ScoutTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it('should apply default trigger', () => {
      const task = { entityId: 'person:test', entityTitle: 'Test' };
      
      const result = ScoutTaskSchema.parse(task);
      expect(result.trigger).toBe('schedule');
    });

    it('should accept optional gravity', () => {
      const task = {
        entityId: 'person:test',
        entityTitle: 'Test',
        gravity: 0.85,
      };
      
      const result = ScoutTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.gravity).toBe(0.85);
      }
    });

    it('should require entityId and entityTitle', () => {
      const taskMissingId = { entityTitle: 'Test' };
      const taskMissingTitle = { entityId: 'person:test' };
      
      expect(ScoutTaskSchema.safeParse(taskMissingId).success).toBe(false);
      expect(ScoutTaskSchema.safeParse(taskMissingTitle).success).toBe(false);
    });

    it('should accept all valid trigger types', () => {
      const triggers = ['schedule', 'manual', 'ripple', 'hook', 'startup_recovery'] as const;
      
      for (const trigger of triggers) {
        const task = {
          entityId: 'person:test',
          entityTitle: 'Test',
          trigger,
        };
        const result = ScoutTaskSchema.safeParse(task);
        expect(result.success).toBe(true);
      }
    });

    it('should accept hook trigger from Entity Lifecycle Hooks', () => {
      const task = {
        entityId: 'person:test',
        entityTitle: 'Test Person',
        trigger: 'hook',
        gravity: 0.9,
      };
      
      const result = ScoutTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trigger).toBe('hook');
      }
    });
  });

  describe('RippleTaskSchema', () => {
    it('should validate valid ripple task', () => {
      const task: RippleTask = {
        eventType: 'SCOUT_CONFIRMED',
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test Person',
        trigger: 'system',
      };
      
      const result = RippleTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it('should accept all valid event types', () => {
      const eventTypes = ['SCOUT_CONFIRMED', 'ENTITY_CREATED', 'RELATION_ADDED', 'MEMORY_INGESTED'] as const;
      
      for (const eventType of eventTypes) {
        const task = {
          eventType,
          entityId: 'person:test',
          entityType: 'person',
          entityTitle: 'Test',
        };
        const result = RippleTaskSchema.safeParse(task);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid event types', () => {
      const task = {
        eventType: 'INVALID_EVENT',
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test',
      };
      
      const result = RippleTaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });

    it('should accept optional metadata', () => {
      const task = {
        eventType: 'ENTITY_CREATED',
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test',
        metadata: { source: 'manual', confidence: 0.9 },
      };
      
      const result = RippleTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata).toEqual({ source: 'manual', confidence: 0.9 });
      }
    });
  });

  describe('CuratorTaskSchema', () => {
    it('should validate valid curator task', () => {
      const task: CuratorTask = {
        scope: 'full',
        trigger: 'manual',
      };
      
      const result = CuratorTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it('should apply default values', () => {
      const task = {};
      
      const result = CuratorTaskSchema.parse(task);
      expect(result.scope).toBe('incremental');
      expect(result.trigger).toBe('schedule');
    });

    it('should accept all valid scope values', () => {
      const scopes = ['full', 'incremental'] as const;
      
      for (const scope of scopes) {
        const task = { scope };
        const result = CuratorTaskSchema.safeParse(task);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('ExploreTaskSchema', () => {
    it('should validate valid explore task', () => {
      const task: ExploreTask = {
        topic: 'AI research trends',
        depth: 3,
        ingest: true,
        trigger: 'mcp',
      };
      
      const result = ExploreTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it('should apply default values', () => {
      const task = { topic: 'test topic' };
      
      const result = ExploreTaskSchema.parse(task);
      expect(result.depth).toBe(2);
      expect(result.ingest).toBe(true);
      expect(result.trigger).toBe('mcp');
    });

    it('should require topic', () => {
      const task = { depth: 2 };
      
      const result = ExploreTaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });

    it('should validate depth range (1-4)', () => {
      // Valid depths
      for (const depth of [1, 2, 3, 4]) {
        const result = ExploreTaskSchema.safeParse({ topic: 'test', depth });
        expect(result.success).toBe(true);
      }
      
      // Invalid depths
      for (const depth of [0, 5, -1, 10]) {
        const result = ExploreTaskSchema.safeParse({ topic: 'test', depth });
        expect(result.success).toBe(false);
      }
    });

    it('should accept all valid trigger types', () => {
      const triggers = ['mcp', 'api', 'schedule', 'manual', 'startup_recovery'] as const;
      
      for (const trigger of triggers) {
        const task = { topic: 'test', trigger };
        const result = ExploreTaskSchema.safeParse(task);
        expect(result.success).toBe(true);
      }
    });

    it('should accept optional callbackUrl', () => {
      const task = {
        topic: 'test topic',
        callbackUrl: 'https://webhook.example.com/callback',
      };
      
      const result = ExploreTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.callbackUrl).toBe('https://webhook.example.com/callback');
      }
    });

    it('should accept optional contextEntityId', () => {
      const task = {
        topic: 'test topic',
        contextEntityId: 'person:elon_musk',
      };
      
      const result = ExploreTaskSchema.safeParse(task);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contextEntityId).toBe('person:elon_musk');
      }
    });

    it('should reject invalid trigger values', () => {
      const task = { topic: 'test', trigger: 'invalid_trigger' };
      
      const result = ExploreTaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });
  });
});

describe('Queue Names', () => {
  it('should have all required queue names', () => {
    expect(QUEUE_NAMES.EXTRACTION).toBe('prism:extraction');
    expect(QUEUE_NAMES.SCOUT).toBe('prism:scout');
    expect(QUEUE_NAMES.RIPPLE).toBe('prism:ripple');
    expect(QUEUE_NAMES.CURATOR).toBe('prism:curator');
    expect(QUEUE_NAMES.EXPLORE).toBe('prism:explore');
  });

  it('should have unique queue names', () => {
    const names = Object.values(QUEUE_NAMES);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });
});

describe('Default Queue Configs', () => {
  it('should have config for each queue', () => {
    for (const queueName of Object.values(QUEUE_NAMES)) {
      expect(DEFAULT_QUEUE_CONFIGS[queueName]).toBeDefined();
    }
  });

  it('should have valid config values', () => {
    for (const [name, config] of Object.entries(DEFAULT_QUEUE_CONFIGS)) {
      expect(config.numRetries).toBeGreaterThanOrEqual(1);
      expect(config.concurrency).toBeGreaterThanOrEqual(1);
      expect(config.pollIntervalMs).toBeGreaterThan(0);
      expect(config.timeoutSecs).toBeGreaterThan(0);
      expect(typeof config.keepFailedJobs).toBe('boolean');
    }
  });

  it('should have appropriate scout config (API-heavy, low concurrency)', () => {
    const scoutConfig = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.SCOUT];
    expect(scoutConfig.concurrency).toBe(1);
    expect(scoutConfig.pollIntervalMs).toBeGreaterThanOrEqual(10000);
  });

  it('should have appropriate extraction config', () => {
    const config = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.EXTRACTION];
    expect(config.numRetries).toBe(3);
    expect(config.timeoutSecs).toBe(300); // 5 minutes
  });

  it('should have appropriate ripple config (fast, high concurrency)', () => {
    const config = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.RIPPLE];
    expect(config.concurrency).toBeGreaterThan(1);
    expect(config.pollIntervalMs).toBeLessThan(5000);
  });

  it('should have appropriate explore config (resource-intensive, low concurrency, long timeout)', () => {
    const config = DEFAULT_QUEUE_CONFIGS[QUEUE_NAMES.EXPLORE];
    expect(config.concurrency).toBe(1);  // Resource-intensive
    expect(config.timeoutSecs).toBeGreaterThanOrEqual(600);  // At least 10 minutes
    expect(config.numRetries).toBe(2);
  });
});
