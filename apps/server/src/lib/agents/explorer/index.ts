import { log, logError, logWarn } from '../../logger.js';

/**
 * Deep Explorer Module
 *
 * A pluggable depth exploration system with:
 * - Intent extraction (understand what user really wants)
 * - Query analysis (auto-configure strategy based on query type)
 * - Strategy pattern (different definitions of "deep")
 * - Composite strategies (weighted multi-strategy)
 * - Forced reflection loop (iterative deepening)
 *
 * Usage:
 * ```typescript
 * import { deepExplorer } from './lib/agents/explorer';
 *
 * // Auto mode (recommended) - analyzes query and auto-configures
 * const result = await deepExplorer.exploreAuto('设计游戏 + 人为控制下雨');
 *
 * // Manual mode - explicit strategy
 * const result = await deepExplorer.explore('monkey', {
 *   strategy: ironyStrategy,
 *   config: { targetLevel: 3, width: 5, maxRounds: 6 },
 * });
 * ```
 */

// Engine
export { DeepExplorer, deepExplorer, type AutoExploreResult } from './engine.js';

// Intent Extraction
export { IntentExtractor, intentExtractor } from './intent-extractor.js';

// Query Analysis
export { 
  QueryAnalyzer, 
  queryAnalyzer,
  type QueryType,
  type QueryComplexity,
  type StrategyWeight,
  type CompositeMode,
  type RecommendedConfig,
  type QueryAnalysis,
} from './query-analyzer.js';

// Strategies
export { IronyDepthStrategy, ironyStrategy } from './strategies/irony.js';
export { 
  CompositeStrategy, 
  createCompositeStrategy,
  type WeightedStrategy,
  type ExecutionOrder,
} from './strategies/composite.js';

// Types
export type {
  // Core types
  Finding,
  DepthScore,
  DimensionDef,
  DepthConfig,
  
  // Intent
  ExplorationIntent,
  ExplorationContext,
  
  // Strategy
  IDepthStrategy,
  StrategyOutput,
  IronyOutput,
  IronyLayer,
  EvidenceOutput,
  
  // Direction
  ExplorationDirection,
  DirectionResult,
  EvaluatedDirection,
  
  // Explore
  ExploreOptions,
  ExploreStatus,
  ExploreResult,
} from './types.js';

export { DEFAULT_DEPTH_CONFIG } from './types.js';

// =============================================================================
// STRATEGY FACTORY
// =============================================================================

import { ironyStrategy } from './strategies/irony.js';
import { createCompositeStrategy } from './strategies/composite.js';
import type { IDepthStrategy } from './types.js';
import type { StrategyWeight, ExecutionOrder } from './query-analyzer.js';

/**
 * Get strategy by name or create composite from weights
 */
export function getStrategy(
  name: string | 'auto',
  weights?: StrategyWeight[],
  executionOrder?: ExecutionOrder,
): IDepthStrategy {
  // If weights provided, create composite
  if (weights && weights.length > 0) {
    return createCompositeStrategy(weights, executionOrder || 'parallel');
  }

  // Single strategy by name
  switch (name) {
    case 'irony':
      return ironyStrategy;
    // Future strategies:
    // case 'evidence':
    //   return evidenceStrategy;
    // case 'emotional':
    //   return emotionalStrategy;
    // case 'causal':
    //   return causalStrategy;
    case 'auto':
      // Auto mode should use exploreAuto, not getStrategy
      logWarn('[DeepExplorer] "auto" strategy requires exploreAuto(), falling back to irony');
      return ironyStrategy;
    default:
      logWarn(`[DeepExplorer] Unknown strategy "${name}", falling back to irony`);
      return ironyStrategy;
  }
}

