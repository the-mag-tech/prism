/**
 * EntityExtractionAtom
 * 
 * A middleware that runs AFTER content ingestion to:
 * 1. Query GraphReader for existing similar entities (via Embedding similarity)
 * 2. Extract new entities using AI (with Graph context injected)
 * 3. Upsert entities and relations via GraphWriter
 * 
 * Phase 2: Uses embedding similarity + gravity weighting for relevance.
 */

import { GraphWriter } from '../writer.js';
import { log, logError, logWarn } from '../../logger.js';
import { GraphMiddleware } from '../types.js';
import { graphReader } from '../index.js';
import { getDB } from '../../../db.js';
import { EXTRACTION_PROMPT } from '../../../pipeline-version.js';
import { BlockFactory } from '../block-factory.js';
// SSOT: Entity type definitions from prism-contract
import { EXTRACTABLE_TYPES, type ExtractableType } from '@prism/contract';
import { SCOUTABLE_TYPES } from '@prism/contract';
// Unified AI client (supports runtime keys + proxy mode)
import { getOpenAI } from '../../ai-clients.js';
// NOTE: Ripple/Scout now triggered via Entity Lifecycle Hooks in GraphWriter
// See: src/lib/graph-link/hooks.ts

/**
 * Raw entity from LLM response (before validation)
 */
interface RawExtractedEntity {
    type: string;
    name: string;
    title: string;
    subtitle?: string;
    body?: string;
    /** @deprecated v1 format */
    relatedTo?: string[];
}

/**
 * v2.0: Semantic relation from LLM response
 */
interface RawExtractedRelation {
    source: string;
    relation: string;
    target: string;
    context?: string;
}

/**
 * Validated entity with strong typing
 */
interface ValidatedEntity {
    type: ExtractableType;
    name: string;        // Clean name without type prefix
    title: string;
    subtitle?: string;
    body?: string;
    /** @deprecated v1 format - use semanticRelations instead */
    relatedTo?: string[];
    /** v2.0: Semantic relations extracted for this entity */
    semanticRelations?: Array<{ relation: string; target: string; context?: string }>;
}

// =============================================================================
// VALIDATION ISSUE TRACKING
// =============================================================================

/**
 * Types of validation issues we track for analysis
 */
type ValidationIssueType = 
    | 'type_downgrade'      // Invalid type → fallback to 'topic'
    | 'name_prefix_cleaned' // Name had type prefix that was stripped
    | 'missing_fields';     // Entity skipped due to missing required fields

interface ValidationIssue {
    type: ValidationIssueType;
    originalValue: string;
    correctedValue?: string;
    entityTitle?: string;
}

/**
 * Collector for validation issues during a single extraction run.
 * Used for aggregated reporting and future iteration analysis.
 */
class ValidationTracker {
    private issues: ValidationIssue[] = [];

    addIssue(issue: ValidationIssue): void {
        this.issues.push(issue);
    }

    getIssues(): ValidationIssue[] {
        return this.issues;
    }

    /**
     * Output aggregated summary to console for analysis.
     * Call this after extraction is complete.
     */
    logSummary(documentTitle: string): void {
        if (this.issues.length === 0) return;

        const byType = this.issues.reduce((acc, issue) => {
            acc[issue.type] = acc[issue.type] || [];
            acc[issue.type].push(issue);
            return acc;
        }, {} as Record<ValidationIssueType, ValidationIssue[]>);

        log(`[EntityExtractionAtom] 📊 Validation Summary for "${documentTitle}":`);
        
        // Type downgrades - important for SSOT iteration
        if (byType.type_downgrade?.length) {
            const invalidTypes = byType.type_downgrade.map(i => i.originalValue);
            const uniqueTypes = [...new Set(invalidTypes)];
            log(`   ⚠️ Type Downgrades (${byType.type_downgrade.length}): ${uniqueTypes.join(', ')} → "topic"`);
            log(`      → Consider adding these to EXTRACTABLE_TYPES or improving prompt`);
        }

        // Name prefix issues - indicates prompt confusion
        if (byType.name_prefix_cleaned?.length) {
            log(`   🔧 Name Prefix Cleaned (${byType.name_prefix_cleaned.length})`);
            byType.name_prefix_cleaned.slice(0, 3).forEach(i => {
                log(`      "${i.originalValue}" → "${i.correctedValue}"`);
            });
            if (byType.name_prefix_cleaned.length > 3) {
                log(`      ... and ${byType.name_prefix_cleaned.length - 3} more`);
            }
        }

        // Missing fields - LLM output quality issue
        if (byType.missing_fields?.length) {
            log(`   ❌ Skipped (missing fields): ${byType.missing_fields.length}`);
        }
    }

