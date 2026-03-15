/**
 * prism_gravity_top Tool
 * 获取当前 Gravity 最高的实体列表
 * 
 * REFACTORED: Uses GraphReader instead of direct SQL
 */

import { graphReader } from '../../lib/graph-link/index.js';

export const gravityTopToolDef = {
    name: 'prism_gravity_top',
    description: '获取用户当前最关注的实体（基于 Gravity 算法）',
    inputSchema: {
        type: 'object',
        properties: {
            limit: {
                type: 'number',
                description: '返回数量（默认 5）',
            },
            entity_type: {
                type: 'string',
                description: '过滤实体类型（person/project/topic）',
            },
        },
    },
};

interface GravityTopArgs {
    limit?: number;
    entity_type?: string;
}

export async function executeGravityTop(args: Record<string, unknown>): Promise<{
    entities: Array<{
        id: string;
        title: string;
        subtitle: string | null;
        gravity: number;
        type: string;
    }>;
}> {
    const { limit = 5, entity_type } = args as GravityTopArgs;

    // Use GraphReader's encapsulated method
    const results = graphReader.getTopByGravity(limit, entity_type);

    // Filter out memory entities and empty titles (matching original behavior)
    const filtered = results.filter(r => 
        !r.id.startsWith('memory:') && 
        r.title && 
        r.title.trim() !== ''
    );

    return {
        entities: filtered,
    };
}
