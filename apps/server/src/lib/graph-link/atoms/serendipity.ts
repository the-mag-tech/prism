/**
 * Serendipity Atom
 * 
 * A Cognitive Atom that calculates and stores "surprise" scores for ingested content.
 * 
 * Serendipity is graph-aware: it measures how different new content is from
 * the existing knowledge graph, not just the content's intrinsic properties.
 * 
 * High surprise = valuable new insight
 * Low surprise = redundant or already known
 * 
 * This atom evaluates ALL ingested content (user drops, scout discoveries, ripple onboards)
 * to provide a unified quality signal for the graph.
 * 
 * @ref serendipity/atom
 * @since 2025-12-27 Fixed: Now evaluates Scout/Ripple content (was incorrectly skipped)
 */

import { GraphMiddleware } from '../types.js';
import { log } from '../../logger.js';
import { graphReader } from '../index.js';
import { getDB } from '../../../db.js';

// =============================================================================
// SERENDIPITY ATOM
// =============================================================================

/**
 * Create the SerendipityAtom middleware
 * 
 * This atom:
 * 1. Calculates surprise score for ALL ingested content
 * 2. Stores the score as an annotation on the memory
 * 3. Boosts heat for related entities if surprise is high
 * 
 * Note: No content is skipped - Serendipity only evaluates and records,
 * it does not trigger Ripple, so there's no loop risk.
 */
export function createSerendipityAtom(): GraphMiddleware {
    return async (ctx, next) => {
        // Run core operation first
        await next();

        // Only process ingest operations
        if (ctx.op !== 'ingest' || !ctx.result) return;

        const memoryId = ctx.result;
        const { title, content, sourceUrl } = ctx.payload;

        // Skip if content is too short
        if (!content || content.length < 100) return;

        // Determine source type for logging
        const sourceType = sourceUrl?.startsWith('http') ? 'scout/ripple' : 'user';
        log(`[SerendipityAtom] 🔮 Evaluating (${sourceType}): "${title?.substring(0, 50)}..."`);

        try {
            // Calculate surprise relative to graph
            const contentSummary = `${title}\n${content.substring(0, 500)}`;
            const surprise = await graphReader.calculateSurprise(contentSummary);

            log(`[SerendipityAtom] Score: ${surprise.score.toFixed(2)} - ${surprise.reason}`);

            // Store surprise annotation on memory
            const db = getDB();
            db.query(`
                INSERT INTO entity_metadata (entity_id, key, value, created_at)
                VALUES (?, 'surprise_score', ?, datetime('now'))
                ON CONFLICT(entity_id, key) DO UPDATE SET
                    value = excluded.value, created_at = excluded.created_at
            `).run(`memory:${memoryId}`, JSON.stringify({
                score: surprise.score,
                reason: surprise.reason,
                evaluatedAt: new Date().toISOString(),
            }));

            // If surprise is high, boost gravity of related entities
            if (surprise.score >= 0.7) {
                log(`[SerendipityAtom] ⚡ High surprise! Boosting related entity heat.`);
                
                // Find entities mentioned in this memory
                const relations = db.query(`
                    SELECT target FROM relations 
                    WHERE source = ? AND type IN ('contains', 'mentions')
                `).all(`memory:${memoryId}`) as Array<{ target: string }>;

                for (const { target } of relations) {
                    // Boost heat (which affects gravity calculation)
                    db.query(`
                        UPDATE entity_physics 
                        SET heat = MIN(1.0, heat + 0.1),
                            last_interaction = datetime('now')
                        WHERE entity_id = ?
                    `).run(target);
                }
            }

        } catch (e) {
            log('[SerendipityAtom] Failed:', e);
        }
    };
}







