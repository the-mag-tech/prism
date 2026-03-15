/**
 * 测试 prism_search 的 fallback 逻辑
 * 
 * 运行：pnpm tsx scripts/test-search-fallback.ts
 */

import 'dotenv/config';
import { executeSearch } from '../src/mcp/tools/search.js';

async function main() {
    console.log('='.repeat(60));
    console.log('prism_search Fallback 测试');
    console.log('='.repeat(60));
    
    console.log('\n环境检查:');
    console.log(`  TAVILY_API_KEY: ${process.env.TAVILY_API_KEY ? '✅ 已配置' : '❌ 未配置'}`);
    console.log(`  QVERIS_API_KEY: ${process.env.QVERIS_API_KEY ? '✅ 已配置' : '❌ 未配置'}`);

    const testQuery = 'OpenAI o3 model features';
    
    console.log(`\n📍 测试查询: "${testQuery}"`);
    console.log('-'.repeat(40));

    const startTime = Date.now();
    const result = await executeSearch({
        query: testQuery,
        maxResults: 5,
        searchDepth: 'basic',
    });
    const elapsed = Date.now() - startTime;

    console.log(`\n结果:`);
    console.log(`  Success: ${result.success}`);
    console.log(`  Latency: ${elapsed}ms`);
    console.log(`  Results: ${result.totalCount}`);
    console.log(`  Answer: ${result.answer?.slice(0, 100)}...`);
    
    if (result.results.length > 0) {
        console.log(`\n  Top 3 结果:`);
        for (const r of result.results.slice(0, 3)) {
            console.log(`    📌 ${r.title}`);
            console.log(`       ${r.url}`);
        }
    }

    // 检测使用的是哪个服务
    const provider = result.answer?.includes('[via Qveris') ? 'Qveris (fallback)' : 'Tavily (primary)';
    console.log(`\n  Provider: ${provider}`);

    console.log('\n' + '='.repeat(60));
}

main().catch(console.error);






