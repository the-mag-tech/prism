/**
 * Curator Module
 * 
 * Knowledge graph structure maintenance:
 * - Entity deduplication
 * - Memory deduplication
 * - Merge management
 * - Trust metrics
 * 
 * NOTE: Previously named "Gardener", renamed to align with Tribe semantics.
 * @see TRIBE-STYLES.md for the distinction between Curator and Gardener roles.
 */

// Agent
export { CuratorAgent, GardenerAgent } from './agent.js';
export type { CuratorReport, GardenerReport } from './agent.js';

// Service
export {
  startCuratorService,
  stopCuratorService,
  isCuratorBusy,
  getCuratorMetrics,
  triggerCycle,
  getLastReport,
  // Legacy aliases
  startGardenerService,
  stopGardenerService,
  isGardenerBusy,
  getGardenerMetrics,
} from './service.js';

// Deduplicator
export { DeduplicatorService } from './deduplicator.js';
export type { SimilarityPair, MergeCandidate, MemoryDuplicate } from './deduplicator.js';

// Merger
export { MergerService } from './merger.js';
export type { MergeResult, MergeHistoryEntry } from './merger.js';

// Trust Metrics
export { TrustMetrics } from './trust-metrics.js';
export type { TrustMetricRecord } from './trust-metrics.js';





