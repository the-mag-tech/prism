/**
 * 搜索服务基准测试
 * 
 * 评估维度：
 * 1. 速度（延迟）
 * 2. 价格（成本估算）
 * 3. 多样性/准确性（结果质量）
 * 
 * 运行：pnpm tsx scripts/benchmark-search.ts
 */

import 'dotenv/config';

// =============================================================================
// 配置
// =============================================================================

const QVERIS_BASE_URL = 'https://qveris.ai/api/v1';
const QVERIS_API_KEY = process.env.QVERIS_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// 测试用例：不同类型的查询
const TEST_QUERIES = [
    { type: 'news', query: 'OpenAI o3 model release December 2024' },
    { type: 'tech', query: 'how does RAG retrieval augmented generation work' },
    { type: 'person', query: 'Sam Altman CEO OpenAI background' },
    { type: 'event', query: 'NeurIPS 2024 conference highlights' },
    { type: 'product', query: 'Claude 3.5 Sonnet vs GPT-4 comparison' },
];

// 要测试的 Qveris 工具
const QVERIS_TOOLS = [
    {
        id: 'linkup.search.v1',
        name: 'Linkup Search',
        params: { depth: 'standard', outputType: 'searchResults' },
    },
    {
        id: 'serpapi.duckduckgo.search.list.v1',
        name: 'DuckDuckGo (SerpAPI)',
        params: { engine: 'duckduckgo' },
    },
    {
        id: 'scrapingbee.store.google.query.v1',
        name: 'Google (ScrapingBee)',
        params: {},
        queryParam: 'search', // 这个工具用 search 而不是 q
    },
];

// 价格信息（估算，需要确认）
const PRICING_INFO: Record<string, { perRequest: number; notes: string }> = {
    'tavily': { perRequest: 0.01, notes: 'Tavily: ~$0.01/search (估算)' },
    'linkup.search.v1': { perRequest: 0.005, notes: 'Qveris Linkup: 按 Qveris 定价' },
    'serpapi.duckduckgo.search.list.v1': { perRequest: 0.005, notes: 'Qveris SerpAPI: 按 Qveris 定价' },
    'scrapingbee.store.google.query.v1': { perRequest: 0.005, notes: 'Qveris ScrapingBee: 按 Qveris 定价' },
};

// =============================================================================
// 类型定义
// =============================================================================

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    source?: string;
}

interface BenchmarkResult {
    provider: string;
    toolId: string;
    query: string;
    queryType: string;
    latencyMs: number;
    success: boolean;
    error?: string;
    resultCount: number;
    results: SearchResult[];
    rawResponse?: any;
}

interface ProviderSummary {
    provider: string;
    avgLatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    successRate: number;
    avgResultCount: number;
    estimatedCostPer1000: number;
    uniqueDomains: Set<string>;
}

// =============================================================================
// Qveris 客户端
// =============================================================================

let cachedSearchId: string | null = null;

async function getQverisSearchId(): Promise<string> {
    if (cachedSearchId) return cachedSearchId;
    
    const response = await fetch(`${QVERIS_BASE_URL}/search`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${QVERIS_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'web search', limit: 5 }),
    });

    if (!response.ok) {
        throw new Error(`Failed to get search_id: ${response.status}`);
    }

    const data = await response.json() as { search_id: string };
    cachedSearchId = data.search_id;
    return cachedSearchId;
}

async function searchWithQveris(
    toolId: string,
    query: string,
    extraParams: Record<string, any> = {},
    queryParam = 'q'
): Promise<{ latencyMs: number; success: boolean; error?: string; results: SearchResult[]; raw: any }> {
    const searchId = await getQverisSearchId();
    
    const params: Record<string, any> = { ...extraParams };
    params[queryParam] = query;

    const startTime = Date.now();
    const response = await fetch(
        `${QVERIS_BASE_URL}/tools/execute?tool_id=${encodeURIComponent(toolId)}`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${QVERIS_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                search_id: searchId,
                parameters: params,
                max_data_size: 30000,
            }),
        }
    );
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
        const error = await response.text();
        return { latencyMs, success: false, error, results: [], raw: null };
    }

    const data = await response.json() as any;
    
    if (!data.success && data.result?.error_details) {
        return { latencyMs, success: false, error: data.result.error_details, results: [], raw: data };
    }

    // 解析结果
    const results = parseQverisResults(toolId, data);
    
    return { latencyMs, success: true, results, raw: data };
}

/**
 * 安全解析可能被截断的 JSON
 * 尝试提取完整的对象，忽略截断的部分
 */
