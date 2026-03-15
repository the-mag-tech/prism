#!/usr/bin/env node

/**
 * Prism MCP Setup CLI
 * 
 * 一键安装并注册到 Claude Desktop / Cursor
 * 
 * 用法：
 *   npm run setup              # 交互式安装
 *   npm run setup -- --auto    # 自动检测并安装到所有可用入口
 *   npm run setup -- --claude  # 仅 Claude Desktop
 *   npm run setup -- --cursor  # 仅 Cursor
 *   npm run setup -- --uninstall # 移除配置
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { fileURLToPath } from 'url';

// ESM 兼容的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CONFIG PATHS
// =============================================================================

interface ConfigLocation {
    name: string;
    path: string;
    exists: boolean;
}

function getConfigLocations(): { claude: ConfigLocation; cursor: ConfigLocation } {
    const home = os.homedir();
    const platform = os.platform();

    let claudePath: string;
    let cursorPath: string;

    if (platform === 'darwin') {
        // macOS
        claudePath = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        cursorPath = path.join(home, '.cursor', 'mcp.json');
    } else if (platform === 'win32') {
        // Windows
        claudePath = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
        cursorPath = path.join(home, '.cursor', 'mcp.json');
    } else {
        // Linux
        claudePath = path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
        cursorPath = path.join(home, '.cursor', 'mcp.json');
    }

    return {
        claude: {
            name: 'Claude Desktop',
            path: claudePath,
            exists: fs.existsSync(path.dirname(claudePath)),
        },
        cursor: {
            name: 'Cursor',
            path: cursorPath,
            exists: fs.existsSync(path.dirname(cursorPath)),
        },
    };
}

// =============================================================================
// PRISM CONFIG
// =============================================================================

function getPrismMcpConfig(): { command: string; args: string[] } {
    // 检查是否有编译后的文件
    const distMcpPath = path.resolve(__dirname, '../mcp/index.js');
    const srcMcpPath = path.resolve(__dirname, '../mcp/index.ts');

    if (fs.existsSync(distMcpPath)) {
        // 编译后模式：使用 node 运行 .js
        return {
            command: 'node',
            args: [distMcpPath],
        };
    } else if (fs.existsSync(srcMcpPath)) {
        // 开发模式：使用 tsx 运行 .ts
        return {
            command: 'npx',
            args: ['tsx', srcMcpPath],
        };
    } else {
        // 找不到文件，使用相对于包的路径
        const pkgRoot = path.resolve(__dirname, '../../');
        const fallbackPath = path.join(pkgRoot, 'src/mcp/index.ts');
        return {
            command: 'npx',
            args: ['tsx', fallbackPath],
        };
    }
}

// =============================================================================
// CONFIG OPERATIONS
// =============================================================================

function readConfig(configPath: string): Record<string, any> {
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch {
            return {};
        }
    }
    return {};
}

function writeConfig(configPath: string, config: Record<string, any>): void {
    // 确保目录存在
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // 备份现有配置
    if (fs.existsSync(configPath)) {
        const backupPath = configPath + '.backup';
        fs.copyFileSync(configPath, backupPath);
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function addPrismToConfig(configPath: string): boolean {
    const config = readConfig(configPath);
    const prismConfig = getPrismMcpConfig();

    // 合并配置（不覆盖其他 MCP servers）
    config.mcpServers = config.mcpServers || {};
    config.mcpServers.prism = prismConfig;

    writeConfig(configPath, config);
    return true;
}

function removePrismFromConfig(configPath: string): boolean {
    if (!fs.existsSync(configPath)) {
        return false;
    }

    const config = readConfig(configPath);
    if (config.mcpServers && config.mcpServers.prism) {
        delete config.mcpServers.prism;
        writeConfig(configPath, config);
        return true;
    }
    return false;
}

// =============================================================================
// UI HELPERS
// =============================================================================

function log(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info'): void {
    const icons = {
        info: '🔍',
        success: '✓',
        error: '✗',
        warn: '⚠',
    };
    console.log(`${icons[type]} ${message}`);
}

async function prompt(question: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(`${question} (y/n) `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
    const args = process.argv.slice(2);
    const isAuto = args.includes('--auto');
    const onlyClaude = args.includes('--claude');
    const onlyCursor = args.includes('--cursor');
    const isUninstall = args.includes('--uninstall');

    console.log('\n🔮 Prism MCP Setup\n');

    const locations = getConfigLocations();
    const detectedTools: string[] = [];

    // 检测可用工具
    log('Detecting AI tools...');

    if (locations.claude.exists) {
        log(`${locations.claude.name} found`, 'success');
        detectedTools.push('claude');
    }

    if (locations.cursor.exists) {
        log(`${locations.cursor.name} found`, 'success');
        detectedTools.push('cursor');
    }

    if (detectedTools.length === 0) {
        log('No supported AI tools detected.', 'warn');
        log('Please install Claude Desktop or Cursor first.');
        process.exit(1);
    }

    console.log('');

    // 卸载模式
    if (isUninstall) {
        log('Uninstalling Prism MCP...');

        if (detectedTools.includes('claude')) {
            if (removePrismFromConfig(locations.claude.path)) {
                log(`Removed from ${locations.claude.name}`, 'success');
            }
        }

        if (detectedTools.includes('cursor')) {
            if (removePrismFromConfig(locations.cursor.path)) {
                log(`Removed from ${locations.cursor.name}`, 'success');
            }
        }

        log('Uninstall complete. Restart your AI tools to apply changes.', 'success');
        return;
    }

    // 确定要配置的工具
    let targetsToConfig: string[] = [];

    if (onlyClaude) {
        targetsToConfig = detectedTools.filter(t => t === 'claude');
    } else if (onlyCursor) {
        targetsToConfig = detectedTools.filter(t => t === 'cursor');
    } else if (isAuto) {
        targetsToConfig = detectedTools;
    } else {
        // 交互模式
        for (const tool of detectedTools) {
            const location = tool === 'claude' ? locations.claude : locations.cursor;
            const shouldConfig = await prompt(`Register Prism MCP with ${location.name}?`);
            if (shouldConfig) {
                targetsToConfig.push(tool);
            }
        }
    }

    if (targetsToConfig.length === 0) {
        log('No tools selected for configuration.', 'warn');
        return;
    }

    // 执行配置
    console.log('');
    log('Configuring...');

    for (const tool of targetsToConfig) {
        const location = tool === 'claude' ? locations.claude : locations.cursor;
        try {
            addPrismToConfig(location.path);
            log(`Registered with ${location.name}`, 'success');
        } catch (error) {
            log(`Failed to configure ${location.name}: ${error}`, 'error');
        }
    }

    console.log('');
    log('Setup complete!', 'success');
    log('Restart your AI tools to activate Prism MCP.', 'info');
    console.log('');
}

main().catch((error) => {
    log(`Setup failed: ${error}`, 'error');
    process.exit(1);
});
