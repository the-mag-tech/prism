/**
 * Extraction Module
 * 
 * Entity extraction from memories using AI.
 * 
 * Usage:
 * ```typescript
 * import { extractEntities, handleExtractionTask } from './lib/agents/extraction';
 * ```
 * 
 * @since 2026-01-08
 */

// Worker (for queue system)
export { handleExtractionTask } from './worker.js';

// Types
export type {
  ExtractedEntity,
  ExtractionResult,
  MemoryRow,
  ExtractOptions,
  ExtractResult,
  ExtractableType,
} from './types.js';

// Core extraction logic is still in extract.ts (root level)
// This is intentional - extract.ts is a shared utility used by multiple consumers
// The worker wraps it with queue + logging capabilities
