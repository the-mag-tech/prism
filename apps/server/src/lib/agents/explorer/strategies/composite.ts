/**
 * Composite Depth Strategy
 *
 * Combines multiple strategies with configurable weights.
 * Supports two execution modes:
 * - parallel: All strategies evaluate simultaneously, scores are weighted-averaged
 * - phased: Strategies execute in order, each building on previous findings
 *
 * Example:
 *   const composite = new CompositeStrategy([
 *     { strategy: ironyStrategy, weight: 0.4 },
 *     { strategy: evidenceStrategy, weight: 0.3 },
 *     { strategy: emotionalStrategy, weight: 0.3 },
 *   ], 'parallel');
 */

import type {
  IDepthStrategy,
  DimensionDef,
  Finding,
  DepthScore,
  DepthConfig,
  ExplorationContext,
  StrategyOutput,
  IronyOutput,
  IronyLayer,
  ExplorationIntent,
} from '../types.js';
import { getOpenAI } from '../../../ai-clients.js';
import { log, logError, logWarn } from '../../../logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface WeightedStrategy {
  strategy: IDepthStrategy;
  weight: number;  // 0-1, should sum to 1
}

export type ExecutionOrder = 'parallel' | 'phased';

// =============================================================================
// COMPOSITE STRATEGY
// =============================================================================

export class CompositeStrategy implements IDepthStrategy {
  readonly name: string;
  readonly description: string;
  readonly dimensions: DimensionDef[];

  private strategies: WeightedStrategy[];
  private executionOrder: ExecutionOrder;

  constructor(
    strategies: WeightedStrategy[],
    executionOrder: ExecutionOrder = 'parallel',
  ) {
    this.strategies = strategies;
    this.executionOrder = executionOrder;
    // Removed: this.openai is not used, use getOpenAI() instead

    // Generate name from component strategies
    this.name = strategies.map(s => s.strategy.name).join('+');
    this.description = `Composite strategy combining: ${strategies.map(s => `${s.strategy.name} (${(s.weight * 100).toFixed(0)}%)`).join(', ')}`;

    // Merge dimensions from all strategies (unique by name)
    const dimMap = new Map<string, DimensionDef>();
    for (const ws of strategies) {
      for (const dim of ws.strategy.dimensions) {
        if (!dimMap.has(dim.name)) {
          dimMap.set(dim.name, {
            ...dim,
            weight: dim.weight * ws.weight,  // Scale by strategy weight
          });
        } else {
          // Add weights for same dimension
          const existing = dimMap.get(dim.name)!;
          existing.weight += dim.weight * ws.weight;
        }
      }
    }
    this.dimensions = Array.from(dimMap.values());

    log(`[CompositeStrategy] Created: ${this.name} (${executionOrder})`);
  }

  /**
   * Evaluate using weighted combination of strategies
   */
  async evaluate(findings: Finding[], intent: ExplorationIntent): Promise<DepthScore> {
    log(`[CompositeStrategy] Evaluating with ${this.strategies.length} strategies...`);

    if (this.executionOrder === 'parallel') {
      return this.evaluateParallel(findings, intent);
    } else {
      return this.evaluatePhased(findings, intent);
    }
  }

  /**
   * Parallel evaluation: all strategies score simultaneously
   */
  private async evaluateParallel(
    findings: Finding[],
    intent: ExplorationIntent,
  ): Promise<DepthScore> {
    // Get scores from all strategies in parallel
    const scorePromises = this.strategies.map(async ws => ({
      weight: ws.weight,
      score: await ws.strategy.evaluate(findings, intent),
    }));

    const results = await Promise.all(scorePromises);

    // Weighted average of dimensions
    const mergedDimensions: Record<string, number> = {};
    let totalScore = 0;
    let maxLevel = 0;
    const reasons: string[] = [];

    for (const { weight, score } of results) {
      totalScore += score.total * weight;
      maxLevel = Math.max(maxLevel, score.level);
      reasons.push(score.reason);

      for (const [dimName, dimValue] of Object.entries(score.dimensions)) {
        if (!mergedDimensions[dimName]) {
          mergedDimensions[dimName] = 0;
        }
        mergedDimensions[dimName] += dimValue * weight;
      }
    }

    return {
      dimensions: mergedDimensions,
      total: totalScore,
      level: maxLevel,
      reason: reasons.filter(r => r).join(' | '),
    };
  }

  /**
   * Phased evaluation: strategies execute in order
   * Each builds on accumulated findings
   */
  private async evaluatePhased(
    findings: Finding[],
    intent: ExplorationIntent,
  ): Promise<DepthScore> {
    let lastScore: DepthScore | null = null;
    const allDimensions: Record<string, number> = {};
    let totalScore = 0;
    const reasons: string[] = [];

    for (const ws of this.strategies) {
      const score = await ws.strategy.evaluate(findings, intent);
      
      totalScore += score.total * ws.weight;
      reasons.push(`[${ws.strategy.name}] ${score.reason}`);

      for (const [dimName, dimValue] of Object.entries(score.dimensions)) {
        if (!allDimensions[dimName]) {
          allDimensions[dimName] = 0;
        }
        allDimensions[dimName] += dimValue * ws.weight;
      }

      lastScore = score;
    }

    return {
      dimensions: allDimensions,
      total: totalScore,
      level: lastScore?.level || 1,
      reason: reasons.join(' → '),
    };
  }

