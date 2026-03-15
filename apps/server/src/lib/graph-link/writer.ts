
import { getDB } from '../../db.js';
import { v4 as uuidv4 } from 'uuid';
import { EntityAnnotation, GraphEntity, GraphMiddleware } from './types.js';
import { AgentLogger } from '../agent-logger.js';
import { log, logWarn } from '../logger.js';
import { entityHooks, EntityChangeContext, shouldContinuePropagation } from './hooks.js';

const logger = new AgentLogger('graph_link');

export class GraphWriter {
    private middlewares: GraphMiddleware[] = [];

    /**
     * Register middleware
     */
    use(middleware: GraphMiddleware) {
        this.middlewares.push(middleware);
    }

    /**
     * Execute middleware chain
     */
    private async runMiddleware(op: 'ingest' | 'upsert' | 'annotate', payload: any, coreFn: () => any): Promise<any> {
        let index = -1;
        const ctx = { op, payload, result: undefined };

        const dispatch = async (i: number): Promise<void> => {
            if (i <= index) throw new Error('next() called multiple times');
            index = i;
            const fn = this.middlewares[i];
            if (i === this.middlewares.length) {
                ctx.result = await coreFn();
                return;
            }
            await fn(ctx, dispatch.bind(null, i + 1));
        };

        await dispatch(0);
        return ctx.result;
    }

    /**
     * Upsert an entity into the graph
     */
    async upsertEntity(entity: Partial<GraphEntity> & { id: string; title: string; type: string }): Promise<void> {
        await this.runMiddleware('upsert', entity, () => {
            const db = getDB();
            const now = new Date().toISOString();

            // 1. Insert/update main entities table
            db.query(`
           INSERT INTO entities (id, title, subtitle, body, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             subtitle = COALESCE(excluded.subtitle, entities.subtitle),
             body = COALESCE(excluded.body, entities.body),
             updated_at = excluded.updated_at
         `).run(
                entity.id,
                entity.title,
                entity.subtitle || null,
                entity.body || null,
                entity.created_at || now,
                now
            );

            // 2. Sync to ECS tables (entity_profiles, entity_physics)
            const entityType = entity.id.split(':')[0] || entity.type;
            db.query(`
              INSERT INTO entity_profiles (id, type, title, subtitle, body, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                subtitle = COALESCE(excluded.subtitle, entity_profiles.subtitle),
                body = COALESCE(excluded.body, entity_profiles.body),
                updated_at = excluded.updated_at
            `).run(
                entity.id,
                entityType,
                entity.title,
                entity.subtitle || null,
                entity.body || null,
                entity.created_at || now,
                now
            );

            // Initialize physics with default gravity (will be recalculated on tick or access)
            db.query(`
              INSERT INTO entity_physics (entity_id, gravity, base_mass)
              VALUES (?, 0.5, 0.5)
              ON CONFLICT(entity_id) DO NOTHING
            `).run(entity.id);
        });
    }

