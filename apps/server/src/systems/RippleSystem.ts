/**
 * Ripple System
 * 
 * Orchestration layer for the Ripple Agent:
 * - Entity Lifecycle Hooks: Triggered by GraphWriter when entities are created/updated
 * - Passive tick: Periodically ripples high-gravity entities that haven't been rippled
 * - Legacy emit(): Still available for manual triggering or external events
 * 
 * Architecture (refactor 2026-01-08):
 * - GraphWriter.addEntityFromSource() → entityHooks.triggerEntityCreate() → RippleSystem.onEntityCreated()
 * - tick() → SQL Query → propagate() (passive scan)
 * - emit() → enqueueRipple() → Queue Worker (legacy/fallback)
 * 
 * @ref systems/RippleSystem
 * @since 2025-12-27 Added passive tick for gravity-based ripple scheduling
 * @since 2025-12-28 Migrated to src/systems/ for consistency
 * @since 2026-01-07 Refactored to use persistent Queue System (removed in-memory queue)
 * @since 2026-01-08 Switched to Entity Lifecycle Hooks (passive sensing)
 */

import { RippleAgent } from '../lib/agents/ripple/agent.js';
import { log, logWarn } from '../lib/logger.js';
import { isSearchAvailable } from '../lib/search-service.js';
import { canConsumeQuota, consumeQuota, getQuotaStatus } from '../lib/scout-quota.js';
import { getDB } from '../db.js';
import { isQueueInitialized, enqueueRipple } from '../lib/queue/index.js';
import { isRippleEnabled } from '../feature-flags.js';
import { entityHooks, EntityChangeContext, shouldContinuePropagation, withDecay } from '../lib/graph-link/hooks.js';
import type { RippleEvent, RippleResult, RippleConfig } from '../lib/agents/ripple/types.js';
import type { RippleTask } from '../lib/queue/types.js';
import { SCOUTABLE_TYPES } from '@prism/contract';

// =============================================================================
// RIPPLE SYSTEM
// =============================================================================

export class RippleSystem {
    private agent: RippleAgent;
    private hooksRegistered = false;

    constructor(config: Partial<RippleConfig> = {}) {
        this.agent = new RippleAgent(config);
    }

    // =========================================================================
    // ENTITY LIFECYCLE HOOKS (Primary trigger mechanism since 2026-01-08)
    // =========================================================================

    /**
     * Register as a subscriber to Entity Lifecycle Hooks.
     * 
     * Call this during server initialization to enable passive sensing.
     * Hooks will trigger propagation when entities are created/updated.
     */
    registerHooks(): void {
        if (this.hooksRegistered) {
            log('[RippleSystem] Hooks already registered, skipping');
            return;
        }

        entityHooks.onEntityCreate((ctx) => this.onEntityCreated(ctx));
        entityHooks.onEntityUpdate((ctx) => this.onEntityUpdated(ctx));
        
        this.hooksRegistered = true;
        log('[RippleSystem] 🎣 Registered Entity Lifecycle Hooks');
    }

    /**
     * Handle entity creation hook (primary trigger for ripple)
     * 
     * Called by GraphWriter when a new entity is added to the graph.
     * This replaces the event-driven emit() for most use cases.
     */
    private async onEntityCreated(ctx: EntityChangeContext): Promise<void> {
        if (!isRippleEnabled()) {
            log(`[RippleSystem] Disabled, skipping hook for ${ctx.entityId}`);
            return;
        }

        // Skip non-scoutable types (uses SCOUTABLE_TYPES from prism-contract SSOT)
        if (!(SCOUTABLE_TYPES as readonly string[]).includes(ctx.entityType)) {
            log(`[RippleSystem] Skipping non-scoutable type: ${ctx.entityType}`);
            return;
        }

        if (!isSearchAvailable()) {
            log('[RippleSystem] No search provider, skipping ripple');
            return;
        }

        // Check quota
        const quota = getQuotaStatus();
        if (quota.daily > 0 && quota.remaining <= 0) {
            log(`[RippleSystem] Quota exhausted, skipping ripple for ${ctx.entityId}`);
            return;
        }

        log(`[RippleSystem] 🎣 Hook triggered: ENTITY_CREATED for ${ctx.entityId} (depth=${ctx.depth ?? 0}, gravity=${(ctx.inheritedGravity ?? 1.0).toFixed(2)})`);

        try {
            const result = await this.agent.propagate(ctx.entityId);
            
            if (result.profileGenerated) {
                consumeQuota();
                
                // Update last_rippled_at
                const db = getDB();
                db.query(`
                    UPDATE entity_profiles 
                    SET last_rippled_at = datetime('now')
                    WHERE id = ?
                `).run(ctx.entityId);

                log(`[RippleSystem] ✅ Rippled ${ctx.entityId}: profile=${result.profileGenerated}, content=${result.contentIngested}`);
            }
        } catch (error) {
            log(`[RippleSystem] Error in hook handler for ${ctx.entityId}:`, error);
        }
    }

