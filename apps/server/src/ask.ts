/**
 * Ask Pipeline - "Thought Tracing" with AI-powered understanding
 * 
 * 4-Stage Pipeline:
 * 1. Fast Recall - FTS5 quick search based on raw input
 * 2. Context-Aware Understanding - AI understands intent with memory context
 * 3. Agentic Explore - Multi-round deep exploration
 * 4. Response Synthesis - Generate final answer with citations
 */

import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { getDB } from './db.js';
import { recall, RecallResult } from './recall.js';
import { searchEntities } from './recommend.js';

// =============================================================================
// TYPES
// =============================================================================

export interface AskRequest {
  query: string;
  sessionId?: string;  // Optional: continue existing session
  maxExploreRounds?: number;  // Default: 3
}

export interface MemoryReference {
  id: number;
  title: string | null;
  snippet: string;
  sourcePath: string;
  createdAt: string | null;
  relevanceScore: number;
}

export interface ExplorationStats {
  rounds: number;
  memoriesScanned: number;
  memoriesSelected: number;
  expandedQueries: string[];
}

export interface AskResponse {
  sessionId: string;
  query: string;
  answer: string;
  understoodIntent: string;
  sources: MemoryReference[];
  timeline: string[];
  explorationStats: ExplorationStats;
}

interface UnderstandingResult {
  intent: string;
  expandedQueries: string[];
  shouldExploreMore: boolean;
}

// =============================================================================
// OPENAI CLIENT (lazy-loaded)
// =============================================================================

import { getOpenAI } from './lib/ai-clients.js';

// =============================================================================
// STAGE 1: FAST RECALL (enhanced with findings search)
// =============================================================================

/**
 * Quick FTS5 search based on raw user input
 * Searches both memories and findings for comprehensive context
 */
function fastRecall(query: string, limit: number = 5): RecallResult[] {
  // 1. Traditional memory recall
  const memoryResults = recall(query, limit).results;

  // 2. Search findings (Scout discoveries) using unified search API
  const findingResults = searchEntities({
    q: query,
    types: ['finding'],
    limit: Math.ceil(limit / 2),  // Split limit between sources
    sort: 'relevance'
  });

  // 3. Convert findings to RecallResult format for compatibility
  const findingsAsRecall: RecallResult[] = findingResults.results.map(f => ({
    id: parseInt(f.id.split(':')[1]) || 0,
    sourcePath: f.subtitle || '',  // subtitle contains source URL for findings
    sourceType: 'scout_snapshot',
    title: f.title,
    snippet: f.body?.substring(0, 150) + (f.body && f.body.length > 150 ? '...' : '') || '',
    content: f.body || '',
    createdAt: f.created_at || null,
    relevance: f.relevance || 0
  }));

  // 4. Merge and deduplicate (prioritize memories, then findings)
  const combined = [...memoryResults, ...findingsAsRecall];

  console.log(`[fastRecall] Found ${memoryResults.length} memories + ${findingsAsRecall.length} findings`);

  return combined.slice(0, limit);
}

// =============================================================================
// STAGE 2: CONTEXT-AWARE UNDERSTANDING
// =============================================================================

/**
 * AI understands user intent with memory context
 */
