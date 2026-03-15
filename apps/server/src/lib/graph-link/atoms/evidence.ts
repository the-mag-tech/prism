
import type { GraphMiddleware } from '../types.js';
import { log, logError, logWarn } from '../../logger.js';
import type { GraphWriter } from '../writer.js';
import { evidenceStrategy } from '../../agents/explorer/strategies/evidence.js';
import { ExplorationIntent } from '../../agents/explorer/types.js';

export function createEvidenceAtom(writer: GraphWriter): GraphMiddleware {
    return async (ctx, next) => {
        // 1. Let the operation complete first (Post-processing)
        await next();

        // 2. Only analyze on 'ingest' success
        if (ctx.op === 'ingest' && ctx.result) {
            const memoryId = ctx.result;
            const { title, content, sourceUrl } = ctx.payload;

            // Skip if content is too short
            if (!content || content.length < 50) return;

            log(`[EvidenceAtom] 🔍 Analyzing finding for evidence: "${title}"`);

            try {
                const pseudoIntent: ExplorationIntent = {
                    coreObject: title,
                    context: content.substring(0, 500),
                    originalQuery: title,
                    searchQueries: [],
                    desiredDepth: 'general',
                };

                const finding = {
                    title,
                    url: sourceUrl,
                    content: content.substring(0, 2000),
                    source: 'search' as const,
                };

                const score = await evidenceStrategy.evaluate([finding], pseudoIntent);

                // Use Level 2 as threshold (Expert Analysis / Some data)
                if (score.level >= 2) {
                    log(`[EvidenceAtom] 📊 Evidence detected! Level ${score.level} (${score.total.toFixed(1)})`);

                    await writer.addAnnotation({
                        entityId: `memory:${memoryId}`,
                        key: 'evidence',
                        value: {
                            score: score.total,
                            level: score.level,
                            reason: score.reason,
                            dimensions: score.dimensions
                        },
                        createdAt: new Date().toISOString()
                    });
                }
            } catch (e) {
                log('[EvidenceAtom] Failed to analyze:', e);
            }
        }
    };
}