    /**
     * Get summary object for potential persistence/metrics
     */
    getSummaryObject(): { 
        typeDowngrades: string[]; 
        prefixCleaned: number; 
        skipped: number;
    } {
        const byType = this.issues.reduce((acc, issue) => {
            acc[issue.type] = acc[issue.type] || [];
            acc[issue.type].push(issue);
            return acc;
        }, {} as Record<ValidationIssueType, ValidationIssue[]>);

        return {
            typeDowngrades: [...new Set((byType.type_downgrade || []).map(i => i.originalValue))],
            prefixCleaned: byType.name_prefix_cleaned?.length || 0,
            skipped: byType.missing_fields?.length || 0,
        };
    }
}

// =============================================================================
// ENTITY VALIDATION UTILITIES (Defensive Programming)
// =============================================================================

/**
 * Validate that a type string is a valid ExtractableType.
 * Falls back to 'topic' if invalid (safest generic type).
 */
function validateEntityType(type: string, tracker?: ValidationTracker): ExtractableType {
    const normalized = type.toLowerCase().trim();
    if ((EXTRACTABLE_TYPES as readonly string[]).includes(normalized)) {
        return normalized as ExtractableType;
    }
    
    // Track the downgrade for analysis
    tracker?.addIssue({
        type: 'type_downgrade',
        originalValue: type,
        correctedValue: 'topic',
    });
    
    log(`[EntityExtractionAtom] ⚠️ Invalid type "${type}", falling back to "topic"`);
    return 'topic';
}

/**
 * Sanitize entity name to prevent duplicate prefixes.
 * 
 * LLM sometimes returns names like "problem:garbage_in_entities_out"
 * when it should just return "garbage_in_entities_out".
 * 
 * This function strips any type prefix if present.
 */
function sanitizeEntityName(name: string, type: string, tracker?: ValidationTracker): string {
    // Normalize to lowercase snake_case
    let cleaned = name.toLowerCase().trim();
    const original = cleaned;
    
    // Remove type prefix if LLM accidentally included it
    // e.g., "problem:garbage_in" -> "garbage_in"
    const prefixPattern = new RegExp(`^${type}:`, 'i');
    cleaned = cleaned.replace(prefixPattern, '');
    
    // Also check for any known type prefix (defensive)
    for (const knownType of EXTRACTABLE_TYPES) {
        const pattern = new RegExp(`^${knownType}:`, 'i');
        cleaned = cleaned.replace(pattern, '');
    }
    
    // Normalize: replace non-alphanumeric with underscore, trim edges
    cleaned = cleaned
        .replace(/[^a-z0-9_\u4e00-\u9fa5]+/g, '_')  // Allow Chinese chars
        .replace(/^_+|_+$/g, '');
    
    const finalName = cleaned || 'unnamed';
    
    // Track if we had to clean a prefix
    if (original !== finalName && original.includes(':')) {
        tracker?.addIssue({
            type: 'name_prefix_cleaned',
            originalValue: original,
            correctedValue: finalName,
        });
    }
    
    return finalName;
}

/**
 * Validate and sanitize a raw entity from LLM response.
 * Returns null if entity is completely invalid.
 */
function validateEntity(raw: RawExtractedEntity, tracker?: ValidationTracker): ValidatedEntity | null {
    if (!raw.type || !raw.name || !raw.title) {
        tracker?.addIssue({
            type: 'missing_fields',
            originalValue: JSON.stringify({ type: raw.type, name: raw.name, title: raw.title }),
        });
        log(`[EntityExtractionAtom] ⚠️ Skipping invalid entity: missing required fields`);
        return null;
    }
    
    const validType = validateEntityType(raw.type, tracker);
    const cleanName = sanitizeEntityName(raw.name, raw.type, tracker);
    
    return {
        type: validType,
        name: cleanName,
        title: raw.title.trim(),
        subtitle: raw.subtitle?.trim(),
        body: raw.body?.trim(),
        relatedTo: raw.relatedTo,
    };
}

// =============================================================================
// EMBEDDING UTILITIES
// =============================================================================

/**
 * Compute embedding for text using OpenAI
 */
async function computeEmbedding(text: string): Promise<number[] | null> {
    const openai = getOpenAI();
    if (!openai) return null;
    
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000),
    });
    return response.data[0].embedding;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Build entity text for embedding
 */
function entityToText(entity: { title: string; subtitle?: string | null; body?: string | null }): string {
    const parts = [entity.title];
    if (entity.subtitle) parts.push(entity.subtitle);
    if (entity.body) parts.push(entity.body.substring(0, 200));
    return parts.join(' | ');
}

