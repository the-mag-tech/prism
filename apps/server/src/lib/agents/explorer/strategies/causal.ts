/**
 * Causal Depth Strategy
 *
 * Evaluation dimensions:
 * - mechanism: How it works
 * - rootCause: Why it happens
 * - impactChain: What it affects
 * - evidenceLink: Proof of causality
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

export interface CausalOutput {
    type: 'causal';
    coreMechanism: string;
    rootCauses: string[];
    consequences: string[];
    diagramLike: string; // ASCII flow
}

export class CausalDepthStrategy implements IDepthStrategy {
    readonly name = 'causal';
    readonly description = '挖掘因果深度，寻找底层逻辑';

    readonly dimensions: DimensionDef[] = [
        { name: 'mechanism', description: '机制：运作原理', weight: 0.3 },
        { name: 'rootCause', description: '根本原因：5 Why', weight: 0.3 },
        { name: 'impactChain', description: '连锁反应：多米诺骨牌', weight: 0.2 },
        { name: 'evidenceLink', description: '证据链：因果关系的证明', weight: 0.2 },
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
                reason: 'OpenAI API key not configured - causal analysis skipped',
            };
        }
        
        const content = findings.map((f) => `${f.title}: ${f.content}`).join('\n\n');

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: `You are a "System Thinker".

Core Object: ${intent.coreObject}
Context: ${intent.context}

Findings:
${content.substring(0, 4000)}

Evaluate the CAUSAL DEPTH (0-10):
1. mechanism: Is the internal process/logic explained clearly?
2. rootCause: Does it go beyond symptoms to underlying drivers?
3. impactChain: Does it map out second and third-order effects?
4. evidenceLink: Is the causality proven or just correlated?

Output JSON:
{
  "mechanism": 0-10,
  "rootCause": 0-10,
  "impactChain": 0-10,
  "evidenceLink": 0-10,
  "reason": "One sentence reason"
}`,
                },
            ],
            response_format: { type: 'json_object' },
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');

        const dimensions: Record<string, number> = {
            mechanism: result.mechanism || 0,
            rootCause: result.rootCause || 0,
            impactChain: result.impactChain || 0,
            evidenceLink: result.evidenceLink || 0,
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
                `${intent.coreObject} how it works`,
                `${intent.coreObject} mechanism explained`,
            ],
            2: [
                `${intent.coreObject} why it happens`,
                `${intent.coreObject} underlying causes`,
            ],
            3: [
                `${intent.coreObject} chain reaction`,
                `${intent.coreObject} long term effects`,
            ],
            4: [
                `${intent.coreObject} system dynamics`,
                `${intent.coreObject} root cause analysis`,
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
                    content: `You are a Systems Analyst.

User Intent: "${intent.originalQuery}"
Core Object: ${intent.coreObject}

Findings:
${content.substring(0, 6000)}

Synthesize a Causal Map.
1. Core Mechanism: How does it basically work?
2. Root Causes: Fundamental drivers.
3. Consequences: Downstream effects.
4. Diagram: An ASCII flow chart (e.g. A -> B -> C)

Output JSON:
{
  "coreMechanism": "...",
  "rootCauses": ["..."],
  "consequences": ["..."],
  "diagramLike": "..."
}`,
                },
            ],
            response_format: { type: 'json_object' },
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');

        return {
            type: 'causal',
            coreMechanism: result.coreMechanism || '',
            rootCauses: result.rootCauses || [],
            consequences: result.consequences || [],
            diagramLike: result.diagramLike || '',
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

export const causalStrategy = new CausalDepthStrategy();