    /**
     * Handle entity update hook (secondary trigger)
     * 
     * Called when an existing entity is modified. May trigger re-ripple
     * for significant updates (e.g., title change, new relations).
     */
    private async onEntityUpdated(ctx: EntityChangeContext): Promise<void> {
        // For now, updates don't trigger automatic ripple
        // This could be enabled for specific scenarios (e.g., major profile changes)
        log(`[RippleSystem] Entity updated: ${ctx.entityId} (no ripple triggered)`);
    }

    /**
     * Emit a ripple event (queued via persistent Queue System)
     * 
     * Events are persisted to SQLite and processed asynchronously by the RippleWorker.
     * This ensures crash resilience - no events are lost on restart.
     */
    emit(event: Omit<RippleEvent, 'timestamp'>): void {
        if (!isRippleEnabled()) {
            log('[RippleSystem] Disabled by feature flag, ignoring event:', event.entityId);
            return;
        }

        if (!isSearchAvailable()) {
            log('[RippleSystem] No search provider available, skipping ripple');
            return;
        }

        // Check quota before queueing
        const quota = getQuotaStatus();
        if (quota.daily > 0 && quota.remaining <= 0) {
            log(`[RippleSystem] Daily quota exhausted (${quota.used}/${quota.daily}), skipping ripple`);
            return;
        }

        // Check if queue system is initialized
        if (!isQueueInitialized()) {
            log('[RippleSystem] Queue not initialized, processing directly');
            // Fallback: process directly if queue not available
            this.handleEventDirect({
                eventType: event.type as RippleTask['eventType'],
                entityId: event.entityId,
                entityType: event.entityType,
                entityTitle: event.entityTitle || event.entityId,
                trigger: (event.trigger as RippleTask['trigger']) || 'system',
            }).catch(err => log('[RippleSystem] Direct processing error:', err));
            return;
        }

        // Enqueue to persistent queue
        const task: RippleTask = {
            eventType: event.type as RippleTask['eventType'],
            entityId: event.entityId,
            entityType: event.entityType,
            entityTitle: event.entityTitle || event.entityId,
            trigger: (event.trigger as RippleTask['trigger']) || 'system',
        };

        enqueueRipple(task)
            .then(jobId => {
                log(`[RippleSystem] 📨 Event queued: ${event.type} for ${event.entityId} (job: ${jobId}, quota: ${quota.daily === 0 ? '∞' : `${quota.remaining}/${quota.daily}`})`);
            })
            .catch(err => {
                log(`[RippleSystem] Failed to enqueue ripple:`, err);
                // Fallback: try direct processing
                this.handleEventDirect(task).catch(e => log('[RippleSystem] Fallback error:', e));
            });
    }

    /**
     * Handle a ripple event directly (called by Worker or as fallback)
     * 
     * This is the actual processing logic, separated from queueing.
     */
    async handleEventDirect(task: RippleTask): Promise<RippleResult | null> {
        const { eventType, entityId } = task;
        
        log(`[RippleSystem] 🔄 Processing: ${eventType} for ${entityId}`);

        switch (eventType) {
            case 'SCOUT_CONFIRMED':
            case 'ENTITY_CREATED':
            case 'RELATION_ADDED':
            case 'MEMORY_INGESTED':
                // These events trigger full ripple propagation
                const result = await this.agent.propagate(entityId);
                
                // Consume quota only if we actually did work
                if (result && result.profileGenerated) {
                    consumeQuota();
                    
                    // Update last_rippled_at
                    const db = getDB();
                    db.query(`
                        UPDATE entity_profiles 
                        SET last_rippled_at = datetime('now')
                        WHERE id = ?
                    `).run(entityId);
                }
                
                return result;

            default:
                logWarn(`[RippleSystem] Unknown event type: ${eventType}`);
                return null;
        }
    }

