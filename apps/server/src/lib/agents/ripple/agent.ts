/**
 * Ripple Agent
 * 
 * Responsible for propagating knowledge through the graph via:
 * 1. Profile generation (triangulated search + AI synthesis)
 * 2. Content onboarding (high-value content ingestion)
 * 3. Serendipity filtering (only ingest surprising content)
 * 
 * Uses GraphReader.calculateSurprise() for graph-aware filtering.
 */

import { getOpenAI } from '../../ai-clients.js';
import { search as searchWeb, isSearchAvailable, searchWithLogging, type SearchContext } from '../../search-service.js';
import { log, logError, logWarn } from '../../logger.js';
import { graphReader, graphWriter } from '../../graph-link/index.js';
import { snapshotUrl } from '../scout/snapshot.js';
import { extractEntities } from '../../../extract.js';
import { getDB } from '../../../db.js';
import type { 
    EntityProfile, 
    RippleResult, 
    RippleConfig, 
    DEFAULT_RIPPLE_CONFIG,
    SearchCandidate,
    EvaluatedCandidate 
} from './types.js';
import { 
    PROFILEABLE_TYPES, 
    getTribeFromType,
    TRIBE_PROFILE_STRATEGIES,
    type EntityType,
    type Tribe,
} from '@prism/contract';

// =============================================================================
// RIPPLE AGENT
// =============================================================================

export class RippleAgent {
    private config: RippleConfig;

    constructor(config: Partial<RippleConfig> = {}) {
        this.config = {
            maxEntitiesPerRipple: config.maxEntitiesPerRipple ?? 3,
            maxContentPerEntity: config.maxContentPerEntity ?? 3,
            maxDepth: config.maxDepth ?? 1,
            minSurpriseThreshold: config.minSurpriseThreshold ?? 0.5,
            // Use SSOT: PROFILEABLE_TYPES from entity-definitions.ts
            scoutableTypes: config.scoutableTypes ?? PROFILEABLE_TYPES,
        };
    }

    /**
     * Main entry point: Propagate ripple from an entity
     * 
     * @param entityId - The entity to ripple from
     * @param depth - Current depth (for recursive ripples)
     */
    async propagate(entityId: string, depth: number = 0): Promise<RippleResult> {
        const startTime = Date.now();
        const result: RippleResult = {
            entityId,
            profileGenerated: false,
            contentIngested: 0,
            entitiesDiscovered: 0,
            relationsCreated: 0,
            surpriseScore: 0,
            duration: 0,
        };

        // Check depth limit
        if (depth >= this.config.maxDepth) {
            log(`[RippleAgent] Max depth (${this.config.maxDepth}) reached for ${entityId}`);
            result.duration = Date.now() - startTime;
            return result;
        }

        // Get entity
        const entity = graphReader.getEntity(entityId);
        if (!entity) {
            logWarn(`[RippleAgent] Entity not found: ${entityId}`);
            result.duration = Date.now() - startTime;
            return result;
        }

        // Check if entity type is scoutable
        if (!this.config.scoutableTypes.includes(entity.type)) {
            log(`[RippleAgent] Skipping non-scoutable type: ${entity.type}`);
            result.duration = Date.now() - startTime;
            return result;
        }

        log(`\n🌊 [RippleAgent] Propagating from: ${entity.title} (${entityId})`);

        try {
            // Step 1: Generate rich profile
            const context = `${entity.subtitle || ''} ${entity.body?.substring(0, 200) || ''}`.trim();
            const profile = await this.profile(entity.title, context, entity.type);
            result.profileGenerated = true;

            log(`[RippleAgent] 📋 Profile: ${profile.name} - ${profile.role || 'unknown role'}`);

            // Step 2: Update entity with enriched profile
            if (profile.bio) {
                const db = getDB();
                db.query(`
                    UPDATE entities 
                    SET body = ?, subtitle = COALESCE(subtitle, ?), updated_at = datetime('now')
                    WHERE id = ?
                `).run(profile.bio, profile.role || null, entityId);

                db.query(`
                    UPDATE entity_profiles 
                    SET body = ?, subtitle = COALESCE(subtitle, ?), updated_at = datetime('now')
                    WHERE id = ?
                `).run(profile.bio, profile.role || null, entityId);
            }

            // Step 3: Onboard high-value content (with Serendipity filtering)
            const onboardResult = await this.onboard(profile, entityId);
            result.contentIngested = onboardResult.contentIngested;
            result.entitiesDiscovered = onboardResult.entitiesDiscovered;
            result.surpriseScore = onboardResult.avgSurprise;

            // Step 4: Create relations from profile
            if (profile.relatedEntities && profile.relatedEntities.length > 0) {
                const db = getDB();
                for (const related of profile.relatedEntities) {
                    const relatedId = `${related.type || 'topic'}:${related.name.toLowerCase().replace(/\s+/g, '_')}`;
                    db.query(`
                        INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
                        VALUES (?, ?, 'relatedTo', 0.6, datetime('now'))
                    `).run(entityId, relatedId);
                    result.relationsCreated++;
                }
                log(`[RippleAgent] 🔗 Created ${result.relationsCreated} relations from profile`);
            }

        } catch (error) {
            log(`[RippleAgent] Error propagating ${entityId}:`, error);
        }

        result.duration = Date.now() - startTime;
        log(`🌊 [RippleAgent] Ripple complete: ${result.contentIngested} content, ${result.entitiesDiscovered} entities (${result.duration}ms)`);
        
        return result;
    }

