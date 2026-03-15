/**
 * Scout System (LOD Scheduler)
 * 
 * Responsible for scheduling Scout missions based on Entity Gravity.
 * 
 * INPUT:  Physics State (Gravity)
 * OUTPUT: Enqueues ScoutTask → Worker triggers PatrolAgent → emits SCOUT_CONFIRMED → triggers Ripple
 * 
 * Architecture (refactor 2026-01-08):
 * - Entity Lifecycle Hooks: Triggered when new entities are created
 * - tick() finds candidates → enqueueScout() → SQLite Queue → ScoutWorker
 * - ScoutWorker handles: patrol() → quota consumption → (Ripple now via hooks)
 * 
 * LOD Intervals (Cost Optimized):
 * - LOD 0 (Gravity > 0.9): Check every 1 hour
 * - LOD 1 (Gravity > 0.7): Check every 12 hours
 * - LOD 2 (Gravity > 0.3): Check every 48 hours
 * 
 * @ref scout/system
 * @since 2025-12-27 Now emits SCOUT_CONFIRMED to trigger Ripple propagation
 * @since 2026-01-07 Refactored to use persistent Queue System
 * @since 2026-01-08 Added Entity Lifecycle Hooks subscription
 */

import { getDB } from '../db.js';
import { getQuotaStatus, canConsumeQuota } from '../lib/scout-quota.js';
import { isQueueInitialized, enqueueScout } from '../lib/queue/index.js';
import { ScoutAgent } from '../lib/agents/scout/agent.js';
import { log } from '../lib/logger.js';
import { entityHooks, type EntityChangeContext } from '../lib/graph-link/hooks.js';
import { isSearchAvailable } from '../lib/search-service.js';
import { SCOUTABLE_TYPES } from '@prism/contract';

export class ScoutSystem {
  private scoutAgent: ScoutAgent;
  private hooksRegistered = false;

  constructor() {
    this.scoutAgent = new ScoutAgent();
  }

  // =========================================================================
  // ENTITY LIFECYCLE HOOKS (Proactive scout for new entities)
  // =========================================================================

  /**
   * Register as a subscriber to Entity Lifecycle Hooks.
   * 
   * When a new scoutable entity is created (person, project, company, event),
   * automatically enqueue a scout task to gather external information.
   */
  registerHooks(): void {
    if (this.hooksRegistered) {
      log('[ScoutSystem] Hooks already registered, skipping');
      return;
    }

    entityHooks.onEntityCreate((ctx) => this.onEntityCreated(ctx));
    
    this.hooksRegistered = true;
    log('[ScoutSystem] 🎣 Registered Entity Lifecycle Hooks');
  }

  /**
   * Handle entity creation hook (proactive scout trigger)
   * 
   * Called by GraphWriter when a new entity is added to the graph.
   * If the entity is scoutable, immediately enqueue a scout task.
   */
  private async onEntityCreated(ctx: EntityChangeContext): Promise<void> {
    // Skip non-scoutable types (uses SCOUTABLE_TYPES from prism-contract SSOT)
    if (!(SCOUTABLE_TYPES as readonly string[]).includes(ctx.entityType)) {
      log(`[ScoutSystem] Skipping non-scoutable type: ${ctx.entityType}`);
      return;
    }

    if (!isSearchAvailable()) {
      log('[ScoutSystem] No search provider, skipping scout');
      return;
    }

    // Check quota
    if (!canConsumeQuota()) {
      log(`[ScoutSystem] Quota exhausted, skipping scout for ${ctx.entityId}`);
      return;
    }

    log(`[ScoutSystem] 🎣 Hook triggered: ENTITY_CREATED for ${ctx.entityId}`);

    // Enqueue scout task (parallel to Ripple)
    if (isQueueInitialized()) {
      try {
        await enqueueScout({
          entityId: ctx.entityId,
          entityTitle: ctx.entityTitle,
          gravity: ctx.inheritedGravity ?? 1.0,
          trigger: 'hook',
        });
        log(`[ScoutSystem] 📨 Enqueued scout for ${ctx.entityId}`);
      } catch (err) {
        log(`[ScoutSystem] Failed to enqueue scout:`, err);
      }
    } else {
      // Fallback: direct scout
      log(`[ScoutSystem] Queue not available, processing directly`);
      await this.processDirectly({
        id: ctx.entityId,
        title: ctx.entityTitle,
        gravity: ctx.inheritedGravity ?? 1.0,
      });
    }
  }

