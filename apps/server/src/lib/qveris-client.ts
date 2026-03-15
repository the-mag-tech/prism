/**
 * Qveris Client - 纯执行层封装
 * 
 * 设计原则：
 * - Qveris 作为「工具仓库」，不做意图识别
 * - Prism 负责意图理解和策略制定
 * - 直接指定 tool_id 执行，跳过 Qveris 的 Intent Router
 * 
 * @since 2025-12-25
 */

import { log, logError } from './logger.js';

// =============================================================================
// Types
// =============================================================================

export interface QverisSearchResult {
    title: string;
    url: string;
    content: string;
    score?: number;
    publishedDate?: string;
}

export interface QverisSearchResponse {
    success: boolean;
    query: string;
    answer?: string;
    results: QverisSearchResult[];
    totalCount: number;
    provider: string;
    latencyMs: number;
    error?: string;
}

export interface LinkupOptions {
    depth?: 'standard' | 'deep';
    outputType?: 'searchResults' | 'sourcedAnswer' | 'structured';
    maxResults?: number;
}

export interface GoogleOptions {
    countryCode?: string;
    language?: string;
    device?: 'desktop' | 'mobile';
    maxResults?: number;
}

export interface DuckDuckGoOptions {
    region?: string;
    maxResults?: number;
}

// Tool IDs - 直接指定，跳过 Qveris Intent Router
const TOOL_IDS = {
    LINKUP: 'linkup.search.v1',
    GOOGLE: 'scrapingbee.store.google.query.v1',
    DUCKDUCKGO: 'serpapi.duckduckgo.search.list.v1',
} as const;

// =============================================================================
// QverisClient
// =============================================================================

export class QverisClient {
    private baseUrl = 'https://qveris.ai/api/v1';
    private apiKey: string;
    private cachedSearchId: string | null = null;
    private searchIdExpiry: number = 0;
    
    // search_id 缓存时间（1小时）
    private static SEARCH_ID_TTL = 60 * 60 * 1000;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    // -------------------------------------------------------------------------
    // 核心方法：获取 search_id（Qveris API 要求）
    // -------------------------------------------------------------------------
    
    /**
     * 获取 search_id
     * 虽然我们跳过意图路由，但 Qveris API 仍要求提供 search_id
     * 这里用最简单的查询获取一个通用的 search_id
     */
    private async getSearchId(): Promise<string> {
        // 检查缓存
        if (this.cachedSearchId && Date.now() < this.searchIdExpiry) {
            return this.cachedSearchId;
        }

        const response = await fetch(`${this.baseUrl}/search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: 'web search', limit: 1 }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to get search_id: ${response.status} - ${error}`);
        }

        const data = await response.json() as { search_id: string };
        this.cachedSearchId = data.search_id;
        this.searchIdExpiry = Date.now() + QverisClient.SEARCH_ID_TTL;
        
