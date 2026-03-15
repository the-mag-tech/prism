
import { getDB } from '../../db.js';
import { log, logError, logWarn } from '../logger.js';
import { GraphEntity, GraphRelation, ScoutEntity, EnrichContextOptions, EntityFingerprint, SurpriseScore } from './types.js';
import { getEquivalentEntities, getCanonicalId } from './equivalence.js';
import { getOpenAI } from '../ai-clients.js';

export class GraphReader {
    /**
     * Resolve a vague entity name (e.g. "Simon") to a canonical Graph Entity
     */
    resolveEntity(name: string): GraphEntity | null {
        const db = getDB();

        // 1. Try exact match on title (Case insensitive)
        let row = db.query(`
      SELECT * 
      FROM entities 
      WHERE lower(title) = lower(?)
      LIMIT 1
    `).get(name) as any;

        // 2. If the name is short (e.g. "Simon"), try to find people with that first name
        if (!row && name.split(' ').length === 1) {
            row = db.query(`
        SELECT *
        FROM entities
        WHERE title LIKE ? || ' %'
        ORDER BY length(title) ASC
        LIMIT 1
      `).get(name) as any;
        }

        if (!row) return null;

        return {
            id: row.id,
            title: row.title,
            subtitle: row.subtitle,
            body: row.body,
            type: row.id.split(':')[0],
            created_at: row.created_at,
            updated_at: row.updated_at,
            last_scouted_at: row.last_scouted_at
        };
    }

    /**
     * Get entity by ID (resolves to canonical if entity is in a group)
     */
    getEntity(id: string): GraphEntity | null {
        const db = getDB();
        // First try the given ID, then try canonical ID if different
        let row = db.query(`SELECT * FROM entities WHERE id = ?`).get(id) as any;

        if (!row) {
            // Try to find via canonical ID
            const canonicalId = getCanonicalId(id);
            if (canonicalId !== id) {
                row = db.query(`SELECT * FROM entities WHERE id = ?`).get(canonicalId) as any;
            }
        }

        if (!row) return null;

        return {
            id: row.id,
            title: row.title,
            subtitle: row.subtitle,
            body: row.body,
            type: row.id.split(':')[0],
            created_at: row.created_at,
            updated_at: row.updated_at,
            last_scouted_at: row.last_scouted_at
        };
    }

    /**
     * Enrich an entity with context from the Graph (Fingerprinting)
     * 
     * Now includes relations by default for better search precision.
     * 
     * @example
     * // Basic usage (includes relations)
     * const fingerprint = graphReader.enrichContext('person:simon');
     * // => "Simon Willison Datasette creator datasette llm sqlite-utils"
     * 
     * @example
     * // Without relations (faster, less context)
     * const basic = graphReader.enrichContext('person:simon', { includeRelations: false });
     * // => "Simon Willison Datasette creator"
     */
    enrichContext(entityId: string, options: EnrichContextOptions = {}): string | null {
        const fingerprint = this.getFingerprint(entityId, options);
        return fingerprint?.fingerprint || null;
    }

    /**
     * Get structured fingerprint for an entity (full context for search/Scout)
     * 
     * This is the canonical method for building entity context.
     * Use this when you need both the fingerprint string AND the components.
     * 
     * @example
     * const fp = graphReader.getFingerprint('person:simon');
     * log(fp.relatedTerms);  // ['datasette', 'llm', 'sqlite_utils']
     * log(fp.fingerprint);   // "Simon Willison Datasette creator datasette llm sqlite_utils"
     */
    getFingerprint(entityId: string, options: EnrichContextOptions = {}): EntityFingerprint | null {
        const {
            includeRelations = true,
            relationLimit = 3,
            bodyLength = 100,
        } = options;

        const db = getDB();

        // 1. Get base entity info
        const row = db.query(`
            SELECT title, subtitle, body 
            FROM entities 
            WHERE id = ?
        `).get(entityId) as { title: string; subtitle: string; body: string } | undefined;

        if (!row) return null;

        // 2. Build related terms from relations
        let relatedTerms: string[] = [];
        
        if (includeRelations) {
            const relations = this.getRelations(entityId, 'both').slice(0, relationLimit);
            relatedTerms = relations
                .map(r => {
                    // Get the "other" entity in the relation
                    const otherId = r.target === entityId ? r.source : r.target;
                    // Extract readable name: "person:simon_willison" -> "simon willison"
                    const namePart = otherId.split(':')[1];
                    return namePart?.replace(/_/g, ' ');
                })
                .filter((term): term is string => Boolean(term));
        }

        // 3. Build fingerprint string
        const parts = [
            row.title,
            row.subtitle || '',
            row.body?.substring(0, bodyLength) || '',
            ...relatedTerms
        ].filter(Boolean);

        const fingerprint = parts.join(' ').replace(/\n/g, ' ').trim();

        return {
            entityId,
            title: row.title,
            subtitle: row.subtitle,
            bodyExcerpt: row.body?.substring(0, bodyLength),
            relatedTerms,
            fingerprint,
        };
    }