    /**
     * Ingest a finding (Source + Entity)
     * 
     * @ref infra/memo-id
     * @doc docs/WORKER-CHECKLIST.md#4-管线完整性
     * @since 2025-12-24 Uses unified memo_id field
     * @since 2026-01-08 Uses new source layer tables (user_memories / scout_findings)
     * 
     * Content is stored in source tables:
     * - Scout discoveries (http/https) → scout_findings → entity: finding:x
     * - User drops (drop://, file://) → user_memories → entity: memory:x
     * 
     * IMPORTANT: After calling this, you should call extractEntities({ memoryIds: [id] })
     * to complete the pipeline. See WORKER-CHECKLIST.md for details.
     * 
     * @param sourceUrl - Source URL or path
     * @param title - Title of the content
     * @param content - HTML content (for detailed view)
     * @param entities - Related entity IDs (for bi-directional linking)
     * @param textContent - Optional plain text version (for search/summaries)
     * @param triggeredBy - Entity ID that triggered this ingest (for scout_findings)
     */
    async ingestFinding(
        sourceUrl: string, 
        title: string, 
        content: string, 
        entities: string[] = [], 
        textContent?: string,
        triggeredBy?: string
    ): Promise<number> {
        const handle = logger.start('ingest', { 
            title: title.substring(0, 50), 
            sourceType: sourceUrl.startsWith('http') ? 'scout' : 'user_drop',
            contentLength: content.length 
        });

        try {
            return await this.runMiddleware('ingest', { sourceUrl, title, content, entities, textContent, triggeredBy }, async () => {
                const db = getDB();
                const now = new Date().toISOString();

                // === PREPARATION PHASE (outside transaction) ===
                
                // 1. Determine source type and entity prefix
                const isScoutDiscovery = sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://');
                const sourceType = isScoutDiscovery ? 'scout_snapshot' : 'user_drop';
                const entityPrefix = isScoutDiscovery ? 'finding' : 'memory';
                const tag = entityPrefix.toUpperCase();

                // 2. Generate summary (REQUIRED - fails entire operation if AI unavailable)
                const summarySource = textContent || content;
                const bodySummary = await this.generateMemorySummary(title, summarySource);
                // If generateMemorySummary throws, operation aborts before transaction starts

                // 3. Dynamic imports (outside transaction)
                const { calculateEntityGravity } = await import('../../systems/PhysicsSystem.js');
                const { BlockFactory } = await import('./block-factory.js');

                // === ATOMIC TRANSACTION (all DB operations) ===
                const result = db.transaction(() => {
                    let sourceId: number;
                    
                    // 4. Save to appropriate source table (NEW: split tables)
                    if (isScoutDiscovery) {
                        // Scout findings → scout_findings table
                        // Check if URL exists (for idempotency)
                        const existing = db.query(`SELECT id FROM scout_findings WHERE url = ?`).get(sourceUrl) as { id: number } | null;
                        
                        if (existing) {
                            // Update existing
                            db.query(`
                                UPDATE scout_findings SET
                                    content = ?, text_content = ?, title = ?,
                                    fetched_at = datetime('now')
                                WHERE id = ?
                            `).run(content, textContent || null, title, existing.id);
                            sourceId = existing.id;
                        } else {
                            // Insert new
                            db.query(`
                                INSERT INTO scout_findings (
                                    url, title, content, text_content, triggered_by,
                                    extraction_status, fetched_at
                                )
                                VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
                            `).run(sourceUrl, title, content, textContent || null, triggeredBy || entities[0] || null);
                            
                            const row = db.query(`SELECT id FROM scout_findings WHERE url = ?`).get(sourceUrl) as { id: number };
                            sourceId = row.id;
                        }
                        
                        // Update entity_id link
                        db.query(`UPDATE scout_findings SET entity_id = ? WHERE id = ?`)
                            .run(`finding:${sourceId}`, sourceId);
                    } else {
                        // User content → user_memories table
                        const userSourceType = sourceUrl.startsWith('file://') ? 'markdown' 
                            : sourceUrl.startsWith('drop://') ? 'user_drop' 
                            : 'mcp';
                        
                        // Check if source_url exists (for idempotency)
                        const existing = db.query(`SELECT id FROM user_memories WHERE source_url = ?`).get(sourceUrl) as { id: number } | null;
                        
                        if (existing) {
                            // Update existing
                            db.query(`
                                UPDATE user_memories SET
                                    content = ?, text_content = ?, title = ?,
                                    ingested_at = datetime('now')
                                WHERE id = ?
                            `).run(content, textContent || null, title, existing.id);
                            sourceId = existing.id;
                        } else {
                            // Insert new
                            db.query(`
                                INSERT INTO user_memories (
                                    title, content, text_content, source_type, source_url,
                                    extraction_status, ingested_at
                                )
                                VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
                            `).run(title, content, textContent || null, userSourceType, sourceUrl);
                            
                            const row = db.query(`SELECT id FROM user_memories WHERE source_url = ?`).get(sourceUrl) as { id: number };
                            sourceId = row.id;
                        }
                        
                        // Update entity_id link
                        db.query(`UPDATE user_memories SET entity_id = ? WHERE id = ?`)
                            .run(`memory:${sourceId}`, sourceId);
                    }

                    const entityId = `${entityPrefix}:${sourceId}`;

                    // 5. Create entity with memo_id (keeping memo_id for backward compat)
                    db.query(`
                        INSERT INTO entities (id, title, subtitle, body, tag, memo_id, extraction_status, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
                        ON CONFLICT(id) DO UPDATE SET
                            title = excluded.title,
                            subtitle = excluded.subtitle,
                            body = excluded.body,
                            tag = excluded.tag,
                            memo_id = excluded.memo_id
                    `).run(entityId, title, sourceUrl, bodySummary, tag, sourceId, now);

                    // 6. Sync to entity_profiles
                    db.query(`
                        INSERT INTO entity_profiles (id, type, title, subtitle, body, tag, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            title = excluded.title,
                            subtitle = excluded.subtitle,
                            body = excluded.body,
                            tag = excluded.tag,
                            updated_at = excluded.updated_at
                    `).run(entityId, entityPrefix, title, sourceUrl, bodySummary, tag, now, now);

                    // 7. Calculate and write gravity
                    const gravityCandidate = {
                        id: entityId,
                        tag: tag,
                        base_gravity: 0.5,
                        created_at: now,
                        source_type: entityPrefix as 'memory' | 'finding',
                    };
                    const { gravity, components } = calculateEntityGravity(gravityCandidate, { time: new Date() });

                    db.query(`
                        INSERT INTO entity_physics (entity_id, gravity, base_mass, convergence, path, spark, updated_at)
                        VALUES (?, ?, 0.5, ?, ?, ?, datetime('now'))
                        ON CONFLICT(entity_id) DO UPDATE SET
                            gravity = excluded.gravity,
                            convergence = excluded.convergence,
                            path = excluded.path,
                            spark = excluded.spark,
                            updated_at = datetime('now')
                    `).run(entityId, gravity, components.convergence, components.path, components.spark);

                    // 8. Create header block (page structure)
                    BlockFactory.addBlockIfMissing(entityId, entityId, { isHeader: true });

                    // 9. Create bi-directional links to source entities
                    for (const sourceEntityId of entities) {
                        db.query(`
                            INSERT OR IGNORE INTO relations (source, target, type, created_at)
                            VALUES (?, ?, 'discovered', datetime('now'))
                        `).run(sourceEntityId, entityId);

                        db.query(`
                            INSERT OR IGNORE INTO relations (source, target, type, created_at)
                            VALUES (?, ?, 'discoveredFrom', datetime('now'))
                        `).run(entityId, sourceEntityId);

                        BlockFactory.addBlockIfMissing(sourceEntityId, entityId, { target: entityId });
                        BlockFactory.addBlockIfMissing(entityId, sourceEntityId, { target: sourceEntityId });

                        log(`[GraphWriter] Linked: ${sourceEntityId} → discovered → ${entityId}`);
                    }

                    return { entityId, memoId: sourceId, bodySummary, gravity };
                })();

                // === POST-TRANSACTION (events) ===
                this.emitEvent('ingest', { type: entityPrefix, id: result.memoId, entities });

                handle.success({ 
                    entityId: result.entityId, 
                    memoId: result.memoId, 
                    summaryLength: result.bodySummary?.length ?? 0, 
                    gravity: result.gravity, 
                    linkedEntities: entities.length 
                });
                return result.memoId;
            });
        } catch (err) {
            handle.error(err);
            throw err;
        }
    }

