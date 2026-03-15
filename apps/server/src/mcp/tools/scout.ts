/**
 * prism_scout Tool
 * 对某个主题/人物进行外部搜索，生成 Profile
 * 
 * @ref scout/profile-v2
 * @doc docs/SCOUT-ANYTHING.md#72-prism_scout
 * @since 2025-12-21
 * @version 2
 * 
 * 改进 v2:
 * - keyLinks 现在来自真实搜索结果，不是 LLM 生成
 * - 支持返回原始搜索结果和搜索元数据
 * - 每个链接标注来源 (search/llm)
 */

import { ScoutAgent } from '../../lib/agents/scout/agent.js';

export const scoutToolDef = {
    name: 'prism_scout',
    description: '搜索外部资料并生成结构化 Profile，可用于了解新人物或话题。keyLinks 来自真实搜索结果。',
    inputSchema: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: '要搜索的人物或话题名称',
            },
            context: {
                type: 'string',
                description: '提供额外的上下文帮助精准搜索',
            },
            includeRawSources: {
                type: 'boolean',
                description: '是否返回原始搜索结果（默认 false，设为 true 可查看完整搜索过程）',
            },
        },
        required: ['name'],
    },
};

interface ScoutArgs {
    name: string;
    context?: string;
    includeRawSources?: boolean;
}

interface ScoutResult {
    profile: {
        name: string;
        role?: string;
        bio: string;
        tags: string[];
        assets?: string[];
        keyLinks?: Array<{ title: string; url: string; source: 'search' | 'llm' }>;
        relatedEntities?: Array<{ name: string; reason: string; type: string }>;
    };
    searchMetadata?: {
        queries: string[];
        totalResults: number;
        searchEngine: string;
        timestamp: string;
        aiAnswers?: string[];
    };
    rawSources?: Array<{
        title: string;
        url: string;
        snippet: string;
        score?: number;
        query: string;
    }>;
}

export async function executeScout(args: Record<string, unknown>): Promise<ScoutResult> {
    const { name, context = '', includeRawSources = false } = args as unknown as ScoutArgs;

    const agent = new ScoutAgent();
    const profile = await agent.profile(name, context);

    const result: ScoutResult = {
        profile: {
            name: profile.name,
            role: profile.role,
            bio: profile.bio,
            tags: profile.tags,
            assets: profile.assets,
            keyLinks: profile.keyLinks,
            relatedEntities: profile.relatedEntities,
        },
    };

    // Always include search metadata for transparency
    if (profile.searchMetadata) {
        result.searchMetadata = profile.searchMetadata;
    }

    // Optionally include raw sources for debugging/verification
    if (includeRawSources && profile.rawSources) {
        result.rawSources = profile.rawSources;
    }

    return result;
}
