/**
 * Evidence Depth Strategy
 *
 * Evaluation dimensions:
 * - sourceCount: Quantity of sources
 * - authoritative: Quality/Trustworthiness of sources
 * - dataPoints: Concrete numbers/stats
 * - crossValidation: Agreement between sources
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

export interface EvidenceOutput {
    type: 'evidence';
    keyFindings: string[];
    citations: string[];
    confidence: number;
}

export class EvidenceDepthStrategy implements IDepthStrategy {
    readonly name = 'evidence';
    readonly description = '挖掘证据深度，寻找可靠的支撑';

    readonly dimensions: DimensionDef[] = [
        { name: 'sourceCount', description: '来源数量', weight: 0.2 },
        { name: 'authoritative', description: '权威性：来源是否可信', weight: 0.3 },
        { name: 'dataPoints', description: '数据点：有具体数字吗', weight: 0.2 },
        { name: 'crossValidation', description: '交叉验证：多源一致吗', weight: 0.3 },
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
                reason: 'OpenAI API key not configured - evidence analysis skipped',
            };
        }
        
        const content = findings.map((f) => `Source: ${f.title} (${f.url || 'LLM'})\n${f.content.substring(0, 500)}...`).join('\n\n');

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: `You are an "Evidence Evaluator".

Core Object: ${intent.coreObject}
Context: ${intent.context}

Findings:
${content.substring(0, 4000)}

Evaluate the EVIDENCE DEPTH (0-10):
1. sourceCount: Are there enough distinct sources? (Automatic based on findings count, but assess quality/diversity)
2. authoritative: Are sources credible (e.g. academic, major news) vs blogs?
3. dataPoints: Are there concrete numbers, dates, statistics?
4. crossValidation: Do sources agree or corroborate each other?

Output JSON:
{
  "sourceCount": 0-10,
  "authoritative": 0-10,
  "dataPoints": 0-10,
  "crossValidation": 0-10,
  "reason": "One sentence reason"
}`,
                },
            ],
            response_format: { type: 'json_object' },
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');

        const dimensions: Record<string, number> = {
            sourceCount: result.sourceCount || 0,
            authoritative: result.authoritative || 0,
            dataPoints: result.dataPoints || 0,
            crossValidation: result.crossValidation || 0,
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

        // Level-specific dig directions for Evidence
        // L1: Broad search
        // L2: Expert search
        // L3: Data/Stats search
        // L4: Academic/Primary Source search
        const directionsByLevel: Record<number, string[]> = {
            1: [
                `${intent.coreObject} overview facts`,
                `${intent.coreObject} history timeline`,
            ],
            2: [
                `${intent.coreObject} expert analysis`,
                `${intent.coreObject} case studies`,
            ],
            3: [
                `${intent.coreObject} statistics data`,
                `${intent.coreObject} market research report`,
            ],
            4: [
                `${intent.coreObject} academic paper pdf`,
                `${intent.coreObject} primary source document`,
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
                    content: `You are a Research Analyst.

User Intent: "${intent.originalQuery}"
Core Object: ${intent.coreObject}

Findings:
${content.substring(0, 6000)}

Synthesize a Research Report.
1. Key Findings: 3-5 bullet points supported by evidence.
2. Citations: List of main sources used.
3. Confidence: 0-100% based on evidence quality.

Output JSON:
{
  "keyFindings": ["..."],
  "citations": ["Title - URL"],
  "confidence": number (0-100)
}`,
                },
            ],
            response_format: { type: 'json_object' },
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');

        return {
            type: 'evidence',
            keyFindings: result.keyFindings || [],
            citations: result.citations || [],
            confidence: result.confidence || 0,
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

export const evidenceStrategy = new EvidenceDepthStrategy();