    /**
     * Generate a concise summary for memory content
     */
    private async generateMemorySummary(title: string, content: string): Promise<string> {
        const { getOpenAI } = await import('../ai-clients.js');
        const openai = getOpenAI();
        
        if (!openai) {
            logWarn('[GraphWriter] OpenAI not available, using truncated content as summary');
            return content.substring(0, 500);
        }

        const truncatedContent = content.length > 4000 ? content.substring(0, 4000) + '...' : content;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a concise summarizer. Generate a 2-3 sentence summary of the given document. Focus on the core thesis and key insights. Output ONLY the summary, no preamble.`
                },
                {
                    role: 'user',
                    content: `Title: ${title}\n\nContent:\n${truncatedContent}`
                }
            ],
            max_tokens: 200,
            temperature: 0.3,
        });

        return completion.choices[0].message.content?.trim() || content.substring(0, 500);
    }

    /**
     * Add an entity from a source (memory) with full graph linking
     * 
     * This is the SSOT for creating entities with proper:
     * - memo_id tracking (unified field for content and extraction tracking)
     * - relations (memory → entity, finding → entity if applicable)
     * - page_blocks (bidirectional navigation)
     * 
     * Use this instead of upsertEntity when the entity comes from a memory/finding.
     * 
     * @param options.entity - Entity data (id, title, type, subtitle, body)
     * @param options.memoId - The memories.id this entity was extracted from
     * @param options.relationType - Type of relation to source ('contains' | 'mentions')
     * @param options.relatedTo - Other entity IDs this entity relates to
     * @param options.extractionBatchId - Optional batch ID for tracking
     */
    async addEntityFromSource(options: {
        entity: Partial<GraphEntity> & { id: string; title: string; type: string };
        memoId: number;
        relationType?: 'contains' | 'mentions';
        /** @deprecated Use semanticRelations for v2.0+ extractions */
        relatedTo?: string[];
        /** v2.0: Semantic relations with typed relationships */
        semanticRelations?: Array<{ relation: string; target: string; context?: string }>;
        extractionBatchId?: string;
        /** Hook context for propagation control (internal use) */
        hookContext?: Partial<EntityChangeContext>;
    }): Promise<string> {
        const { entity, memoId, relationType = 'contains', relatedTo = [], semanticRelations = [], extractionBatchId, hookContext } = options;
        const db = getDB();

        // Dynamic import (outside transaction)
        const { BlockFactory } = await import('./block-factory.js');

        // Check if entity already exists (to distinguish CREATE vs UPDATE)
        const existingEntity = db.query('SELECT id FROM entities WHERE id = ?').get(entity.id) as { id: string } | undefined;
        const isNewEntity = !existingEntity;

        // All DB operations in a single atomic transaction
        db.transaction(() => {
            // 1. Upsert the entity (inline for atomicity)
            const now = new Date().toISOString();
            db.query(`
                INSERT INTO entities (id, title, subtitle, body, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    subtitle = COALESCE(excluded.subtitle, entities.subtitle),
                    body = COALESCE(excluded.body, entities.body),
                    updated_at = excluded.updated_at
            `).run(entity.id, entity.title, entity.subtitle || null, entity.body || null, now, now);

            // Sync to entity_profiles
            db.query(`
                INSERT INTO entity_profiles (id, type, title, subtitle, body, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    type = excluded.type,
                    title = excluded.title,
                    subtitle = COALESCE(excluded.subtitle, entity_profiles.subtitle),
                    body = COALESCE(excluded.body, entity_profiles.body),
                    updated_at = excluded.updated_at
            `).run(entity.id, entity.type, entity.title, entity.subtitle || null, entity.body || null, now, now);

            // 2. Set memo_id
            db.query(`
                UPDATE entities 
                SET memo_id = ?, extraction_batch_id = COALESCE(?, extraction_batch_id)
                WHERE id = ? AND memo_id IS NULL
            `).run(memoId, extractionBatchId || null, entity.id);

            // 3. Check source type (v50: uses new source layer tables)
            // Try user_memories first, then scout_findings
            const userMem = db.query(`SELECT id FROM user_memories WHERE id = ?`).get(memoId) as { id: number } | undefined;
            const isScoutFinding = !userMem && db.query(`SELECT id FROM scout_findings WHERE id = ?`).get(memoId) !== undefined;
            const sourceEntityId = isScoutFinding ? `finding:${memoId}` : `memory:${memoId}`;

            // 4. Create relation: source → entity
            db.query(`
                INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
                VALUES (?, ?, ?, 0.7, datetime('now'))
            `).run(sourceEntityId, entity.id, relationType);

            // 5. Create page_blocks: bidirectional linking
            BlockFactory.ensureEntityPageStructure(entity.id, memoId);
            BlockFactory.addBlockIfMissing(sourceEntityId, entity.id, { target: entity.id });

            // 6. If scout_finding, add reverse linking
            if (isScoutFinding) {
                const findingId = `finding:${memoId}`;
                const findingExists = db.query('SELECT id FROM entities WHERE id = ?').get(findingId);
                
                if (findingExists) {
                    db.query(`
                        INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
                        VALUES (?, ?, 'contains', 0.8, datetime('now'))
                    `).run(findingId, entity.id);

                    db.query(`
                        INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
                        VALUES (?, ?, 'containedIn', 0.8, datetime('now'))
                    `).run(entity.id, findingId);

                    BlockFactory.addBlockIfMissing(findingId, entity.id, { target: entity.id });
                    BlockFactory.addBlockIfMissing(entity.id, findingId, { target: findingId, isSource: true });
                }
            }

            // 7. Handle semantic relations (v2.0)
            for (const rel of semanticRelations) {
                db.query(`
                    INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
                    VALUES (?, ?, ?, 0.9, datetime('now'))
                `).run(entity.id, rel.target, rel.relation);
                
                // Also add page_block for the relation
                BlockFactory.addBlockIfMissing(entity.id, rel.target, { target: rel.target });
            }

            // 7b. Handle legacy relatedTo links (fallback for v1 extractions)
            for (const relatedId of relatedTo) {
                db.query(`
                    INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
                    VALUES (?, ?, 'related_to', 0.5, datetime('now'))
                `).run(entity.id, relatedId);
            }
        })();

        // === POST-TRANSACTION: Trigger Entity Lifecycle Hooks ===
        // Build hook context (respecting propagation control)
        const ctx: EntityChangeContext = {
            entityId: entity.id,
            entityType: entity.type,
            entityTitle: entity.title,
            sourceMemoId: memoId,
            trigger: hookContext?.trigger ?? 'system',
            inheritedGravity: hookContext?.inheritedGravity ?? 1.0,
            depth: hookContext?.depth ?? 0,
        };

        // Check decay threshold before triggering hooks
        if (shouldContinuePropagation(ctx)) {
            if (isNewEntity) {
                entityHooks.triggerEntityCreate(ctx);
            } else {
                entityHooks.triggerEntityUpdate(ctx);
            }
        } else {
            log(`[GraphWriter] Skipping hooks for ${entity.id} due to decay threshold`);
        }

        return entity.id;
    }

    /**
     * Add a cognitive annotation (Irony, etc.)
     */
    async addAnnotation(annotation: EntityAnnotation): Promise<void> {
        await this.runMiddleware('annotate', annotation, () => {
            const db = getDB();
            const now = new Date().toISOString();

            db.query(`
          INSERT INTO entity_metadata (entity_id, key, value, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(entity_id, key) DO UPDATE SET
            value = excluded.value,
            created_at = excluded.created_at
        `).run(
                annotation.entityId,
                annotation.key,
                JSON.stringify(annotation.value),
                annotation.createdAt || now
            );

            // Emit event for "Dreaming"
            this.emitEvent('annotation', annotation);
        });
    }

    /**
     * Record activity on an entity (e.g. scouted, visited)
     */
    async recordActivity(entityId: string, activityType: 'scout' | 'visit'): Promise<void> {
        const db = getDB();
        const now = new Date().toISOString();

        if (activityType === 'scout') {
            // Update both tables for transition safety
            try {
                db.query('UPDATE entity_profiles SET last_scouted_at = ? WHERE id = ?').run(now, entityId);
            } catch (e) { /* ignore */ }
            try {
                db.query('UPDATE entities SET last_scouted_at = ? WHERE id = ?').run(now, entityId);
            } catch (e) { /* ignore */ }
        }

        // Future: Handle 'visit' type
    }

    /**
     * Boost entity gravity (explicit user interest signal)
     * 
     * Used for "collect" operations - when user explicitly indicates interest.
     * Returns the new gravity value, or null if entity not found.
     */
    async boostGravity(entityId: string, boost: number = 2.0): Promise<{ title: string; oldGravity: number; newGravity: number } | null> {
        const db = getDB();

        // Get current entity
        const entity = db.query('SELECT id, title, base_gravity FROM entities WHERE id = ?')
            .get(entityId) as { id: string; title: string; base_gravity: number } | undefined;

        if (!entity) {
            return null;
        }

        // Calculate new gravity (capped at 10)
        const oldGravity = entity.base_gravity || 0;
        const newGravity = Math.min(10, oldGravity + boost);

        // Update base_gravity
        db.query('UPDATE entities SET base_gravity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(newGravity, entityId);

        // Update entity_physics with new base_mass
        db.query('UPDATE entity_physics SET base_mass = ?, updated_at = CURRENT_TIMESTAMP WHERE entity_id = ?')
            .run(newGravity, entityId);

        return {
            title: entity.title,
            oldGravity,
            newGravity
        };
    }

    /**
     * Set entity gravity to a specific value
     * 
     * Used for "anchor" operations - explicitly set gravity.
     */
    async setGravity(entityId: string, gravity: number): Promise<boolean> {
        const db = getDB();

        const result = db.query('UPDATE entities SET base_gravity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(gravity, entityId);

        if (result.changes === 0) {
            return false;
        }

        // Update entity_physics with new base_mass and gravity
        db.query(`
            UPDATE entity_physics 
            SET base_mass = ?, gravity = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE entity_id = ?
        `).run(gravity, gravity, entityId);

        return true;
    }

    /**
     * Discard an entity (soft-delete)
     * 
     * Sets gravity to -1 to hide from the field without deleting data.
     * Used for atomicity rollback when subsequent steps fail.
     */
    async discardEntity(entityId: string): Promise<void> {
        const db = getDB();

        // Soft-delete entity by setting base_gravity to -1
        db.query(`
            UPDATE entities 
            SET base_gravity = -1, updated_at = datetime('now')
            WHERE id = ?
        `).run(entityId);

        // Also mark the source memory as discarded (for memory:/finding: entities)
        if (entityId.startsWith('memory:') || entityId.startsWith('finding:')) {
            const numericId = entityId.split(':')[1];
            db.query(`
                UPDATE memories 
                SET discarded = 1
                WHERE id = ?
            `).run(numericId);
        }

        // Set gravity to -1 in entity_physics
        db.query(`
            UPDATE entity_physics 
            SET gravity = -1, updated_at = datetime('now')
            WHERE entity_id = ?
        `).run(entityId);

        log(`[GraphWriter] Discarded entity: ${entityId}`);
    }

    // Simple Event Emitter placeholder (to be replaced by real bus)
    private listeners: Record<string, Function[]> = {};

    on(event: string, callback: Function) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    private emitEvent(event: string, payload: any) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(payload));
        }
    }
}
