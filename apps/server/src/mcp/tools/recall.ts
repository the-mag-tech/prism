/**
 * prism_recall Tool
 * 从用户的记忆库中检索相关信息
 */

import { recall as recallFn } from '../../recall.js';

export const recallToolDef = {
    name: 'prism_recall',
    description: "从用户的个人记忆库中检索相关信息，帮助回答'我之前想过什么'的问题",
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: '自然语言查询',
            },
            limit: {
                type: 'number',
                description: '返回结果数量（默认 10）',
            },
        },
        required: ['query'],
    },
};

interface RecallArgs {
    query: string;
    limit?: number;
}

export async function executeRecall(args: Record<string, unknown>): Promise<{
    query: string;
    results: Array<{
        id: number;
        title: string | null;
        snippet: string;
        date: string;
        sourceType: string;
    }>;
    timeline: string[];
    totalCount: number;
}> {
    const { query, limit = 10 } = args as unknown as RecallArgs;

    const response = recallFn(query, limit);

    return {
        query: response.query,
        results: response.results.map(r => ({
            id: r.id,
            title: r.title,
            snippet: r.snippet,
            date: r.createdAt?.split('T')[0] || '',
            sourceType: r.sourceType,
        })),
        timeline: response.timeline,
        totalCount: response.totalCount,
    };
}
