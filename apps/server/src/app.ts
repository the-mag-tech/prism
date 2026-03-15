import Fastify from 'fastify';
import cors from '@fastify/cors';
import fs from 'fs';
import path from 'path';
import { extractText as extractPdfText } from 'unpdf';
import { getDB } from './db.js';
import { getRelatedEntities } from './graph.js';
import { config } from './config.js';
import { ingestEmail, ParsedEmail } from './ingest.js';
import { graphWriter } from './lib/graph-link/index.js';
import { getPageFromDB, listPagesFromDB, hasPage, getCategoryPage, isCategoryPage } from './pages.js';
import { recall, listMemories, RecallResponse } from './recall.js';
import { askPipeline, recordFeedback, AskRequest, AskResponse, FeedbackRequest } from './ask.js';
import { recordNavigation, getNavigationStats, getRecentPaths, getAssociatedEntities, NavigationRequest } from './navigation.js';
import { getFlags, setFlags, resetFlags, getFlagMetadata, setFlag, type FeatureFlags } from './feature-flags.js';
import { recordEntityVisit, getRecommendationStats, searchEntities } from './recommend.js';
import { ensureApiKey } from './api-keys.js';
import { validatePage } from '@prism/contract';
import type { PageResponse, PagesListResponse, ErrorResponse } from '@prism/contract';

import { DeepExplorer } from './lib/agents/explorer/engine.js';
import { queryAnalyzer } from './lib/agents/explorer/query-analyzer.js';
import { registerSandboxRoutes } from './sandbox.js';

// Lazy-initialized Deep Explorer (DB must be ready before first use)
let _deepExplorer: DeepExplorer | null = null;
function getDeepExplorer(): DeepExplorer {
  if (!_deepExplorer) {
    _deepExplorer = new DeepExplorer();
  }
  return _deepExplorer;
}

