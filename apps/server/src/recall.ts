/**
 * Recall - "Thought Tracing" / Experience Retrieval
 * 
 * Find the memory fragments that help you answer:
 * "Why did I make this decision?"
 * "What was I thinking when...?"
 */

import { getDB } from './db.js';

// =============================================================================
// TYPES
// =============================================================================

export interface RecallResult {
  id: number;
  sourcePath: string;
  sourceType: string;
  title: string | null;
  snippet: string;        // Relevant snippet with context
  content: string;        // Full content
  createdAt: string | null;
  relevance: number;      // FTS rank score (lower = more relevant)
}

export interface RecallResponse {
  query: string;
  results: RecallResult[];
  timeline: string[];     // Unique dates for timeline visualization
  totalCount: number;
}

// =============================================================================
// CORE RECALL FUNCTION
// =============================================================================

/**
 * Search memories for relevant fragments
 * 
 * @param query - Natural language query (e.g., "为什么选择 SQLite")
 * @param limit - Max results to return (default: 10)
 */
export function recall(query: string, limit: number = 10): RecallResponse {
  const db = getDB();
  
  // Clean query for FTS5 (escape special chars, handle Chinese)
  const ftsQuery = prepareQuery(query);
  
  try {
    // FTS5 search with BM25 ranking
    const results = db.query(`
      SELECT 
        m.id,
        m.source_url as sourcePath,
        m.source_type as sourceType,
        m.title,
        m.content,
        m.ingested_at as createdAt,
        rank as relevance
      FROM user_memories_fts 
      JOIN user_memories m ON user_memories_fts.rowid = m.id
      WHERE user_memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{
      id: number;
      sourcePath: string;
      sourceType: string;
      title: string | null;
      content: string;
      createdAt: string | null;
      relevance: number;
    }>;

    // Extract snippets and build response
    const processedResults: RecallResult[] = results.map(r => ({
      ...r,
      snippet: extractSnippet(r.content, query, 150)
    }));

    // Extract unique dates for timeline
    const timeline = [...new Set(
      results
        .map(r => r.createdAt?.split('T')[0])
        .filter((d): d is string => d !== null && d !== undefined)
    )].sort().reverse();

    return {
      query,
      results: processedResults,
      timeline,
      totalCount: results.length
    };

  } catch (error) {
    // FTS query might fail with certain inputs, fallback to LIKE search
    console.warn('FTS search failed, falling back to LIKE:', error);
    return fallbackSearch(query, limit);
  }
}

/**
 * Get all memories (for debugging/exploration)
 */
export function listMemories(limit: number = 50): RecallResult[] {
  const db = getDB();
  
  const results = db.query(`
    SELECT 
      id,
      source_url as sourcePath,
      source_type as sourceType,
      title,
      content,
      ingested_at as createdAt
    FROM user_memories
    ORDER BY ingested_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    sourcePath: string;
    sourceType: string;
    title: string | null;
    content: string;
    createdAt: string | null;
  }>;

  return results.map(r => ({
    ...r,
    snippet: r.content.substring(0, 200) + (r.content.length > 200 ? '...' : ''),
    relevance: 0
  }));
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Prepare query for FTS5
 * - Handle Chinese characters (no word boundaries)
 * - Escape special FTS5 operators
 */
function prepareQuery(query: string): string {
  // Remove FTS5 special chars that could cause syntax errors
  let cleaned = query
    .replace(/["\(\)\*\-\+\^]/g, ' ')
    .trim();
  
  // Split into terms and join with OR for broader matching
  const terms = cleaned.split(/\s+/).filter(t => t.length > 0);
  
  if (terms.length === 0) {
    return '*'; // Match all if empty query
  }
  
  // Use prefix matching for partial word support
  // Wrap each term in quotes to handle special chars
  return terms.map(t => `"${t}"*`).join(' OR ');
}

/**
 * Extract a relevant snippet from content around query terms
 */
function extractSnippet(content: string, query: string, maxLength: number): string {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const contentLower = content.toLowerCase();
  
  // Find first occurrence of any term
  let bestPos = -1;
  for (const term of terms) {
    const pos = contentLower.indexOf(term);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }
  
  if (bestPos === -1) {
    // No match found, return start of content
    return content.substring(0, maxLength) + (content.length > maxLength ? '...' : '');
  }
  
  // Extract snippet centered around the match
  const start = Math.max(0, bestPos - 50);
  const end = Math.min(content.length, bestPos + maxLength - 50);
  
  let snippet = content.substring(start, end);
  
  // Add ellipsis
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  
  return snippet;
}

/**
 * Fallback search using LIKE when FTS fails
 */
function fallbackSearch(query: string, limit: number): RecallResponse {
  const db = getDB();
  
  const pattern = `%${query}%`;
  
  const results = db.query(`
    SELECT 
      id,
      source_url as sourcePath,
      source_type as sourceType,
      title,
      content,
      created_at as createdAt
    FROM user_memories
    WHERE content LIKE ? OR title LIKE ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(pattern, pattern, limit) as Array<{
    id: number;
    sourcePath: string;
    sourceType: string;
    title: string | null;
    content: string;
    createdAt: string | null;
  }>;

  const processedResults: RecallResult[] = results.map(r => ({
    ...r,
    snippet: extractSnippet(r.content, query, 150),
    relevance: 0
  }));

  const timeline = [...new Set(
    results
      .map(r => r.createdAt?.split('T')[0])
      .filter((d): d is string => d !== null && d !== undefined)
  )].sort().reverse();

  return {
    query,
    results: processedResults,
    timeline,
    totalCount: results.length
  };
}