    /**
     * Manually trigger ripple for an entity (bypasses queue, direct processing)
     */
    async triggerManual(entityId: string): Promise<RippleResult> {
        return this.agent.propagate(entityId);
    }

    /**
     * Check if ripple system is enabled (delegates to feature flag)
     */
    isEnabled(): boolean {
        return isRippleEnabled();
    }

    // =========================================================================
    // PASSIVE TICK (Gravity-based scheduling)
    // =========================================================================

    /**
     * Passive tick: Find high-gravity entities that need ripple propagation.
     * 
     * This complements the event-driven approach by catching:
     * - Entities that were created before Ripple was enabled
     * - Entities whose gravity increased but weren't re-rippled
     * - Entities that were never rippled due to quota limits
     * 
     * Called periodically by server.ts (e.g., every 10 minutes)
     */
    async tick(): Promise<{ processed: number; skipped: number }> {
        if (!isRippleEnabled()) {
            log('[RippleSystem] Disabled by feature flag, skipping tick');
            return { processed: 0, skipped: 0 };
        }

        if (!isSearchAvailable()) {
            log('[RippleSystem] No search provider, skipping tick');
            return { processed: 0, skipped: 0 };
        }

        const quota = getQuotaStatus();
        if (quota.daily > 0 && quota.remaining <= 0) {
            log(`[RippleSystem] Quota exhausted (${quota.used}/${quota.daily}), skipping tick`);
            return { processed: 0, skipped: 0 };
        }

        log(`[RippleSystem] 🌊 Passive tick (quota: ${quota.daily === 0 ? '∞' : `${quota.remaining}/${quota.daily}`})`);

        const db = getDB();

        // Find candidates: high gravity + never rippled OR rippled long ago
        // Uses similar LOD logic to ScoutSystem
        const candidates = db.query(`
            SELECT 
                p.id, 
                p.title,
                p.last_rippled_at,
                COALESCE(r.gravity_score, ph.gravity, 0.5) as gravity
            FROM entity_profiles p
            LEFT JOIN entity_physics ph ON p.id = ph.entity_id
            LEFT JOIN render_frame_buffer r ON p.id = r.entity_id AND r.frame_id = 'global'
            WHERE 
                -- Exclude system entities
                p.id NOT LIKE 'system:%' 
                AND p.id NOT LIKE 'singleton:%'
                AND p.id NOT LIKE 'memory:%'
                AND p.id NOT LIKE 'finding:%'
                -- High gravity entities that need ripple
                AND COALESCE(r.gravity_score, ph.gravity, 0.5) > 0.5
                AND (
                    -- Never rippled
                    p.last_rippled_at IS NULL
                    -- Or rippled more than 7 days ago for high-gravity entities
                    OR (COALESCE(r.gravity_score, ph.gravity, 0.5) > 0.7 
                        AND julianday('now') - julianday(p.last_rippled_at) > 7)
                )
            ORDER BY COALESCE(r.gravity_score, ph.gravity, 0.5) DESC
            LIMIT 2  -- Max 2 per tick to control costs
        `).all() as Array<{ id: string; title: string; gravity: number }>;

        if (candidates.length === 0) {
            log('[RippleSystem] No entities need rippling');
            return { processed: 0, skipped: 0 };
        }

        log(`[RippleSystem] Found ${candidates.length} candidates for ripple`);

        let processed = 0;
        let skipped = 0;

        for (const candidate of candidates) {
            if (!canConsumeQuota()) {
                log('[RippleSystem] Quota exhausted mid-tick, stopping');
                skipped += candidates.length - processed;
                break;
            }

            log(`[RippleSystem] 🔄 Rippling: ${candidate.title} (G=${candidate.gravity.toFixed(2)})`);

            try {
                const result = await this.agent.propagate(candidate.id);
                
                if (result.profileGenerated) {
                    consumeQuota();
                    processed++;

                    // Update last_rippled_at
                    db.query(`
                        UPDATE entity_profiles 
                        SET last_rippled_at = datetime('now')
                        WHERE id = ?
                    `).run(candidate.id);
                }
            } catch (error) {
                log(`[RippleSystem] Error rippling ${candidate.id}:`, error);
                skipped++;
            }
        }

        log(`[RippleSystem] Tick complete: ${processed} processed, ${skipped} skipped`);
        return { processed, skipped };
    }
}

// Singleton instance
export const rippleSystem = new RippleSystem();
