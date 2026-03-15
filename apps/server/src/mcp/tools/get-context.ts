/**
 * prism_get_context Tool
 * 获取某个实体的累积 context（Profile + 相关实体 + 历史交互）
 * 
 * REFACTORED: Uses GraphReader instead of direct SQL
 */

import { graphReader } from '../../lib/graph-link/index.js';

export const getContextToolDef = {
    name: 'prism_get_context',
    description: '获取用户知识图谱中某个实体的完整上下文，包括 Profile、相关实体和历史交互',
    inputSchema: {
        type: 'object',
        properties: {
            entity_id: {
                type: 'string',
                description: "实体 ID，如 'person:julian' 或 'project:naughty_labs'",
            },
            include_related: {
                type: 'boolean',
                description: '是否包含相关实体（默认 true）',
            },
        },
        required: ['entity_id'],
    },
};

interface GetContextArgs {
    entity_id: string;
    include_related?: boolean;
}

export async function executeGetContext(args: Record<string, unknown>): Promise<{
    entity: {
        id: string;
        title: string;
        subtitle: string | null;
        body: string | null;
        tags: string[];
    } | null;
    related_entities: Array<{ id: string; title: string; relation: string }>;
    recent_memories: Array<{ id: number; title: string | null; date: string }>;
}> {
    const { entity_id, include_related = true } = args as unknown as GetContextArgs;

    // 1. Get entity via GraphReader
    const entity = graphReader.getEntity(entity_id);

    if (!entity) {
        return {
            entity: null,
            related_entities: [],
            recent_memories: [],
        };
    }

    // 2. Get related entities via GraphReader
    let related_entities: Array<{ id: string; title: string; relation: string }> = [];
    if (include_related) {
        const related = graphReader.getRelatedEntities(entity_id, 10);
        related_entities = related.map(r => ({
            id: r.id,
            title: r.title,
            relation: r.relationType,
        }));
    }

    // 3. Search memories for entity name via GraphReader
    const memories = graphReader.searchMemories(entity.title, 5);

    return {
        entity: {
            id: entity.id,
            title: entity.title,
            subtitle: entity.subtitle || null,
            body: entity.body || null,
            tags: [], // Tags moved to entity_profiles in ECS, not on base entity
        },
        related_entities,
        recent_memories: memories.map(m => ({
            id: m.id,
            title: m.title,
            date: m.createdAt?.split('T')[0] || '',
        })),
    };
}
