/**
 * prism_search Tool
 * 搜索外部资料，返回原始搜索结果（不经过 LLM 合成）
 * 
 * 与 prism_scout 的区别：
 * - prism_scout: 搜索 + LLM 合成 → 结构化 Profile
 * - prism_search: 纯搜索 → 原始结果列表（标题、URL、摘要）
 * 
 * 使用统一搜索服务（search-service），自动 fallback：
 * - 优先使用 Tavily（速度快、质量好）
 * - Tavily 不可用或失败时，fallback 到 Qveris/Linkup
 * 
 * @ref scout/search-tool
 * @doc docs/SCOUT-ANYTHING.md#73-prism_search
 * @since 2025-12-21
 * @updated 2025-12-26 - 使用统一搜索服务
 */
import { search } from '../../lib/search-service.js';
import { log } from '../../lib/logger.js';

export const searchToolDef = {
    name: 'prism_search',
    description: '搜索外部资料，返回原始搜索结果（标题、URL、摘要），适合调研和信息验证',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: '搜索查询（支持自然语言）',
            },
            maxResults: {
                type: 'number',
                description: '返回结果数量（默认 5，最大 10）',
                default: 5,
            },
            searchDepth: {
                type: 'string',
                enum: ['basic', 'advanced'],
                description: 'basic=快速搜索, advanced=深度搜索（更慢但更全面）',
                default: 'basic',
            },
            includeAnswer: {
                type: 'boolean',
                description: '是否包含 AI 生成的摘要答案（默认 true）',
                default: true,
            },
            topic: {
                type: 'string',
                enum: ['general', 'news'],
                description: 'general=通用搜索, news=新闻搜索',
                default: 'general',
            },
        },
        required: ['query'],
    },
};

interface SearchArgs {
    query: string;
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
    includeAnswer?: boolean;
    topic?: 'general' | 'news';
}

interface SearchResult {
    success: boolean;
    query: string;
    answer?: string;
    results: Array<{
        title: string;
        url: string;
        snippet: string;
        score?: number;
        publishedDate?: string;
    }>;
    totalCount: number;
    searchDepth: string;
    provider?: string;
}

export async function executeSearch(args: Record<string, unknown>): Promise<SearchResult> {
    const {
        query,
        maxResults = 5,
        searchDepth = 'basic',
        includeAnswer = true,
        topic = 'general',
    } = args as unknown as SearchArgs;

    log(`[prism_search] Searching: "${query}" (depth: ${searchDepth}, max: ${maxResults})`);

    // 使用统一搜索服务（自动处理 Tavily → Qveris fallback）
    const searchResult = await search(query, {
        maxResults,
        searchDepth,
        includeAnswer,
        topic,
    });

    if (!searchResult.success) {
        return {
            success: false,
            query,
            results: [],
            totalCount: 0,
            searchDepth,
            answer: searchResult.error || 'Search failed',
        };
    }

    log(`[prism_search] Found ${searchResult.results.length} results via ${searchResult.provider} (${searchResult.latencyMs}ms)`);

    return {
        success: true,
        query,
        answer: searchResult.answer,
        results: searchResult.results.map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
            score: r.score,
            publishedDate: r.publishedDate,
        })),
        totalCount: searchResult.totalCount,
        searchDepth,
        provider: searchResult.provider,
    };
}