function safeParseJsonArray(jsonStr: string, arrayKey: string): any[] {
    try {
        // 先尝试直接解析
        const parsed = JSON.parse(jsonStr);
        return parsed[arrayKey] || [];
    } catch {
        // JSON 被截断，尝试提取完整的对象
        const results: any[] = [];
        
        // 找到数组开始的位置
        const arrayStart = jsonStr.indexOf(`"${arrayKey}": [`);
        if (arrayStart === -1) return [];
        
        const contentStart = jsonStr.indexOf('[', arrayStart);
        if (contentStart === -1) return [];
        
        // 逐个提取完整的对象
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
                    // 找到一个完整的对象
                    try {
                        const objStr = jsonStr.slice(objStart, i + 1);
                        const obj = JSON.parse(objStr);
                        results.push(obj);
                    } catch {
                        // 这个对象解析失败，跳过
                    }
                    objStart = -1;
                }
            }
        }
        
        return results;
    }
}

function parseQverisResults(toolId: string, data: any): SearchResult[] {
    const results: SearchResult[] = [];
    
    try {
        if (toolId === 'linkup.search.v1') {
            // Linkup 返回格式：truncated_content 是 JSON 字符串
            const content = data.result?.truncated_content || data.result?.data;
            if (typeof content === 'string') {
                // 使用安全解析处理可能被截断的 JSON
                const parsedResults = safeParseJsonArray(content, 'results');
                for (const r of parsedResults) {
                    results.push({
                        title: r.name || '',
                        url: r.url || '',
                        snippet: (r.content || '').slice(0, 500),
                        source: 'linkup',
                    });
                }
            }
        } else if (toolId.includes('duckduckgo') || toolId.includes('serpapi')) {
            // SerpAPI 格式：可能在 data.result.data 或 truncated_content 中
            let organic = data.result?.data?.organic_results;
            
            // 如果 data 为空，尝试解析 truncated_content
            if (!organic && data.result?.truncated_content) {
                try {
                    const parsed = JSON.parse(data.result.truncated_content);
                    organic = parsed.organic_results || [];
                } catch {
                    organic = safeParseJsonArray(data.result.truncated_content, 'organic_results');
                }
            }
            
            for (const r of organic || []) {
                results.push({
                    title: r.title || '',
                    url: r.link || '',
                    snippet: r.snippet || '',
                    source: 'serpapi',
                });
            }
        } else if (toolId.includes('scrapingbee')) {
            // ScrapingBee 格式
            let organic = data.result?.data?.organic_results || data.result?.organic_results;
            
            // 尝试解析 truncated_content
            if (!organic && data.result?.truncated_content) {
                try {
                    const parsed = JSON.parse(data.result.truncated_content);
                    organic = parsed.organic_results || [];
                } catch {
                    organic = safeParseJsonArray(data.result.truncated_content, 'organic_results');
                }
            }
            
            for (const r of organic || []) {
                results.push({
                    title: r.title || '',
                    url: r.link || r.url || '',
                    snippet: r.snippet || r.description || '',
                    source: 'scrapingbee',
                });
            }
        }
    } catch (e) {
        // 解析失败，返回空
        console.error(`[parseQverisResults] Error parsing ${toolId}:`, e);
    }
    
    return results;
}

// =============================================================================
// Tavily 客户端
// =============================================================================

async function searchWithTavily(query: string): Promise<{ latencyMs: number; success: boolean; error?: string; results: SearchResult[]; raw: any }> {
    if (!TAVILY_API_KEY) {
        return { latencyMs: 0, success: false, error: 'No Tavily API key', results: [], raw: null };
    }

    const startTime = Date.now();
    try {
        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: TAVILY_API_KEY,
                query,
                max_results: 10,
                include_answer: true,
            }),
        });
        const latencyMs = Date.now() - startTime;

        if (!response.ok) {
            const error = await response.text();
            return { latencyMs, success: false, error, results: [], raw: null };
        }

        const data = await response.json() as any;
        const results: SearchResult[] = (data.results || []).map((r: any) => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.content || '',
            source: 'tavily',
        }));

        return { latencyMs, success: true, results, raw: data };
    } catch (e) {
        return { latencyMs: Date.now() - startTime, success: false, error: String(e), results: [], raw: null };
    }
}

// =============================================================================
// 基准测试
// =============================================================================

