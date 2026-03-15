/**
 * prism_explore Tool
 * 使用 Deep Explorer 对主题进行深度探索，自动选择最佳策略
 */

import { DeepExplorer } from '../../lib/agents/explorer/engine.js';
import { AgentLogger } from '../../lib/agent-logger.js';

const logger = new AgentLogger('mcp');

export const exploreToolDef = {
    name: 'prism_explore',
    description: '对指定主题进行深度探索，使用多头探索策略，自动提取洞见和发现',
    inputSchema: {
        type: 'object',
        properties: {
            topic: {
                type: 'string',
                description: '要探索的主题或问题',
            },
            depth: {
                type: 'number',
                description: '探索深度（1-3，默认 2）。1=快速，2=标准，3=深度',
            },
        },
        required: ['topic'],
    },
};

interface ExploreArgs {
    topic: string;
    depth?: number;
}

export async function executeExplore(args: Record<string, unknown>): Promise<{
    success: boolean;
    topic?: string;
    winner?: {
        direction: string;
        level: number;
        score: number;
    };
    output?: unknown;  // StrategyOutput (IronyOutput | EvidenceOutput)
    findings_count?: number;
    query_type?: string;
    error?: string;
}> {
    const { topic, depth = 2 } = args as unknown as ExploreArgs;
    const log = logger.start('explore', { topic: topic.substring(0, 50), depth });

    const { isOpenAIAvailable } = await import('../../lib/ai-clients.js');
    if (!isOpenAIAvailable()) {
        log.error(new Error('OpenAI not available'));
        return {
            success: false,
            error: 'Deep exploration requires OpenAI (configure API key or proxy)',
        };
    }

    try {
        const explorer = new DeepExplorer();
        
        // Use auto mode which analyzes query and picks best strategy
        const result = await explorer.exploreAuto(topic);

        log.success({
            queryType: result.queryAnalysis.queryType,
            winnerLevel: result.winner.score.level,
            findingsCount: result.winner.findings.length,
        });

        return {
            success: true,
            topic,
            winner: {
                direction: result.winner.name,
                level: result.winner.score.level,
                score: result.winner.score.total,
            },
            output: result.output,
            findings_count: result.winner.findings.length,
            query_type: result.queryAnalysis.queryType,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(error);
        return {
            success: false,
            error: errorMessage,
        };
    }
}