        log('[QverisClient] Obtained new search_id');
        return this.cachedSearchId;
    }

    // -------------------------------------------------------------------------
    // 核心方法：执行工具
    // -------------------------------------------------------------------------

    /**
     * 直接执行指定工具（跳过 Qveris Intent Router）
     */
    async execute(
        toolId: string,
        parameters: Record<string, unknown>,
        maxDataSize = 30000
    ): Promise<{ success: boolean; data: unknown; latencyMs: number; error?: string }> {
        const searchId = await this.getSearchId();
        
        const startTime = Date.now();
        const response = await fetch(
            `${this.baseUrl}/tools/execute?tool_id=${encodeURIComponent(toolId)}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    search_id: searchId,
                    parameters,
                    max_data_size: maxDataSize,
                }),
            }
        );
        const latencyMs = Date.now() - startTime;

        if (!response.ok) {
            const error = await response.text();
            return { success: false, data: null, latencyMs, error };
        }

        const result = await response.json() as {
            success: boolean;
            result: unknown;
            error_message?: string;
        };

        if (!result.success) {
            return {
                success: false,
                data: result.result,
                latencyMs,
                error: result.error_message || 'Unknown error',
            };
        }

        return { success: true, data: result.result, latencyMs };
    }

    // -------------------------------------------------------------------------
    // 便捷方法：Linkup Search（高准确性，AI 原生）
    // -------------------------------------------------------------------------

    /**
     * 使用 Linkup 搜索
     * 特点：AI 原生、高准确性、SimpleQA 基准最高
     */
    async searchWithLinkup(
        query: string,
        options: LinkupOptions = {}
    ): Promise<QverisSearchResponse> {
        const {
            depth = 'standard',
            outputType = 'searchResults',
            maxResults = 10,
        } = options;

        const startTime = Date.now();
        
        try {
            const result = await this.execute(TOOL_IDS.LINKUP, {
                q: query,
                depth,
                outputType,
            });

            if (!result.success) {
                return {
                    success: false,
                    query,
                    results: [],
                    totalCount: 0,
                    provider: 'linkup',
                    latencyMs: result.latencyMs,
                    error: result.error,
                };
            }

            // 解析 Linkup 返回格式
            const results = this.parseLinkupResults(result.data, maxResults);
            
            return {
                success: true,
                query,
                results,
                totalCount: results.length,
                provider: 'linkup',
                latencyMs: result.latencyMs,
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError(`[QverisClient] Linkup search failed: ${errorMessage}`);
            return {
                success: false,
                query,
                results: [],
                totalCount: 0,
                provider: 'linkup',
                latencyMs,
                error: errorMessage,
            };
        }
    }

    // -------------------------------------------------------------------------
    // 便捷方法：Google Search（全面覆盖）
    // -------------------------------------------------------------------------

    /**
     * 使用 Google 搜索（via ScrapingBee）
     * 特点：全面覆盖、传统搜索结果格式
     */
    async searchWithGoogle(
        query: string,
        options: GoogleOptions = {}
    ): Promise<QverisSearchResponse> {
        const {
            countryCode = 'us',
            language = 'en',
            device = 'desktop',
            maxResults = 10,
        } = options;

        const startTime = Date.now();

        try {
            const result = await this.execute(TOOL_IDS.GOOGLE, {
                search: query,  // 注意：Google 用 'search' 不是 'q'
                country_code: countryCode,
                language,
                device,
            });

            if (!result.success) {
                return {
                    success: false,
                    query,
                    results: [],
                    totalCount: 0,
                    provider: 'google',
                    latencyMs: result.latencyMs,
                    error: result.error,
                };
            }

            const results = this.parseGoogleResults(result.data, maxResults);

            return {
                success: true,
                query,
                results,
                totalCount: results.length,
                provider: 'google',
                latencyMs: result.latencyMs,
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError(`[QverisClient] Google search failed: ${errorMessage}`);
            return {
                success: false,
                query,
                results: [],
                totalCount: 0,
                provider: 'google',
                latencyMs,
                error: errorMessage,
            };
        }
    }

    // -------------------------------------------------------------------------
    // 便捷方法：DuckDuckGo Search（隐私、无个性化偏见）
    // -------------------------------------------------------------------------

    /**
     * 使用 DuckDuckGo 搜索（via SerpAPI）
     * 特点：隐私友好、无个性化、结果无偏见
     */
    async searchWithDuckDuckGo(
        query: string,
        options: DuckDuckGoOptions = {}
    ): Promise<QverisSearchResponse> {
        const { region = 'us-en', maxResults = 10 } = options;

        const startTime = Date.now();

        try {
            const result = await this.execute(TOOL_IDS.DUCKDUCKGO, {
                q: query,
                engine: 'duckduckgo',
                kl: region,
            });

            if (!result.success) {
                return {
                    success: false,
                    query,
                    results: [],
                    totalCount: 0,
                    provider: 'duckduckgo',
                    latencyMs: result.latencyMs,
                    error: result.error,
                };
            }

            const results = this.parseDuckDuckGoResults(result.data, maxResults);

            return {
                success: true,
                query,
                results,
                totalCount: results.length,
                provider: 'duckduckgo',
                latencyMs: result.latencyMs,
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError(`[QverisClient] DuckDuckGo search failed: ${errorMessage}`);
            return {
                success: false,
                query,
                results: [],
                totalCount: 0,
                provider: 'duckduckgo',
                latencyMs,
                error: errorMessage,
            };
        }
    }

    // -------------------------------------------------------------------------
    // Tavily 兼容接口
    // -------------------------------------------------------------------------

    /**
     * Tavily 兼容的 search 方法
     * 默认使用 Linkup（最接近 Tavily 的工具）
     */
    async search(
        query: string,
        options?: {
            searchDepth?: 'basic' | 'advanced';
            maxResults?: number;
            includeAnswer?: boolean;
        }
    ): Promise<{
        answer?: string;
        results: Array<{
            title: string;
            url: string;
            content: string;
            score?: number;
        }>;
    }> {
        const depth = options?.searchDepth === 'advanced' ? 'deep' : 'standard';
        const outputType = options?.includeAnswer ? 'sourcedAnswer' : 'searchResults';
        
        const response = await this.searchWithLinkup(query, {
            depth,
            outputType,
            maxResults: options?.maxResults,
        });

        return {
            answer: response.answer,
            results: response.results,
        };
    }

    // -------------------------------------------------------------------------
    // 结果解析器
    // -------------------------------------------------------------------------

    /**
     * 安全解析可能被截断的 JSON
     */
    private safeParseJsonArray(jsonStr: string, arrayKey: string): unknown[] {
        try {
            const parsed = JSON.parse(jsonStr);
            return parsed[arrayKey] || [];
        } catch {
            // JSON 被截断，尝试提取完整的对象
            const results: unknown[] = [];
            const arrayStart = jsonStr.indexOf(`"${arrayKey}": [`);
            if (arrayStart === -1) return [];

            const contentStart = jsonStr.indexOf('[', arrayStart);
            if (contentStart === -1) return [];

            let depth = 0;
            let objStart = -1;

            for (let i = contentStart + 1; i < jsonStr.length; i++) {
                const char = jsonStr[i];
                if (char === '{') {
                    if (depth === 0) objStart = i;
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0 && objStart !== -1) {
                        try {
                            const obj = JSON.parse(jsonStr.slice(objStart, i + 1));
                            results.push(obj);
                        } catch {
                            // skip
                        }
                        objStart = -1;
                    }
                }
            }
            return results;
        }
    }

    private parseLinkupResults(data: unknown, maxResults: number): QverisSearchResult[] {
        const results: QverisSearchResult[] = [];
        
        try {
            const resultData = data as { truncated_content?: string; data?: unknown };
            const content = resultData.truncated_content;
            
            if (typeof content === 'string') {
                const parsed = this.safeParseJsonArray(content, 'results') as Array<{
                    name?: string;
                    url?: string;
                    content?: string;
                }>;
                
                for (const r of parsed.slice(0, maxResults)) {
                    results.push({
                        title: r.name || '',
                        url: r.url || '',
                        content: (r.content || '').slice(0, 1000),
                    });
                }
            }
        } catch (e) {
            logError(`[QverisClient] Failed to parse Linkup results: ${e}`);
        }

        return results;
    }

    private parseGoogleResults(data: unknown, maxResults: number): QverisSearchResult[] {
        const results: QverisSearchResult[] = [];

        try {
            const resultData = data as {
                data?: { organic_results?: Array<{ title?: string; link?: string; snippet?: string }> };
                truncated_content?: string;
            };
            
            let organic = resultData.data?.organic_results;

            // 如果在 data 里没找到，尝试解析 truncated_content
            if (!organic && resultData.truncated_content) {
                organic = this.safeParseJsonArray(resultData.truncated_content, 'organic_results') as Array<{
                    title?: string;
                    link?: string;
                    snippet?: string;
                }>;
            }

            for (const r of (organic || []).slice(0, maxResults)) {
                results.push({
                    title: r.title || '',
                    url: r.link || '',
                    content: r.snippet || '',
                });
            }
        } catch (e) {
            logError(`[QverisClient] Failed to parse Google results: ${e}`);
        }

        return results;
    }

    private parseDuckDuckGoResults(data: unknown, maxResults: number): QverisSearchResult[] {
        const results: QverisSearchResult[] = [];

        try {
            const resultData = data as {
                data?: { organic_results?: Array<{ title?: string; link?: string; snippet?: string }> };
                truncated_content?: string;
            };
            
            let organic = resultData.data?.organic_results;

            if (!organic && resultData.truncated_content) {
                organic = this.safeParseJsonArray(resultData.truncated_content, 'organic_results') as Array<{
                    title?: string;
                    link?: string;
                    snippet?: string;
                }>;
            }

            for (const r of (organic || []).slice(0, maxResults)) {
                results.push({
                    title: r.title || '',
                    url: r.link || '',
                    content: r.snippet || '',
                });
            }
        } catch (e) {
            logError(`[QverisClient] Failed to parse DuckDuckGo results: ${e}`);
        }

        return results;
    }
}

// =============================================================================
// Factory Function & Runtime Key Support
// =============================================================================

let _qverisClient: QverisClient | null = null;
let _qverisChecked = false;
let _runtimeQverisKey: string | undefined;

/**
 * Configure Qveris API key at runtime
 * Called by ai-clients.configureKeys() for unified key management
 * 
 * @param key - Qveris API key
 */
export function configureQverisKey(key: string | undefined): void {
    _runtimeQverisKey = key;
    // Reset client to force re-initialization
    _qverisClient = null;
    _qverisChecked = false;
    if (key) {
        log('[QverisClient] Runtime key configured');
    }
}

/**
 * 获取 Qveris Client（单例）
 * 
 * Key priority:
 * 1. Runtime key (from configureQverisKey)
 * 2. Environment variable (QVERIS_API_KEY)
 */
export function getQverisClient(): QverisClient | null {
    if (!_qverisChecked) {
        _qverisChecked = true;
        
        // Priority: runtime key > env var
        const apiKey = _runtimeQverisKey || process.env.QVERIS_API_KEY;
        
        if (apiKey) {
            _qverisClient = new QverisClient(apiKey);
            const source = _runtimeQverisKey ? 'runtime' : 'env';
            log(`[QverisClient] ✓ Initialized (source: ${source})`);
        } else {
            log('[QverisClient] ⚠️ Qveris not configured (no key)');
        }
    }
    
    return _qverisClient;
}

/**
 * Check if Qveris is available (without initializing)
 */
export function isQverisAvailable(): boolean {
    return !!(_runtimeQverisKey || process.env.QVERIS_API_KEY);
}

/**
 * 重置 client（用于测试或重新配置）
 */
export function resetQverisClient(): void {
    _qverisClient = null;
    _qverisChecked = false;
    _runtimeQverisKey = undefined;
}