    /**
     * Generate a rich profile for an entity via triangulated search.
     * Only generates profile for PROFILEABLE_TYPES (person, company, project).
     * 
     * @param name - Entity display name
     * @param context - Additional context (subtitle, body snippet)
     * @param type - Entity type (from entityId prefix)
     * @returns EntityProfile (minimal if type is not profileable)
     */
    async profile(name: string, context: string, type: string): Promise<EntityProfile> {
        const entityType = type as EntityType;
        const tribe = getTribeFromType(type);
        
        // Check if this type needs profile generation (person, company, project only)
        if (!PROFILEABLE_TYPES.includes(entityType)) {
            log(`[RippleAgent] ⏭️ Skipping profile for non-profileable type: ${type} (tribe: ${tribe || 'unknown'})`);
            return {
                name,
                type: entityType,
                bio: context || undefined,
                tags: [],
                keyLinks: [],
                relatedEntities: [],
            };
        }

        log(`[RippleAgent] 🔍 Profiling: ${name} (${type}, tribe: ${tribe})`);

        const searchResults: string[] = [];

        // Strategy-based queries depending on entity type
        const queries = this.generateQueries(name, context, type);

        log(`[RippleAgent] Searching with ${queries.length} queries...`);

        // Parallel search using unified search service
        const searchPromises = queries.map(q =>
            searchWeb(q, {
                searchDepth: 'basic',
                maxResults: 2,
                includeAnswer: true,
            })
        );

        try {
            const results = await Promise.all(searchPromises);
            results.forEach(r => {
                if (r.success) {
                    if (r.answer) searchResults.push(`AI Summary: ${r.answer}`);
                    r.results.forEach((res) => 
                        searchResults.push(`Source (${res.title}): ${res.content} URL: ${res.url}`)
                    );
                }
            });
        } catch (e) {
            logWarn('[RippleAgent] Search failed during profiling:', e);
            searchResults.push(`Context: ${context}`);
        }

        // Synthesize profile with AI
        return this.synthesizeProfile(name, type, searchResults.join('\n---\n'));
    }

