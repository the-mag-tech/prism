/**
 * @module search-service
 * @description Unified Search Service - Single entry point for all web search operations
 * 
 * ============================================================================
 * AGENTIC MODULE REGISTRY - SEARCH SERVICE
 * ============================================================================
 * 
 * Keywords for grep/search:
 *   - SEARCH_SERVICE, WEB_SEARCH, TAVILY_FALLBACK, QVERIS_FALLBACK
 *   - search, searchWeb, getSearchService
 * 
 * This module provides a unified search interface with automatic fallback:
 *   1. Tavily (primary) - Fast, AI-native search
 *   2. Qveris/Linkup (fallback) - Reliable backup when Tavily fails
 * 
 * Both Tavily and Qveris support:
 *   - Direct API key mode (from env or runtime)
 *   - Proxy mode (through api-proxy with quota management)
 * 
 * USAGE:
 * ```typescript
 * import { search, isSearchAvailable } from './lib/search-service.js';
 * 
 * // Simple search
 * const results = await search('Claude AI latest features');
 * 
 * // With options
 * const results = await search('AI news', {
 *   maxResults: 5,
 *   searchDepth: 'advanced',
 *   includeAnswer: true,
 * });
 * ```
 * 
 * @since 2025-12-26
 */

import { getTavily, isProxyMode, getProxyConfig } from './ai-clients.js';
import { getQverisClient, QverisClient } from './qveris-client.js';
import { log, logError } from './logger.js';

// =============================================================================
// Types
// =============================================================================

export interface SearchResult {
    title: string;
    url: string;
    content: string;
    score?: number;
    publishedDate?: string;
}

export interface SearchResponse {
    success: boolean;
    query: string;
    answer?: string;
    results: SearchResult[];
    totalCount: number;
    provider: 'tavily' | 'qveris' | 'none';
    latencyMs: number;
    error?: string;
}

export interface SearchOptions {
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
    includeAnswer?: boolean;
    topic?: 'general' | 'news';
}

// =============================================================================
// Proxy Qveris Client (when user has no direct Qveris key)
// =============================================================================

/**
 * Create a Qveris client that routes through the proxy
 */
function createProxyQverisClient(): QverisClient | null {
    const proxy = getProxyConfig();
    if (!proxy) return null;

    // Create a minimal QverisClient-like object that uses proxy
    // We can't extend QverisClient directly, so we create a wrapper
    return {
        search: async (query: string, options?: SearchOptions) => {
            return searchViaQverisProxy(proxy, query, options);
        },
        searchWithLinkup: async (query: string, options?: { depth?: 'standard' | 'deep'; maxResults?: number }) => {
            return searchViaQverisProxy(proxy, query, {
                searchDepth: options?.depth === 'deep' ? 'advanced' : 'basic',
                maxResults: options?.maxResults,
            });
        },
    } as unknown as QverisClient;
}

/**
 * Execute search via Qveris proxy
 */