async function understandIntent(
  query: string,
  initialMemories: RecallResult[]
): Promise<UnderstandingResult> {
  const openai = getOpenAI();
  if (!openai) {
    // Fallback: return basic understanding without AI
    return {
      intent: query,
      expandedQueries: [],
      shouldExploreMore: false,
    };
  }

  // Build context from initial memories
  const memoryContext = initialMemories
    .map((m, i) => `[Memory ${i + 1}] ${m.title || 'Untitled'}: ${m.snippet}`)
    .join('\n\n');

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a "Thought Archaeologist" helping users trace their past thinking.

Given a user's question and some initial memory fragments, your job is to:
1. Understand what the user REALLY wants to know (their true intent)
2. Identify additional search terms that would help find more relevant memories
3. Decide if we need to explore more (true if the initial memories don't fully answer the question)

IMPORTANT: Respond in the SAME LANGUAGE as the user's query. If the user asks in Chinese, respond in Chinese. If in English, respond in English.

Output JSON:
{
  "intent": "A clear statement of what the user wants to know (in user's language)",
  "expandedQueries": ["term1", "term2", ...],  // 2-5 additional search terms (can be in any language that helps find memories)
  "shouldExploreMore": true/false
}`
        },
        {
          role: "user",
          content: `User's question: "${query}"

Initial memories found:
${memoryContext || "(No memories found)"}

Analyze and output JSON.`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');

    return {
      intent: result.intent || query,
      expandedQueries: result.expandedQueries || [],
      shouldExploreMore: result.shouldExploreMore ?? true,
    };

  } catch (error) {
    console.error('Understanding failed:', error);
    // Fallback: extract keywords from query
    const words = query.split(/\s+/).filter(w => w.length > 2);
    return {
      intent: query,
      expandedQueries: words.slice(0, 3),
      shouldExploreMore: true,
    };
  }
}

// =============================================================================
// STAGE 3: AGENTIC EXPLORE
// =============================================================================

/**
 * Multi-round exploration to find all relevant memories
 */
async function agenticExplore(
  query: string,
  initialMemories: RecallResult[],
  expandedQueries: string[],
  maxRounds: number = 3
): Promise<{ memories: RecallResult[]; rounds: number; totalScanned: number }> {

  // Track seen memory IDs to avoid duplicates
  const seenIds = new Set<number>(initialMemories.map(m => m.id));
  const allMemories = [...initialMemories];
  let totalScanned = initialMemories.length;
  let round = 0;

  // Round 1: Search with expanded queries
  for (const expandedQuery of expandedQueries) {
    if (round >= maxRounds) break;

    const results = fastRecall(expandedQuery, 5);
    totalScanned += results.length;

    for (const mem of results) {
      if (!seenIds.has(mem.id)) {
        seenIds.add(mem.id);
        allMemories.push(mem);
      }
    }
    round++;
  }

  // Round 2+: If we found new memories, try to find related ones
  // by extracting key terms from found memories
  if (allMemories.length > initialMemories.length && round < maxRounds) {
    const newMemories = allMemories.slice(initialMemories.length);
    const additionalTerms = extractKeyTerms(newMemories);

    for (const term of additionalTerms.slice(0, 2)) {
      if (round >= maxRounds) break;

      const results = fastRecall(term, 3);
      totalScanned += results.length;

      for (const mem of results) {
        if (!seenIds.has(mem.id)) {
          seenIds.add(mem.id);
          allMemories.push(mem);
        }
      }
      round++;
    }
  }

  return {
    memories: allMemories,
    rounds: round,
    totalScanned,
  };
}

/**
 * Extract key terms from memory content for further exploration
 */
function extractKeyTerms(memories: RecallResult[]): string[] {
  const terms: string[] = [];

  for (const mem of memories) {
    // Extract title words
    if (mem.title) {
      const titleWords = mem.title
        .split(/[\s\-:]+/)
        .filter(w => w.length > 3 && !/^(the|and|for|with|from)$/i.test(w));
      terms.push(...titleWords.slice(0, 2));
    }
  }

  // Return unique terms
  return [...new Set(terms)];
}

// =============================================================================
// STAGE 4: RESPONSE SYNTHESIS
// =============================================================================

/**
 * Generate final answer with citations
 */
async function synthesizeResponse(
  query: string,
  intent: string,
  memories: RecallResult[]
): Promise<{ answer: string; timeline: string[] }> {
  const openai = getOpenAI();

  // Detect if query is primarily Chinese
  const isChinese = /[\u4e00-\u9fa5]/.test(query) &&
    (query.match(/[\u4e00-\u9fa5]/g)?.length || 0) > query.length * 0.3;

  if (memories.length === 0 || !openai) {
    return {
      answer: isChinese
        ? "没有找到相关的记忆碎片。试着添加更多笔记或换个方式提问吧。"
        : "I couldn't find any relevant memories for your question. Try adding more notes or rephrasing your query.",
      timeline: [],
    };
  }

  // Sort memories by date
  const sortedMemories = [...memories].sort((a, b) => {
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Build memory context for synthesis
  const memoryContext = sortedMemories
    .map((m, i) => {
      const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : 'Unknown date';
      return `[${i + 1}] (${date}) ${m.title || 'Untitled'}:\n${m.snippet}`;
    })
    .join('\n\n---\n\n');

  // Extract timeline
  const timeline = [...new Set(
    sortedMemories
      .map(m => m.createdAt?.split('T')[0])
      .filter((d): d is string => d !== null && d !== undefined)
  )].sort().reverse();

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are helping the user trace their past thinking.

Based on the memory fragments provided, synthesize a clear, helpful answer that:
1. Directly addresses the user's question
2. References specific memories using [1], [2], etc.
3. Organizes information chronologically if relevant
4. Highlights key insights and decisions

IMPORTANT: Respond in the SAME LANGUAGE as the user's query. If the user asks in Chinese, answer in Chinese. If in English, answer in English. Match the user's language exactly.

Be concise but thorough. Use the user's own words from the memories when helpful.`
        },
        {
          role: "user",
          content: `User's question: "${query}"
User's intent: "${intent}"

Found memories:
${memoryContext}

Synthesize an answer.`
        }
      ],
      temperature: 0.5,
      max_tokens: 1000,
    });

    return {
      answer: completion.choices[0].message.content || 'Unable to synthesize response.',
      timeline,
    };

  } catch (error) {
    console.error('Synthesis failed:', error);
    // Fallback: just list the memories
    return {
      answer: `Found ${memories.length} relevant memories:\n\n` +
        sortedMemories.map((m, i) => `${i + 1}. ${m.title || 'Untitled'}`).join('\n'),
      timeline,
    };
  }
}