    /**
     * Get relations for an entity (1-hop)
     * Automatically resolves equivalence groups: includes relations from all equivalent entities.
     */
    getRelations(entityId: string, direction: 'incoming' | 'outgoing' | 'both' = 'both'): GraphRelation[] {
        const db = getDB();

        // Get all equivalent entity IDs (includes the original)
        const equivalentIds = getEquivalentEntities(entityId);
        const placeholders = equivalentIds.map(() => '?').join(',');

        let query = '';
        let params: string[] = [];

        if (direction === 'outgoing') {
            query = `SELECT source, target, type, weight FROM relations WHERE source IN (${placeholders})`;
            params = equivalentIds;
        } else if (direction === 'incoming') {
            query = `SELECT source, target, type, weight FROM relations WHERE target IN (${placeholders})`;
            params = equivalentIds;
        } else {
            query = `
        SELECT source, target, type, weight FROM relations WHERE source IN (${placeholders})
        UNION
        SELECT source, target, type, weight FROM relations WHERE target IN (${placeholders})
      `;
            params = [...equivalentIds, ...equivalentIds];
        }

        const rows = db.query(query).all(...params) as any[];

        // Deduplicate relations that might appear from multiple equivalent entities
        const seen = new Set<string>();
        const uniqueRelations: GraphRelation[] = [];

        for (const r of rows) {
            // Normalize source/target to canonical IDs for deduplication
            const canonicalSource = getCanonicalId(r.source);
            const canonicalTarget = getCanonicalId(r.target);
            const key = `${canonicalSource}|${canonicalTarget}|${r.type}`;

            if (!seen.has(key)) {
                seen.add(key);
                uniqueRelations.push({
                    source: r.source,
                    target: r.target,
                    type: r.type,
                    weight: r.weight
                });
            }
        }

        return uniqueRelations;
    }

    /**
     * Get related entities (Nodes)
     * Automatically resolves equivalence groups.
     */
    getRelatedNodes(entityId: string, limit: number = 5): GraphEntity[] {
        const equivalentIds = getEquivalentEntities(entityId);
        const relations = this.getRelations(entityId, 'both');

        // Get related IDs, excluding any that are equivalent to the query entity
        const relatedIds = relations
            .map(r => equivalentIds.includes(r.source) ? r.target : r.source)
            .filter(id => !equivalentIds.includes(id)) // Exclude self-relations within group
            .slice(0, limit);

        if (relatedIds.length === 0) return [];

        const db = getDB();
        const placeholders = relatedIds.map(() => '?').join(',');
        const rows = db.query(`SELECT * FROM entities WHERE id IN (${placeholders})`).all(...relatedIds) as any[];

        return rows.map(row => ({
            id: row.id,
            title: row.title,
            subtitle: row.subtitle,
            body: row.body,
            type: row.id.split(':')[0]
        }));
    }

    // =========================================================================
    // SERENDIPITY: Graph-Based Surprise Calculation
    // =========================================================================

