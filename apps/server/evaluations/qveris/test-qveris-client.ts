/**
 * QverisClient 测试脚本
 * 
 * 运行：pnpm tsx scripts/test-qveris-client.ts
 */

import 'dotenv/config';
import { QverisClient, getQverisClient } from '../../src/lib/qveris-client.js';

async function main() {
    console.log('='.repeat(60));
    console.log('QverisClient 测试');
    console.log('='.repeat(60));

    const client = getQverisClient();
    
    if (!client) {
        console.error('❌ QverisClient not initialized. Check QVERIS_API_KEY in .env');
        process.exit(1);
    }

    const testQuery = 'OpenAI o3 model features';

    // Test 1: Linkup Search
    console.log('\n📍 Test 1: Linkup Search (AI 原生、高准确性)');
    console.log('-'.repeat(40));
    
    const linkupResult = await client.searchWithLinkup(testQuery, {
        depth: 'standard',
        maxResults: 5,
    });
    
    console.log(`   Success: ${linkupResult.success}`);
    console.log(`   Latency: ${linkupResult.latencyMs}ms`);
    console.log(`   Results: ${linkupResult.totalCount}`);
    
    if (linkupResult.error) {
        console.log(`   Error: ${linkupResult.error}`);
    } else if (linkupResult.results.length > 0) {
        console.log(`   First result:`);
        console.log(`     Title: ${linkupResult.results[0].title}`);
        console.log(`     URL: ${linkupResult.results[0].url}`);
        console.log(`     Content: ${linkupResult.results[0].content.slice(0, 150)}...`);
    }

    // Test 2: Google Search
    console.log('\n📍 Test 2: Google Search (全面覆盖)');
    console.log('-'.repeat(40));
    
    const googleResult = await client.searchWithGoogle(testQuery, {
        maxResults: 5,
    });
    
    console.log(`   Success: ${googleResult.success}`);
    console.log(`   Latency: ${googleResult.latencyMs}ms`);
    console.log(`   Results: ${googleResult.totalCount}`);
    
    if (googleResult.error) {
        console.log(`   Error: ${googleResult.error}`);
    } else if (googleResult.results.length > 0) {
        console.log(`   First result:`);
        console.log(`     Title: ${googleResult.results[0].title}`);
        console.log(`     URL: ${googleResult.results[0].url}`);
    }

    // Test 3: Tavily 兼容接口
    console.log('\n📍 Test 3: Tavily 兼容接口');
    console.log('-'.repeat(40));
    
    const tavilyCompatResult = await client.search(testQuery, {
        searchDepth: 'basic',
        maxResults: 3,
    });
    
    console.log(`   Results: ${tavilyCompatResult.results.length}`);
    if (tavilyCompatResult.results.length > 0) {
        console.log(`   First result: ${tavilyCompatResult.results[0].title}`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('测试总结');
    console.log('='.repeat(60));
    console.log(`
   Linkup:  ${linkupResult.success ? '✅' : '❌'} ${linkupResult.latencyMs}ms, ${linkupResult.totalCount} results
   Google:  ${googleResult.success ? '✅' : '❌'} ${googleResult.latencyMs}ms, ${googleResult.totalCount} results
   兼容接口: ${tavilyCompatResult.results.length > 0 ? '✅' : '❌'} ${tavilyCompatResult.results.length} results
    `);
}

main().catch(console.error);

