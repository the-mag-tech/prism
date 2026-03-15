/**
 * Irony Depth Strategy
 *
 * Defines "depth" as layers of irony - from surface to cosmic.
 * Extracted and refactored from adversarial.ts.
 *
 * Evaluation dimensions:
 * - surprise: Would a normal person say "wow"?
 * - storytelling: Are there characters/conflicts/twists?
 * - ironyDepth: Is there counter-intuitive insight?
 * - accessibility: Can non-experts understand?
 * - emotionalResonance: Does it evoke laughter/shock/awe?
 */

import { getOpenAI } from '../../../ai-clients.js';
import type {
  IDepthStrategy,
  DimensionDef,
  Finding,
  DepthScore,
  DepthConfig,
  ExplorationContext,
  IronyOutput,
  IronyLayer,
  ExplorationIntent,
} from '../types.js';

export class IronyDepthStrategy implements IDepthStrategy {
  readonly name = 'irony';
  readonly description = '挖掘讽刺深度，寻找反直觉的洞察';

  readonly dimensions: DimensionDef[] = [
    {
      name: 'surprise',
      description: '惊喜度：普通人会说"哇"吗？',
      weight: 0.2,
    },
    {
      name: 'storytelling',
      description: '故事性：有人物/冲突/转折吗？',
      weight: 0.2,
    },
    {
      name: 'ironyDepth',
      description: '讽刺深度：有反直觉的点吗？',
      weight: 0.25,
    },
    {
      name: 'accessibility',
      description: '易懂性：不懂技术能理解吗？',
      weight: 0.15,
    },
    {
      name: 'emotionalResonance',
      description: '情感共鸣：能引起笑/惊/叹吗？',
      weight: 0.2,
    },
  ];

  /**
   * Evaluate findings for irony depth
   */
  async evaluate(
    findings: Finding[],
    intent: ExplorationIntent,
  ): Promise<DepthScore> {
    const openai = getOpenAI();
    if (!openai) {
      // Return a neutral score if OpenAI is not available
      return {
        dimensions: Object.fromEntries(this.dimensions.map(d => [d.name, 0])),
        total: 0,
        level: 0,
        reason: 'OpenAI API key not configured - irony analysis skipped',
      };
    }
    
    const content = findings.map((f) => `${f.title}: ${f.content}`).join('\n\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `你是一个"讽刺深度评估器"。

用户想探索的核心对象: ${intent.coreObject}
背景上下文: ${intent.context}

当前发现的内容:
${content.substring(0, 4000)}

评估这些发现的讽刺深度 (0-10分):
1. surprise: 惊喜度 - 普通人看了会说"哇"吗？
2. storytelling: 故事性 - 有具体的人物/事件/冲突吗？
3. ironyDepth: 讽刺深度 - 有深层的矛盾/反转吗？
4. accessibility: 易懂性 - 不懂专业知识的人能理解吗？
5. emotionalResonance: 情感共鸣 - 能引起笑/惊/叹吗？

IMPORTANT: 评估时要聚焦在用户的核心对象 "${intent.coreObject}"，不是泛泛的背景。

输出 JSON:
{
  "surprise": 0-10,
  "storytelling": 0-10,
  "ironyDepth": 0-10,
  "accessibility": 0-10,
  "emotionalResonance": 0-10,
  "reason": "一句话评估理由"
}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');

    const dimensions: Record<string, number> = {
      surprise: result.surprise || 0,
      storytelling: result.storytelling || 0,
      ironyDepth: result.ironyDepth || 0,
      accessibility: result.accessibility || 0,
      emotionalResonance: result.emotionalResonance || 0,
    };

    const total = this.weightedSum(dimensions);
    const level = this.inferLevel(total);

    return {
      dimensions,
      total,
      level,
      reason: result.reason || '',
    };
  }

  /**
   * Check if target depth is reached
   */
  isComplete(score: DepthScore, config: DepthConfig): boolean {
    return score.level >= config.targetLevel;
  }

  /**
   * Get next search directions based on current level
   */
  async getNextDirections(context: ExplorationContext): Promise<string[]> {
    const { intent, currentLevel } = context;

    // Level-specific dig directions
    const directionsByLevel: Record<number, string[]> = {
      1: [
        `${intent.coreObject} origin story`,
        `${intent.coreObject} behind the scenes`,
      ],
      2: [
        `${intent.coreObject} controversy criticism`,
        `${intent.coreObject} failed attempt backfire`,
      ],
      3: [
        `${intent.coreObject} unexpected consequence irony`,
        `${intent.coreObject} deeper meaning symbolism`,
      ],
      4: [
        `${intent.coreObject} meta commentary absurd`,
        `${intent.coreObject} cosmic irony truth`,
      ],
    };

    const nextLevel = Math.min(currentLevel + 1, 4);
    return directionsByLevel[nextLevel] || [];
  }

  /**
   * Format output as irony pyramid (anchored to original intent)
   */
  async format(
    findings: Finding[],
    score: DepthScore,
    intent: ExplorationIntent,
  ): Promise<IronyOutput> {
    const content = findings.map((f) => `${f.title}: ${f.content}`).join('\n\n');

    const openai = getOpenAI();
    if (!openai) {
      throw new Error('OpenAI API key not configured');
    }
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `你是一个讽刺大师。

用户的原始问题: "${intent.originalQuery}"
核心探索对象: ${intent.coreObject}
背景上下文: ${intent.context}

相关发现:
${content.substring(0, 6000)}

构建一个"讽刺金字塔"，从表面到深层:

层级 1 (表面讽刺): 最容易看出的反差
层级 2 (结构讽刺): 设计上的矛盾
层级 3 (命运讽刺): 出乎意料的结果
层级 4 (宇宙讽刺): 最深层的荒诞

CRITICAL REQUIREMENTS:
1. 每一层都要聚焦在 "${intent.coreObject}"，不是泛泛的背景
2. 用普通人能理解的语言
3. 要有故事感，有具体的事件/证据
4. explosivePoint 和 oneLiner 必须回答用户的原始问题

输出 JSON:
{
  "ironyPyramid": [
    { "level": 1, "description": "...", "evidence": "..." },
    { "level": 2, "description": "...", "evidence": "..." },
    { "level": 3, "description": "...", "evidence": "..." },
    { "level": 4, "description": "...", "evidence": "..." }
  ],
  "explosivePoint": "最爆的那个点（必须关于 ${intent.coreObject}）",
  "oneLiner": "一句话总结（回答用户的问题）",
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
    };
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private weightedSum(dimensions: Record<string, number>): number {
    let sum = 0;
    for (const dim of this.dimensions) {
      sum += (dimensions[dim.name] || 0) * dim.weight;
    }
    // Scale to 0-50 range (5 dimensions * 10 max each)
    return sum * 10;
  }

  private inferLevel(total: number): number {
    // Level 1: Surface irony (total < 20)
    // Level 2: Structural irony (20-30)
    // Level 3: Fate irony (30-40)
    // Level 4: Cosmic irony (> 40)
    if (total < 20) return 1;
    if (total < 30) return 2;
    if (total < 40) return 3;
    return 4;
  }
}

// Singleton
export const ironyStrategy = new IronyDepthStrategy();