export function build() {
  const app = Fastify({ logger: true });

  // CORS configuration: support credentials with specific origins
  app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like curl, mobile apps)
      if (!origin) return cb(null, true);

      // Allow Railway domains and localhost for development
      const allowedOrigins = [
        'https://monkey-arena.up.railway.app',
        'http://localhost:3088',
        'http://localhost:4006',  // Magpie dev frontend
        'http://localhost:4007',  // Dynamic Presenter dev
        'http://localhost:1420',  // Tauri dev
        'tauri://localhost',      // Tauri prod
      ];

      if (allowedOrigins.includes(origin) || origin.endsWith('.railway.app')) {
        cb(null, origin);
      } else {
        cb(null, true); // Allow all other origins without credentials
      }
    },
    credentials: true,
  });

  // ==========================================================================
  // DEEP EXPLORER API (Prism v2)
  // ==========================================================================

  /**
   * POST /api/explore - Full-Spectrum Exploration (Auto Mode)
   * 
   * Body: { topic: string, strategy?: string }
   */
  app.post<{
    Body: { topic: string; strategy?: string };
  }>('/api/explore', async (request, reply) => {
    const { topic, strategy } = request.body;

    if (!topic) {
      return reply.code(400).send({ error: 'Missing topic' });
    }

    try {
      request.log.info({ topic, strategy }, 'Deep Explorer request received');
      const deepExplorer = getDeepExplorer(); // Lazy init

      // Use Auto Mode if no strategy provided
      if (!strategy) {
        const result = await deepExplorer.exploreAuto(topic);
        return result;
      }

      // Manual Mode (Future extension, for now default to Auto or basic explore)
      const result = await deepExplorer.exploreAuto(topic);
      return result;

    } catch (error: any) {
      request.log.error(error, 'Deep Explorer failed');
      return reply.code(500).send({ error: error.message });
    }
  });

  // ==========================================================================
  // PAGES API (Prism Contract)
  // ==========================================================================

  /**
   * GET /pages - List all available pages
   */
  app.get<{ Reply: PagesListResponse | ErrorResponse }>('/pages', async (request, reply) => {
    try {
      const pages = listPagesFromDB();
      return { pages };
    } catch (error) {
      request.log.error(error, 'Failed to list pages');
      return reply.code(500).send({
        error: 'Internal server error',
        details: 'Failed to list pages'
      });
    }
  });

  /**
   * GET /pages/:id - Get a specific page by ID
   * 
   * Special handling:
   * - 'category:*': Returns category listing page (e.g., all people)
   */
  app.get<{
    Params: { id: string };
    Reply: PageResponse | ErrorResponse
  }>('/pages/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      // Special case: category pages (e.g., category:person, category:topic)
      if (isCategoryPage(id)) {
        const categoryType = id.split(':')[1];
        const page = getCategoryPage(categoryType);

        if (!page) {
          return reply.code(404).send({
            error: 'Invalid category',
            details: `Unknown category type "${categoryType}"`
          });
        }

        return { page };
      }

      // Check if page exists
      if (!hasPage(id)) {
        return reply.code(404).send({
          error: 'Page not found',
          details: `No page with ID "${id}"`
        });
      }

      // Get page from database
      const page = getPageFromDB(id);

      if (!page) {
        return reply.code(404).send({
          error: 'Page not found',
          details: `No page with ID "${id}"`
        });
      }

      // Validate against contract
      const validation = validatePage(page);
      if (!validation.valid) {
        request.log.warn({ pageId: id, error: validation.error }, 'Page validation failed');
        // Still return the page, but log the warning
      }

      return { page };
    } catch (error) {
      request.log.error(error, 'Failed to get page');
      return reply.code(500).send({
        error: 'Internal server error',
        details: `Failed to get page "${id}"`
      });
    }
  });

  // ==========================================================================
  // ENTITY API (for direct entity access)
  // ==========================================================================

  /**
   * GET /entities/search - Search entities and public content by text
   * 
   * Supports prefix search: "Jul" will match "Julian"
   * Also searches public_content (Scout results, Research findings)
   */
  app.get<{
    Querystring: { q: string };
    Reply: { results: Array<{ id: string; title: string; subtitle?: string }> } | ErrorResponse
  }>('/entities/search', async (request, reply) => {
    const { q } = request.query;

    if (!q || q.length < 2) {
      return { results: [] };
    }

    try {
      const db = getDB();

      // Add wildcard for prefix search (e.g., "Jul" -> "Jul*" matches "Julian")
      // Escape special FTS5 characters and add wildcard
      const searchQuery = q.replace(/['"]/g, '').trim() + '*';
      const likeQuery = '%' + q.replace(/['"]/g, '').trim() + '%';

      // 1. Search entities (FTS)
      const entityResults = db.query(`
        SELECT e.id, e.title, e.subtitle 
        FROM entities_fts 
        JOIN entities e ON e.rowid = entities_fts.rowid
        WHERE entities_fts MATCH ? 
        ORDER BY rank 
        LIMIT 15
      `).all(searchQuery) as Array<{ id: string; title: string; subtitle: string | null }>;

      // 2. Search public_content (LIKE - no FTS index)
      const publicResults = db.query(`
        SELECT id, title, source_name as subtitle
        FROM public_content
        WHERE is_active = 1
          AND (title LIKE ? OR body LIKE ?)
        ORDER BY fetched_at DESC
        LIMIT 10
      `).all(likeQuery, likeQuery) as Array<{ id: string; title: string; subtitle: string | null }>;

      // Combine and dedupe (entities first, then public)
      const seenIds = new Set<string>();
      const combined: Array<{ id: string; title: string; subtitle?: string }> = [];

      for (const r of entityResults) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          combined.push({ id: r.id, title: r.title, subtitle: r.subtitle ?? undefined });
        }
      }

      for (const r of publicResults) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          combined.push({ id: r.id, title: r.title, subtitle: r.subtitle ?? undefined });
        }
      }

      return { results: combined.slice(0, 20) };
    } catch (error) {
      request.log.error(error, 'Entity search failed');
      return { results: [] };
    }
  });

  /**
   * POST /entities/:id/gravity - Manually update entity gravity
   * 
   * Used to "Anchor" an entity (set high gravity) so it appears in the field.
   */
  app.post<{
    Params: { id: string };
    Body: { base_gravity: number };
  }>('/entities/:id/gravity', async (request, reply) => {
    const { id } = request.params;
    const { base_gravity } = request.body;

    if (typeof base_gravity !== 'number') {
      return reply.code(400).send({ error: 'base_gravity must be a number' });
    }

    try {
      const db = getDB();

      // Update entities table
      const result = db.query(`
        UPDATE entities 
        SET base_gravity = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(base_gravity, id);

      if (result.changes === 0) {
        // Try public_content if not in entities
        const pubResult = db.query(`
           UPDATE public_content
           SET base_gravity = ?
           WHERE id = ?
        `).run(base_gravity, id);

        if (pubResult.changes === 0) {
          return reply.code(404).send({ error: 'Entity not found' });
        }
      }

      // Update entity_physics with new base_mass and trigger gravity recalc
      db.query(`
        UPDATE entity_physics 
        SET base_mass = ?, updated_at = datetime('now')
        WHERE entity_id = ?
      `).run(base_gravity, id);

      return { success: true, id, base_gravity };
    } catch (error) {
      request.log.error(error, 'Failed to update gravity');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /entities/:id/discard - Soft-delete an entity (Drop-to-Grid discard)
   * 
   * Sets base_gravity to -1 to hide from the field without deleting data.
   * Used for quickly discarding freshly imported blocks.
   */
  app.post<{
    Params: { id: string };
    Reply: { success: boolean; id: string } | ErrorResponse;
  }>('/entities/:id/discard', async (request, reply) => {
    const { id } = request.params;

    try {
      const db = getDB();

      // Soft-delete by setting base_gravity to -1 (hidden)
      const result = db.query(`
        UPDATE entities 
        SET base_gravity = -1, updated_at = datetime('now')
        WHERE id = ?
      `).run(id);

      if (result.changes === 0) {
        // Try user_memories table (for memory:xxx IDs)
        const memResult = db.query(`
          UPDATE user_memories 
          SET archived = 1
          WHERE id = (SELECT CAST(SUBSTR(?, 8) AS INTEGER) WHERE ? LIKE 'memory:%')
        `).run(id, id);

        if (memResult.changes === 0) {
          return reply.code(404).send({ error: 'Entity not found', details: `ID: ${id}` });
        }
      }

      // Set gravity to -1 in entity_physics (effectively hides from field)
      db.query(`
        UPDATE entity_physics 
        SET gravity = -1, updated_at = datetime('now')
        WHERE entity_id = ?
      `).run(id);

      request.log.info({ id }, 'Entity discarded');
      return { success: true, id };
    } catch (error) {
      request.log.error(error, 'Failed to discard entity');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /categories - Get category counts for Omnibar quick access
   */
  app.get<{
    Reply: { categories: Array<{ type: string; count: number; label: string; icon: string }> }
  }>('/categories', async (request, reply) => {
    try {
      const db = getDB();
      const counts = db.query(`
        SELECT 
          CASE 
            WHEN id LIKE 'person:%' THEN 'person'
            WHEN id LIKE 'company:%' THEN 'company'
            WHEN id LIKE 'topic:%' THEN 'topic'
            WHEN id LIKE 'event:%' THEN 'event'
            WHEN id LIKE 'project:%' THEN 'project'
            ELSE 'other'
          END as type,
          COUNT(*) as count
        FROM entities
        WHERE id NOT LIKE 'singleton:%' 
          AND id NOT LIKE 'system:%'
          AND id NOT LIKE 'alias:%'
        GROUP BY type
        HAVING type != 'other'
      `).all() as Array<{ type: string; count: number }>;

      // Add labels and icons
      const categoryMeta: Record<string, { label: string; icon: string }> = {
        person: { label: 'People', icon: '👤' },
        company: { label: 'Companies', icon: '🏢' },
        topic: { label: 'Topics', icon: '🏷️' },
        event: { label: 'Events', icon: '📅' },
        project: { label: 'Projects', icon: '📁' },
      };

      return {
        categories: counts.map(c => ({
          type: c.type,
          count: c.count,
          label: categoryMeta[c.type]?.label || c.type,
          icon: categoryMeta[c.type]?.icon || '📄',
        }))
      };
    } catch (error) {
      request.log.error(error, 'Failed to get categories');
      return { categories: [] };
    }
  });

  // ==========================================================================
  // RECALL API - "Thought Tracing" / Experience Retrieval
  // ==========================================================================

  /**
   * GET /recall - Search memories for relevant fragments
   * 
   * Query params:
   *   q: Search query (required)
   *   limit: Max results (default: 10)
   */
  app.get<{
    Querystring: { q?: string; limit?: string };
    Reply: RecallResponse | ErrorResponse;
  }>('/recall', async (request, reply) => {
    const { q, limit } = request.query;

    if (!q || q.trim().length === 0) {
      return reply.code(400).send({
        error: 'Missing query',
        details: 'Please provide a search query with ?q=<query>'
      });
    }

    try {
      const limitNum = limit ? parseInt(limit) : 10;
      const result = recall(q, limitNum);
      return result;
    } catch (error) {
      request.log.error(error, 'Recall search failed');
      return reply.code(500).send({
        error: 'Search failed',
        details: 'An error occurred while searching memories'
      });
    }
  });

  /**
   * GET /memories - List all memories (for debugging/exploration)
   */
  app.get<{
    Querystring: { limit?: string };
  }>('/memories', async (request, reply) => {
    const { limit } = request.query;
    const limitNum = limit ? parseInt(limit) : 50;

    try {
      const memories = listMemories(limitNum);
      return { memories, count: memories.length };
    } catch (error) {
      request.log.error(error, 'Failed to list memories');
      return reply.code(500).send({
        error: 'Failed to list memories'
      });
    }
  });

  // ==========================================================================
  // ASK API - AI-powered "Thought Tracing" with 4-stage pipeline
  // ==========================================================================

  /**
   * POST /ask - Main question-answering endpoint
   * 
   * 4-stage pipeline:
   * 1. Fast Recall - FTS5 quick search
   * 2. Context Understanding - AI understands intent
   * 3. Agentic Explore - Multi-round deep exploration
   * 4. Response Synthesis - Generate answer with citations
   */
  app.post<{
    Body: AskRequest;
    Reply: AskResponse | ErrorResponse;
  }>('/ask', async (request, reply) => {
    const { query, sessionId, maxExploreRounds } = request.body;

    // Check for API key (Degraded Mode protection)
    try {
      ensureApiKey('OPENAI');
    } catch (e) {
      return reply.code(401).send({
        error: 'Authentication required',
        details: 'The field is dormant. Please awaken it to ask questions.'
      });
    }

    if (!query || query.trim().length === 0) {
      return reply.code(400).send({
        error: 'Missing query',
        details: 'Please provide a question in the request body'
      });
    }

    try {
      const result = await askPipeline({
        query,
        sessionId,
        maxExploreRounds,
      });
      return result;
    } catch (error) {
      request.log.error(error, 'Ask pipeline failed');
      return reply.code(500).send({
        error: 'Ask failed',
        details: 'An error occurred while processing your question'
      });
    }
  });

  /**
   * POST /feedback - Record user interaction with memories
   * 
   * Used to improve future search results based on user behavior
   */
  app.post<{
    Body: FeedbackRequest;
    Reply: { success: boolean } | ErrorResponse;
  }>('/feedback', async (request, reply) => {
    const { sessionId, memoryId, action, durationMs, query } = request.body;

    if (!sessionId || !memoryId || !action) {
      return reply.code(400).send({
        error: 'Missing fields',
        details: 'sessionId, memoryId, and action are required'
      });
    }

    const validActions = ['clicked', 'copied', 'dwelled', 'feedback_useful', 'feedback_not_relevant'];
    if (!validActions.includes(action)) {
      return reply.code(400).send({
        error: 'Invalid action',
        details: `Action must be one of: ${validActions.join(', ')}`
      });
    }

    try {
      const success = recordFeedback({
        sessionId,
        memoryId,
        action,
        durationMs,
        query,
      });
      return { success };
    } catch (error) {
      request.log.error(error, 'Feedback recording failed');
      return reply.code(500).send({
        error: 'Feedback failed',
        details: 'An error occurred while recording feedback'
      });
    }
  });

  // ==========================================================================
  // LEGACY API (Email/Graph) - Preserved for backwards compatibility
  // ==========================================================================

  /**
   * GET /search - Full-text search over emails
   */
  app.get('/search', async (request, reply) => {
    const { q } = request.query as { q: string };
    if (!q) return [];

    const db = getDB();
    try {
      const results = db.query(
        "SELECT * FROM emails_fts WHERE emails_fts MATCH ? ORDER BY rank LIMIT 20"
      ).all(q);
      return results;
    } catch (e) {
      request.log.error(e, 'Search error');
      return [];
    }
  });

  /**
   * GET /graph/:email - Get related entities for an email address
   */
  app.get('/graph/:email', async (request, reply) => {
    const { email } = request.params as { email: string };
    const related = getRelatedEntities(email);
    return related;
  });

  /**
   * POST /ingest - Ingest a single email
   */
  app.post('/ingest', async (request, reply) => {
    const body = request.body as ParsedEmail;

    if (!body.id || !body.subject) {
      return reply.code(400).send({ error: 'Missing fields' });
    }

    const emailData = {
      ...body,
      sentAt: new Date(body.sentAt)
    };
    ingestEmail(emailData);
    return { success: true };
  });

  /**
   * POST /ingest/file - Ingest a file into memory
   * 
   * Unified pipeline: Uses GraphWriter.ingestFinding() for full processing:
   * - Creates memory + memory entity
   * - Generates LLM summary for body
   * - Triggers EntityExtractionAtom, IronyAtom, etc.
   * 
   * Supports two modes:
   * 1. Path mode (Desktop/Tauri): { path: "/absolute/path/to/file.md" }
   * 2. Content mode (Browser): { filename: "file.md", content: "..." }
   */
  app.post<{
    Body: { path?: string; filename?: string; content?: string };
    Reply: { success: boolean; id: number; title?: string } | ErrorResponse;
  }>('/ingest/file', async (request, reply) => {
    const { path: filePath, filename, content } = request.body;

    try {
      let sourceUrl: string;
      let fileContent: string;
      let title: string;

      // Mode 1: Path-based (Desktop/Tauri)
      if (filePath) {
        if (!fs.existsSync(filePath)) {
          return reply.code(404).send({ error: 'File not found', details: `Path does not exist: ${filePath}` });
        }

        const ext = path.extname(filePath).toLowerCase();
        
        // Handle PDF files - extract text using unpdf (works in compiled binary)
        if (ext === '.pdf') {
          try {
            const pdfBuffer = fs.readFileSync(filePath);
            const uint8Array = new Uint8Array(pdfBuffer);
            const result = await extractPdfText(uint8Array);
            fileContent = Array.isArray(result.text) ? result.text.join('\n') : result.text;
            title = path.basename(filePath, ext);
          } catch (pdfError) {
            console.error('PDF parsing failed:', pdfError);
            return reply.code(500).send({ 
              error: 'PDF parsing failed', 
              details: String(pdfError)
            });
          }
        } else {
          // Text-based files (md, txt, etc.)
          fileContent = fs.readFileSync(filePath, 'utf-8');
          const titleMatch = fileContent.match(/^#\s+(.+)$/m);
          title = titleMatch ? titleMatch[1] : path.basename(filePath, ext);
        }
        
        sourceUrl = `file://${filePath}`;
      }
      // Mode 2: Content-based (Browser)
      else if (content && filename) {
        fileContent = content;
        sourceUrl = `drop://${filename}`;

        // Extract title from content or filename
        const titleMatch = content.match(/^#\s+(.+)$/m);
        title = titleMatch ? titleMatch[1] : filename.replace(/\.[^.]+$/, '');
      }
      // Neither mode provided
      else {
        return reply.code(400).send({
          error: 'Invalid request',
          details: 'Provide either "path" (Desktop) or "filename" + "content" (Browser)'
        });
      }

      // Use unified GraphWriter pipeline
      const memoryId = await graphWriter.ingestFinding(sourceUrl, title, fileContent, []);
      request.log.info({ id: memoryId, source: sourceUrl }, 'File ingested via unified pipeline');

      return { success: true, id: memoryId, title };
    } catch (error) {
      const err = error as Error;
      request.log.error(error, 'File ingest failed');
      return reply.code(500).send({ error: 'Ingest failed', details: err.message });
    }
  });

  // ==========================================================================
  // MEMORIES API
  // ==========================================================================

  /**
   * GET /memo/:id/content - Get full content from memories table
   * 
   * Clean API that uses memo:<id> convention.
   * ID is the memories table id directly.
   * 
   * Example: GET /memo/12/content
   */
  app.get<{
    Params: { id: string };
    Reply: { id: number; title: string; content: string; source_path: string; created_at: string } | ErrorResponse;
  }>('/memo/:id/content', async (request, reply) => {
    const { id } = request.params;
    const memoId = parseInt(id, 10);

    if (isNaN(memoId)) {
      return reply.code(400).send({ error: 'Invalid memo ID' });
    }

    const db = getDB();
    const memory = db.query(
      'SELECT id, title, content, source_url as source_path, ingested_at as created_at FROM user_memories WHERE id = ?'
    ).get(memoId) as { id: number; title: string; content: string; source_path: string; created_at: string } | null;

    if (!memory) {
      return reply.code(404).send({ error: 'Memo not found' });
    }

    return memory;
  });

  /**
   * GET /entities/:id/memo - Get source memo content for an entity
   * 
   * Uses entity's memo_id to fetch full content.
   * 
   * Supports two ID formats:
   * 1. Entity ID: "memory:38" - looks up entity, then uses memo_id
   * 2. Legacy ID: "memory:12" - if entity not found, treats 12 as memories.id
   * 
   * Example: GET /entities/memory:35/memo
   */
  app.get<{
    Params: { id: string };
    Reply: { id: number; title: string; content: string; source_path: string; created_at: string; entity_id: string } | ErrorResponse;
  }>('/entities/:id/memo', async (request, reply) => {
    const { id } = request.params;
    const db = getDB();

    // Strategy 1: Try as entity ID with memo_id
    const entity = db.query(
      'SELECT id, memo_id FROM entities WHERE id = ?'
    ).get(id) as { id: string; memo_id: number | null } | null;

    let memoId: number | null = null;
    let entityId = id;

    if (entity?.memo_id) {
      memoId = entity.memo_id;
      entityId = entity.id;
    } else if (id.startsWith('memory:') || id.startsWith('finding:')) {
      // Strategy 2: Legacy format - treat numeric part as user_memories.id
      const numericPart = parseInt(id.split(':')[1], 10);
      if (!isNaN(numericPart)) {
        // Check if this user_memories.id exists
        const memExists = db.query('SELECT id FROM user_memories WHERE id = ?').get(numericPart);
        if (memExists) {
          memoId = numericPart;
          // Try to find the actual entity that links to this memo
          const linkedEntity = db.query(
            'SELECT id FROM entities WHERE memo_id = ?'
          ).get(numericPart) as { id: string } | null;
          if (linkedEntity) {
            entityId = linkedEntity.id;
          }
        }
      }
    }

    if (!memoId) {
      return reply.code(404).send({ error: 'No memo found for this entity' });
    }

    // Get memo content (including text_content for clean display)
    const memory = db.query(
      'SELECT id, title, content, text_content, source_url as source_path, ingested_at as created_at FROM user_memories WHERE id = ?'
    ).get(memoId) as { 
      id: number; 
      title: string; 
      content: string; 
      text_content: string | null;
      source_path: string; 
      created_at: string;
    } | null;

    if (!memory) {
      return reply.code(404).send({ error: 'Memo not found' });
    }

    // Return text_content (clean text) as primary display content
    // Keep content (HTML) available for cases that need it
    return {
      id: memory.id,
      title: memory.title,
      content: memory.text_content || memory.content,  // Prefer clean text
      rawContent: memory.content,  // Original HTML for edge cases
      source_path: memory.source_path,
      created_at: memory.created_at,
      entity_id: entityId
    };
  });

  // ==========================================================================
  // NAVIGATION CONTEXT API (Phase 4)
  // ==========================================================================

  /**
   * POST /navigation - Record a navigation path
   * 
   * Body: { path: string[], dwellTimeMs?: number }
   * 
   * Records user navigation paths and learns entity associations from:
   * 1. Co-occurrence in same path
   * 2. Julilar path patterns (via embedding similarity)
   */
  app.post<{
    Body: NavigationRequest;
  }>('/navigation', async (request, reply) => {
    try {
      const { path, dwellTimeMs } = request.body;

      if (!path || !Array.isArray(path) || path.length === 0) {
        return reply.code(400).send({ error: 'path is required and must be a non-empty array' });
      }

      const session = await recordNavigation({ path, dwellTimeMs });
      return session;

    } catch (error) {
      request.log.error(error, 'Navigation recording failed');
      return reply.code(500).send({ error: 'Failed to record navigation' });
    }
  });

  /**
   * GET /navigation/stats - Get navigation learning statistics
   * 
   * @deprecated path_associations feature not yet implemented.
   * This endpoint returns empty/zero stats until Phase 3 migration.
   * @see GitHub issue for path_associations implementation plan.
   */
  app.get('/navigation/stats', async () => {
    const stats = getNavigationStats();
    return stats;
  });

  /**
   * GET /navigation/recent - Get recent navigation paths
   */
  app.get<{
    Querystring: { limit?: string };
  }>('/navigation/recent', async (request) => {
    const limit = parseInt(request.query.limit || '20', 10);
    const paths = getRecentPaths(limit);
    return { paths };
  });

  /**
   * GET /navigation/associations/:entityId - Get entities associated via paths
   */
  app.get<{
    Params: { entityId: string };
    Querystring: { limit?: string };
  }>('/navigation/associations/:entityId', async (request) => {
    const { entityId } = request.params;
    const limit = parseInt(request.query.limit || '10', 10);
    const associations = getAssociatedEntities(entityId, limit);
    return { entityId, associations };
  });

  // ==========================================================================
  // SCOUT SYSTEM API
  // ==========================================================================

  /**
   * POST /scout/tick - Manually trigger a Scout scheduling cycle
   * 
   * Processes high-gravity entities that need information updates.
   */
  app.post('/scout/tick', async (request, reply) => {
    try {
      const { ScoutSystem } = await import('./systems/ScoutSystem.js');
      const scoutSystem = new ScoutSystem();
      await scoutSystem.tick();
      return { success: true, message: 'Scout tick completed' };
    } catch (error) {
      request.log.error(error, 'Scout tick failed');
      return reply.code(500).send({ error: 'Scout tick failed' });
    }
  });

  /**
   * GET /scout/stats - Get Scout system statistics
   */
  app.get('/scout/stats', async () => {
    const { getAgentStats, getAgentLogs } = await import('./lib/agent-logger.js');
    const stats = getAgentStats('scout');
    const recentLogs = getAgentLogs({ agent: 'scout', limit: 10 });
    return { stats, recentLogs };
  });

  /**
   * GET /scout/enabled - Check if Scout auto-tick is enabled
   * 
   * Note: This only controls auto-tick. Manual /scout/tick is always available.
   */
  app.get('/scout/enabled', async () => {
    const { isScoutAutoTickEnabled } = await import('./server.js');
    return { 
      enabled: isScoutAutoTickEnabled(),
      message: 'Auto-tick status (manual tick always available)'
    };
  });

  /**
   * POST /scout/enabled - Enable or disable Scout auto-tick
   * 
   * Body: { enabled: boolean }
   * Note: This only controls auto-tick. Manual /scout/tick is always available.
   */
  app.post<{ Body: { enabled: boolean } }>('/scout/enabled', async (request, reply) => {
    const { enabled } = request.body;
    
    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled must be a boolean' });
    }

    try {
      if (enabled) {
        const { resumeScoutAutoTick } = await import('./server.js');
        const success = resumeScoutAutoTick();
        if (!success) {
          return reply.code(503).send({ 
            error: 'Failed to start Scout (Tavily API key not configured)',
            enabled: false
          });
        }
        return { enabled: true, message: 'Scout auto-tick enabled' };
      } else {
        const { stopScoutAutoTick } = await import('./server.js');
        stopScoutAutoTick();
        return { enabled: false, message: 'Scout auto-tick disabled (manual tick still available)' };
      }
    } catch (error) {
      request.log.error(error, 'Failed to toggle Scout');
      return reply.code(500).send({ error: 'Failed to toggle Scout auto-tick' });
    }
  });

  /**
   * GET /scout/quota - Get current scout quota status
   * 
   * Response: { daily, used, remaining, resetAt }
   */
  app.get('/scout/quota', async () => {
    const { getQuotaStatus } = await import('./server.js');
    const quota = getQuotaStatus();
    return {
      daily: quota.daily,
      used: quota.used,
      remaining: quota.remaining,
      resetAt: quota.resetAt,
      unlimited: quota.daily === 0,
    };
  });

  /**
   * POST /scout/quota - Set daily quota limit
   * 
   * Body: { daily: number } (0 = unlimited)
   */
  app.post<{ Body: { daily: number } }>('/scout/quota', async (request, reply) => {
    const { daily } = request.body;
    
    if (typeof daily !== 'number' || daily < 0) {
      return reply.code(400).send({ error: 'daily must be a non-negative number' });
    }

    const { setDailyQuota, getQuotaStatus } = await import('./server.js');
    setDailyQuota(daily);
    const quota = getQuotaStatus();
    
    return {
      daily: quota.daily,
      used: quota.used,
      remaining: quota.remaining,
      resetAt: quota.resetAt,
      unlimited: quota.daily === 0,
      message: daily === 0 ? 'Quota set to unlimited' : `Daily quota set to ${daily}`,
    };
  });

  /**
   * GET /scout/recent - Get recently scouted entities
   * 
   * Query: since (timestamp in ms) - only return scouts after this time
   * Response: { results: [{ entityId, entityTitle, timestamp, summary }] }
   * 
   * Used by frontend to show "New Discovery" toast notifications.
   */
  app.get<{
    Querystring: { since?: string };
  }>('/scout/recent', async (request) => {
    const since = request.query.since ? parseInt(request.query.since, 10) : Date.now() - 300000; // Default: last 5 mins
    const sinceDate = new Date(since).toISOString();

    const db = getDB();
    
    // Get entities that were scouted after 'since' time
    const results = db.query(`
      SELECT 
        p.id as entityId, 
        p.title as entityTitle,
        p.last_scouted_at as timestamp,
        p.subtitle as summary
      FROM entity_profiles p
      WHERE p.last_scouted_at IS NOT NULL 
        AND p.last_scouted_at > ?
        AND p.id NOT LIKE 'system:%'
        AND p.id NOT LIKE 'singleton:%'
      ORDER BY p.last_scouted_at DESC
      LIMIT 10
    `).all(sinceDate) as Array<{
      entityId: string;
      entityTitle: string;
      timestamp: string;
      summary: string | null;
    }>;

    // Convert ISO timestamps to ms for frontend
    const formattedResults = results.map(r => ({
      ...r,
      timestamp: new Date(r.timestamp).getTime(),
    }));

    return { results: formattedResults };
  });

  // ==========================================================================
  // GARDENER API
  // ==========================================================================

  /**
   * GET /api/gardener/metrics - Get automation trust metrics
   */
  app.get('/api/gardener/metrics', async (request, reply) => {
    const { getCuratorMetrics } = await import('./lib/agents/curator/service.js');
    return getCuratorMetrics();
  });

  // ==========================================================================
  // FEATURE FLAGS API
  // ==========================================================================

  /**
   * GET /flags - Get all current feature flags
   * 
   * Response: FeatureFlags object
   */
  app.get('/flags', async () => {
    return getFlags();
  });

  /**
   * GET /flags/metadata - Get flags with descriptions and categories
   * 
   * Response: Array of flag metadata objects
   */
  app.get('/flags/metadata', async () => {
    return getFlagMetadata();
  });

  /**
   * PATCH /flags - Update multiple feature flags
   * 
   * Body: Partial<FeatureFlags>
   * Example: { "rippleEnabled": false, "navigationTracking": false }
   */
  app.patch<{
    Body: Partial<FeatureFlags>;
  }>('/flags', async (request) => {
    const updates = request.body;
    setFlags(updates, 'api');
    return getFlags();
  });

  /**
   * PUT /flags/:key - Set a single feature flag
   * 
   * Params: key (flag name)
   * Body: { value: boolean }
   */
  app.put<{
    Params: { key: string };
    Body: { value: boolean };
  }>('/flags/:key', async (request) => {
    const { key } = request.params;
    const { value } = request.body;
    
    // Validate key exists
    const flags = getFlags();
    if (!(key in flags)) {
      throw { statusCode: 400, message: `Unknown feature flag: ${key}` };
    }
    
    setFlag(key as keyof FeatureFlags, value, 'api');
    return { [key]: value };
  });

  /**
   * POST /flags/reset - Reset all flags to defaults
   */
  app.post('/flags/reset', async () => {
    resetFlags();
    return getFlags();
  });

  // ==========================================================================
  // SETTINGS API (Backward compatible, maps to feature flags)
  // ==========================================================================

  /**
   * GET /settings - Get learning settings (subset of feature flags)
   * @deprecated Use /flags instead
   */
  app.get('/settings', async () => {
    const flags = getFlags();
    return {
      navigationTracking: flags.navigationTracking,
      feedbackTracking: flags.feedbackTracking,
      embeddingEnabled: flags.embeddingEnabled,
      associationLearning: flags.associationLearning,
    };
  });

  /**
   * PATCH /settings - Update learning settings
   * @deprecated Use PATCH /flags instead
   */
  app.patch<{
    Body: Partial<{ navigationTracking: boolean; feedbackTracking: boolean; embeddingEnabled: boolean; associationLearning: boolean }>;
  }>('/settings', async (request) => {
    const updates = request.body;
    setFlags(updates, 'api:legacy');
    const flags = getFlags();
    return {
      navigationTracking: flags.navigationTracking,
      feedbackTracking: flags.feedbackTracking,
      embeddingEnabled: flags.embeddingEnabled,
      associationLearning: flags.associationLearning,
    };
  });

  /**
   * POST /settings/reset - Reset learning settings to defaults
   * @deprecated Use POST /flags/reset instead
   */
  app.post('/settings/reset', async () => {
    // Only reset learning-related flags
    setFlags({
      navigationTracking: true,
      feedbackTracking: true,
      embeddingEnabled: true,
      associationLearning: true,
    }, 'api:legacy');
    const flags = getFlags();
    return {
      navigationTracking: flags.navigationTracking,
      feedbackTracking: flags.feedbackTracking,
      embeddingEnabled: flags.embeddingEnabled,
      associationLearning: flags.associationLearning,
    };
  });

  // ==========================================================================
  // CONFIG API (Entity Semantics)
  // ==========================================================================

  /**
   * GET /config/entity-semantics - Get valid entity categories (SSOT)
   * 
   * Render Boundary:
   * - Backend: provides category list (which entity types are valid)
   * - Frontend: owns category → role → color mapping
   * 
   * @see apps/magpie/src/lib/entity-semantics-api.ts for frontend mapping
   */
  app.get('/config/entity-semantics', async () => {
    const { getEntityCategoriesConfig } = await import('./entity-semantics.js');
    return getEntityCategoriesConfig();
  });

  // ==========================================================================
  // RUNTIME KEY CONFIGURATION API
  // ==========================================================================

  /**
   * POST /api/config/keys - Configure AI service keys at runtime
   * 
   * @ref ai-clients/runtime-keys
   * @ref ai-clients/shared-config
   * @doc docs/PRISM-MCP-SPEC.md#53-key-configuration-architecture
   * @since 2025-12
   * 
   * Called by frontend after login to inject API keys from localStorage/keychain.
   * This enables ScoutSystem and other AI features without restart.
   * 
   * Also saves to shared config file (~/.magpie/prism-config.json) for MCP binary access.
   * 
   * Priority:
   * 1. User's own keys (openaiKey, tavilyKey) - if provided
   * 2. Proxy mode (proxyToken + proxyUrl) - for users without their own keys
   * 
   * @body {
   *   openaiKey?: string,    // User's own OpenAI API key
   *   tavilyKey?: string,    // User's own Tavily API key
   *   proxyToken?: string,   // JWT from email login (for proxy mode)
   *   proxyUrl?: string,     // Proxy server URL (default: https://api.fulmail.net)
   * }
   * 
   * @returns { openai: boolean, tavily: boolean, proxy: boolean, scoutEnabled: boolean }
   */
  app.post<{
    Body: {
      openaiKey?: string;
      tavilyKey?: string;
      proxyToken?: string;
      proxyUrl?: string;
    };
  }>('/api/config/keys', async (request, reply) => {
    try {
      const { openaiKey, tavilyKey, proxyToken, proxyUrl } = request.body || {};
      
      // Import configureKeys from ai-clients
      const { configureKeys, getAIServicesStatus, saveSharedConfig } = await import('./lib/ai-clients.js');
      const { isSearchAvailable } = await import('./lib/search-service.js');
      
      const effectiveProxyUrl = proxyUrl || process.env.MAGPIE_PROXY_URL || 'https://api-proxy-magpie.up.railway.app';
      
      // Configure keys in memory
      const result = configureKeys({
        openaiKey,
        tavilyKey,
        proxyToken,
        proxyUrl: effectiveProxyUrl,
      });
      
      // Also save to shared config file (~/.magpie/prism-config.json)
      // This allows MCP binary to read the same keys
      try {
        saveSharedConfig({
          openaiKey,
          tavilyKey,
          proxyToken,
          proxyUrl: effectiveProxyUrl,
        });
        request.log.info('Saved keys to shared config file for MCP binary');
      } catch (e) {
        // Non-fatal: log but don't fail the request
        request.log.warn(e, 'Failed to save shared config (non-fatal)');
      }
      
      const status = getAIServicesStatus();
      
      request.log.info({
        openai: result.openai,
        tavily: result.tavily,
        proxy: result.proxy,
        sources: status.sources,
      }, 'API keys configured');
      
      return {
        success: true,
        openai: result.openai,
        tavily: result.tavily,
        qveris: result.qveris,
        proxy: result.proxy,
        sources: status.sources,
        // Scout can run if any search is available (Tavily or Qveris fallback)
        scoutEnabled: isSearchAvailable(),
      };
    } catch (error) {
      request.log.error(error, 'Failed to configure keys');
      return reply.code(500).send({ error: 'Failed to configure keys' });
    }
  });

  /**
   * GET /api/config/keys/status - Get current AI services status
   * 
   * Returns which services are available and their source (runtime/env/proxy/none).
   */
  app.get('/api/config/keys/status', async () => {
    const { getAIServicesStatus, isOpenAIAvailable } = await import('./lib/ai-clients.js');
    const { isSearchAvailable } = await import('./lib/search-service.js');
    const status = getAIServicesStatus();
    
    return {
      ...status,
      scoutEnabled: isSearchAvailable(),
      gardenerEnabled: isOpenAIAvailable(),
    };
  });

  // ==========================================================================
  // RECOMMENDATION API (Dynamic Origin)
  // ==========================================================================

  /**
   * POST /pages/:id/visit - Record a page/entity visit
   * 
   * Used to track user navigation for improving recommendations.
   * Body: { source?: 'navigation' | 'search' | 'direct', dwellMs?: number }
   */
  app.post<{
    Params: { id: string };
    Body: { source?: string; dwellMs?: number };
  }>('/pages/:id/visit', async (request, reply) => {
    const { id } = request.params;
    const { source = 'navigation', dwellMs = 0 } = request.body || {};

    try {
      recordEntityVisit(id, source, dwellMs);
      return { success: true, entityId: id };
    } catch (error) {
      request.log.error(error, 'Failed to record visit');
      return reply.code(500).send({ error: 'Failed to record visit' });
    }
  });

  /**
   * GET /recommend/stats - Get recommendation system statistics
   * 
   * @deprecated Debug endpoint. Consider consolidating into /health or removing.
   * Stats may be incomplete due to ECS migration.
   */
  app.get('/recommend/stats', async () => {
    const stats = getRecommendationStats();
    return stats;
  });

  // ==========================================================================
  // UNIFIED ENTITY SEARCH API
  // ==========================================================================

  /**
   * GET /api/entities/search - Unified entity search (Inspired by Google Knowledge Graph API)
   * 
   * Query Parameters:
   * - q: text search query
   * - types: DEPRECATED - use 'sources' instead
   * - sources: comma-separated source types (entity,finding,memory,public). Default: all
   * - categories: comma-separated entity ID prefixes (event,decision,person). Default: all
   * - limit: max results (default: 20, max: 100)
   * - offset: pagination offset (default: 0)
   * - sort: sort field (gravity, created_at, title, relevance). Default: gravity
   * - order: sort order (asc, desc). Default: desc
   * 
   * @example GET /api/entities/search?q=knowledge&sources=finding,memory&limit=10
   * @example GET /api/entities/search?sources=entity&categories=event,decision  // anchor slot
   */
  app.get<{
    Querystring: {
      q?: string;
      types?: string;      // deprecated
      sources?: string;    // new
      categories?: string; // new
      limit?: string;
      offset?: string;
      sort?: string;
      order?: string;
    }
  }>('/api/entities/search', async (request, reply) => {
    try {
      const { q, types, sources, categories, limit, offset, sort, order } = request.query;

      const params = {
        q: q || undefined,
        // Backward compat: prefer sources, fallback to types
        sources: sources ? sources.split(',').map(t => t.trim()) : undefined,
        types: types ? types.split(',').map(t => t.trim()) : undefined,
        // NEW: categories filter
        categories: categories ? categories.split(',').map(c => c.trim()) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
        sort: sort as 'gravity' | 'created_at' | 'title' | 'relevance' | undefined,
        order: order as 'asc' | 'desc' | undefined,
      };

      const result = searchEntities(params);
      return result;
    } catch (error: any) {
      console.error('[API] Entity search error:', error);
      reply.code(500).send({ error: error.message || 'Search failed' });
    }
  });

  // ==========================================================================
  // FIELD API (God Mode - Internal/Debug)
  // ==========================================================================

  /**
   * GET /api/field/snapshot - Get the entire field state for God Mode visualization
   * 
   * @internal Used by GodModeScene.tsx for 3D field visualization.
   * Returns all entities (up to 2000) with gravity scores.
   * Not intended for production use - high payload size.
   */
  app.get('/api/field/snapshot', async (request, reply) => {
    try {
      const db = getDB();

      // Get all entities with their gravity from unified entity_physics table
      const entities = db.query(`
        SELECT 
          e.id, 
          e.title, 
          COALESCE(ph.gravity, e.base_gravity, 0.5) as mass,
          json_object(
            'convergence', ph.convergence,
            'path', ph.path,
            'spark', ph.spark,
            'base', ph.base_mass
          ) as components
        FROM entities e
        LEFT JOIN entity_physics ph ON e.id = ph.entity_id
        WHERE e.id NOT LIKE 'singleton:%'
        LIMIT 2000
      `).all() as Array<{ id: string; title: string; mass: number; components: string }>;

      return {
        entities: entities.map(e => {
          let type = 'default';
          if (e.id.startsWith('person:')) type = 'type-anchor';
          else if (e.id.startsWith('company:')) type = 'type-intel';
          else if (e.id.startsWith('topic:')) type = 'type-spark';
          else if (e.id.startsWith('event:')) type = 'type-anchor';
          else if (e.id.startsWith('project:')) type = 'type-context';

          return {
            id: e.id,
            label: e.title,
            type: type,
            mass: e.mass,
            components: JSON.parse(e.components)
          };
        })
      };
    } catch (error) {
      request.log.error(error, 'Failed to get field snapshot');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/field/tick - Run a physics simulation tick
   * 
   * Triggers PhysicsSystem to recalculate gravity for all entities.
   * This updates the entity_physics table with fresh gravity values.
   * 
   * @body lens - Optional focus lens (e.g., 'tech', 'design')
   * @body userPath - Optional array of recently visited entity IDs
   * 
   * @returns Summary of the tick operation
   */
  app.post<{
    Body: { lens?: string; userPath?: string[] };
  }>('/api/field/tick', async (request, reply) => {
    try {
      const { PhysicsSystem } = await import('./systems/PhysicsSystem.js');
      const physics = new PhysicsSystem();
      
      const context = {
        time: new Date(),
        lens: request.body?.lens,
        userPath: request.body?.userPath,
      };
      
      const entities = await physics.tick(context);
      
      return {
        success: true,
        entitiesProcessed: entities.length,
        context: {
          time: context.time.toISOString(),
          lens: context.lens || 'general',
        }
      };
    } catch (error: any) {
      request.log.error(error, 'Failed to run physics tick');
      return reply.code(500).send({ 
        error: 'Physics tick failed',
        details: error.message 
      });
    }
  });

  // ==========================================================================
  // HEALTH CHECK
  // ==========================================================================

  /**
   * GET /health - Health check endpoint
   */
  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.3.0'  // Bumped for dynamic origin feature
    };
  });

  // ==========================================================================
  // GRACEFUL SHUTDOWN API
  // ==========================================================================

  /**
   * GET /shutdown/status - Check if server has active tasks
   * 
   * Returns status of all background systems:
   * - RippleSystem: processing queue
   * - ScoutSystem: active tick in progress
   * - BackgroundWorker: stale entity processing
   * - GardenerService: deduplication cycle
   * 
   * Used by Tauri to wait for tasks before quitting.
   */
  app.get('/shutdown/status', async () => {
    const { getQueueStats, areWorkersRunning } = await import('./lib/queue/index.js');
    const { getWorkerStatus } = await import('./background-worker.js');
    const { isScoutBusy } = await import('./server.js');
    const { isCuratorBusy } = await import('./lib/agents/curator/service.js');

    const queueStats = await getQueueStats();
    const workersRunning = areWorkersRunning();
    const workerStatus = getWorkerStatus();
    const scoutBusy = isScoutBusy();
    const curatorBusy = isCuratorBusy();

    // Check if any queue has pending work
    const totalPending = queueStats.extraction.pending + queueStats.scout.pending + 
                         queueStats.ripple.pending + queueStats.curator.pending + 
                         queueStats.explore.pending;
    const busy = totalPending > 0 || scoutBusy || curatorBusy || workerStatus.isRunning;

    return {
      busy,
      systems: {
        ripple: {
          processing: workersRunning,
          queueLength: queueStats.ripple.pending,
        },
        scout: {
          busy: scoutBusy,
        },
        curator: {
          busy: curatorBusy,
        },
        worker: {
          running: workerStatus.isRunning,
          pending: workerStatus.pendingCount,
        },
      },
      message: busy 
        ? 'Tasks in progress, please wait...' 
        : 'All tasks complete, safe to quit',
    };
  });

  /**
   * POST /shutdown/prepare - Initiate graceful shutdown
   * 
   * Stops accepting new tasks and waits for existing ones to complete.
   * Returns immediately - caller should poll /shutdown/status.
   */
  app.post('/shutdown/prepare', async () => {
    const { rippleSystem } = await import('./systems/RippleSystem.js');
    const { stopScoutAutoTick } = await import('./server.js');
    const { stopBackgroundWorker } = await import('./background-worker.js');
    const { stopCuratorService } = await import('./lib/agents/curator/service.js');

    // Stop accepting new tasks (temporarily disable via feature flags)
    setFlag('rippleEnabled', false, 'shutdown');
    stopScoutAutoTick();
    stopBackgroundWorker();
    stopCuratorService();

    return {
      success: true,
      message: 'Shutdown initiated. Poll /shutdown/status to check completion.',
    };
  });

  // ==========================================================================
  // SCOUT API (Agentic Scissors)
  // ==========================================================================

  /**
   * POST /api/scout/profile - Generate an entity profile via Scout
   */
  app.post<{
    Body: { entity: string; context: string };
    Reply: any | ErrorResponse;
  }>('/api/scout/profile', async (request, reply) => {
    const { entity, context } = request.body;

    // Check for API key (Degraded Mode protection)
    try {
      ensureApiKey('OPENAI');
    } catch (e) {
      return reply.code(401).send({
        error: 'Authentication required',
        details: 'The field is dormant. Please awaken it to scout entities.'
      });
    }

    if (!entity) {
      return reply.code(400).send({
        error: 'Missing entity',
        details: 'Please provide an entity name'
      });
    }

    try {
      const { ScoutAgent } = await import('./lib/agents/scout/agent.js');

      const agent = new ScoutAgent();
      const profile = await agent.profile(entity, context || '');

      return profile;
    } catch (error) {
      const err = error as Error & { response?: { status: number } };
      request.log.error(error, 'Scout profile generation failed');

      // Detect Tavily quota errors (432 = usage limit exceeded)
      const isQuotaError =
        err.message?.includes('432') ||
        err.message?.includes('usage limit') ||
        err.message?.includes('quota') ||
        err.response?.status === 432 ||
        err.response?.status === 429;

      if (isQuotaError) {
        return reply.code(402).send({
          error: 'Quota Exceeded',
          details: 'Search API quota exceeded. Please check your Tavily plan.'
        });
      }

      return reply.code(500).send({
        error: 'Scout failed',
        details: process.env.NODE_ENV === 'production'
          ? 'An error occurred while generating the profile'
          : err.message || 'Unknown error'
      });
    }
  });

  // ==========================================================================
  // FEED COLLECTION API (Drag & Drop)
  // ==========================================================================

  /**
   * POST /feed/collect - Collect a block to your graph via drag & drop
   * 
   * This boosts the entity's gravity and records the user's explicit interest.
   * The entity will appear more prominently in future recommendations.
   */
  app.post<{
    Body: {
      sourceId: string;
    };
    Reply: { success: boolean; entityId: string; newGravity: number; message: string } | ErrorResponse;
  }>('/feed/collect', async (request, reply) => {
    const { sourceId } = request.body;

    if (!sourceId) {
      return reply.code(400).send({
        error: 'Missing fields',
        details: 'sourceId is required'
      });
    }

    try {
      // Use GraphWriter to boost gravity (single source of truth for graph operations)
      const result = await graphWriter.boostGravity(sourceId, 2.0);

      if (!result) {
        return reply.code(404).send({
          error: 'Entity not found',
          details: `No entity with ID "${sourceId}"`
        });
      }

      request.log.info({ entityId: sourceId, oldGravity: result.oldGravity, newGravity: result.newGravity }, 'Entity collected via drag & drop');

      return {
        success: true,
        entityId: sourceId,
        newGravity: result.newGravity,
        message: `Collected "${result.title}" - gravity boosted to ${result.newGravity.toFixed(1)}`
      };
    } catch (error) {
      request.log.error(error, 'Failed to collect entity');
      return reply.code(500).send({
        error: 'Collection failed',
        details: 'Database error'
      });
    }
  });

  // ==========================================================================
  // VISUAL FEEDBACK API (Migration Lifecycle)
  // ==========================================================================

  /**
   * POST /feedback/visual - Report UI issues for the migration pipeline
   * 
   * This enables users to report issues they see in the UI:
   * - duplicate_entity: Same entity appears multiple times
   * - wrong_color: Entity has incorrect color/classification
   * - missing_relation: Related entities not linked
   * - other: Any other UI issue
   */
  app.post<{
    Body: {
      pageId: string;
      issueType: 'duplicate_entity' | 'wrong_color' | 'missing_relation' | 'other';
      comment?: string;
      blocks?: unknown[];
    };
    Reply: { issueId: string; status: string } | ErrorResponse;
  }>('/feedback/visual', async (request, reply) => {
    const { pageId, issueType, comment, blocks } = request.body;

    if (!pageId || !issueType) {
      return reply.code(400).send({
        error: 'Missing fields',
        details: 'pageId and issueType are required'
      });
    }

    const validTypes = ['duplicate_entity', 'wrong_color', 'missing_relation', 'other'];
    if (!validTypes.includes(issueType)) {
      return reply.code(400).send({
        error: 'Invalid issueType',
        details: `issueType must be one of: ${validTypes.join(', ')}`
      });
    }

    try {
      const db = getDB();
      const issueId = `issue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      db.query(`
        INSERT INTO visual_issues (id, page_id, issue_type, comment, page_data, status)
        VALUES (?, ?, ?, ?, ?, 'open')
      `).run(issueId, pageId, issueType, comment || null, blocks ? JSON.stringify(blocks) : null);

      request.log.info({ issueId, pageId, issueType }, 'Visual issue reported');

      return { issueId, status: 'received' };
    } catch (error) {
      request.log.error(error, 'Failed to record visual issue');
      return reply.code(500).send({
        error: 'Failed to record issue',
        details: 'Database error'
      });
    }
  });

  /**
   * GET /feedback/visual - List visual issues (for debugging/admin)
   */
  app.get<{
    Querystring: { status?: string };
    Reply: { issues: unknown[] } | ErrorResponse;
  }>('/feedback/visual', async (request, reply) => {
    const { status } = request.query;

    try {
      const db = getDB();
      let query = 'SELECT * FROM visual_issues';
      const params: string[] = [];

      if (status) {
        query += ' WHERE status = ?';
        params.push(status);
      }

      query += ' ORDER BY created_at DESC LIMIT 100';

      const issues = db.query(query).all(...params);
      return { issues };
    } catch (error) {
      request.log.error(error, 'Failed to list visual issues');
      return reply.code(500).send({
        error: 'Failed to list issues',
        details: 'Database error'
      });
    }
  });

  // ==========================================================================
  // EXPLORE API (Adversarial Exploration - Guest Mode)
  // ==========================================================================

  /**
   * POST /explore - Run deep exploration for a keyword (DEPRECATED)
   * 
   * @deprecated Use POST /api/explore instead. This route is kept for backwards
   * compatibility with older clients but will be removed in a future version.
   * 
   * Note: explore_logs and gallery functionality has been moved to cognitive-arena.
   * This route now simply proxies to /api/explore.
   */
  app.post<{
    Body: {
      word: string;
      strategy?: string;
      targetLevel?: number;
    };
    Reply: unknown;
  }>('/explore', async (request, reply) => {
    const { word, strategy } = request.body;

    // Check for API key (Degraded Mode protection)
    try {
      ensureApiKey('OPENAI');
    } catch (e) {
      return reply.code(401).send({
        error: 'Authentication required',
        details: 'The field is dormant. Please awaken it to explore.'
      });
    }

    if (!word || word.trim().length === 0) {
      return reply.code(400).send({
        error: 'Missing word',
        details: 'Please provide a word to explore'
      });
    }

    try {
      // Import the DeepExplorer
      const { deepExplorer, getStrategy, DEFAULT_DEPTH_CONFIG } = await import('./lib/agents/explorer/index.js');

      let result;
      let queryAnalysisInfo: { queryType: string; complexity: string; mode: string } | undefined;

      if (!strategy || strategy === 'auto') {
        // AUTO MODE: Analyze query and auto-configure
        const autoResult = await deepExplorer.exploreAuto(word.trim());
        result = autoResult;

        queryAnalysisInfo = {
          queryType: autoResult.queryAnalysis.queryType,
          complexity: autoResult.queryAnalysis.complexity,
          mode: autoResult.queryAnalysis.recommendedConfig.mode,
        };
      } else {
        // MANUAL MODE: Use specified strategy
        const strategyObj = getStrategy(strategy);
        result = await deepExplorer.explore(word.trim(), {
          strategy: strategyObj,
          config: DEFAULT_DEPTH_CONFIG,
        });
      }

      // Return sanitized result (no DB logging - moved to cognitive-arena)
      if (result.output.type === 'irony') {
        return {
          winner: {
            name: result.winner.name,
            score: result.winner.score.total,
            ironyPyramid: result.output.ironyPyramid.map((layer: any) => ({
              level: layer.level,
              description: layer.description,
            })),
          },
          contenders: result.allDirections.slice(0, 3).map((d: any, i: number) => ({
            name: d.name,
            rank: i + 1,
          })),
          explosivePoint: result.output.explosivePoint,
          oneLiner: result.output.oneLiner,
          intent: {
            coreObject: result.intent.coreObject,
            context: result.intent.context,
          },
          queryAnalysis: queryAnalysisInfo,
        };
      }

      return {
        winner: {
          name: result.winner.name,
          score: result.winner.score.total,
        },
        contenders: result.allDirections.slice(0, 3).map((d: any, i: number) => ({
          name: d.name,
          rank: i + 1,
        })),
        explosivePoint: '',
        oneLiner: '',
        intent: {
          coreObject: result.intent.coreObject,
          context: result.intent.context,
        },
        queryAnalysis: queryAnalysisInfo,
      };
    } catch (error) {
      const err = error as Error & { response?: { status: number } };
      const errorMessage = err.message || 'Unknown error';
      console.error('[Explore] Error details:', errorMessage);
      request.log.error(error, 'Exploration failed');

      const isQuotaError =
        errorMessage.includes('432') ||
        errorMessage.includes('usage limit') ||
        errorMessage.includes('quota') ||
        err.response?.status === 432 ||
        err.response?.status === 429;

      if (isQuotaError) {
        return reply.code(402).send({
          error: 'Quota Exceeded',
          details: 'Search API quota exceeded. Please check your Tavily plan.'
        });
      }

      return reply.code(500).send({
        error: 'Exploration failed',
        details: process.env.NODE_ENV === 'production'
          ? 'An error occurred during deep exploration'
          : errorMessage
      });
    }
  });

  // ==========================================================================
  // GARDENER API (V1: Conservative Deduplication)
  // ==========================================================================

  /**
   * GET /gardener/candidates - Get pending merge candidates for user review
   * 
   * V1 Strategy: User decides whether to merge entities.
   */
  app.get<{
    Reply: {
      candidates: Array<{
        id: number;
        entityA: string;
        titleA: string;
        subtitleA: string | null;
        sourceDomainA: string | null;
        entityB: string;
        titleB: string;
        subtitleB: string | null;
        sourceDomainB: string | null;
        similarity: number;
        createdAt: string;
      }>;
      total: number;
    };
  }>('/gardener/candidates', async (request, reply) => {
    try {
      const { CuratorAgent } = await import('./lib/agents/curator/agent.js');
      const { DeduplicatorService } = await import('./lib/agents/curator/deduplicator.js');

      const deduplicator = new DeduplicatorService();
      const candidates = deduplicator.getPendingCandidatesWithDetails();

      return {
        candidates: candidates.map(c => ({
          id: c.id,
          entityA: c.entityA,
          titleA: c.titleA,
          subtitleA: c.subtitleA,
          sourceDomainA: c.sourceDomainA,
          entityB: c.entityB,
          titleB: c.titleB,
          subtitleB: c.subtitleB,
          sourceDomainB: c.sourceDomainB,
          similarity: c.similarity,
          createdAt: c.createdAt,
        })),
        total: candidates.length,
      };
    } catch (error) {
      request.log.error(error, 'Failed to get merge candidates');
      return reply.code(500).send({
        error: 'Internal server error',
        details: 'Failed to get merge candidates',
      } as any);
    }
  });

  /**
   * POST /gardener/merge - User approves a merge
   * 
   * Merges entityB into entityA (or vice versa based on convention).
   */
  app.post<{
    Body: {
      entityA: string;
      entityB: string;
      reason?: string;
    };
    Reply: {
      success: boolean;
      historyId?: number;
      error?: string;
    };
  }>('/gardener/merge', async (request, reply) => {
    try {
      const { entityA, entityB, reason } = request.body;

      if (!entityA || !entityB) {
        return reply.code(400).send({
          success: false,
          error: 'entityA and entityB are required',
        });
      }

      const { CuratorAgent } = await import('./lib/agents/curator/agent.js');
      const agent = new CuratorAgent();
      const result = await agent.approveMerge(entityA, entityB, reason);

      return {
        success: result.success,
        historyId: result.historyId,
        error: result.error,
      };
    } catch (error: any) {
      request.log.error(error, 'Failed to merge entities');
      return reply.code(500).send({
        success: false,
        error: error.message || 'Merge failed',
      });
    }
  });

  /**
   * POST /gardener/reject - User rejects a merge candidate
   * 
   * Marks the pair as "not the same entity". Will never be suggested again.
   */
  app.post<{
    Body: {
      entityA: string;
      entityB: string;
      reason?: string;
    };
    Reply: { success: boolean };
  }>('/gardener/reject', async (request, reply) => {
    try {
      const { entityA, entityB, reason } = request.body;

      if (!entityA || !entityB) {
        return reply.code(400).send({ success: false });
      }

      const { CuratorAgent } = await import('./lib/agents/curator/agent.js');
      const agent = new CuratorAgent();
      const success = agent.rejectMerge(entityA, entityB, reason);

      return { success };
    } catch (error) {
      request.log.error(error, 'Failed to reject merge candidate');
      return reply.code(500).send({ success: false });
    }
  });

  /**
   * POST /gardener/defer - User defers decision on a merge candidate
   */
  app.post<{
    Body: {
      entityA: string;
      entityB: string;
    };
    Reply: { success: boolean };
  }>('/gardener/defer', async (request, reply) => {
    try {
      const { entityA, entityB } = request.body;

      if (!entityA || !entityB) {
        return reply.code(400).send({ success: false });
      }

      const { CuratorAgent } = await import('./lib/agents/curator/agent.js');
      const agent = new CuratorAgent();
      const success = agent.deferMerge(entityA, entityB);

      return { success };
    } catch (error) {
      request.log.error(error, 'Failed to defer merge candidate');
      return reply.code(500).send({ success: false });
    }
  });

  /**
   * POST /gardener/undo - Undo a previous merge
   */
  app.post<{
    Body: { historyId: number };
    Reply: { success: boolean; error?: string };
  }>('/gardener/undo', async (request, reply) => {
    try {
      const { historyId } = request.body;

      if (!historyId) {
        return reply.code(400).send({ success: false, error: 'historyId is required' });
      }

      const { CuratorAgent } = await import('./lib/agents/curator/agent.js');
      const agent = new CuratorAgent();
      const result = await agent.undoMerge(historyId);

      return result;
    } catch (error: any) {
      request.log.error(error, 'Failed to undo merge');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /gardener/history - Get merge history
   */
  app.get<{
    Querystring: { limit?: string };
    Reply: {
      history: Array<{
        id: number;
        targetId: string;
        sourceId: string;
        decidedBy: string;
        mergedAt: string;
        undoneAt: string | null;
      }>;
    };
  }>('/gardener/history', async (request, reply) => {
    try {
      const limit = parseInt(request.query.limit || '50', 10);

      const { MergerService } = await import('./lib/agents/curator/merger.js');
      const merger = new MergerService();
      const history = merger.getMergeHistory(limit);

      return {
        history: history.map(h => ({
          id: h.id,
          targetId: h.targetId,
          sourceId: h.sourceId,
          decidedBy: h.decidedBy,
          mergedAt: h.mergedAt,
          undoneAt: h.undoneAt,
        })),
      };
    } catch (error) {
      request.log.error(error, 'Failed to get merge history');
      return { history: [] };
    }
  });

  /**
   * GET /gardener/status - Get gardener service status
   */
  app.get<{
    Reply: {
      pendingCandidates: number;
      recentMerges: number;
    };
  }>('/gardener/status', async (request, reply) => {
    try {
      const { CuratorAgent } = await import('./lib/agents/curator/agent.js');
      const agent = new CuratorAgent();
      return agent.getStatus();
    } catch (error) {
      request.log.error(error, 'Failed to get gardener status');
      return { pendingCandidates: 0, recentMerges: 0 };
    }
  });

  /**
   * POST /gardener/scan - Manually trigger a gardener scan
   */
  app.post<{
    Reply: {
      success: boolean;
      report?: {
        memoryDuplicates: { found: number; merged: number };
        entityCandidates: { found: number; recorded: number; pendingTotal: number };
      };
      error?: string;
    };
  }>('/gardener/scan', async (request, reply) => {
    try {
      const { triggerCycle } = await import('./lib/agents/curator/service.js');
      const report = await triggerCycle();

      return {
        success: true,
        report: {
          memoryDuplicates: report.memoryDuplicates,
          entityCandidates: report.entityCandidates,
        },
      };
    } catch (error: any) {
      request.log.error(error, 'Failed to trigger gardener scan');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // ==========================================================================
  // MCP TOOLS TEST ENDPOINT (DEV ONLY)
  // ==========================================================================

  /**
   * POST /mcp/tools/call - Test MCP tools via HTTP (mimics JSON-RPC)
   * 
   * Example:
   * curl -X POST http://localhost:3006/mcp/tools/call \
   *   -H "Content-Type: application/json" \
   *   -d '{"tool": "prism_search", "arguments": {"query": "test", "maxResults": 3}}'
   */
  app.post<{
    Body: { tool: string; arguments: Record<string, unknown> };
    Reply: { success: boolean; result?: unknown; error?: string };
  }>('/mcp/tools/call', async (request, reply) => {
    const { tool, arguments: args } = request.body;

    if (!tool) {
      return reply.code(400).send({ success: false, error: 'Missing tool name' });
    }

    try {
      // Dynamic import to avoid circular dependencies
      const { executeSearch } = await import('./mcp/tools/search.js');
      const { executeScout } = await import('./mcp/tools/scout.js');
      const { executeRecall } = await import('./mcp/tools/recall.js');
      const { executeGravityTop } = await import('./mcp/tools/gravity-top.js');
      const { executeIngest } = await import('./mcp/tools/ingest.js');
      const { executeGetContext } = await import('./mcp/tools/get-context.js');

      let result: unknown;

      switch (tool) {
        case 'prism_search':
          result = await executeSearch(args || {});
          break;
        case 'prism_scout':
          result = await executeScout(args || {});
          break;
        case 'prism_recall':
          result = await executeRecall(args || {});
          break;
        case 'prism_gravity_top':
          result = await executeGravityTop(args || {});
          break;
        case 'prism_ingest':
          result = await executeIngest(args || {});
          break;
        case 'prism_get_context':
          result = await executeGetContext(args || {});
          break;
        default:
          return reply.code(400).send({ success: false, error: `Unknown tool: ${tool}` });
      }

      return { success: true, result };
    } catch (error: any) {
      request.log.error(error, `MCP tool ${tool} failed`);
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  // ==========================================================================
  // MCP HTTP TRANSPORT (JSON-RPC 2.0)
  // Standard MCP endpoint for http-bridge and Cursor
  // ==========================================================================

  /**
   * POST /mcp - Standard MCP HTTP Transport
   * 
   * Supports JSON-RPC 2.0 format for:
   * - tools/list: List available tools
   * - tools/call: Execute a tool
   * 
   * Example:
   * curl -X POST http://localhost:3006/mcp \
   *   -H "Content-Type: application/json" \
   *   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   */
  app.post<{
    Body: { jsonrpc: string; id: number | string; method: string; params?: any };
  }>('/mcp', async (request, reply) => {
    const { jsonrpc, id, method, params } = request.body;

    // Validate JSON-RPC version
    if (jsonrpc !== '2.0') {
      return reply.code(400).send({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
      });
    }

    try {
      // Dynamic imports to avoid circular dependencies
      const { searchToolDef, executeSearch } = await import('./mcp/tools/search.js');
      const { scoutToolDef, executeScout } = await import('./mcp/tools/scout.js');
      const { recallToolDef, executeRecall } = await import('./mcp/tools/recall.js');
      const { gravityTopToolDef, executeGravityTop } = await import('./mcp/tools/gravity-top.js');
      const { ingestToolDef, executeIngest } = await import('./mcp/tools/ingest.js');
      const { getContextToolDef, executeGetContext } = await import('./mcp/tools/get-context.js');
      const { exploreToolDef, executeExplore } = await import('./mcp/tools/explore.js');
      const { scoutTickToolDef, executeScoutTick } = await import('./mcp/tools/scout-tick.js');

      const tools = [
        searchToolDef,
        scoutToolDef,
        scoutTickToolDef,
        recallToolDef,
        gravityTopToolDef,
        ingestToolDef,
        getContextToolDef,
        exploreToolDef,
      ];

      const executors: Record<string, (args: any) => Promise<any>> = {
        prism_search: executeSearch,
        prism_scout: executeScout,
        prism_scout_tick: executeScoutTick,
        prism_recall: executeRecall,
        prism_gravity_top: executeGravityTop,
        prism_ingest: executeIngest,
        prism_get_context: executeGetContext,
        prism_explore: executeExplore,
      };

      // DEV_MODE only: Add experimental tools
      if (config.devMode) {
        const { narrateToolDef, executeNarrate } = await import('./mcp/tools/narrate.js');
        tools.push(narrateToolDef);
        executors['prism_narrate'] = executeNarrate;
      }

      switch (method) {
        // MCP Protocol: Initialize handshake
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'prism-mcp-server',
                version: '0.3.0',
              },
            },
          };

        // MCP Protocol: Initialized notification (no response needed)
        case 'notifications/initialized':
          return { jsonrpc: '2.0', id, result: {} };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: { tools },
          };

        case 'tools/call': {
          const { name, arguments: args } = params || {};
          if (!name) {
            return reply.code(400).send({
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'Invalid params: missing tool name' },
            });
          }

          const executor = executors[name];
          if (!executor) {
            return reply.code(400).send({
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method not found: unknown tool "${name}"` },
            });
          }

          const result = await executor(args || {});
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            },
          };
        }

        default:
          return reply.code(400).send({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
      }
    } catch (error: any) {
      request.log.error(error, `MCP request failed: ${method}`);
      return reply.code(500).send({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: error.message },
      });
    }
  });

  // Register Sandbox routes (Shadow Chessboard for Dynamic Presenter)
  registerSandboxRoutes(app);

  return app;
}
