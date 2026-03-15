/**
 * prism_ingest Tool
 * 将内容导入 Prism 记忆库（使用完整 Graph Link Pipeline）
 * 
 * Pipeline 包括：
 * 1. 写入 memories 表
 * 2. 生成 LLM summary
 * 3. 创建对应 entity (memory:x)
 * 4. Entity Extraction - 自动提取实体和关系
 * 5. Page Blocks - 构建页面结构
 * 
 * 支持两种模式：
 * 1. 直接导入内容（content）
 * 2. 导入文件路径（file_path）
 */

import fs from 'fs';
import { log, logError, logWarn } from '../../lib/logger.js';
import path from 'path';
import { graphWriter } from '../../lib/graph-link/index.js';
import { getMemoriesCount } from '../../ingest.js';
import { getDB } from '../../db.js';
import { AgentLogger } from '../../lib/agent-logger.js';
import { extractText as extractPdfText } from 'unpdf';

const logger = new AgentLogger('mcp');

export const ingestToolDef = {
    name: 'prism_ingest',
    description: '将内容导入 Prism 记忆库（支持直接传入内容或文件路径）',
    inputSchema: {
        type: 'object',
        properties: {
            content: {
                type: 'string',
                description: '要导入的 Markdown 内容（与 file_path 二选一）',
            },
            file_path: {
                type: 'string',
                description: '要导入的文件路径（与 content 二选一）',
            },
            title: {
                type: 'string',
                description: '内容标题（可选，会自动从内容中提取）',
            },
            source: {
                type: 'string',
                description: '来源标识（可选，用于标记内容来源）',
            },
            extract_entities: {
                type: 'boolean',
                description: '是否自动提取实体（默认 true，需要 OpenAI API）',
            },
        },
        required: [],
    },
};

interface IngestArgs {
    content?: string;
    file_path?: string;
    title?: string;
    source?: string;
    extract_entities?: boolean;
}

/**
 * Extract title from markdown content (first H1 or first line)
 */
function extractMarkdownTitle(content: string): string | undefined {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
        return h1Match[1].trim();
    }

    const firstLine = content.split('\n').find(line => line.trim().length > 0);
    if (firstLine && firstLine.length < 100) {
        return firstLine.trim();
    }

    return undefined;
}

export async function executeIngest(args: Record<string, unknown>): Promise<{
    success: boolean;
    memory_id?: number;
    title?: string;
    source_path?: string;
    total_memories?: number;
    entities_count?: number;
    relations_count?: number;
    error?: string;
}> {
    const { content, file_path, title: titleHint, source, extract_entities = true } = args as unknown as IngestArgs;

    // Validate: need either content or file_path
    if (!content && !file_path) {
        return {
            success: false,
            error: '需要提供 content 或 file_path 其中之一',
        };
    }

    // Check OpenAI availability if extraction is enabled (supports runtime keys + proxy)
    const { isOpenAIAvailable } = await import('../../lib/ai-clients.js');
    if (extract_entities && !isOpenAIAvailable()) {
        return {
            success: false,
            error: 'Entity extraction requires OpenAI. Set extract_entities=false to skip, or configure API key/proxy.',
        };
    }

    const logHandle = logger.start('ingest', { 
        mode: file_path ? 'file' : 'content',
        source: source || 'cursor',
        hasTitle: !!titleHint,
    });

    try {
        let fileContent: string;
        let sourceUrl: string;
        let title: string;

        if (file_path) {
            // Mode 1: Ingest from file path
            const absolutePath = path.resolve(file_path);
            
            if (!fs.existsSync(absolutePath)) {
                return {
                    success: false,
                    error: `文件不存在: ${absolutePath}`,
                };
            }

            const ext = path.extname(absolutePath).toLowerCase();
            
            // Handle PDF files - extract text using unpdf (works in compiled binary)
            if (ext === '.pdf') {
                try {
                    const pdfBuffer = fs.readFileSync(absolutePath);
                    const uint8Array = new Uint8Array(pdfBuffer);
                    const result = await extractPdfText(uint8Array);
                    fileContent = Array.isArray(result.text) ? result.text.join('\n') : result.text;
                    title = titleHint || path.basename(absolutePath, ext);
                } catch (pdfError) {
                    logError('PDF parsing failed:', pdfError);
                    return {
                        success: false,
                        error: `PDF 解析失败: ${String(pdfError)}`,
                    };
                }
            } else {
                // Text-based files (md, txt, etc.)
                fileContent = fs.readFileSync(absolutePath, 'utf-8');
                title = titleHint 
                    || extractMarkdownTitle(fileContent) 
                    || path.basename(absolutePath, ext);
            }
            
            sourceUrl = `file://${absolutePath}`;

        } else if (content) {
            // Mode 2: Ingest from content directly
            fileContent = content;
            
            // Generate a virtual path for tracking
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            sourceUrl = source 
                ? `drop://${source}/${timestamp}.md`
                : `drop://cursor/${timestamp}.md`;

            // Extract title from content or use hint
            title = titleHint || extractMarkdownTitle(fileContent) || 'Untitled';
        } else {
            return {
                success: false,
                error: '参数解析错误',
            };
        }

        // Use GraphWriter's full pipeline (includes entity extraction via middleware)
        log(`[Prism MCP Ingest] Starting full pipeline for: "${title}"`);
        
        const memoryId = await graphWriter.ingestFinding(sourceUrl, title, fileContent, []);
        
        log(`[Prism MCP Ingest] ✅ Ingested memory #${memoryId}`);

        // Get stats after ingestion
        const db = getDB();
        const entitiesCount = (db.query('SELECT COUNT(*) as count FROM entities').get() as { count: number }).count;
        const relationsCount = (db.query('SELECT COUNT(*) as count FROM relations').get() as { count: number }).count;

        logHandle.success({ memoryId, title, entitiesCount, relationsCount });

        return {
            success: true,
            memory_id: memoryId,
            title,
            source_path: sourceUrl,
            total_memories: getMemoriesCount(),
            entities_count: entitiesCount,
            relations_count: relationsCount,
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`[Prism MCP Ingest] ❌ Error: ${errorMessage}`);
        logHandle.error(error);
        return {
            success: false,
            error: errorMessage,
        };
    }
}
