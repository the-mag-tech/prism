/**
 * Emotional Depth Strategy
 *
 * Evaluation dimensions:
 * - characterArc: Is there a person/entity changing over time?
 * - conflictIntensity: Is there struggle/tension?
 * - empathy: Does it make you feel for them?
 * - resonance: Does it touch on universal themes?
 */

import { getOpenAI } from '../../../ai-clients.js';
import type {
    IDepthStrategy,
    DimensionDef,
    Finding,
    DepthScore,
    DepthConfig,
    ExplorationContext,
    StrategyOutput,
    ExplorationIntent,
} from '../types.js';

export interface EmotionalOutput {
    type: 'emotional';
    protagonist: string;
    conflict: string;
    journey: string;
    emotionalTheme: string;
}

export class EmotionalDepthStrategy implements IDepthStrategy {
    readonly name = 'emotional';
    readonly description = '挖掘情感深度，寻找打动人心的故事';

    readonly dimensions: DimensionDef[] = [
        { name: 'characterArc', description: '人物弧光：是否有成长/变化', weight: 0.25 },
        { name: 'conflictIntensity', description: '冲突强度：困难/挑战', weight: 0.25 },
        { name: 'empathy', description: '共情：能否引发同情', weight: 0.25 },
        { name: 'resonance', description: '共鸣：是否触及普遍人性', weight: 0.25 },
    ];

    async evaluate(
        findings: Finding[],
        intent: ExplorationIntent,
    ): Promise<DepthScore> {
        const openai = getOpenAI();
        if (!openai) {
            return {
                dimensions: Object.fromEntries(this.dimensions.map(d => [d.name, 0])),
                total: 0,
                level: 0,
                reason: 'OpenAI API key not configured - emotional analysis skipped',
            };
        }
        
        const content = findings.map((f) => `${f.title}: ${f.content}`).join('\n\n');

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: `You are a "Story Evaluator".

Core Object: ${intent.coreObject}
Context: ${intent.context}

Findings:
${content.substring(0, 4000)}

Evaluate the EMOTIONAL DEPTH (0-10):
1. characterArc: Is there a clear protagonist (person/team) who changes/grows/fails?
2. conflictIntensity: Is there a significant struggle, antagonist, or obstacle?
3. empathy: Does the content generate emotional connection (joy, sadness, pity)?
4. resonance: Does it touch on universal human themes (love, loss, ambition, betrayal)?

Output JSON:
{
  "characterArc": 0-10,
  "conflictIntensity": 0-10,
  "empathy": 0-10,
  "resonance": 0-10,
  "reason": "One sentence reason"
}`,
                },
            ],
            response_format: { type: 'json_object' },
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');

        const dimensions: Record<string, number> = {
            characterArc: result.characterArc || 0,
            conflictIntensity: result.conflictIntensity || 0,
            empathy: result.empathy || 0,
            resonance: result.resonance || 0,
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

    isComplete(score: DepthScore, config: DepthConfig): boolean {
        return score.level >= config.targetLevel;
    }

    async getNextDirections(context: ExplorationContext): Promise<string[]> {
        const { intent, currentLevel } = context;

        const directionsByLevel: Record<number, string[]> = {
            1: [
                `${intent.coreObject} personal story`,
                `${intent.coreObject} founder biography`,
            ],
            2: [
                `${intent.coreObject} struggle failure`,
                `${intent.coreObject} hard times`,
            ],
            3: [
                `${intent.coreObject} emotional moment`,
                `${intent.coreObject} turning point interview`,
            ],
            4: [
                `${intent.coreObject} legacy meaning`,
                `${intent.coreObject} human impact`,
            ],
        };

        const nextLevel = Math.min(currentLevel + 1, 4);
        return directionsByLevel[nextLevel] || [];
    }

    async format(
        findings: Finding[],
        score: DepthScore,
        intent: ExplorationIntent,
    ): Promise<any> {
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
                    content: `You are a Screenwriter.

User Intent: "${intent.originalQuery}"
Core Object: ${intent.coreObject}

Findings:
${content.substring(0, 6000)}

Synthesize a Narrative Arc.
1. Protagonist: Who is the main character?
2. Conflict: What was the main struggle?
3. Journey: Brief summary of the transformation.
4. Emotional Theme: One word theme (e.g. Redemption, Hubris).

Output JSON:
{
  "protagonist": "...",
  "conflict": "...",
  "journey": "...",
  "emotionalTheme": "..."
}`,
                },
            ],
            response_format: { type: 'json_object' },
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');

        return {
            type: 'emotional',
            protagonist: result.protagonist || '',
            conflict: result.conflict || '',
            journey: result.journey || '',
            emotionalTheme: result.emotionalTheme || '',
        };
    }

    private weightedSum(dimensions: Record<string, number>): number {
        let sum = 0;
        for (const dim of this.dimensions) {
            sum += (dimensions[dim.name] || 0) * dim.weight;
        }
        return sum * 10;
    }

    private inferLevel(total: number): number {
        if (total < 20) return 1;
        if (total < 30) return 2;
        if (total < 40) return 3;
        return 4;
    }
}

export const emotionalStrategy = new EmotionalDepthStrategy();
