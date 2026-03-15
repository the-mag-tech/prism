
import type { GraphMiddleware } from '../types.js';
import { log, logError, logWarn } from '../../logger.js';
import type { GraphWriter } from '../writer.js';
import { ironyStrategy } from '../../agents/explorer/strategies/irony.js';
import { ExplorationIntent } from '../../agents/explorer/types.js';

export function createIronyAtom(writer: GraphWriter): GraphMiddleware {
    return async (ctx, next) => {
        // 1. Let the operation complete first (Post-processing)
        await next();

        // 2. Only analyze on 'ingest' success
        if (ctx.op === 'ingest' && ctx.result) {
            const sourceId = ctx.result;
            const { title, content, sourceUrl } = ctx.payload;
            
            // Determine entity prefix based on source URL
            const isScoutDiscovery = sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://');
            const entityPrefix = isScoutDiscovery ? 'finding' : 'memory';

            // Skip if content is too short
            if (!content || content.length < 50) return;

            log(`[IronyAtom] 🧠 Analyzing finding for irony: "${title}"`);

            try {
                // Construct a pseudo-intent for the strategy
                const pseudoIntent: ExplorationIntent = {
                    coreObject: title,
                    context: content.substring(0, 500), // First 500 chars as context
                    originalQuery: title,
                    searchQueries: [],
                    desiredDepth: 'general',
                };

                const finding = {
                    title,
                    url: sourceUrl,
                    content: content.substring(0, 2000), // Analyze up to 2k chars
                    source: 'search' as const,
                };

                const score = await ironyStrategy.evaluate([finding], pseudoIntent);

                if (score.level >= 2) {
                    // Structural Irony or higher
                    log(`[IronyAtom] 🤡 Irony detected! Level ${score.level} (${score.total.toFixed(1)})`);
                    log(`[IronyAtom]    Reason: ${score.reason}`);

                    // Annotate the entity (finding: for scout, memory: for user content)
                    await writer.addAnnotation({
                        entityId: `${entityPrefix}:${sourceId}`,
                        key: 'irony',
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
                log('[IronyAtom] Failed to analyze:', e);
            }
        }
    };
}
