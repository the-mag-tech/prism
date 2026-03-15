/**
 * Data Gap Detection Module
 *
 * @ref data-gap/system
 * @doc docs/DATA-GAP-DETECTION.md
 *
 * Exports:
 * - Detection functions
 * - Database operations
 * - Statistics
 */

export {
  // Types
  type DataGap,
  type GapDetectionResult,
  type GapStats,
  // Core detection
  detectGaps,
  detectGapsForEntities,
  detectHighPriorityGaps,
  // Database operations
  upsertGap,
  insertGaps,
  getOpenGaps,
  getAllOpenGaps,
  markGapFilled,
  markGapFilledByRelation,
  incrementSearchAttempts,
  markGapUnfillable,
  // Statistics
  getGapStats,
  // Integration
  detectAndStoreGaps,
  checkRelationFillsGap,
} from './detector.js';
