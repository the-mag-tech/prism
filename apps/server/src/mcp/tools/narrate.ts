/**
 * prism_narrate Tool
 * 
 * @deprecated 2025-12-26
 * 
 * ============================================================================
 * ⚠️ DEPRECATED - DO NOT USE
 * ============================================================================
 * 
 * This tool attempted to generate narratives via LLM calls, but we learned
 * that this approach leads to:
 * - "Metaphor Trap": Fabricating allegories instead of telling real stories
 * - "Data Dump": Listing facts without narrative arc
 * - Rigid outputs that can't adapt to conversation context
 * 
 * BETTER APPROACH:
 * Let Claude Agent apply storytelling principles naturally during conversation.
 * See `.claude/skills/storytelling/` for the principles and frameworks.
 * 
 * Use `buildGraphSnapshot()` from `lib/storytelling` to extract graph data,
 * then include it in your Claude Agent conversation context.
 * 
 * ============================================================================
 * KEEPING FOR REFERENCE ONLY
 * ============================================================================
 */

import {
    buildGraphSnapshot,
    TRIBE_STYLES,
    type TribeStyle,
    type StoryLength,
    type GraphSnapshot,
    type StoryEntity,
    type StoryRelation,
} from '../../lib/storytelling/index.js';
import { getOpenAI, isOpenAIAvailable } from '../../lib/ai-clients.js';

export const narrateToolDef = {
    name: 'prism_narrate',
    description: '[DEV] 从知识图谱生成个性化叙事。使用 Ira Glass 叙事结构和 Tribe 风格（Archivist/Salesman/Gardener/Logger）。实验性功能。',
    inputSchema: {
        type: 'object',
        properties: {
            tribe: {
                type: 'string',
                enum: ['archivist', 'salesman', 'gardener', 'logger'],
                description: '叙事风格：archivist（知识连接）、salesman（行动机会）、gardener（关系关怀）、logger（自我反思）',
            },
            length: {
                type: 'string',
                enum: ['micro', 'short', 'medium', 'long'],
                description: '叙事长度：micro（10-30秒）、short（1-2分钟）、medium（3-5分钟）、long（5-10分钟）',
            },
            focusEntityId: {
                type: 'string',
                description: '可选：聚焦于某个特定实体（entity ID）',
            },
            language: {
                type: 'string',
                enum: ['en', 'zh-CN', 'ja'],
                description: '输出语言（默认 en）',
            },
            limit: {
                type: 'number',
                description: '从图谱中获取的最大实体数量（默认 10）',
            },
        },
        required: [],
    },
};

interface NarrateArgs {
    tribe?: TribeStyle;
    length?: StoryLength;
    focusEntityId?: string;
    language?: 'en' | 'zh-CN' | 'ja';
    limit?: number;
}

interface NarrateResult {
    story: string;
    metadata: {
        tribe: TribeStyle;
        tribeDescription: string;
        length: StoryLength;
        wordCount: number;
        estimatedDuration: string;
        language: string;
        mentionedEntities: string[];
    };
    debug?: {
        snapshotStats: {
            topGravityCount: number;
            sparksCount: number;
            dormantCount: number;
            relationsCount: number;
        };
    };
}

/**
 * @deprecated Use buildGraphSnapshot() + Claude Agent conversation instead
 */
export async function executeNarrate(args: Record<string, unknown>): Promise<NarrateResult> {
    const {
        tribe = 'archivist',
        length = 'short',
        language = 'en',
        limit = 10,
    } = args as NarrateArgs;
    
    // Get graph data (this part is still useful)
    const snapshot = await buildGraphSnapshot({ limit });
    
    // Return deprecation notice with graph data
    const deprecationNotice = language === 'zh-CN'
        ? `⚠️ prism_narrate 已废弃。

请改用以下方式：
1. 调用 buildGraphSnapshot() 获取图谱数据
2. 将数据传给 Claude Agent
3. 让 Agent 运用 .claude/skills/storytelling/ 中的原则自然地讲故事

以下是当前的图谱快照数据，你可以直接使用：

## 高 Gravity 实体
${snapshot.topGravityEntities.map(e => `- ${e.title} (${e.type})`).join('\n')}

## 最近的 Sparks
${snapshot.recentSparks.map(e => `- ${e.title} (${e.type})`).join('\n')}

## 关系
${snapshot.relations.slice(0, 5).map(r => `- ${r.from_id} → ${r.to_id}`).join('\n')}`
        : `⚠️ prism_narrate is deprecated.

Use this approach instead:
1. Call buildGraphSnapshot() to get graph data
2. Pass data to Claude Agent
3. Let Agent apply .claude/skills/storytelling/ principles naturally

Here's the current graph snapshot data:

## High Gravity Entities
${snapshot.topGravityEntities.map(e => `- ${e.title} (${e.type})`).join('\n')}

## Recent Sparks
${snapshot.recentSparks.map(e => `- ${e.title} (${e.type})`).join('\n')}

## Relations
${snapshot.relations.slice(0, 5).map(r => `- ${r.from_id} → ${r.to_id}`).join('\n')}`;

    return {
        story: deprecationNotice,
        metadata: {
            tribe,
            tribeDescription: TRIBE_STYLES[tribe].displayName,
            length,
            wordCount: 0,
            estimatedDuration: '0 seconds',
            language,
            mentionedEntities: [],
        },
        debug: {
            snapshotStats: {
                topGravityCount: snapshot.topGravityEntities.length,
                sparksCount: snapshot.recentSparks.length,
                dormantCount: snapshot.dormantEntities.length,
                relationsCount: snapshot.relations.length,
            },
        },
    };
}


