/**
 * Prism Queue Types
 * 
 * Defines the task schemas for all background jobs in Prism.
 * Uses Zod for runtime validation and type safety.
 * 
 * @ref worker/checklist
 * @since 2026-01-07
 */

import { z } from 'zod';

// =============================================================================
// TASK SCHEMAS
// =============================================================================

/**
 * Extraction Task: Extract entities from a memory
 */
export const ExtractionTaskSchema = z.object({
  memoryId: z.number(),
  entityId: z.string().optional(),  // If re-extracting a specific entity
  priority: z.number().default(0),
  trigger: z.enum(['ingest', 'manual', 'retry', 'startup_recovery']).default('ingest'),
});
export type ExtractionTask = z.infer<typeof ExtractionTaskSchema>;
/** Input type for ExtractionTask (allows omitting fields with defaults) */
export type ExtractionTaskInput = z.input<typeof ExtractionTaskSchema>;

/**
 * Scout Task: Scout/research an entity
 * 
 * Trigger values:
 * - 'schedule': LOD-based scheduler tick
 * - 'manual': User-triggered via API
 * - 'ripple': Ripple system requesting scout
 * - 'hook': Entity Lifecycle Hook (new entity created)
 * - 'startup_recovery': Recovered from queue on startup
 */
export const ScoutTaskSchema = z.object({
  entityId: z.string(),
  entityTitle: z.string(),
  gravity: z.number().optional(),
  trigger: z.enum(['schedule', 'manual', 'ripple', 'hook', 'startup_recovery']).default('schedule'),
});
export type ScoutTask = z.infer<typeof ScoutTaskSchema>;
export type ScoutTaskInput = z.input<typeof ScoutTaskSchema>;

/**
 * Ripple Task: Propagate knowledge graph updates
 * 
 * Trigger values:
 * - 'system': Automated system trigger
 * - 'user': User action triggered
 * - 'scout': Scout system discovered new info
 * - 'startup_recovery': Recovered from queue on startup
 */
export const RippleTaskSchema = z.object({
  eventType: z.enum(['SCOUT_CONFIRMED', 'ENTITY_CREATED', 'RELATION_ADDED', 'MEMORY_INGESTED']),
  entityId: z.string(),
  entityType: z.string(),
  entityTitle: z.string(),
  trigger: z.enum(['system', 'user', 'scout', 'startup_recovery']).default('system'),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type RippleTask = z.infer<typeof RippleTaskSchema>;
export type RippleTaskInput = z.input<typeof RippleTaskSchema>;

/**
 * Curator Task: Run deduplication/merge analysis
 */
export const CuratorTaskSchema = z.object({
  scope: z.enum(['full', 'incremental']).default('incremental'),
  trigger: z.enum(['schedule', 'manual', 'startup_recovery']).default('schedule'),
});
export type CuratorTask = z.infer<typeof CuratorTaskSchema>;
export type CuratorTaskInput = z.input<typeof CuratorTaskSchema>;

/**
 * Explore Task: Deep exploration of a topic
 * 
 * Supports both sync (immediate return) and async (queue + callback) modes.
 */
export const ExploreTaskSchema = z.object({
  /** Topic to explore */
  topic: z.string(),
  /** Exploration depth (1-4), higher = deeper but slower */
  depth: z.number().min(1).max(4).default(2),
  /** Whether to ingest findings into the knowledge graph */
  ingest: z.boolean().default(true),
  /** Trigger source */
  trigger: z.enum(['mcp', 'api', 'schedule', 'manual', 'startup_recovery']).default('mcp'),
  /** Optional: callback URL to notify when complete */
  callbackUrl: z.string().optional(),
  /** Optional: entity ID to associate findings with */
  contextEntityId: z.string().optional(),
});
export type ExploreTask = z.infer<typeof ExploreTaskSchema>;
export type ExploreTaskInput = z.input<typeof ExploreTaskSchema>;

// =============================================================================
// QUEUE NAMES
// =============================================================================

export const QUEUE_NAMES = {
  EXTRACTION: 'prism:extraction',
  SCOUT: 'prism:scout',
  RIPPLE: 'prism:ripple',
  CURATOR: 'prism:curator',
  EXPLORE: 'prism:explore',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

// =============================================================================
// QUEUE CONFIG
// =============================================================================

export interface QueueConfig {
  /** Number of retries before marking as failed */
  numRetries: number;
  /** Keep failed jobs in DB for inspection */
  keepFailedJobs: boolean;
  /** Worker concurrency */
  concurrency: number;
  /** Poll interval in milliseconds */
  pollIntervalMs: number;
  /** Timeout in seconds */
  timeoutSecs: number;
}

export const DEFAULT_QUEUE_CONFIGS: Record<QueueName, QueueConfig> = {
  [QUEUE_NAMES.EXTRACTION]: {
    numRetries: 3,
    keepFailedJobs: true,
    concurrency: 2,
    pollIntervalMs: 5000,
    timeoutSecs: 300,  // 5 minutes
  },
  [QUEUE_NAMES.SCOUT]: {
    numRetries: 2,
    keepFailedJobs: true,
    concurrency: 1,  // Scout is API-heavy, keep low
    pollIntervalMs: 10000,
    timeoutSecs: 600,  // 10 minutes
  },
  [QUEUE_NAMES.RIPPLE]: {
    numRetries: 3,
    keepFailedJobs: true,
    concurrency: 3,
    pollIntervalMs: 2000,
    timeoutSecs: 60,
  },
  [QUEUE_NAMES.CURATOR]: {
    numRetries: 1,
    keepFailedJobs: true,
    concurrency: 1,
    pollIntervalMs: 30000,
    timeoutSecs: 300,
  },
  [QUEUE_NAMES.EXPLORE]: {
    numRetries: 2,
    keepFailedJobs: true,
    concurrency: 1,  // Deep exploration is resource-intensive
    pollIntervalMs: 10000,
    timeoutSecs: 900,  // 15 minutes (deep exploration can be slow)
  },
};
