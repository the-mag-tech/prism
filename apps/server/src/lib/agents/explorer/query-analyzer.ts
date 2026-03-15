/**
 * Query Analyzer
 *
 * Analyzes user queries to recommend optimal strategy configuration.
 * Detects query type, complexity, and domains to auto-configure the engine.
 *
 * Example:
 *   Input: "如果我在设计一个互动手势游戏，其中加入了惊天魔盗团中'人为控制下雨'这个元素"
 *   Output: {
 *     queryType: 'creation',
 *     complexity: 'complex',
 *     domains: ['game_design', 'film', 'interaction'],
 *     recommendedConfig: {
 *       mode: 'composite',
 *       strategies: [
 *         { name: 'irony', weight: 0.4 },
 *         { name: 'emotional', weight: 0.3 },
 *         { name: 'evidence', weight: 0.3 }
 *       ],
 *       targetLevel: 3,
 *       width: 5
 *     }
 *   }
 */

import { getOpenAI } from '../../ai-clients.js';
import { log, logError, logWarn } from '../../logger.js';
import type { DepthConfig } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

export type QueryType =
  | 'exploration'    // 纯探索：monkey, 什么是PKM
  | 'creation'       // 创作参考：设计游戏/写故事/做产品
  | 'research'       // 深度研究：学术/技术/方法论
  | 'comparison'     // 对比分析：A vs B
  | 'explanation';   // 解释说明：为什么X会Y

export type QueryComplexity = 'simple' | 'moderate' | 'complex';

export interface StrategyWeight {
  name: 'irony' | 'evidence' | 'emotional' | 'causal';
  weight: number;  // 0-1, should sum to 1
}

export type ExecutionOrder = 'parallel' | 'phased';

export interface CompositeMode {
  mode: 'single' | 'composite';
  /** For single mode */
  strategy?: string;
  /** For composite mode */
  strategies?: StrategyWeight[];
  /** Execution order for phased composite */
  executionOrder?: ExecutionOrder;
}

export interface RecommendedConfig extends CompositeMode {
  targetLevel: number;
  width: number;
  maxRounds: number;
}

export interface QueryAnalysis {
  /** Type of query */
  queryType: QueryType;
  /** Complexity level */
  complexity: QueryComplexity;
  /** Detected domains */
  domains: string[];
  /** Recommended engine configuration */
  recommendedConfig: RecommendedConfig;
  /** Reasoning for the recommendation */
  reasoning: string;
}

// =============================================================================
// QUERY ANALYZER
// =============================================================================

