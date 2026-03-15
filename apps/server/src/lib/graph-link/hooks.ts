/**
 * Entity Lifecycle Hooks
 * 
 * @ref graph-link/hooks
 * @since 2026-01-08
 * 
 * A lightweight Observer pattern for entity lifecycle events.
 * 
 * Design Philosophy:
 * - **Entity-Centric**: Hooks are triggered by entity state changes, not arbitrary events
 * - **Passive Sensing**: Subscribers "react" to changes, don't actively poll
 * - **Parallel Processing**: Multiple hooks can process the same event in parallel
 * - **Decoupled**: GraphWriter doesn't know about RippleSystem/ScoutSystem specifics
 * 
 * Hook Types:
 * - afterEntityCreate: Entity was created (new to graph)
 * - afterEntityUpdate: Entity was modified (already existed)
 * - afterRelationCreate: Relation was created between entities
 * 
 * Subscribers:
 * - RippleSystem: Semantic expansion (discover related entities)
 * - ScoutSystem: External information retrieval
 * - (Future) MCP Notifier: Broadcast to Magpie UI
 */

import { log } from '../logger.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Entity change context passed to hooks
 */
export interface EntityChangeContext {
  /** Entity ID (format: type:name) */
  entityId: string;
  
  /** Entity type (extracted from ID) */
  entityType: string;
  
  /** Entity title for display */
  entityTitle: string;
  
  /** Source memory ID if extracted from content */
  sourceMemoId?: number;
  
  /** Whether this is from user input or system discovery */
  trigger: 'user' | 'system' | 'scout' | 'ripple';
  
  /** Inherited gravity for propagation decay */
  inheritedGravity?: number;
  
  /** Current propagation depth (for decay) */
  depth?: number;
}

/**
 * Relation change context passed to hooks
 */
export interface RelationChangeContext {
  sourceId: string;
  targetId: string;
  relationType: string;
  weight?: number;
}

/**
 * Hook function signatures
 */
export type EntityHook = (ctx: EntityChangeContext) => void | Promise<void>;
export type RelationHook = (ctx: RelationChangeContext) => void | Promise<void>;

/**
 * Hook registry
 */
interface HookRegistry {
  afterEntityCreate: EntityHook[];
  afterEntityUpdate: EntityHook[];
  afterRelationCreate: RelationHook[];
}

// =============================================================================
// HOOK MANAGER (Singleton)
// =============================================================================

class EntityHookManager {
  private hooks: HookRegistry = {
    afterEntityCreate: [],
    afterEntityUpdate: [],
    afterRelationCreate: [],
  };

  private initialized = false;

  /**
   * Register a hook for entity creation
   */
  onEntityCreate(hook: EntityHook): void {
    this.hooks.afterEntityCreate.push(hook);
    log(`[EntityHooks] Registered afterEntityCreate hook (total: ${this.hooks.afterEntityCreate.length})`);
  }

  /**
   * Register a hook for entity update
   */
  onEntityUpdate(hook: EntityHook): void {
    this.hooks.afterEntityUpdate.push(hook);
    log(`[EntityHooks] Registered afterEntityUpdate hook (total: ${this.hooks.afterEntityUpdate.length})`);
  }

  /**
   * Register a hook for relation creation
   */
  onRelationCreate(hook: RelationHook): void {
    this.hooks.afterRelationCreate.push(hook);
    log(`[EntityHooks] Registered afterRelationCreate hook (total: ${this.hooks.afterRelationCreate.length})`);
  }

  /**
   * Trigger all afterEntityCreate hooks (parallel, non-blocking)
   * 
   * Error isolation: Each hook runs in its own try-catch, so one failing hook
   * won't prevent others from executing.
   */
  triggerEntityCreate(ctx: EntityChangeContext): void {
    if (this.hooks.afterEntityCreate.length === 0) return;
    
    log(`[EntityHooks] 🎣 Triggering afterEntityCreate for ${ctx.entityId} (${this.hooks.afterEntityCreate.length} hooks)`);
    
    // Fire and forget - parallel execution with error isolation
    Promise.all(
      this.hooks.afterEntityCreate.map(async hook => {
        try {
          await hook(ctx);
        } catch (err) {
          log(`[EntityHooks] Hook error:`, err);
        }
      })
    );
  }

