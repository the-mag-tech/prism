/**
 * Deep Explorer Types
 *
 * Core interfaces for the pluggable depth exploration system.
 * Implements the strategy pattern for different "depth" definitions.
 */

// =============================================================================
// FINDINGS (from search/LLM)
// =============================================================================

export interface Finding {
  title: string;
  url: string;
  content: string;
  source?: 'search' | 'llm';
}

// =============================================================================
// DEPTH SCORING
// =============================================================================

/**
 * Depth score - evaluated by strategy
 */
export interface DepthScore {
  /** Individual dimension scores */
  dimensions: Record<string, number>;
  /** Weighted total score */
  total: number;
  /** Current depth level (1-4) */
  level: number;
  /** Human-readable evaluation reason */
  reason: string;
}

/**
 * Dimension definition for strategies
 */
export interface DimensionDef {
  name: string;
  description: string;
  weight: number; // 0-1, should sum to 1
}

// =============================================================================
// EXPLORATION INTENT
// =============================================================================

/**
 * Parsed user intent - extracted before direction generation
 * 
 * Example: "惊天魔盗团中'人为控制下雨'的片段解读"
 * -> coreObject: "人为控制下雨的魔术场景"
 * -> context: "惊天魔盗团 (Now You See Me)"
 * -> desiredDepth: "scene_analysis"
 */
export interface ExplorationIntent {
  /** The specific thing user wants to explore */
  coreObject: string;
  /** Background/context for the core object */
  context: string;
  /** What kind of depth the user wants */
  desiredDepth: 'scene_analysis' | 'concept_exploration' | 'comparison' | 'deep_dive' | 'general';
  /** Original user query (preserved for anchoring) */
  originalQuery: string;
  /** Suggested search queries in English */
  searchQueries: string[];
}

// =============================================================================
// EXPLORATION CONTEXT
// =============================================================================

/**
 * Context passed to strategy during exploration
 */
export interface ExplorationContext {
  /** Parsed intent */
  intent: ExplorationIntent;
  /** Original topic/keyword */
  topic: string;
  /** Accumulated findings */
  findings: Finding[];
  /** Current depth level */
  currentLevel: number;
  /** Current exploration round */
  round: number;
}

// =============================================================================
// DEPTH CONFIGURATION
// =============================================================================

export interface DepthConfig {
  /** Target depth level (1-4) */
  targetLevel: number;
  /** Maximum exploration rounds */
  maxRounds: number;
  /** Number of parallel directions to explore */
  width: number;
}

export const DEFAULT_DEPTH_CONFIG: DepthConfig = {
  targetLevel: 3,
  maxRounds: 6,
  width: 5,
};

// =============================================================================
// STRATEGY INTERFACE
// =============================================================================

/**
 * Strategy output types
 */
export interface IronyOutput {
  type: 'irony';
  ironyPyramid: IronyLayer[];
  explosivePoint: string;
  oneLiner: string;
  story?: string;
}

export interface IronyLayer {
  level: number;
  description: string;
  evidence?: string;
}

export interface EvidenceOutput {
  type: 'evidence';
  sections: { title: string; content: string }[];
  citations: { title: string; url: string }[];
  confidence: number;
}

export type StrategyOutput = IronyOutput | EvidenceOutput;

/**
 * Core depth strategy interface
 * 
 * Each strategy defines:
 * - What "deep" means (dimensions)
 * - How to evaluate depth (evaluate)
 * - When exploration is complete (isComplete)
 * - Where to dig next (getNextDirections)
 * - How to format output (format)
 */
export interface IDepthStrategy {
  /** Strategy name */
  readonly name: string;

  /** Strategy description */
  readonly description: string;

  /** Evaluation dimensions with weights */
  readonly dimensions: DimensionDef[];

  /**
   * Evaluate current findings' depth
   */
  evaluate(findings: Finding[], intent: ExplorationIntent): Promise<DepthScore>;

  /**
   * Check if target depth is reached
   */
  isComplete(score: DepthScore, config: DepthConfig): boolean;

  /**
   * Get next search directions based on current context
   */
  getNextDirections(context: ExplorationContext): Promise<string[]>;

  /**
   * Format final output (anchored to original intent)
   */
  format(findings: Finding[], score: DepthScore, intent: ExplorationIntent): Promise<StrategyOutput>;
}

// =============================================================================
// DIRECTION TYPES
// =============================================================================

export interface ExplorationDirection {
  name: string;
  queries: string[];
}

export interface DirectionResult {
  name: string;
  findings: Finding[];
  rawContent: string;
}

export interface EvaluatedDirection extends DirectionResult {
  score: DepthScore;
}

// =============================================================================
// EXPLORE OPTIONS & RESULT
// =============================================================================

export interface ExploreOptions {
  strategy: IDepthStrategy;
  config: DepthConfig;
  ingest?: boolean; // NEW: Write high-quality findings to graph
  onProgress?: (status: ExploreStatus) => void;
}

export interface ExploreStatus {
  phase: 'intent' | 'explore' | 'evaluate' | 'deepen' | 'reflect' | 'format' | 'complete';
  message: string;
  round?: number;
  level?: number;
}

export interface ExploreResult {
  /** Parsed intent */
  intent: ExplorationIntent;
  /** Strategy used */
  strategy: string;
  /** Final depth score */
  score: DepthScore;
  /** Strategy-specific output */
  output: StrategyOutput;
  /** All evaluated directions */
  allDirections: EvaluatedDirection[];
  /** Winner direction */
  winner: EvaluatedDirection;
}