async function runBenchmark(): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const totalTests = (QVERIS_TOOLS.length + 1) * TEST_QUERIES.length;
    let completed = 0;

    console.log(`\n🚀 开始基准测试：${totalTests} 个测试用例\n`);

    for (const testCase of TEST_QUERIES) {
        // 测试 Tavily
        if (TAVILY_API_KEY) {
            process.stdout.write(`  [${++completed}/${totalTests}] Tavily: "${testCase.query.slice(0, 30)}..."  `);
            const tavilyResult = await searchWithTavily(testCase.query);
            results.push({
                provider: 'Tavily',
                toolId: 'tavily',
                query: testCase.query,
                queryType: testCase.type,
                latencyMs: tavilyResult.latencyMs,
                success: tavilyResult.success,
                error: tavilyResult.error,
                resultCount: tavilyResult.results.length,
                results: tavilyResult.results,
                rawResponse: tavilyResult.raw,
            });
            console.log(tavilyResult.success ? `✅ ${tavilyResult.latencyMs}ms` : `❌ ${tavilyResult.error}`);
            await sleep(500); // 避免 rate limit
        }

        // 测试 Qveris 工具
        for (const tool of QVERIS_TOOLS) {
            process.stdout.write(`  [${++completed}/${totalTests}] ${tool.name}: "${testCase.query.slice(0, 30)}..."  `);
            const qverisResult = await searchWithQveris(
                tool.id,
                testCase.query,
                tool.params,
                tool.queryParam || 'q'
            );
            results.push({
                provider: `Qveris/${tool.name}`,
                toolId: tool.id,
                query: testCase.query,
                queryType: testCase.type,
                latencyMs: qverisResult.latencyMs,
                success: qverisResult.success,
                error: qverisResult.error,
                resultCount: qverisResult.results.length,
                results: qverisResult.results,
                rawResponse: qverisResult.raw,
            });
            console.log(qverisResult.success ? `✅ ${qverisResult.latencyMs}ms (${qverisResult.results.length} results)` : `❌ ${qverisResult.error?.slice(0, 50)}`);
            await sleep(500);
        }
    }

    return results;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// 分析和报告
// =============================================================================

function analyzeResults(results: BenchmarkResult[]): Map<string, ProviderSummary> {
    const summaries = new Map<string, ProviderSummary>();

    // 按 provider 分组
    const byProvider = new Map<string, BenchmarkResult[]>();
    for (const r of results) {
        const key = r.provider;
        if (!byProvider.has(key)) byProvider.set(key, []);
        byProvider.get(key)!.push(r);
    }

    for (const [provider, providerResults] of byProvider) {
        const successful = providerResults.filter(r => r.success);
        const latencies = successful.map(r => r.latencyMs);
        
        // 收集所有唯一域名
        const domains = new Set<string>();
        for (const r of successful) {
            for (const result of r.results) {
                try {
                    const url = new URL(result.url);
                    domains.add(url.hostname);
                } catch {}
            }
        }

        const toolId = providerResults[0]?.toolId || '';
        const pricing = PRICING_INFO[toolId] || { perRequest: 0.01, notes: '' };

        summaries.set(provider, {
            provider,
            avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
            minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : 0,
            maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
            successRate: providerResults.length > 0 ? successful.length / providerResults.length : 0,
            avgResultCount: successful.length > 0 ? successful.reduce((a, b) => a + b.resultCount, 0) / successful.length : 0,
            estimatedCostPer1000: pricing.perRequest * 1000,
            uniqueDomains: domains,
        });
    }

    return summaries;
}

