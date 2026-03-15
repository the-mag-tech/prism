
import type { GraphMiddleware } from '../types.js';
import { log, logError, logWarn } from '../../logger.js';
import type { GraphWriter } from '../writer.js';
import { emotionalStrategy } from '../../agents/explorer/strategies/emotional.js';
import { ExplorationIntent } from '../../agents/explorer/types.js';

export function createEmotionalAtom(writer: GraphWriter): GraphMiddleware {
    return async (ctx, next) => {
        await next();

        if (ctx.op === 'ingest' && ctx.result) {
            const sourceId = ctx.result;
            const { title, content, sourceUrl } = ctx.payload;
            
            // Determine entity prefix based on source URL
            const isScoutDiscovery = sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://');
            const entityPrefix = isScoutDiscovery ? 'finding' : 'memory';

            if (!content || content.length < 50) return;

            log(`[EmotionalAtom] ❤️ Analyzing finding for emotion: "${title}"`);

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

                const score = await emotionalStrategy.evaluate([finding], pseudoIntent);

                if (score.level >= 2) {
                    log(`[EmotionalAtom] 🎭 Emotion detected! Level ${score.level} (${score.total.toFixed(1)})`);

                    await writer.addAnnotation({
                        entityId: `${entityPrefix}:${sourceId}`,
                        key: 'emotional',
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
                log('[EmotionalAtom] Failed to analyze:', e);
            }
        }
    };
}
