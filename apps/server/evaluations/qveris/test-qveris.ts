/**
 * Qveris API 测试脚本
 * 
 * 目的：验证 Qveris 平台的 web search 能力
 * 
 * 运行：pnpm tsx scripts/test-qveris.ts
 */

import 'dotenv/config';

const QVERIS_BASE_URL = 'https://qveris.ai/api/v1';
const API_KEY = process.env.QVERIS_API_KEY;

if (!API_KEY) {
    console.error('❌ QVERIS_API_KEY not found in .env');
    process.exit(1);
}

interface QverisToolResult {
    tool_id: string;
    name: string;
    description: string;
    provider_name?: string;
    params?: Array<{
        name: string;
        type: string;
        required: boolean;
        description: string;
    }>;
}

interface QverisSearchResponse {
    query: string;
    search_id: string;
    total: number;
    results: QverisToolResult[];
    stats?: { search_time_ms: number };
}

interface QverisExecuteResponse {
    execution_id: string;
    tool_id: string;
    result: any;
    success: boolean;
    error_message?: string;
    execution_time: number;
}

// Step 1: 搜索可用的工具
async function searchTools(query: string, limit = 10): Promise<QverisSearchResponse> {
    console.log(`\n🔍 Searching tools: "${query}"`);
    
    const startTime = Date.now();
    const response = await fetch(`${QVERIS_BASE_URL}/search`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Search failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as QverisSearchResponse;
    const elapsed = Date.now() - startTime;
    
    console.log(`✅ Found ${data.total} tools in ${elapsed}ms`);
    return data;
}

// Step 2: 执行工具
async function executeTool(
    toolId: string, 
    searchId: string, 
    parameters: Record<string, any>
): Promise<QverisExecuteResponse> {
    console.log(`\n⚡ Executing tool: ${toolId}`);
    console.log(`   Parameters:`, JSON.stringify(parameters, null, 2));
    
    const startTime = Date.now();
    const response = await fetch(`${QVERIS_BASE_URL}/tools/execute?tool_id=${encodeURIComponent(toolId)}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            search_id: searchId,
            parameters,
            max_data_size: 20480,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Execute failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as QverisExecuteResponse;
    const elapsed = Date.now() - startTime;
    
    console.log(`✅ Execution completed in ${elapsed}ms (API reported: ${data.execution_time}s)`);
    return data;
}

// 测试特定的搜索工具
async function testSearchTool(
    toolId: string,
    searchId: string,
    query: string,
    extraParams: Record<string, any> = {}
) {
    console.log('\n' + '-'.repeat(60));
    console.log(`测试工具: ${toolId}`);
    console.log('-'.repeat(60));

    try {
        const execResult = await executeTool(toolId, searchId, {
            q: query,
            ...extraParams,
        });

        console.log('\n📦 Result:');
        console.log(`   Success: ${execResult.success}`);
        if (execResult.error_message) {
            console.log(`   Error: ${execResult.error_message}`);
        }
        
        const resultStr = JSON.stringify(execResult.result, null, 2);
        console.log(`   Data preview (${resultStr.length} chars):`);
        console.log(resultStr.slice(0, 3000));
        
        if (resultStr.length > 3000) {
            console.log('   ... (truncated)');
        }

        return execResult;
    } catch (error) {
        console.error(`   ❌ Error: ${error}`);
        return null;
    }
}

// 主流程
async function main() {
    console.log('='.repeat(60));
    console.log('Qveris API 测试 - linkup.search');
    console.log('='.repeat(60));

    const testQuery = 'latest AI news December 2024';

    try {
        // 1. 搜索工具（需要获取 search_id）
        const searchResult = await searchTools('web search');
        
        // 2. 测试 linkup.search（最接近 Tavily 的工具）
        // linkup 参数: q*, depth*, outputType*, 可选: toDate, fromDate, includeImages, etc.
        await testSearchTool(
            'linkup.search.v1',
            searchResult.search_id,
            testQuery,
            {
                depth: 'standard',      // 'standard' | 'deep'
                outputType: 'searchResults',  // 'searchResults' | 'sourcedAnswer' | 'structured'
            }
        );

        // 3. 也测试一下 DuckDuckGo（免费备选）
        console.log('\n');
        await testSearchTool(
            'serpapi.duckduckgo.search.list.v1',
            searchResult.search_id,
            testQuery,
            {
                engine: 'duckduckgo',
            }
        );

    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }

    console.log('\n' + '='.repeat(60));
    console.log('测试完成');
    console.log('='.repeat(60));
}

main();

