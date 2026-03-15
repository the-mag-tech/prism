/**
 * prism_scout_tick Tool
 * 手动触发 Scout System 调度周期，加速高 Gravity 实体的信息更新
 */

import { ScoutSystem } from '../../systems/ScoutSystem.js';
import { AgentLogger } from '../../lib/agent-logger.js';

const logger = new AgentLogger('mcp');

export const scoutTickToolDef = {
    name: 'prism_scout_tick',
    description: '手动触发 Scout 调度周期，根据实体 Gravity 自动选择需要更新的实体进行 Scout',
    inputSchema: {
        type: 'object',
        properties: {
            limit: {
                type: 'number',
                description: '最多处理的实体数量（默认 5）',
            },
        },
        required: [],
    },
};

interface ScoutTickArgs {
    limit?: number;
}

export async function executeScoutTick(args: Record<string, unknown>): Promise<{
    success: boolean;
    message: string;
    scouted_count?: number;
    candidates?: Array<{ id: string; title: string; gravity: number }>;
    error?: string;
}> {
    const { limit = 5 } = args as unknown as ScoutTickArgs;
    const log = logger.start('scout_tick', { limit });

    try {
        const scoutSystem = new ScoutSystem();
        
        // Run a scout tick
        await scoutSystem.tick();

        log.success({ message: 'Scout tick completed' });

        return {
            success: true,
            message: `Scout 调度周期已执行，最多处理 ${limit} 个高优先级实体`,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(error);
        return {
            success: false,
            message: 'Scout 调度失败',
            error: errorMessage,
        };
    }
}