async function searchViaQverisProxy(
    proxy: { token: string; url: string },
    query: string,
    options?: SearchOptions
): Promise<{ success: boolean; results: SearchResult[]; error?: string; latencyMs: number }> {
    const startTime = Date.now();

    try {
        // Step 1: Get search_id
        const searchResponse = await fetch(`${proxy.url}/proxy/qveris/search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${proxy.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: 'web search', limit: 1 }),
        });

        if (!searchResponse.ok) {
            const error = await searchResponse.text();
            return { success: false, results: [], error: `Proxy search failed: ${error}`, latencyMs: Date.now() - startTime };
        }

        const searchData = await searchResponse.json() as { search_id?: string };
        const searchId = searchData.search_id;

        if (!searchId) {
            return { success: false, results: [], error: 'No search_id returned', latencyMs: Date.now() - startTime };
        }

        // Step 2: Execute Linkup search
        const depth = options?.searchDepth === 'advanced' ? 'deep' : 'standard';
        const executeResponse = await fetch(`${proxy.url}/proxy/qveris/execute?tool_id=linkup.search.v1`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${proxy.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                search_id: searchId,
                parameters: {
                    q: query,
                    depth,
                    outputType: 'searchResults',
                },
            }),
        });

        if (!executeResponse.ok) {
            const error = await executeResponse.text();
            return { success: false, results: [], error: `Proxy execute failed: ${error}`, latencyMs: Date.now() - startTime };
        }

        const executeData = await executeResponse.json() as {
            success?: boolean;
            error_message?: string;
            result?: { truncated_content?: string; data?: any };
        };

        if (executeData.success === false) {
            return { success: false, results: [], error: executeData.error_message, latencyMs: Date.now() - startTime };
        }

        // Parse results
        const results = parseQverisProxyResults(executeData, options?.maxResults || 10);

        return {
            success: true,
            results,
            latencyMs: Date.now() - startTime,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, results: [], error: errorMessage, latencyMs: Date.now() - startTime };
    }
}

/**
 * Parse Qveris proxy results (handles truncated_content)
 */
function parseQverisProxyResults(data: any, maxResults: number): SearchResult[] {
    try {
        let content = data.result?.truncated_content || data.result?.data;
        if (!content) return [];

        // If content is a string, try to parse it
        if (typeof content === 'string') {
            // Try to extract complete JSON objects from potentially truncated string
            const results: SearchResult[] = [];
            const regex = /\{[^{}]*"content"\s*:\s*"[^"]*"[^{}]*"url"\s*:\s*"[^"]*"[^{}]*\}/g;
            const matches = content.match(regex);

            if (matches) {
                for (const match of matches.slice(0, maxResults)) {
                    try {
                        const obj = JSON.parse(match);
                        results.push({
                            title: obj.name || obj.title || '',
                            url: obj.url || '',
                            content: obj.content || obj.snippet || '',
                        });
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }

            // Fallback: try parsing as JSON array
            if (results.length === 0) {
                try {
                    const parsed = JSON.parse(content);
                    if (parsed.results && Array.isArray(parsed.results)) {
                        return parsed.results.slice(0, maxResults).map((r: any) => ({
                            title: r.name || r.title || '',
                            url: r.url || '',
                            content: r.content || r.snippet || '',
                        }));
                    }
                } catch {
                    // Ignore parse errors
                }
            }

            return results;
        }

        // If content is already an object
        if (content.results && Array.isArray(content.results)) {
            return content.results.slice(0, maxResults).map((r: any) => ({
                title: r.name || r.title || '',
                url: r.url || '',
                content: r.content || r.snippet || '',
            }));
        }

        return [];
    } catch {
        return [];
    }
}

// =============================================================================
// Unified Search Function
// =============================================================================

/**
 * Unified search function with automatic fallback
 * 
 * Priority:
 * 1. Tavily (direct key or proxy)
 * 2. Qveris/Linkup (direct key or proxy) - fallback when Tavily fails
 * 
 * @param query - Search query
 * @param options - Search options
 * @returns Search response with results and metadata
 * 
 * @example
 * const results = await search('Claude AI features');
 * console.log(results.provider); // 'tavily' or 'qveris'
 * console.log(results.results);  // Array of search results
 */
export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const {
        maxResults = 5,
        searchDepth = 'basic',
        includeAnswer = false,
        topic = 'general',
    } = options;

    const startTime = Date.now();

    // Try Tavily first
    const tavilyResult = await searchWithTavily(query, { maxResults, searchDepth, includeAnswer, topic });
    if (tavilyResult.success) {
        return tavilyResult;
    }

    log(`[SearchService] Tavily failed (${tavilyResult.error}), trying Qveris fallback...`);

    // Fallback to Qveris
    const qverisResult = await searchWithQveris(query, { maxResults, searchDepth });
    if (qverisResult.success) {
        return qverisResult;
    }

    // All failed
    return {
        success: false,
        query,
        results: [],
        totalCount: 0,
        provider: 'none',
        latencyMs: Date.now() - startTime,
        error: `All search providers failed. Tavily: ${tavilyResult.error}, Qveris: ${qverisResult.error}`,
    };
}

/**
 * Search using Tavily (direct or proxy)
 */
async function searchWithTavily(
    query: string,
    options: { maxResults: number; searchDepth: string; includeAnswer: boolean; topic: string }
): Promise<SearchResponse> {
    const startTime = Date.now();
    const tavilyClient = getTavily();

    if (!tavilyClient) {
        return {
            success: false,
            query,
            results: [],
            totalCount: 0,
            provider: 'tavily',
            latencyMs: Date.now() - startTime,
            error: 'Tavily not configured',
        };
    }

    try {
        const response = await tavilyClient.search(query, {
            searchDepth: options.searchDepth as 'basic' | 'advanced',
            maxResults: options.maxResults,
            includeAnswer: options.includeAnswer,
            topic: options.topic as 'general' | 'news',
        });

        const results: SearchResult[] = (response.results || []).map((r: any) => ({
            title: r.title || '',
            url: r.url || '',
            content: r.content || '',
            score: r.score,
            publishedDate: r.publishedDate,
        }));

        return {
            success: true,
            query,
            answer: response.answer,
            results,
            totalCount: results.length,
            provider: 'tavily',
            latencyMs: Date.now() - startTime,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(`[SearchService] Tavily search failed: ${errorMessage}`);
        return {
            success: false,
            query,
            results: [],
            totalCount: 0,
            provider: 'tavily',
            latencyMs: Date.now() - startTime,
            error: errorMessage,
        };
    }
}

/**
 * Search using Qveris (direct or proxy)
 */
async function searchWithQveris(
    query: string,
    options: { maxResults: number; searchDepth: string }
): Promise<SearchResponse> {
    const startTime = Date.now();

    // Try direct Qveris client first
    let qverisClient = getQverisClient();

    // If no direct client, try proxy mode
    if (!qverisClient && isProxyMode()) {
        qverisClient = createProxyQverisClient();
        if (qverisClient) {
            log('[SearchService] Using Qveris via proxy');
        }
    }

    if (!qverisClient) {
        return {
            success: false,
            query,
            results: [],
            totalCount: 0,
            provider: 'qveris',
            latencyMs: Date.now() - startTime,
            error: 'Qveris not configured (no key or proxy)',
        };
    }

    try {
        const depth = options.searchDepth === 'advanced' ? 'deep' : 'standard';
        const response = await qverisClient.searchWithLinkup(query, {
            depth: depth as 'standard' | 'deep',
            maxResults: options.maxResults,
        });

        if (!response.success) {
            return {
                success: false,
                query,
                results: [],
                totalCount: 0,
                provider: 'qveris',
                latencyMs: Date.now() - startTime,
                error: response.error || 'Qveris search failed',
            };
        }

        const results: SearchResult[] = response.results.map(r => ({
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
            publishedDate: r.publishedDate,
        }));

        log(`[SearchService] Qveris found ${results.length} results`);

        return {
            success: true,
            query,
            results,
            totalCount: results.length,
            provider: 'qveris',
            latencyMs: Date.now() - startTime,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(`[SearchService] Qveris search failed: ${errorMessage}`);
        return {
            success: false,
            query,
            results: [],
            totalCount: 0,
            provider: 'qveris',
            latencyMs: Date.now() - startTime,
            error: errorMessage,
        };
    }
}

// =============================================================================
// Availability Check
// =============================================================================

/**
 * Check if any search provider is available
 */
export function isSearchAvailable(): boolean {
    // Tavily available?
    if (getTavily()) return true;

    // Qveris available (direct)?
    if (getQverisClient()) return true;

    // Proxy mode available?
    if (isProxyMode()) return true;

    return false;
}

/**
 * Get search service status
 */
export function getSearchStatus(): {
    available: boolean;
    tavily: { available: boolean; mode: 'direct' | 'proxy' | 'none' };
    qveris: { available: boolean; mode: 'direct' | 'proxy' | 'none' };
} {
    const tavilyClient = getTavily();
    const qverisClient = getQverisClient();
    const proxyMode = isProxyMode();

    return {
        available: isSearchAvailable(),
        tavily: {
            available: !!tavilyClient,
            mode: tavilyClient
                ? (proxyMode && !process.env.TAVILY_API_KEY ? 'proxy' : 'direct')
                : 'none',
        },
        qveris: {
            available: !!qverisClient || proxyMode,
            mode: qverisClient
                ? 'direct'
                : proxyMode
                ? 'proxy'
                : 'none',
        },
    };
}

// =============================================================================
// SEARCH WITH LOGGING (Phase 0.5 - Quality Tracking)
// =============================================================================

import { SearchLogger, type SearchContext, type SearchLogMetrics } from './search-logger.js';

export type { SearchContext, SearchLogMetrics };

/**
 * Search with quality logging
 * 
 * Wraps the standard search() function with automatic logging to search_logs table.
 * Use this for operations where quality tracking is needed (Ripple, Scout, Explore).
 * 
 * @param query - Search query
 * @param options - Search options
 * @param context - Logging context (trigger, entityId, sessionId)
 * @returns SearchResponse with additional logger for recording metrics
 * 
 * @example
 * const { response, logger } = await searchWithLogging(
 *   'Simon Willison bio',
 *   { maxResults: 5 },
 *   { trigger: 'ripple', entityId: 'person:simon' }
 * );
 * 
 * // After processing results...
 * logger.finalize({ ingestedCount: 2, skippedCount: 3, avgSurpriseScore: 0.6 });
 */
export async function searchWithLogging(
    query: string,
    options: SearchOptions = {},
    context: SearchContext
): Promise<{ response: SearchResponse; logger: SearchLogger }> {
    // Create logger
    const logger = new SearchLogger(context);
    
    // Execute search
    const response = await search(query, options);
    
    // Record results
    logger.recordResults(
        query,
        response.provider,
        response.totalCount,
        response.latencyMs
    );
    
    return { response, logger };
}

// =============================================================================
// SEARCH WITH DATA GAP DETECTION (Phase 4.5 - "Security Checkpoint")
// =============================================================================

import {
    detectGaps,
    detectAndStoreGaps,
    getOpenGaps,
    type DataGap,
    type GapDetectionResult,
} from './data-gap/index.js';

export type { DataGap, GapDetectionResult };

export interface SearchWithGapOptions extends SearchOptions {
    /** Entity ID to detect gaps for (e.g., 'person:simon_willison') */
    entityId?: string;
    /** Whether to detect and store gaps (default: true) */
    detectGaps?: boolean;
    /** Whether to prioritize gap-filling queries (default: true) */
    prioritizeGaps?: boolean;
}

export interface SearchWithGapResponse extends SearchResponse {
    /** Detected data gaps for the entity */
    detectedGaps: DataGap[];
    /** Suggested queries to fill gaps */
    gapSuggestedQueries: string[];
    /** Entity completeness score (0-1) */
    completeness: number;
}

/**
 * Search with automatic Data Gap Detection
 * 
 * @ref data-gap/integration
 * @doc docs/DATA-GAP-DETECTION.md#6.2
 * 
 * This is the "Security Checkpoint" - every search goes through here,
 * and gaps are automatically detected and stored.
 * 
 * @param query - Search query
 * @param options - Search options with gap detection settings
 * @param context - Logging context
 * @returns Search response with detected gaps and suggestions
 * 
 * @example
 * const result = await searchWithGapDetection(
 *   'Simon Willison bio',
 *   { entityId: 'person:simon_willison', maxResults: 5 },
 *   { trigger: 'ripple' }
 * );
 * 
 * console.log(result.detectedGaps);        // [{missing: 'educated_at', ...}]
 * console.log(result.gapSuggestedQueries); // ['Simon Willison education']
 * console.log(result.completeness);        // 0.6
 */
export async function searchWithGapDetection(
    query: string,
    options: SearchWithGapOptions = {},
    context: SearchContext
): Promise<{ response: SearchWithGapResponse; logger: SearchLogger }> {
    const {
        entityId,
        detectGaps: shouldDetectGaps = true,
        prioritizeGaps = true,
        ...searchOptions
    } = options;

    // 1. Detect gaps first (if entity provided)
    let gapResult: GapDetectionResult = {
        entityId: entityId || '',
        gaps: [],
        existingRelations: [],
        completeness: 1.0,
    };

    if (entityId && shouldDetectGaps) {
        gapResult = detectGaps(entityId);
        
        // Store gaps in database
        if (gapResult.gaps.length > 0) {
            detectAndStoreGaps([entityId]);
            log(`[SearchService] Detected ${gapResult.gaps.length} gaps for ${entityId} (completeness: ${(gapResult.completeness * 100).toFixed(0)}%)`);
        }
    }

    // 2. Optionally enhance query with gap-suggested queries
    let finalQuery = query;
    if (prioritizeGaps && gapResult.gaps.length > 0) {
        // Get high-priority gap queries
        const highPriorityGaps = gapResult.gaps.filter(
            g => g.priority === 'critical' || g.priority === 'high'
        );
        
        if (highPriorityGaps.length > 0) {
            // Log that we're using gap-informed search
            log(`[SearchService] ${highPriorityGaps.length} high-priority gaps inform search context`);
        }
    }

    // 3. Execute search with logging
    const { response, logger } = await searchWithLogging(finalQuery, searchOptions, context);

    // 4. Collect gap-suggested queries
    const gapSuggestedQueries = gapResult.gaps.flatMap(g => g.suggestedQueries);

    // 5. Return enhanced response
    const enhancedResponse: SearchWithGapResponse = {
        ...response,
        detectedGaps: gapResult.gaps,
        gapSuggestedQueries,
        completeness: gapResult.completeness,
    };

    return { response: enhancedResponse, logger };
}

/**
 * Get gap-informed search queries for an entity
 * 
 * Returns suggested queries based on detected gaps.
 * Useful when you want to proactively search for missing information.
 * 
 * @param entityId - Entity to get gap queries for
 * @param limit - Max number of queries to return
 * @returns Array of suggested search queries
 */
export function getGapInformedQueries(entityId: string, limit: number = 5): string[] {
    const openGaps = getOpenGaps(entityId, { priority: ['critical', 'high'] });
    
    const queries = openGaps
        .flatMap(g => g.suggestedQueries)
        .slice(0, limit);
    
    return queries;
}