  /**
   * Trigger all afterEntityUpdate hooks (parallel, non-blocking)
   */
  triggerEntityUpdate(ctx: EntityChangeContext): void {
    if (this.hooks.afterEntityUpdate.length === 0) return;
    
    log(`[EntityHooks] 🎣 Triggering afterEntityUpdate for ${ctx.entityId} (${this.hooks.afterEntityUpdate.length} hooks)`);
    
    // Fire and forget - parallel execution with error isolation
    Promise.all(
      this.hooks.afterEntityUpdate.map(async hook => {
        try {
          await hook(ctx);
        } catch (err) {
          log(`[EntityHooks] Hook error:`, err);
        }
      })
    );
  }

  /**
   * Trigger all afterRelationCreate hooks (parallel, non-blocking)
   */
  triggerRelationCreate(ctx: RelationChangeContext): void {
    if (this.hooks.afterRelationCreate.length === 0) return;
    
    log(`[EntityHooks] 🎣 Triggering afterRelationCreate ${ctx.sourceId} -> ${ctx.targetId}`);
    
    // Fire and forget - parallel execution with error isolation
    Promise.all(
      this.hooks.afterRelationCreate.map(async hook => {
        try {
          await hook(ctx);
        } catch (err) {
          log(`[EntityHooks] Hook error:`, err);
        }
      })
    );
  }

  /**
   * Get hook counts for debugging
   */
  getStats(): { entityCreate: number; entityUpdate: number; relationCreate: number } {
    return {
      entityCreate: this.hooks.afterEntityCreate.length,
      entityUpdate: this.hooks.afterEntityUpdate.length,
      relationCreate: this.hooks.afterRelationCreate.length,
    };
  }

  /**
   * Clear all hooks (for testing)
   */
  clear(): void {
    this.hooks = {
      afterEntityCreate: [],
      afterEntityUpdate: [],
      afterRelationCreate: [],
    };
  }
}

// Singleton instance
export const entityHooks = new EntityHookManager();

// =============================================================================
// DECAY UTILITIES
// =============================================================================

/**
 * Default decay factor for propagation
 */
export const PROPAGATION_DECAY = 0.7;

/**
 * Minimum gravity threshold to continue propagation
 */
export const MIN_GRAVITY_THRESHOLD = 0.3;

/**
 * Maximum propagation depth
 */
export const MAX_PROPAGATION_DEPTH = 3;

/**
 * Calculate next propagation context with decay
 */
export function withDecay(ctx: EntityChangeContext): EntityChangeContext {
  const currentGravity = ctx.inheritedGravity ?? 1.0;
  const currentDepth = ctx.depth ?? 0;
  
  return {
    ...ctx,
    inheritedGravity: currentGravity * PROPAGATION_DECAY,
    depth: currentDepth + 1,
    trigger: 'system', // Child propagations are system-triggered
  };
}

/**
 * Check if propagation should continue based on decay
 */
export function shouldContinuePropagation(ctx: EntityChangeContext): boolean {
  const gravity = ctx.inheritedGravity ?? 1.0;
  const depth = ctx.depth ?? 0;
  
  if (depth >= MAX_PROPAGATION_DEPTH) {
    log(`[EntityHooks] 🛑 Max depth (${MAX_PROPAGATION_DEPTH}) reached, stopping propagation`);
    return false;
  }
  
  if (gravity < MIN_GRAVITY_THRESHOLD) {
    log(`[EntityHooks] 🛑 Gravity (${gravity.toFixed(2)}) below threshold (${MIN_GRAVITY_THRESHOLD}), stopping propagation`);
    return false;
  }
  
  return true;
}