// =============================================================================
// GRAPH CONTEXT BUILDING (Embedding-Based)
// =============================================================================

/**
 * Find relevant entities using embedding similarity + gravity weighting
 * 
 * Formula: relevance_score = similarity * (0.5 + 0.5 * gravity)
 */
async function findRelevantEntities(contentSummary: string): Promise<string> {
    const db = getDB();

    // 1. Get entities with cached embeddings
    const entities = db.query(`
        SELECT e.id, e.title, e.subtitle, e.body,
               COALESCE(ph.gravity, e.base_gravity, 0.5) as gravity,
               m.value as embedding_json
        FROM entities e
        LEFT JOIN entity_physics ph ON e.id = ph.entity_id
        LEFT JOIN entity_metadata m ON e.id = m.entity_id AND m.key = 'embedding'
        WHERE e.id NOT LIKE 'system:%' AND e.id NOT LIKE 'singleton:%'
        LIMIT 50
    `).all() as Array<{
        id: string; title: string; subtitle: string | null; body: string | null;
        gravity: number; embedding_json: string | null;
    }>;

    if (entities.length === 0) {
        return 'Graph is empty. All entities will be created fresh.';
    }

    // 2. Compute content embedding
    log(`[EntityExtractionAtom] 📐 Computing content embedding...`);
    const contentEmbedding = await computeEmbedding(contentSummary);

    // 3. Calculate similarity for each entity
    const scored: Array<{ entity: typeof entities[0]; relevance: number; similarity: number }> = [];

    for (const entity of entities) {
        let entityEmbedding: number[];

        if (entity.embedding_json) {
            entityEmbedding = JSON.parse(entity.embedding_json);
        } else {
            // Compute and cache
            const text = entityToText(entity);
            const computed = await computeEmbedding(text);
            if (!computed) continue; // Skip if embedding failed
            entityEmbedding = computed;

            db.query(`
                INSERT INTO entity_metadata (entity_id, key, value, created_at)
                VALUES (?, 'embedding', ?, datetime('now'))
                ON CONFLICT(entity_id, key) DO UPDATE SET
                    value = excluded.value, created_at = excluded.created_at
            `).run(entity.id, JSON.stringify(entityEmbedding));
        }

        if (!contentEmbedding) continue; // Skip if content embedding failed
        const similarity = cosineSimilarity(contentEmbedding, entityEmbedding);
        const gravityBoost = 0.5 + 0.5 * entity.gravity;
        const relevance = similarity * gravityBoost;

        scored.push({ entity, relevance, similarity });
    }

    // 4. Sort and filter
    scored.sort((a, b) => b.relevance - a.relevance);
    const topEntities = scored.filter(s => s.similarity >= 0.3).slice(0, 8);

    if (topEntities.length === 0) {
        return 'No semantically similar entities found. Create new entities as needed.';
    }

    log(`[EntityExtractionAtom] 📊 Found ${topEntities.length} relevant entities by embedding.`);

    const entityList = topEntities
        .map(s => `- ${s.entity.id}: "${s.entity.title}"${s.entity.subtitle ? ` (${s.entity.subtitle})` : ''} [sim=${s.similarity.toFixed(2)}, G=${s.entity.gravity.toFixed(2)}]`)
        .join('\n');

    return `SEMANTICALLY SIMILAR ENTITIES (by embedding + gravity):
${entityList}

PRIORITIZE linking to these existing entities instead of creating duplicates.`;
}

// =============================================================================
// MIDDLEWARE FACTORY
// =============================================================================

/**
 * Create the EntityExtractionAtom middleware
 */