  /**
   * Check if complete based on weighted consensus
   */
  isComplete(score: DepthScore, config: DepthConfig): boolean {
    // Complete if average level meets target
    return score.level >= config.targetLevel;
  }

  /**
   * Get next directions by consulting all strategies
   */
  async getNextDirections(context: ExplorationContext): Promise<string[]> {
    // Gather directions from all strategies
    const allDirections: string[] = [];

    for (const ws of this.strategies) {
      const dirs = await ws.strategy.getNextDirections(context);
      // Add weighted number of directions
      const numToTake = Math.ceil(dirs.length * ws.weight);
      allDirections.push(...dirs.slice(0, numToTake));
    }

    // Deduplicate
    return [...new Set(allDirections)];
  }

  /**
   * Format output - synthesize from all strategies
   * For now, output as IronyOutput for compatibility
   */
  async format(
    findings: Finding[],
    score: DepthScore,
    intent: ExplorationIntent,
  ): Promise<StrategyOutput> {
    // For composite, we synthesize a unified output
    // Currently returns IronyOutput for UI compatibility
    
    const content = findings.map(f => `${f.title}: ${f.content}`).join('\n\n');
    const strategyNames = this.strategies.map(s => s.strategy.name).join(', ');

    const openai = getOpenAI();
    if (!openai) {
      throw new Error('OpenAI API key not configured');
    }
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `你是一个综合分析大师，擅长融合多种视角。

用户的原始问题: "${intent.originalQuery}"
核心探索对象: ${intent.coreObject}
背景上下文: ${intent.context}

使用的策略组合: ${strategyNames}
评估维度得分:
${Object.entries(score.dimensions).map(([k, v]) => `- ${k}: ${v.toFixed(1)}`).join('\n')}

相关发现:
${content.substring(0, 6000)}

请综合以上多个视角，构建一个"讽刺金字塔"：

层级 1 (表面洞察): 最直接的发现
层级 2 (结构洞察): 设计/机制层面的发现
层级 3 (意外洞察): 出乎意料的关联
层级 4 (深层洞察): 最深刻的理解

CRITICAL REQUIREMENTS:
1. 每一层都要聚焦在 "${intent.coreObject}"
2. 综合 ${strategyNames} 的不同视角
3. explosivePoint 应该是最有价值的综合洞察
4. oneLiner 必须直接回答用户的问题

输出 JSON:
{
  "ironyPyramid": [
    { "level": 1, "description": "...", "evidence": "..." },
    { "level": 2, "description": "...", "evidence": "..." },
    { "level": 3, "description": "...", "evidence": "..." },
    { "level": 4, "description": "...", "evidence": "..." }
  ],
  "explosivePoint": "最有价值的综合洞察",
  "oneLiner": "一句话回答用户问题",
  "story": "可选：完整的故事版本"
}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');

    return {
      type: 'irony',
      ironyPyramid: (result.ironyPyramid || []).map((layer: IronyLayer) => ({
        level: layer.level,
        description: layer.description,
        evidence: layer.evidence,
      })),
      explosivePoint: result.explosivePoint || '',
      oneLiner: result.oneLiner || '',
      story: result.story,
    } as IronyOutput;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

import { ironyStrategy } from './irony.js';

/**
 * Create a composite strategy from weight specifications
 */
export function createCompositeStrategy(
  weights: Array<{ name: string; weight: number }>,
  executionOrder: ExecutionOrder = 'parallel',
): CompositeStrategy {
  // Map strategy names to implementations
  const strategyMap: Record<string, IDepthStrategy> = {
    irony: ironyStrategy,
    // Future strategies will be added here:
    // evidence: evidenceStrategy,
    // emotional: emotionalStrategy,
    // causal: causalStrategy,
  };

  const weightedStrategies: WeightedStrategy[] = [];

  for (const { name, weight } of weights) {
    const strategy = strategyMap[name];
    if (strategy) {
      weightedStrategies.push({ strategy, weight });
    } else {
      logWarn(`[CompositeStrategy] Unknown strategy: ${name}, using irony as fallback`);
      weightedStrategies.push({ strategy: ironyStrategy, weight });
    }
  }

  // Fallback if no valid strategies
  if (weightedStrategies.length === 0) {
    weightedStrategies.push({ strategy: ironyStrategy, weight: 1.0 });
  }

  return new CompositeStrategy(weightedStrategies, executionOrder);
}