export class QueryAnalyzer {
  /**
   * Analyze query and recommend strategy configuration
   */
  async analyze(query: string): Promise<QueryAnalysis> {
    const openai = getOpenAI();
    if (!openai) {
      // Return default analysis if OpenAI not available
      return {
        queryType: 'exploration',
        complexity: 'simple',
        domains: [],
        recommendedConfig: {
          mode: 'single',
          strategy: 'evidence',
          targetLevel: 2,
          width: 3,
          maxRounds: 4,
        },
        reasoning: 'OpenAI not configured - using default strategy',
      };
    }
    
    log(`\n[QueryAnalyzer] 🔬 Analyzing: "${query.substring(0, 50)}..."`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are the "Prism Splitter" (Query Analyzer).
Your goal is to detect the user's "Blind Spot" and recommend the best Deep Explorer strategy to illuminate it.

The 4 Dimensions of Blind Spot:
1. Structural (Logic) -> Causal Strategy
   - Symptom: User asks "Why?", "How works?", "Mechanism", "Impact".
2. Emotional (Humanity) -> Emotional Strategy
   - Symptom: User asks "Story", "Person", "Feeling", "Biopic", "Meaning".
3. Factual (Evidence) -> Evidence Strategy
   - Symptom: User asks "Truth", "Proof", "Data", "Research", "Stats", "Academic".
4. Irony (Contradiction) -> Irony Strategy
   - Symptom: User asks "Surprise", "Fun", "Critique", "Insight", "Paradox", or generic exploration.

Analyze the user's query:

1. **queryType**:
   - exploration (Irony/General)
   - creation (Emotional/Composite)
   - research (Evidence/Causal)
   - explanation (Causal)
   - comparison (Evidence/Causal)

2. **complexity**: simple | moderate | complex

3. **domains**: [list of domains]

4. **recommendedConfig**:
   - mode: 'single' | 'composite'
   - strategy: 'irony' | 'evidence' | 'emotional' | 'causal'
   - strategies: [{name, weight}] (for composite)
   - executionOrder: 'parallel' | 'phased'
   - targetLevel: 1-4
   - width: 3-7

Example:
"Why did the 2008 crisis happen?"
-> Missing Mechanism (Structural Blind Spot) -> Causal Strategy.

"Tell me the story of Steve Jobs."
-> Missing Humanity (Emotional Blind Spot) -> Emotional Strategy.

"Is the earth flat? Prove it."
-> Missing Proof (Factual Blind Spot) -> Evidence Strategy.

"Boring stuff about taxes."
-> Missing Surprise (Irony Blind Spot) -> Irony Strategy.

Output JSON only:
{
  "queryType": "...",
  "complexity": "...",
  "domains": [...],
  "recommendedConfig": { ... },
  "reasoning": "Detected [Type] Blind Spot, recommending [Strategy]..."
}`,
        },
        {
          role: 'user',
          content: query,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');

    const analysis: QueryAnalysis = {
      queryType: this.validateQueryType(result.queryType),
      complexity: this.validateComplexity(result.complexity),
      domains: result.domains || [],
      recommendedConfig: this.validateConfig(result.recommendedConfig),
      reasoning: result.reasoning || '',
    };

    log(`[QueryAnalyzer]    Type: ${analysis.queryType}`);
    log(`[QueryAnalyzer]    Complexity: ${analysis.complexity}`);
    log(`[QueryAnalyzer]    Domains: ${analysis.domains.join(', ')}`);
    log(`[QueryAnalyzer]    Mode: ${analysis.recommendedConfig.mode}`);
    if (analysis.recommendedConfig.mode === 'composite') {
      const weights = analysis.recommendedConfig.strategies!
        .map(s => `${s.name}:${(s.weight * 100).toFixed(0)}%`)
        .join(' + ');
      log(`[QueryAnalyzer]    Strategies: ${weights}`);
    }

    return analysis;
  }

  /**
   * Quick analysis without LLM (for simple queries)
   */
  analyzeSimple(query: string): QueryAnalysis {
    // Detect creation intent
    const creationKeywords = ['设计', '创作', '写', '做', '建', '开发', 'design', 'create', 'build'];
    const isCreation = creationKeywords.some(k => query.includes(k));

    // Detect research intent
    const researchKeywords = ['研究', '学术', '论文', '方法', 'research', 'academic', 'study'];
    const isResearch = researchKeywords.some(k => query.includes(k));

    // Detect comparison
    const comparisonKeywords = ['对比', '比较', 'vs', '还是', '哪个', 'compare'];
    const isComparison = comparisonKeywords.some(k => query.includes(k));

    // Detect complexity by query length and special markers
    const hasQuotes = /['"""''"]/.test(query);
    const hasMultipleConcepts = query.length > 30;

    let queryType: QueryType = 'exploration';
    let complexity: QueryComplexity = 'simple';
    let config: RecommendedConfig;

    if (isCreation) {
      queryType = 'creation';
      complexity = hasQuotes ? 'complex' : 'moderate';
      config = {
        mode: 'composite',
        strategies: [
          { name: 'irony', weight: 0.4 },
          { name: 'emotional', weight: 0.3 },
          { name: 'evidence', weight: 0.3 },
        ],
        executionOrder: 'parallel',
        targetLevel: 3,
        width: 5,
        maxRounds: 6,
      };
    } else if (isResearch) {
      queryType = 'research';
      complexity = 'moderate';
      config = {
        mode: 'composite',
        strategies: [
          { name: 'evidence', weight: 0.6 },
          { name: 'causal', weight: 0.2 },
          { name: 'irony', weight: 0.2 },
        ],
        executionOrder: 'phased',
        targetLevel: 4,
        width: 5,
        maxRounds: 8,
      };
    } else if (isComparison) {
      queryType = 'comparison';
      complexity = 'moderate';
      config = {
        mode: 'composite',
        strategies: [
          { name: 'evidence', weight: 0.5 },
          { name: 'causal', weight: 0.5 },
        ],
        executionOrder: 'parallel',
        targetLevel: 3,
        width: 4,
        maxRounds: 6,
      };
    } else {
      // Default: exploration with irony
      queryType = 'exploration';
      complexity = hasMultipleConcepts ? 'moderate' : 'simple';
      config = {
        mode: 'single',
        strategy: 'irony',
        targetLevel: complexity === 'simple' ? 2 : 3,
        width: complexity === 'simple' ? 4 : 5,
        maxRounds: 4,
      };
    }

    return {
      queryType,
      complexity,
      domains: [],
      recommendedConfig: config,
      reasoning: 'Quick analysis based on keywords',
    };
  }

  // =============================================================================
  // VALIDATION HELPERS
  // =============================================================================

  private validateQueryType(raw: string | undefined): QueryType {
    const valid: QueryType[] = ['exploration', 'creation', 'research', 'comparison', 'explanation'];
    return valid.includes(raw as QueryType) ? (raw as QueryType) : 'exploration';
  }

  private validateComplexity(raw: string | undefined): QueryComplexity {
    const valid: QueryComplexity[] = ['simple', 'moderate', 'complex'];
    return valid.includes(raw as QueryComplexity) ? (raw as QueryComplexity) : 'moderate';
  }

  private validateConfig(raw: any): RecommendedConfig {
    if (!raw) {
      return {
        mode: 'single',
        strategy: 'irony',
        targetLevel: 3,
        width: 5,
        maxRounds: 6,
      };
    }

    const config: RecommendedConfig = {
      mode: raw.mode === 'composite' ? 'composite' : 'single',
      targetLevel: Math.min(Math.max(raw.targetLevel || 3, 1), 4),
      width: Math.min(Math.max(raw.width || 5, 3), 7),
      maxRounds: Math.min(Math.max(raw.maxRounds || 6, 4), 10),
    };

    if (config.mode === 'single') {
      config.strategy = raw.strategy || 'irony';
    } else {
      config.strategies = this.validateStrategies(raw.strategies);
      config.executionOrder = raw.executionOrder === 'phased' ? 'phased' : 'parallel';
    }

    return config;
  }

  private validateStrategies(raw: any[]): StrategyWeight[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      return [{ name: 'irony', weight: 1.0 }];
    }

    const validNames = ['irony', 'evidence', 'emotional', 'causal'];
    const strategies = raw
      .filter(s => s && validNames.includes(s.name))
      .map(s => ({
        name: s.name as StrategyWeight['name'],
        weight: Math.max(0, Math.min(1, s.weight || 0)),
      }));

    // Normalize weights to sum to 1
    const totalWeight = strategies.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight > 0) {
      strategies.forEach(s => (s.weight /= totalWeight));
    }

    return strategies.length > 0 ? strategies : [{ name: 'irony', weight: 1.0 }];
  }
}

// Singleton
export const queryAnalyzer = new QueryAnalyzer();