function printReport(results: BenchmarkResult[], summaries: Map<string, ProviderSummary>) {
    console.log('\n');
    console.log('='.repeat(80));
    console.log('📊 基准测试报告');
    console.log('='.repeat(80));

    // 1. 速度对比
    console.log('\n📈 1. 速度对比 (延迟 ms)\n');
    console.log('| Provider | Avg | Min | Max | 成功率 |');
    console.log('|----------|-----|-----|-----|--------|');
    for (const [, s] of summaries) {
        console.log(`| ${s.provider.padEnd(25)} | ${Math.round(s.avgLatencyMs).toString().padStart(5)} | ${Math.round(s.minLatencyMs).toString().padStart(5)} | ${Math.round(s.maxLatencyMs).toString().padStart(5)} | ${(s.successRate * 100).toFixed(0).padStart(3)}% |`);
    }

    // 2. 价格估算
    console.log('\n💰 2. 价格估算 (每 1000 次请求)\n');
    console.log('| Provider | 估算成本 | 备注 |');
    console.log('|----------|---------|------|');
    for (const [, s] of summaries) {
        const toolId = results.find(r => r.provider === s.provider)?.toolId || '';
        const pricing = PRICING_INFO[toolId];
        console.log(`| ${s.provider.padEnd(25)} | $${s.estimatedCostPer1000.toFixed(2).padStart(6)} | ${pricing?.notes || '需确认'} |`);
    }

    // 3. 结果多样性
    console.log('\n🌐 3. 结果多样性\n');
    console.log('| Provider | 平均结果数 | 唯一域名数 |');
    console.log('|----------|-----------|-----------|');
    for (const [, s] of summaries) {
        console.log(`| ${s.provider.padEnd(25)} | ${s.avgResultCount.toFixed(1).padStart(9)} | ${s.uniqueDomains.size.toString().padStart(9)} |`);
    }

    // 4. 按查询类型的成功率
    console.log('\n🎯 4. 按查询类型的表现\n');
    const queryTypes = [...new Set(results.map(r => r.queryType))];
    const providers = [...summaries.keys()];
    
    console.log('| 查询类型 | ' + providers.map(p => p.slice(0, 15).padEnd(15)).join(' | ') + ' |');
    console.log('|----------|' + providers.map(() => '-'.repeat(15) + '-|').join(''));
    
    for (const qType of queryTypes) {
        const row = [qType.padEnd(8)];
        for (const provider of providers) {
            const typeResults = results.filter(r => r.queryType === qType && r.provider === provider);
            const successCount = typeResults.filter(r => r.success).length;
            const avgLatency = typeResults.filter(r => r.success).reduce((a, b) => a + b.latencyMs, 0) / (successCount || 1);
            row.push(`${successCount}/${typeResults.length} ${Math.round(avgLatency)}ms`.padEnd(15));
        }
        console.log('| ' + row.join(' | ') + ' |');
    }

    // 5. 综合评分
    console.log('\n🏆 5. 综合评分 (满分 100)\n');
    const scores: Array<{ provider: string; score: number; breakdown: string }> = [];
    
    // 找到基准值用于归一化
    const allLatencies = [...summaries.values()].map(s => s.avgLatencyMs).filter(l => l > 0);
    const minLatency = Math.min(...allLatencies);
    const maxLatency = Math.max(...allLatencies);
    
    for (const [, s] of summaries) {
        if (s.avgLatencyMs === 0) continue;
        
        // 速度分 (40分)：延迟越低越好
        const speedScore = 40 * (1 - (s.avgLatencyMs - minLatency) / (maxLatency - minLatency + 1));
        
        // 成功率分 (30分)
        const reliabilityScore = 30 * s.successRate;
        
        // 多样性分 (30分)：域名数量
        const maxDomains = Math.max(...[...summaries.values()].map(x => x.uniqueDomains.size));
        const diversityScore = 30 * (s.uniqueDomains.size / (maxDomains || 1));
        
        const totalScore = speedScore + reliabilityScore + diversityScore;
        scores.push({
            provider: s.provider,
            score: totalScore,
            breakdown: `速度=${speedScore.toFixed(0)}, 可靠=${reliabilityScore.toFixed(0)}, 多样=${diversityScore.toFixed(0)}`,
        });
    }
    
    scores.sort((a, b) => b.score - a.score);
    
    console.log('| 排名 | Provider | 总分 | 分项 |');
    console.log('|------|----------|------|------|');
    scores.forEach((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
        console.log(`| ${medal} ${i + 1} | ${s.provider.padEnd(25)} | ${s.score.toFixed(1).padStart(4)} | ${s.breakdown} |`);
    });

    // 6. 样例结果展示
    console.log('\n📝 6. 样例结果对比 (第一个查询)\n');
    const firstQuery = TEST_QUERIES[0].query;
    const firstResults = results.filter(r => r.query === firstQuery && r.success);
    
    for (const r of firstResults) {
        console.log(`\n--- ${r.provider} ---`);
        if (r.results.length === 0) {
            console.log('  (无解析结果，可能需要调整解析器)');
            continue;
        }
        for (const result of r.results.slice(0, 3)) {
            console.log(`  📌 ${result.title.slice(0, 60)}`);
            console.log(`     ${result.url}`);
            console.log(`     ${result.snippet.slice(0, 100)}...`);
        }
    }
}

// =============================================================================
// 主函数
// =============================================================================

async function main() {
    console.log('='.repeat(80));
    console.log('🔬 搜索服务基准测试');
    console.log('='.repeat(80));
    console.log(`\n测试环境:`);
    console.log(`  - Qveris API: ${QVERIS_API_KEY ? '✅ 已配置' : '❌ 未配置'}`);
    console.log(`  - Tavily API: ${TAVILY_API_KEY ? '✅ 已配置' : '⚠️ 未配置 (跳过)'}`);
    console.log(`  - 测试用例: ${TEST_QUERIES.length} 个查询`);
    console.log(`  - Qveris 工具: ${QVERIS_TOOLS.map(t => t.name).join(', ')}`);

    if (!QVERIS_API_KEY) {
        console.error('\n❌ QVERIS_API_KEY not found in .env');
        process.exit(1);
    }

    try {
        const results = await runBenchmark();
        const summaries = analyzeResults(results);
        printReport(results, summaries);
    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }

    console.log('\n' + '='.repeat(80));
    console.log('测试完成');
    console.log('='.repeat(80));
}

main();

