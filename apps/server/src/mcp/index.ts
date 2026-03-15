#!/usr/bin/env node

/**
 * Prism MCP Server (stdio transport)
 * 将 Prism 的核心能力 (Graph/Scout/Recall) 暴露为 MCP Server
 * 供 Claude Desktop 等 AI 客户端调用
 * 
 * @ref mcp/stdio-server
 * @doc docs/PRISM-MCP-SPEC.md#52-claude-desktop
 * @since 2025-12
 * 
 * KEY SOURCES (Priority Order):
 *   1. Shared config file (~/.magpie/prism-config.json) @ref ai-clients/shared-config
 *   2. Environment variables (OPENAI_API_KEY, TAVILY_API_KEY)
 *   3. Proxy Mode (MAGPIE_PROXY_TOKEN + MAGPIE_PROXY_URL) @ref ai-clients/proxy-mode
 * 
 * NOTE: For best experience, run Magpie desktop app which automatically
 * manages API keys. The MCP binary will read from the shared config file.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { initDB } from '../db.js';
import { config } from '../config.js';
import { registerToolHandlers } from './tools/index.js';
import { loadSharedConfig, logAIServicesStatus, getSharedConfigPath } from '../lib/ai-clients.js';
import { enableMcpMode, log } from '../lib/logger.js';

/**
 * 主函数
 */
async function main() {
    // Enable MCP mode: all logs go to stderr to avoid polluting JSON-RPC stdout
    enableMcpMode();
    
    log('[Prism MCP] Prism MCP Server starting...');

    // 初始化数据库
    initDB(config.dbPath);
    log('[Prism MCP] Database connected');

    // Load API keys from shared config file (~/.magpie/prism-config.json)
    // This allows MCP binary to access the same keys configured in Magpie desktop
    const configLoaded = loadSharedConfig();
    if (!configLoaded) {
        log('[Prism MCP] ⚠️  No shared config found at:', getSharedConfigPath());
        log('[Prism MCP] ⚠️  Some tools (scout, search) may not work without API keys.');
        log('[Prism MCP] 💡 Tip: Configure keys in Magpie desktop app, or create config manually.');
    }
    
    // Log AI services status
    logAIServicesStatus();

    // 创建 MCP Server
    const server = new Server(
        {
            name: 'prism-mcp-server',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // 注册 Tool handlers
    registerToolHandlers(server);

    // 创建 stdio transport
    const transport = new StdioServerTransport();

    // 连接 server 和 transport
    await server.connect(transport);

    log('[Prism MCP] Server connected and ready');
}

// 错误处理 - always use console.error for fatal errors
main().catch((error) => {
    console.error('[Prism MCP] Fatal error:', error);
    process.exit(1);
});
