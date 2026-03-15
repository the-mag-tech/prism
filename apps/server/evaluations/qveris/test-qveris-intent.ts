/**
 * Qveris Intent Router 能力测试
 * 
 * 目的：验证 Qveris 是否能正确理解语义化查询，推荐合适的工具
 * 
 * 运行：pnpm tsx scripts/test-qveris-intent.ts
 */

import 'dotenv/config';

const QVERIS_BASE_URL = 'https://qveris.ai/api/v1';
const API_KEY = process.env.QVERIS_API_KEY;

if (!API_KEY) {
    console.error('❌ QVERIS_API_KEY not found in .env');
    process.exit(1);
}

// =============================================================================
// 测试用例：不同类型的语义化查询
// =============================================================================

interface TestCase {
    query: string;
    expectedCategory: string;
    expectedTools: string[];  // 期望推荐的工具关键词
    description: string;
}

const TEST_CASES: TestCase[] = [
    {
        query: 'search the web for latest AI news',
        expectedCategory: 'web_search',
        expectedTools: ['search', 'google', 'bing', 'linkup'],
        description: '通用网页搜索',
    },
    {
        query: 'find recent news articles about OpenAI',
        expectedCategory: 'news',
        expectedTools: ['news', 'search', 'google'],
        description: '新闻搜索',
    },
    {
        query: 'get current weather in Beijing',
        expectedCategory: 'weather',
        expectedTools: ['weather', 'openweather'],
        description: '天气查询',
    },
    {
        query: 'stock price of AAPL Apple',
        expectedCategory: 'finance',
        expectedTools: ['stock', 'finance', 'market', 'price'],
        description: '股票/金融数据',
    },
    {
        query: 'search for video tutorials about machine learning',
        expectedCategory: 'video',
        expectedTools: ['video', 'youtube', 'brave'],
        description: '视频搜索',
    },
    {
        query: 'extract content from a webpage URL',
        expectedCategory: 'scraping',
        expectedTools: ['scrape', 'extract', 'content', 'reader'],
        description: '网页内容提取',
    },
    {
        query: 'translate text from English to Chinese',
        expectedCategory: 'translation',
        expectedTools: ['translate', 'language'],
        description: '翻译服务',
    },
    {
        query: 'search academic papers about transformers',
        expectedCategory: 'academic',
        expectedTools: ['academic', 'paper', 'scholar', 'arxiv'],
        description: '学术搜索',
    },
    {
        query: 'find images of cats',
        expectedCategory: 'image',
        expectedTools: ['image', 'photo', 'picture'],
        description: '图片搜索',
    },
    {
        query: 'get cryptocurrency bitcoin price',
        expectedCategory: 'crypto',
        expectedTools: ['crypto', 'bitcoin', 'coin', 'binance'],
        description: '加密货币',
    },
];

// =============================================================================
// 测试函数
// =============================================================================

interface QverisTool {
    tool_id: string;
    name: string;
    description: string;
    provider_name?: string;
}

interface QverisSearchResponse {
    query: string;
    search_id: string;
    total: number;
    results: QverisTool[];
    stats?: { search_time_ms: number };
}