  /**
   * Run a scout scheduling tick.
   * This should be called periodically (e.g. every 5 minutes).
   * 
   * Finds candidates based on Gravity and LOD intervals,
   * then enqueues them to the persistent ScoutQueue for processing.
   */
  async tick() {
    const db = getDB();

    // Check quota before doing any work
    const quota = getQuotaStatus();
    if (quota.daily > 0 && quota.remaining <= 0) {
      log(`[ScoutSystem] Daily quota exhausted (${quota.used}/${quota.daily}). Skipping tick.`);
      return { enqueued: 0, skipped: 0, reason: 'quota_exhausted' };
    }

    log(`[ScoutSystem] Checking schedule... (quota: ${quota.daily === 0 ? '∞' : `${quota.remaining}/${quota.daily}`})`);

    // 1. Get Candidates needing scout
    // We join Physics State with Profiles
    // We filter by "Time Since Last Scout" > "LOD Interval"

    /*
      LOD Intervals (in Hours) - COST OPTIMIZED:
      G > 0.9 -> 1h (was 10 mins)
      G > 0.7 -> 12h (was 6h)
      G > 0.3 -> 48h (was 24h)
      
      Combined with 5-minute tick interval and 2 entities/tick limit,
      this reduces API costs by ~90% while maintaining reasonable freshness.
    */

    // We fetch candidates that satisfy the condition
    // Use render_frame_buffer.gravity_score if available, else fallback to entity_physics.gravity
    const candidates = db.query(`
      SELECT 
        p.id, p.title, p.last_scouted_at,
        COALESCE(ph.base_mass, 0.5) as mass, 
        COALESCE(ph.heat, 0) as temperature,
        COALESCE(r.gravity_score, ph.gravity, 0.5) as gravity
      FROM entity_profiles p
      LEFT JOIN entity_physics ph ON p.id = ph.entity_id
      LEFT JOIN render_frame_buffer r ON p.id = r.entity_id AND r.frame_id = 'global'
      LEFT JOIN entities e ON p.id = e.id
      WHERE 
        -- Exclude system/singleton entities
        p.id NOT LIKE 'system:%' AND p.id NOT LIKE 'singleton:%'
        -- Legacy: Exclude ghost entities if any exist (ghost blocks are now frontend-only)
        -- Keeping this check for backward compatibility with existing databases
        AND COALESCE(e.extraction_batch_id, '') != 'system_ghost'
        AND (
          -- LOD 0 Check (G > 0.9 → every 1 hour)
          (COALESCE(r.gravity_score, ph.gravity, 0.5) > 0.9 AND 
           (p.last_scouted_at IS NULL OR 
            (julianday('now') - julianday(p.last_scouted_at)) * 24 > 1))
          OR
          -- LOD 1 Check (G > 0.7 → every 12 hours)
          (COALESCE(r.gravity_score, ph.gravity, 0.5) > 0.7 AND 
           (p.last_scouted_at IS NULL OR 
            (julianday('now') - julianday(p.last_scouted_at)) * 24 > 12))
          OR
          -- LOD 2 Check (G > 0.3 → every 48 hours)
          (COALESCE(r.gravity_score, ph.gravity, 0.5) > 0.3 AND 
           (p.last_scouted_at IS NULL OR 
            (julianday('now') - julianday(p.last_scouted_at)) * 24 > 48))
        )
      ORDER BY COALESCE(r.gravity_score, ph.gravity, 0.5) DESC
      LIMIT 2 -- Reduced from 5 to 2 per tick for cost savings
    `).all() as Array<{
      id: string;
      title: string;
      last_scouted_at: string | null;
      mass: number;
      temperature: number;
      gravity: number;
    }>;

    if (candidates.length === 0) {
      log(`[ScoutSystem] No targets need scouting.`);
      return { enqueued: 0, skipped: 0, reason: 'no_candidates' };
    }

    log(`[ScoutSystem] Found ${candidates.length} candidates for scouting.`);

    // 2. Enqueue to persistent queue (or fallback to direct processing)
    let enqueued = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      // Limit enqueuing to remaining quota
      if (quota.daily > 0 && enqueued >= quota.remaining) {
        log(`[ScoutSystem] Quota limit reached, stopping enqueue.`);
        skipped += candidates.length - enqueued;
        break;
      }

      log(`[ScoutSystem] 📨 Enqueuing: ${candidate.title} (G=${candidate.gravity?.toFixed(2)})`);

      // Check if queue system is initialized
      if (isQueueInitialized()) {
        try {
          await enqueueScout({
            entityId: candidate.id,
            entityTitle: candidate.title,
            gravity: candidate.gravity,
            trigger: 'schedule',
          });
          enqueued++;
        } catch (err) {
          log(`[ScoutSystem] Failed to enqueue ${candidate.id}:`, err);
          skipped++;
        }
      } else {
        // Fallback: direct processing (for backward compatibility)
        log(`[ScoutSystem] Queue not initialized, processing directly`);
        await this.processDirectly(candidate);
        enqueued++;
      }
    }