    /**
     * Calculate the "surprise" score of new content relative to the graph.
     * 
     * Surprise = how different is this content from what we already know?
     * 
     * This is the core of Serendipity: content that's too similar to existing
     * knowledge is not worth ingesting; content that's wildly different
     * but relevant is highly valuable.
     * 
     * @param content - The new content (title + snippet) to evaluate
     * @param contextEntityId - Optional entity to use as context anchor
     * @returns SurpriseScore with score and reasoning
     * 
     * @example
     * const result = await graphReader.calculateSurprise(
     *   "Simon Willison releases Datasette 1.0",
     *   "person:simon_willison"
     * );
     * // If we already know about Datasette: { score: 0.3, reason: "Known project" }
     * // If this is new: { score: 0.8, reason: "Major release not in graph" }
     */
    async calculateSurprise(
        content: string,
        contextEntityId?: string
    ): Promise<SurpriseScore> {
        const db = getDB();

        // 1. Build graph context
        let graphContext = '';
        
        if (contextEntityId) {
            // Get the entity's neighborhood as context
            const fingerprint = this.getFingerprint(contextEntityId, { 
                includeRelations: true, 
                relationLimit: 5,
                bodyLength: 200 
            });
            if (fingerprint) {
                graphContext = `Known about ${fingerprint.title}: ${fingerprint.fingerprint}`;
            }

            // Get related entities for broader context
            const relatedNodes = this.getRelatedNodes(contextEntityId, 5);
            if (relatedNodes.length > 0) {
                graphContext += '\nRelated entities: ' + 
                    relatedNodes.map(n => `${n.title} (${n.type})`).join(', ');
            }
        }

        // 2. If no context entity, sample recent high-gravity entities
        if (!graphContext) {
            const recentEntities = db.query(`
                SELECT e.id, e.title, COALESCE(p.gravity, 0.5) as gravity
                FROM entities e
                LEFT JOIN entity_physics p ON e.id = p.entity_id
                WHERE e.id NOT LIKE 'system:%' AND e.id NOT LIKE 'memory:%'
                ORDER BY p.gravity DESC, e.updated_at DESC
                LIMIT 10
            `).all() as Array<{ id: string; title: string; gravity: number }>;

            if (recentEntities.length > 0) {
                graphContext = 'Current graph contains: ' + 
                    recentEntities.map(e => `${e.title} (${e.id.split(':')[0]})`).join(', ');
            }
        }

        // 3. Use lightweight LLM to evaluate surprise
        const openai = getOpenAI();
        if (!openai) {
            // Fallback: assume moderate surprise if no AI available
            return { 
                score: 0.5, 
                reason: 'AI unavailable, defaulting to moderate surprise',
                shouldIngest: true 
            };
        }

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a Serendipity Evaluator for a knowledge graph system.

Your job: Evaluate how "surprising" new content is relative to existing knowledge.

GRAPH CONTEXT (what we already know):
${graphContext || 'Graph is empty - everything is new.'}

SCORING GUIDE:
- 0.0-0.3: REDUNDANT - We already know this, or it's generic/marketing fluff
- 0.4-0.6: INCREMENTAL - Adds some new detail to known topics  
- 0.7-0.9: SURPRISING - New insight, unexpected connection, or fresh perspective
- 1.0: PARADIGM SHIFT - Completely changes our understanding

Output JSON: { "score": number, "reason": "brief explanation" }`
                    },
                    {
                        role: 'user',
                        content: `NEW CONTENT TO EVALUATE:\n${content.substring(0, 1000)}`
                    }
                ],
                response_format: { type: 'json_object' },
                max_tokens: 100,
                temperature: 0.2,
            });

            const result = JSON.parse(response.choices[0].message.content || '{}');
            const score = Math.max(0, Math.min(1, result.score ?? 0.5));
            
            return {
                score,
                reason: result.reason || 'No reason provided',
                shouldIngest: score >= 0.5,
            };
        } catch (error) {
            log('[GraphReader] Surprise calculation failed:', error);
            return { 
                score: 0.5, 
                reason: 'Evaluation failed, defaulting to moderate',
                shouldIngest: true 
            };
        }
    }

    /**
     * Get graph context summary for an entity's neighborhood.
     * Useful for providing context to other systems.
     */
    getGraphContext(entityId: string): string {
        const fingerprint = this.getFingerprint(entityId, {
            includeRelations: true,
            relationLimit: 5,
            bodyLength: 300,
        });

        if (!fingerprint) return '';

        const relatedNodes = this.getRelatedNodes(entityId, 5);
        const relatedSummary = relatedNodes.length > 0
            ? `\nRelated: ${relatedNodes.map(n => n.title).join(', ')}`
            : '';

        return `${fingerprint.fingerprint}${relatedSummary}`;
    }

    // =========================================================================
    // REFACTORED API: Encapsulated queries for MCP/API consumers
    // =========================================================================

    /**
     * Get related entities with their relation types.
     * 
     * This is the canonical method for getting entity relationships,
     * designed for MCP tools and API endpoints.
     * 
     * @param entityId - The entity to query relations for
     * @param limit - Maximum number of related entities to return (default: 10)
     * @returns Array of related entities with relation type
     * 
     * @example
     * const related = graphReader.getRelatedEntities('person:simon');
     * // => [{ id: 'project:datasette', title: 'Datasette', relationType: 'created_by' }, ...]
     */
    getRelatedEntities(entityId: string, limit: number = 10): Array<{
        id: string;
        title: string;
        relationType: string;
    }> {
        const db = getDB();
        const equivalentIds = getEquivalentEntities(entityId);
        const placeholders = equivalentIds.map(() => '?').join(',');

        // Get relations where entity is source or target
        const relations = db.query(`
            SELECT 
                CASE WHEN source IN (${placeholders}) THEN target ELSE source END as related_id,
                COALESCE(relation_type, type, 'related_to') as relation_type
            FROM relations
            WHERE source IN (${placeholders}) OR target IN (${placeholders})
            LIMIT ?
        `).all(...equivalentIds, ...equivalentIds, ...equivalentIds, limit) as Array<{
            related_id: string;
            relation_type: string;
        }>;

        // Enrich with entity titles
        const results: Array<{ id: string; title: string; relationType: string }> = [];
        const seen = new Set<string>();

        for (const rel of relations) {
            // Skip self-relations and duplicates
            if (equivalentIds.includes(rel.related_id) || seen.has(rel.related_id)) continue;
            seen.add(rel.related_id);

            const entity = db.query('SELECT title FROM entities WHERE id = ?')
                .get(rel.related_id) as { title: string } | undefined;

            if (entity) {
                results.push({
                    id: rel.related_id,
                    title: entity.title,
                    relationType: rel.relation_type,
                });
            }
        }

        return results;
    }

    /**
     * Get top entities by gravity score.
     * 
     * This is the canonical method for gravity-based ranking,
     * designed for MCP tools and API endpoints.
     * 
     * @param limit - Maximum number of entities to return (default: 10)
     * @param entityType - Optional filter by entity type prefix (e.g., 'person', 'project')
     * @returns Array of entities with gravity scores, sorted descending
     * 
     * @example
     * // Get top 5 entities overall
     * const top = graphReader.getTopByGravity(5);
     * 
     * @example
     * // Get top 5 people by gravity
     * const topPeople = graphReader.getTopByGravity(5, 'person');
     */
    getTopByGravity(limit: number = 10, entityType?: string): Array<{
        id: string;
        title: string;
        subtitle: string | null;
        gravity: number;
        type: string;
    }> {
        const db = getDB();

        let query = `
            SELECT 
                e.id, 
                e.title, 
                e.subtitle,
                COALESCE(p.gravity, e.base_gravity, 0.5) as gravity
            FROM entities e
            LEFT JOIN entity_physics p ON e.id = p.entity_id
            WHERE e.id NOT LIKE 'singleton:%'
              AND e.id NOT LIKE 'system:%'
        `;
        const params: (string | number)[] = [];

        if (entityType) {
            query += ` AND e.id LIKE ? || ':%'`;
            params.push(entityType);
        }

        query += ` ORDER BY gravity DESC LIMIT ?`;
        params.push(limit);

        const rows = db.query(query).all(...params) as Array<{
            id: string;
            title: string;
            subtitle: string | null;
            gravity: number;
        }>;

        return rows.map(row => ({
            ...row,
            type: row.id.split(':')[0],
        }));
    }

    /**
     * Search user memories by query string.
     * 
     * Uses FTS5 full-text search with LIKE fallback.
     * 
     * @param query - Search query
     * @param limit - Maximum results (default: 10)
     * @returns Array of matching memories
     */
    searchMemories(query: string, limit: number = 10): Array<{
        id: number;
        title: string | null;
        snippet: string;
        sourceType: string;
        createdAt: string;
    }> {
        const db = getDB();

        // Try FTS5 first
        try {
            const ftsQuery = query.split(/\s+/).map(term => `"${term}"*`).join(' ');
            const results = db.query(`
                SELECT 
                    m.id,
                    m.title,
                    substr(m.content, 1, 200) as snippet,
                    m.source_type as sourceType,
                    m.ingested_at as createdAt
                FROM user_memories_fts fts
                JOIN user_memories m ON fts.rowid = m.id
                WHERE user_memories_fts MATCH ?
                  AND m.archived = 0
                ORDER BY rank
                LIMIT ?
            `).all(ftsQuery, limit) as any[];

            return results;
        } catch {
            // Fallback to LIKE search
            const pattern = `%${query}%`;
            return db.query(`
                SELECT 
                    id,
                    title,
                    substr(content, 1, 200) as snippet,
                    source_type as sourceType,
                    ingested_at as createdAt
                FROM user_memories
                WHERE (content LIKE ? OR title LIKE ?)
                  AND archived = 0
                ORDER BY ingested_at DESC
                LIMIT ?
            `).all(pattern, pattern, limit) as any[];
        }
    }

    // =========================================================================
    // REST API ENCAPSULATION (Phase 3)
    // =========================================================================

    /**
     * Search entities and public content by text query.
     * 
     * Used by: GET /entities/search (Omnibar)
     * Supports prefix search: "Jul" matches "Julian"
     * 
     * @param query - Search query (min 2 chars)
     * @param limit - Maximum results (default: 20)
     * @returns Combined results from entities and public_content
     */
    searchEntitiesAndPublicContent(query: string, limit: number = 20): Array<{
        id: string;
        title: string;
        subtitle?: string;
        source: 'entity' | 'public_content';
    }> {
        if (!query || query.length < 2) return [];

        const db = getDB();
        const searchQuery = query.replace(/['"]/g, '').trim() + '*';
        const likeQuery = '%' + query.replace(/['"]/g, '').trim() + '%';

        // 1. Search entities via FTS
        let entityResults: Array<{ id: string; title: string; subtitle: string | null }> = [];
        try {
            entityResults = db.query(`
                SELECT e.id, e.title, e.subtitle 
                FROM entities_fts 
                JOIN entities e ON e.rowid = entities_fts.rowid
                WHERE entities_fts MATCH ? 
                ORDER BY rank 
                LIMIT ?
            `).all(searchQuery, limit) as any[];
        } catch {
            // FTS failed, try LIKE fallback
            entityResults = db.query(`
                SELECT id, title, subtitle 
                FROM entities
                WHERE title LIKE ? OR subtitle LIKE ?
                ORDER BY title
                LIMIT ?
            `).all(likeQuery, likeQuery, limit) as any[];
        }

        // 2. Search public_content via LIKE (no FTS index)
        const publicResults = db.query(`
            SELECT id, title, source_name as subtitle
            FROM public_content
            WHERE is_active = 1
              AND (title LIKE ? OR body LIKE ?)
            ORDER BY fetched_at DESC
            LIMIT ?
        `).all(likeQuery, likeQuery, Math.ceil(limit / 2)) as Array<{ 
            id: string; 
            title: string; 
            subtitle: string | null;
        }>;

        // 3. Combine and dedupe (entities first)
        const seen = new Set<string>();
        const results: Array<{ id: string; title: string; subtitle?: string; source: 'entity' | 'public_content' }> = [];

        for (const r of entityResults) {
            if (!seen.has(r.id)) {
                seen.add(r.id);
                results.push({ 
                    id: r.id, 
                    title: r.title, 
                    subtitle: r.subtitle ?? undefined, 
                    source: 'entity' 
                });
            }
        }

        for (const r of publicResults) {
            if (!seen.has(r.id)) {
                seen.add(r.id);
                results.push({ 
                    id: r.id, 
                    title: r.title, 
                    subtitle: r.subtitle ?? undefined, 
                    source: 'public_content' 
                });
            }
        }

        return results.slice(0, limit);
    }

    /**
     * Get scout quota statistics for today.
     * 
     * Used by: GET /scout/quota
     * 
     * @returns Current quota usage and limits
     */
    getScoutQuota(): { 
        used: number; 
        limit: number; 
        remaining: number; 
        resetAt: string;
        date: string;
    } {
        const db = getDB();
        const today = new Date().toISOString().split('T')[0];

        const row = db.query(`
            SELECT used, daily_limit, reset_date 
            FROM scout_quota 
            WHERE date = ?
        `).get(today) as { used: number; daily_limit: number; reset_date: string } | undefined;

        const limit = row?.daily_limit ?? 25;
        const used = row?.used ?? 0;

        return {
            used,
            limit,
            remaining: Math.max(0, limit - used),
            resetAt: row?.reset_date ?? today + 'T00:00:00Z',
            date: today,
        };
    }
}