async function searchTools(query: string): Promise<QverisSearchResponse> {
    const response = await fetch(`${QVERIS_BASE_URL}/search`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit: 10 }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Search failed: ${response.status} - ${error}`);
    }

    return response.json() as Promise<QverisSearchResponse>;
}

function evaluateMatch(tools: QverisTool[], expectedTools: string[]): {
    matched: boolean;
    matchedKeywords: string[];
    topToolsInfo: string[];
} {
    const matchedKeywords: string[] = [];
    const topToolsInfo: string[] = [];

    for (const tool of tools.slice(0, 5)) {
        const toolText = `${tool.tool_id} ${tool.name} ${tool.description}`.toLowerCase();
        topToolsInfo.push(`${tool.name} (${tool.tool_id})`);
        
        for (const expected of expectedTools) {
            if (toolText.includes(expected.toLowerCase()) && !matchedKeywords.includes(expected)) {
                matchedKeywords.push(expected);
            }
        }
    }

    return {
        matched: matchedKeywords.length > 0,
        matchedKeywords,
        topToolsInfo,
    };
}

// =============================================================================
// 主函数
// =============================================================================

async function main() {
    console.log('='.repeat(70));
    console.log('Qveris Intent Router 能力测试');
    console.log('='.repeat(70));
    console.log('\n测试目的：验证 Qveris 是否能正确理解语义化查询，推荐合适的工具\n');

    const results: Array<{
        testCase: TestCase;
        success: boolean;
        matchedKeywords: string[];
        topTools: string[];
        latencyMs: number;
        error?: string;
    }> = [];

    for (let i = 0; i < TEST_CASES.length; i++) {
        const testCase = TEST_CASES[i];
        console.log(`[${i + 1}/${TEST_CASES.length}] ${testCase.description}`);
        console.log(`    Query: "${testCase.query}"`);
        console.log(`    期望: ${testCase.expectedTools.join(', ')}`);

        const startTime = Date.now();
        try {
            const response = await searchTools(testCase.query);
            const latencyMs = Date.now() - startTime;

            const evaluation = evaluateMatch(response.results, testCase.expectedTools);

            console.log(`    结果: ${evaluation.matched ? '✅ 匹配' : '❌ 不匹配'}`);
            console.log(`    命中关键词: ${evaluation.matchedKeywords.join(', ') || '(无)'}`);
            console.log(`    Top 3 工具: ${evaluation.topToolsInfo.slice(0, 3).join(' | ')}`);
            console.log(`    延迟: ${latencyMs}ms`);
            console.log('');

            results.push({
                testCase,
                success: evaluation.matched,
                matchedKeywords: evaluation.matchedKeywords,
                topTools: evaluation.topToolsInfo,
                latencyMs,
            });

            // 避免 rate limit
            await new Promise(resolve => setTimeout(resolve, 300));

        } catch (error) {
            const latencyMs = Date.now() - startTime;
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.log(`    ❌ 错误: ${errorMsg}`);
            console.log('');

            results.push({
                testCase,
                success: false,
                matchedKeywords: [],
                topTools: [],
                latencyMs,
                error: errorMsg,
            });
        }
    }

    // ==========================================================================
    // 汇总报告
    // ==========================================================================

    console.log('\n' + '='.repeat(70));
    console.log('📊 汇总报告');
    console.log('='.repeat(70));

    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => r.error).length;
    const avgLatency = results.reduce((a, b) => a + b.latencyMs, 0) / results.length;

    console.log(`\n整体表现:`);
    console.log(`  - 测试用例: ${TEST_CASES.length}`);
    console.log(`  - 匹配成功: ${successCount} (${(successCount / TEST_CASES.length * 100).toFixed(0)}%)`);
    console.log(`  - 匹配失败: ${TEST_CASES.length - successCount - errorCount}`);
    console.log(`  - 请求错误: ${errorCount}`);
    console.log(`  - 平均延迟: ${avgLatency.toFixed(0)}ms`);

    console.log(`\n分类别表现:`);
    console.log('| 类别 | 结果 | 命中关键词 | Top 工具 |');
    console.log('|------|------|-----------|---------|');
    
    for (const r of results) {
        const status = r.error ? '⚠️ 错误' : (r.success ? '✅' : '❌');
        const keywords = r.matchedKeywords.slice(0, 2).join(',') || '-';
        const tool = r.topTools[0]?.split(' ')[0] || '-';
        console.log(`| ${r.testCase.description.padEnd(12)} | ${status} | ${keywords.padEnd(10)} | ${tool} |`);
    }

    // 结论
    console.log(`\n📝 结论:`);
    if (successCount >= TEST_CASES.length * 0.7) {
        console.log('  ✅ Qveris Intent Router 表现良好，可以作为「懂数据的意图识别」层');
    } else if (successCount >= TEST_CASES.length * 0.5) {
        console.log('  ⚠️ Qveris Intent Router 表现一般，部分场景需要 Prism 补充');
    } else {
        console.log('  ❌ Qveris Intent Router 表现不佳，建议 Prism 自己做工具选择');
    }

    console.log('\n' + '='.repeat(70));
}

main().catch(console.error);