    log(`[ScoutSystem] Tick complete: ${enqueued} enqueued, ${skipped} skipped`);
    return { enqueued, skipped, reason: 'ok' };
  }

  /**
   * Fallback: Process a candidate directly (when queue is not available)
   * 
   * This preserves the original behavior for backward compatibility.
   * Ideally, the queue should always be used.
   */
  private async processDirectly(candidate: {
    id: string;
    title: string;
    gravity: number;
  }): Promise<void> {
    const { consumeQuota, canConsumeQuota } = await import('../lib/scout-quota.js');
    const { rippleSystem } = await import('./RippleSystem.js');

    if (!canConsumeQuota()) {
      log(`[ScoutSystem] Quota exhausted, skipping direct processing`);
      return;
    }

    log(`[ScoutSystem] Direct Mission: ${candidate.title} (G=${candidate.gravity?.toFixed(2)})`);
    const result = await this.scoutAgent.patrol(candidate.id);

    if (result && result.confidence > 0.5) {
      consumeQuota();
      log(`[ScoutSystem] ✅ Scout confirmed for ${candidate.id}, triggering Ripple`);
      rippleSystem.emit({
        type: 'SCOUT_CONFIRMED',
        entityId: candidate.id,
        entityType: candidate.id.split(':')[0] as any,
        entityTitle: candidate.title,
        trigger: 'scout',
      });
    } else {
      log(`[ScoutSystem] ⚠️ Scout failed for ${candidate.id} (confidence=${result?.confidence ?? 0})`);
    }
  }

  /**
   * Manually trigger scout for an entity (bypasses queue, direct processing)
   */
  async triggerManual(entityId: string, entityTitle: string): Promise<{
    success: boolean;
    confidence?: number;
  }> {
    const result = await this.scoutAgent.patrol(entityId);
    
    if (result && result.confidence > 0.5) {
      const { consumeQuota } = await import('../lib/scout-quota.js');
      const { rippleSystem } = await import('./RippleSystem.js');
      
      consumeQuota();
      rippleSystem.emit({
        type: 'SCOUT_CONFIRMED',
        entityId,
        entityType: entityId.split(':')[0] as any,
        entityTitle,
        trigger: 'scout',
      });
      
      return { success: true, confidence: result.confidence };
    }
    
    return { success: false, confidence: result?.confidence ?? 0 };
  }
}