    /**
     * Onboard high-value content for an entity (with Serendipity filtering)
     * 
     * Now includes quality logging for empirical analysis (Phase 0.5).
     */
    async onboard(
        profile: EntityProfile, 
        entityId: string
    ): Promise<{ contentIngested: number; entitiesDiscovered: number; avgSurprise: number }> {
        if (!isSearchAvailable()) {
            logWarn('[RippleAgent] Cannot onboard without search service');
            return { contentIngested: 0, entitiesDiscovered: 0, avgSurprise: 0 };
        }

        log(`[RippleAgent] 🌊 Onboarding content for: ${profile.name}`);

        // Search for high-value content with quality logging
        const query = `${profile.name} best essays blog insights ${profile.role || ''}`;
        const searchContext: SearchContext = {
            trigger: 'ripple',
            entityId,
        };

        try {
            // Use searchWithLogging for quality tracking
            const { response: searchResult, logger: searchLogger } = await searchWithLogging(
                query,
                {
                    searchDepth: 'advanced',
                    maxResults: this.config.maxContentPerEntity + 2, // Get extra for filtering
                },
                searchContext
            );

            if (!searchResult.success || searchResult.results.length === 0) {
                log(`[RippleAgent] No content found to onboard (${searchResult.error || 'no results'})`);
                searchLogger.finalize({ ingestedCount: 0, skippedCount: 0 });
                return { contentIngested: 0, entitiesDiscovered: 0, avgSurprise: 0 };
            }
            
            log(`[RippleAgent] Found ${searchResult.results.length} candidates via ${searchResult.provider}`);

            // Evaluate each candidate with Serendipity
            const candidates: SearchCandidate[] = searchResult.results.map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.content,
            }));

            const evaluated = await this.evaluateCandidates(candidates, entityId);
            
            // Filter and limit
            const toIngest = evaluated
                .filter(c => c.shouldIngest)
                .slice(0, this.config.maxContentPerEntity);
            
            // Record negative samples (skipped results) for learning
            const skipped = evaluated.filter(c => !c.shouldIngest);
            for (const skipCandidate of skipped) {
                searchLogger.recordSkipped(
                    skipCandidate.url,
                    skipCandidate.title,
                    skipCandidate.snippet,
                    'low_surprise',
                    skipCandidate.surpriseScore,
                    query
                );
            }

            log(`[RippleAgent] Serendipity filter: ${toIngest.length}/${candidates.length} passed`);

            let contentIngested = 0;
            let entitiesDiscovered = 0;
            let totalSurprise = 0;

            // Ingest high-value content
            for (const candidate of toIngest) {
                log(`[RippleAgent] 📥 Ingesting (surprise=${candidate.surpriseScore.toFixed(2)}): ${candidate.title}`);
                
                const snapshot = await snapshotUrl(candidate.url);
                if (!snapshot) continue;

                // Ingest via GraphWriter
                const memoryId = await graphWriter.ingestFinding(
                    candidate.url,
                    snapshot.title,
                    snapshot.content,
                    [entityId],
                    snapshot.textContent || ''
                );

                contentIngested++;
                totalSurprise += candidate.surpriseScore;

                // Extract entities (this triggers the Ripple chain via EntityExtractionAtom)
                try {
                    const extractResult = await extractEntities({
                        memoryIds: [memoryId],
                        description: `Ripple: ${snapshot.title}`,
                    });
                    entitiesDiscovered += extractResult.entitiesCreated;
                    log(`[RippleAgent]    → Extracted ${extractResult.entitiesCreated} entities`);
                } catch (e) {
                    logWarn('[RippleAgent] Entity extraction failed:', e);
                }
            }

            // Finalize search log with metrics
            const avgSurprise = contentIngested > 0 ? totalSurprise / contentIngested : 0;
            searchLogger.finalize({
                ingestedCount: contentIngested,
                skippedCount: skipped.length,
                avgSurpriseScore: avgSurprise,
            });

            return {
                contentIngested,
                entitiesDiscovered,
                avgSurprise,
            };

        } catch (e) {
            log('[RippleAgent] Onboard failed:', e);
            return { contentIngested: 0, entitiesDiscovered: 0, avgSurprise: 0 };
        }
    }

    /**
     * Evaluate search candidates using Graph-based Serendipity
     */
    private async evaluateCandidates(
        candidates: SearchCandidate[],
        contextEntityId: string
    ): Promise<EvaluatedCandidate[]> {
        const results: EvaluatedCandidate[] = [];

        for (const candidate of candidates) {
            const content = `${candidate.title}\n${candidate.snippet}`;
            const surprise = await graphReader.calculateSurprise(content, contextEntityId);

            results.push({
                ...candidate,
                surpriseScore: surprise.score,
                shouldIngest: surprise.shouldIngest && surprise.score >= this.config.minSurpriseThreshold,
                reason: surprise.reason,
            });
        }

        // Sort by surprise (highest first)
        results.sort((a, b) => b.surpriseScore - a.surpriseScore);

        return results;
    }

    /**
     * Generate search queries based on entity tribe (SSOT-driven Strategy Pattern)
     * 
     * Uses TRIBE_PROFILE_STRATEGIES from entity-definitions.ts instead of hardcoded switch.
     */
    private generateQueries(name: string, context: string, type: string): string[] {
        // Get tribe from entity type (SSOT)
        const tribe = getTribeFromType(type);
        
        if (!tribe) {
            log(`[RippleAgent] Unknown entity type: ${type}, using default queries`);
            return [`${name} ${context}`, `${name} overview`];
        }
        
        // Get query templates from SSOT
        const strategy = TRIBE_PROFILE_STRATEGIES[tribe];
        
        if (!strategy.queryTemplates.length) {
            log(`[RippleAgent] Tribe ${tribe} has no query templates`);
            return [`${name} ${context}`, `${name} overview`];
        }
        
        // Render templates with name and context
        return strategy.queryTemplates.map(template =>
            template
                .replace('{name}', name)
                .replace('{context}', context)
        );
    }

    /**
     * Synthesize a profile from search results using AI
     */
    private async synthesizeProfile(
        name: string,
        type: string,
        rawData: string
    ): Promise<EntityProfile> {
        const entityType = type as EntityType;
        const openai = getOpenAI();
        if (!openai) {
            return {
                name,
                type: entityType,
                bio: rawData.substring(0, 200),
                role: undefined,
                tags: [],
                keyLinks: [],
                relatedEntities: [],
            };
        }

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a Profile Synthesizer. Create a structured profile from search results.

Target: ${name} (${type})

Output JSON:
{
  "name": "Full Name",
  "type": "${type}",
  "role": "Brief role/title",
  "bio": "2-3 sentence biography focusing on unique contributions",
  "tags": ["tag1", "tag2"],
  "keyLinks": [{"title": "Source", "url": "..."}],
  "relatedEntities": [{"name": "Related", "type": "person|project|topic", "reason": "why related"}]
}`
                    },
                    { role: 'user', content: rawData.substring(0, 3000) }
                ],
                response_format: { type: 'json_object' },
                max_tokens: 500,
                temperature: 0.3,
            });

            const result = JSON.parse(response.choices[0].message.content || '{}');
            return {
                name: result.name || name,
                type: (result.type || entityType) as EntityType,
                bio: result.bio,
                role: result.role,
                tags: result.tags || [],
                keyLinks: result.keyLinks || [],
                relatedEntities: result.relatedEntities || [],
                assets: result.assets,
            };
        } catch (e) {
            log('[RippleAgent] Profile synthesis failed:', e);
            return {
                name,
                type: entityType,
                bio: rawData.substring(0, 200),
                tags: [],
                keyLinks: [],
                relatedEntities: [],
            };
        }
    }
}

// Singleton instance
export const rippleAgent = new RippleAgent();