// =============================================================================
// MAIN PIPELINE
// =============================================================================

/**
 * Main Ask Pipeline - orchestrates all 4 stages
 */
export async function askPipeline(request: AskRequest): Promise<AskResponse> {
  const sessionId = request.sessionId || uuidv4();
  const maxRounds = request.maxExploreRounds || 3;
  const query = request.query.trim();

  console.log(`[Ask] Session ${sessionId}: "${query}"`);

  // Stage 1: Fast Recall
  console.log('[Ask] Stage 1: Fast Recall');
  const initialMemories = fastRecall(query, 5);
  console.log(`[Ask] Found ${initialMemories.length} initial memories`);

  // Stage 2: Understand Intent
  console.log('[Ask] Stage 2: Understanding Intent');
  const understanding = await understandIntent(query, initialMemories);
  console.log(`[Ask] Intent: ${understanding.intent}`);
  console.log(`[Ask] Expanded queries: ${understanding.expandedQueries.join(', ')}`);

  // Stage 3: Agentic Explore
  console.log('[Ask] Stage 3: Agentic Explore');
  const exploration = await agenticExplore(
    query,
    initialMemories,
    understanding.expandedQueries,
    maxRounds
  );
  console.log(`[Ask] Explored ${exploration.rounds} rounds, found ${exploration.memories.length} memories`);

  // Stage 4: Synthesize Response
  console.log('[Ask] Stage 4: Synthesizing Response');
  const synthesis = await synthesizeResponse(
    query,
    understanding.intent,
    exploration.memories
  );

  // Save session to database
  saveSession(sessionId, query, understanding, exploration, synthesis);

  // Build response
  const sources: MemoryReference[] = exploration.memories.map(m => ({
    id: m.id,
    title: m.title,
    snippet: m.snippet,
    sourcePath: m.sourcePath,
    createdAt: m.createdAt,
    relevanceScore: Math.abs(m.relevance), // FTS5 returns negative scores
  }));

  return {
    sessionId,
    query,
    answer: synthesis.answer,
    understoodIntent: understanding.intent,
    sources,
    timeline: synthesis.timeline,
    explorationStats: {
      rounds: exploration.rounds,
      memoriesScanned: exploration.totalScanned,
      memoriesSelected: exploration.memories.length,
      expandedQueries: understanding.expandedQueries,
    },
  };
}

// =============================================================================
// SESSION PERSISTENCE
// =============================================================================

function saveSession(
  sessionId: string,
  query: string,
  understanding: UnderstandingResult,
  exploration: { memories: RecallResult[]; rounds: number },
  synthesis: { answer: string }
) {
  const db = getDB();

  try {
    db.query(`
      INSERT INTO recall_sessions (id, query, understood_intent, expanded_queries, final_response, memories_used, exploration_rounds, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      sessionId,
      query,
      understanding.intent,
      JSON.stringify(understanding.expandedQueries),
      synthesis.answer,
      JSON.stringify(exploration.memories.map(m => m.id)),
      exploration.rounds
    );
  } catch (error) {
    console.error('Failed to save session:', error);
  }
}

// =============================================================================
// FEEDBACK RECORDING
// =============================================================================

export interface FeedbackRequest {
  sessionId: string;
  memoryId: number;
  action: 'clicked' | 'copied' | 'dwelled' | 'feedback_useful' | 'feedback_not_relevant';
  durationMs?: number;
  query?: string;
}

/**
 * Record user feedback/interaction with a memory
 */
export function recordFeedback(request: FeedbackRequest): boolean {
  const db = getDB();

  try {
    db.query(`
      INSERT INTO memory_interactions (memory_id, session_id, query, action, duration_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      request.memoryId,
      request.sessionId,
      request.query || null,
      request.action,
      request.durationMs || null
    );

    // Update memory weight based on action
    updateMemoryWeight(request.memoryId, request.action);

    return true;
  } catch (error) {
    console.error('Failed to record feedback:', error);
    return false;
  }
}

/**
 * Update memory weight based on interaction
 */
function updateMemoryWeight(memoryId: number, action: string) {
  const db = getDB();

  // Weight changes based on action type
  const weightDeltas: Record<string, number> = {
    'copied': 0.3,
    'feedback_useful': 0.5,
    'clicked': 0.1,
    'dwelled': 0.05,
    'feedback_not_relevant': -0.2,
  };

  const delta = weightDeltas[action] || 0;
  if (delta === 0) return;

  try {
    // Upsert weight record
    db.query(`
      INSERT INTO memory_weights (memory_id, interaction_score, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(memory_id) DO UPDATE SET
        interaction_score = interaction_score + ?,
        updated_at = datetime('now')
    `).run(memoryId, delta, delta);
  } catch (error) {
    console.error('Failed to update weight:', error);
  }
}

