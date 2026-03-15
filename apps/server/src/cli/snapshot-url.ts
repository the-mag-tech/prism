/**
 * Snapshot URL CLI - 抓取 URL 内容保存为 memory
 * 
 * 手动挡工具：把链接内容固化为 memory（时间胶囊）
 * 
 * Usage:
 *   npm run snapshot https://example.com/article
 *   npm run snapshot https://linkedin.com/in/simon --paste
 */

import { initDB, getDB } from '../db.js';
import { config } from '../config.js';
import readline from 'readline';

// =============================================================================
// TYPES
// =============================================================================

interface SnapshotResult {
  url: string;
  title: string;
  content: string;
  capturedAt: string;
  method: 'auto' | 'manual_paste';
}

// =============================================================================
// URL FETCHING
// =============================================================================

/**
 * 检测 URL 类型
 */
function detectUrlType(url: string): 'linkedin' | 'twitter' | 'public' {
  if (url.includes('linkedin.com')) return 'linkedin';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  return 'public';
}

/**
 * 抓取公开 URL 内容
 */
async function fetchPublicUrl(url: string): Promise<{ title: string; content: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      console.log(`  ⚠️ HTTP ${response.status}`);
      return null;
    }

    const html = await response.text();
    
    // 简单的 HTML 解析
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;
    
    // 提取正文（简化版：移除 HTML 标签）
    let content = html
      // 移除 script/style
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      // 移除 HTML 标签
      .replace(/<[^>]+>/g, ' ')
      // 清理空白
      .replace(/\s+/g, ' ')
      .trim();
    
    // 限制长度
    if (content.length > 10000) {
      content = content.substring(0, 10000) + '...[truncated]';
    }

    return { title, content };
  } catch (error) {
    console.log(`  ❌ Fetch failed: ${error}`);
    return null;
  }
}

/**
 * 手动粘贴内容
 */
async function manualPaste(url: string): Promise<{ title: string; content: string } | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`
  📋 请手动粘贴 ${url} 的内容
  
  提示：在浏览器中打开链接，Cmd+A 全选，Cmd+C 复制
  然后在这里粘贴，完成后输入 END 并回车
  
  ---开始粘贴---
`);

  return new Promise((resolve) => {
    const lines: string[] = [];
    
    rl.on('line', (line) => {
      if (line.trim().toUpperCase() === 'END') {
        rl.close();
        const content = lines.join('\n').trim();
        
        if (!content) {
          resolve(null);
          return;
        }

        // 尝试从内容提取标题（第一行或前 50 字符）
        const firstLine = content.split('\n')[0].trim();
        const title = firstLine.length < 100 ? firstLine : firstLine.substring(0, 50) + '...';
        
        resolve({ title, content });
      } else {
        lines.push(line);
      }
    });
  });
}

// =============================================================================
// SAVE TO DB
// =============================================================================

function saveSnapshot(result: SnapshotResult): number {
  const db = getDB();
  
  const insert = db.query(`
    INSERT INTO memories (source_path, source_type, content, title, created_at)
    VALUES (?, 'url_snapshot', ?, ?, ?)
  `);
  
  const info = insert.run(
    result.url,
    `[Snapshot: ${result.url}]\n[Captured: ${result.capturedAt}]\n[Method: ${result.method}]\n\n${result.content}`,
    result.title,
    result.capturedAt
  );
  
  return info.lastInsertRowid as number;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const url = args.find(a => a.startsWith('http'));
  const forcePaste = args.includes('--paste') || args.includes('-p');

  if (!url) {
    console.error('❌ 请提供 URL');
    process.exit(1);
  }

  // Init DB
  initDB(config.dbPath);

  console.log(`
📸 Snapshot URL
${'═'.repeat(50)}

🔗 URL: ${url}
`);

  const urlType = detectUrlType(url);
  let result: SnapshotResult | null = null;

  if (forcePaste || urlType === 'linkedin' || urlType === 'twitter') {
    if (urlType !== 'public' && !forcePaste) {
      console.log(`  ⚠️ ${urlType} 需要登录，将使用手动粘贴模式`);
    }
    
    const pasted = await manualPaste(url);
    if (pasted) {
      result = {
        url,
        title: pasted.title,
        content: pasted.content,
        capturedAt: new Date().toISOString(),
        method: 'manual_paste',
      };
    }
  } else {
    console.log(`  🌐 正在抓取...`);
    const fetched = await fetchPublicUrl(url);
    
    if (fetched) {
      result = {
        url,
        title: fetched.title,
        content: fetched.content,
        capturedAt: new Date().toISOString(),
        method: 'auto',
      };
      console.log(`  ✓ 抓取成功: "${result.title}"`);
    } else {
      console.log(`  ⚠️ 自动抓取失败，切换到手动粘贴模式`);
      const pasted = await manualPaste(url);
      if (pasted) {
        result = {
          url,
          title: pasted.title,
          content: pasted.content,
          capturedAt: new Date().toISOString(),
          method: 'manual_paste',
        };
      }
    }
  }

  if (!result) {
    console.log(`\n❌ 没有内容，未保存`);
    process.exit(1);
  }

  // Save
  const memoryId = saveSnapshot(result);
  
  console.log(`
${'─'.repeat(50)}
✅ 保存成功！

   Memory ID: ${memoryId}
   Title: ${result.title}
   Method: ${result.method}
   Content: ${result.content.length} 字符

现在可以通过搜索找到这个内容：
   npm run recall "${result.title.split(' ')[0]}"
`);
}

function printHelp() {
  console.log(`
📸 Snapshot URL - 抓取链接内容保存为 memory

Usage:
  npm run snapshot <url>              自动抓取（公开链接）
  npm run snapshot <url> --paste      手动粘贴模式
  
Options:
  -p, --paste     强制使用手动粘贴模式
  -h, --help      显示帮助

Examples:
  npm run snapshot https://techcrunch.com/some-article
  npm run snapshot https://linkedin.com/in/simon --paste
  
自动检测：
  - LinkedIn, Twitter/X → 自动切换到手动粘贴
  - 其他公开链接 → 自动抓取
`);
}

main().catch(console.error);