export function createEntityExtractionAtom(writer: GraphWriter): GraphMiddleware {
    return async (ctx, next) => {
        await next();

        if (ctx.op === 'ingest' && ctx.result) {
            const memoryId = ctx.result;
            const { title, content } = ctx.payload;

            if (!content || content.length < 100) return;

            log(`[EntityExtractionAtom] 🔍 Extracting entities from: "${title}"`);

            try {
                // Build Graph context using embedding similarity
                const graphContext = await findRelevantEntities(content.substring(0, 2000));

                const truncatedContent = content.length > 6000
                    ? content.substring(0, 6000) + '\n\n[... truncated ...]'
                    : content;

                const systemPrompt = `${EXTRACTION_PROMPT}

---
GRAPH CONTEXT (for deduplication and linking):
${graphContext}
---

When extracting entities:
- If an entity matches an EXISTING ENTITY above, use the EXACT same ID format
- Prioritize relations to high-gravity existing entities
- Create new entities only for genuinely new concepts`;

                const openai = getOpenAI();
                if (!openai) {
                    log(`[EntityExtractionAtom] ⚠️ OpenAI not available, skipping extraction`);
                    return;
                }
                
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Document: "${title}"\n\n${truncatedContent}` }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                });

                const result = JSON.parse(completion.choices[0].message.content || '{}');
                const rawEntities = (result.entities || []) as RawExtractedEntity[];
                
                // v2.0: Parse semantic relations
                const rawRelations = (result.relations || []) as RawExtractedRelation[];

                if (rawEntities.length === 0) {
                    log(`[EntityExtractionAtom]    No entities found.`);
                    return;
                }

                // Create tracker for this extraction run
                const tracker = new ValidationTracker();

                // Validate and sanitize all entities
                const entities = rawEntities
                    .map(raw => validateEntity(raw, tracker))
                    .filter((e): e is ValidatedEntity => e !== null);
                
                // v2.0: Map relations to their source entities
                const relationsMap = new Map<string, Array<{ relation: string; target: string; context?: string }>>();
                for (const rel of rawRelations) {
                    if (!relationsMap.has(rel.source)) {
                        relationsMap.set(rel.source, []);
                    }
                    relationsMap.get(rel.source)!.push({
                        relation: rel.relation,
                        target: rel.target,
                        context: rel.context,
                    });
                }
                
                // Attach semantic relations to entities
                for (const entity of entities) {
                    const entityId = `${entity.type}:${entity.name}`;
                    const rels = relationsMap.get(entityId);
                    if (rels && rels.length > 0) {
                        entity.semanticRelations = rels;
                    }
                }

                // Log validation summary for analysis
                tracker.logSummary(title);

                if (entities.length === 0) {
                    log(`[EntityExtractionAtom]    No valid entities after validation.`);
                    return;
                }

                log(`[EntityExtractionAtom]    Found ${entities.length} valid entities (${rawEntities.length} raw).`);

                const db = getDB();
                let position = 0;
                const newlyCreatedEntityIds: string[] = []; // Track new entities for scout

                for (const entity of entities) {
                    // Build entity ID with validated type and sanitized name
                    const entityId = `${entity.type}:${entity.name}`;
                    const existing = graphReader.resolveEntity(entity.title);
                    const targetEntityId = existing ? existing.id : entityId;

                    if (existing) {
                        // Entity already exists - just create mention relation
                        log(`[EntityExtractionAtom]    ⚡ Linked to existing: ${existing.id}`);
                        db.query(`
                            INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
                            VALUES (?, ?, 'mentions', 0.5, datetime('now'))
                        `).run(`memory:${memoryId}`, existing.id);
                        
                        // Still need to link page structure
                        BlockFactory.linkMemoryToEntity(memoryId, existing.id);
                    } else {
                        // New entity - use addEntityFromSource (SSOT for entity creation with linking)
                        await writer.addEntityFromSource({
                            entity: {
                                id: entityId,
                                title: entity.title,
                                type: entity.type,
                                subtitle: entity.subtitle ?? undefined,
                                body: entity.body ?? undefined,
                            },
                            memoId: memoryId,
                            relationType: 'contains',
                            relatedTo: entity.relatedTo ?? [],  // v1 fallback
                            semanticRelations: entity.semanticRelations ?? [],  // v2.0
                        });
                        log(`[EntityExtractionAtom]    ✨ Created: ${entityId}`);

                        // v2.0: Log semantic relations
                        if (entity.semanticRelations && entity.semanticRelations.length > 0) {
                            for (const rel of entity.semanticRelations) {
                                log(`[EntityExtractionAtom]       → [${rel.relation}] ${rel.target}`);
                            }
                        } else if (entity.relatedTo && entity.relatedTo.length > 0) {
                            // v1 fallback logging
                            log(`[EntityExtractionAtom]       → ${entity.relatedTo.length} relations (legacy)`);
                        }

                        // Track for scout enrichment (uses SCOUTABLE_TYPES from prism-contract SSOT)
                        if ((SCOUTABLE_TYPES as readonly string[]).includes(entity.type)) {
                            newlyCreatedEntityIds.push(entityId);
                        }
                    }
                }

                log(`[EntityExtractionAtom] ✅ Extraction complete.`);

                // NOTE: Ripple/Scout triggers are now handled automatically via Entity Lifecycle Hooks
                // in GraphWriter.addEntityFromSource() - no manual emit() needed.
                // See: src/lib/graph-link/hooks.ts
                if (newlyCreatedEntityIds.length > 0) {
                    log(`[EntityExtractionAtom] 🎣 ${newlyCreatedEntityIds.length} new entities will trigger hooks automatically`);
                }

            } catch (e) {
                log('[EntityExtractionAtom] Failed:', e);
            }
        }
    };
}
