/**
 * Entity Lifecycle Hooks Tests
 * 
 * Tests for the entity lifecycle hook system that enables passive sensing.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { 
  entityHooks, 
  EntityChangeContext, 
  shouldContinuePropagation, 
  withDecay,
  PROPAGATION_DECAY,
  MIN_GRAVITY_THRESHOLD,
  MAX_PROPAGATION_DEPTH,
} from '../../src/lib/graph-link/hooks.js';

describe('Entity Lifecycle Hooks', () => {
  beforeEach(() => {
    // Clear hooks before each test
    entityHooks.clear();
  });

  describe('Hook Registration', () => {
    it('should register afterEntityCreate hooks', () => {
      const hook = mock(() => {});
      entityHooks.onEntityCreate(hook);
      
      const stats = entityHooks.getStats();
      expect(stats.entityCreate).toBe(1);
    });

    it('should register afterEntityUpdate hooks', () => {
      const hook = mock(() => {});
      entityHooks.onEntityUpdate(hook);
      
      const stats = entityHooks.getStats();
      expect(stats.entityUpdate).toBe(1);
    });

    it('should register afterRelationCreate hooks', () => {
      const hook = mock(() => {});
      entityHooks.onRelationCreate(hook);
      
      const stats = entityHooks.getStats();
      expect(stats.relationCreate).toBe(1);
    });

    it('should register multiple hooks of the same type', () => {
      entityHooks.onEntityCreate(mock(() => {}));
      entityHooks.onEntityCreate(mock(() => {}));
      entityHooks.onEntityCreate(mock(() => {}));
      
      const stats = entityHooks.getStats();
      expect(stats.entityCreate).toBe(3);
    });
  });

  describe('Hook Triggering', () => {
    it('should trigger afterEntityCreate hooks', async () => {
      const triggered: EntityChangeContext[] = [];
      entityHooks.onEntityCreate((ctx) => {
        triggered.push(ctx);
      });

      const ctx: EntityChangeContext = {
        entityId: 'person:test_user',
        entityType: 'person',
        entityTitle: 'Test User',
        trigger: 'user',
      };

      entityHooks.triggerEntityCreate(ctx);
      
      // Give async hooks time to execute
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(triggered.length).toBe(1);
      expect(triggered[0].entityId).toBe('person:test_user');
    });

    it('should trigger multiple hooks in parallel', async () => {
      const order: number[] = [];
      
      entityHooks.onEntityCreate(async () => {
        await new Promise(r => setTimeout(r, 20));
        order.push(1);
      });
      
      entityHooks.onEntityCreate(async () => {
        await new Promise(r => setTimeout(r, 10));
        order.push(2);
      });
      
      entityHooks.onEntityCreate(async () => {
        order.push(3);
      });

      const ctx: EntityChangeContext = {
        entityId: 'project:test',
        entityType: 'project',
        entityTitle: 'Test Project',
        trigger: 'system',
      };

      entityHooks.triggerEntityCreate(ctx);
      
      // Wait for all hooks to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // All three should have executed
      expect(order.length).toBe(3);
      // Order should be 3, 2, 1 due to different delays
      expect(order).toEqual([3, 2, 1]);
    });

    it('should not throw when no hooks are registered', () => {
      const ctx: EntityChangeContext = {
        entityId: 'topic:test',
        entityType: 'topic',
        entityTitle: 'Test Topic',
        trigger: 'system',
      };

      expect(() => entityHooks.triggerEntityCreate(ctx)).not.toThrow();
    });
  });

  describe('Propagation Decay', () => {
    it('should apply decay with withDecay()', () => {
      const ctx: EntityChangeContext = {
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test',
        trigger: 'user',
        inheritedGravity: 1.0,
        depth: 0,
      };

      const decayed = withDecay(ctx);
      
      expect(decayed.inheritedGravity).toBe(PROPAGATION_DECAY);
      expect(decayed.depth).toBe(1);
      expect(decayed.trigger).toBe('system'); // Changes to system
    });

    it('should compound decay on multiple applications', () => {
      let ctx: EntityChangeContext = {
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test',
        trigger: 'user',
        inheritedGravity: 1.0,
        depth: 0,
      };

      ctx = withDecay(ctx);
      ctx = withDecay(ctx);
      ctx = withDecay(ctx);

      expect(ctx.depth).toBe(3);
      expect(ctx.inheritedGravity).toBeCloseTo(PROPAGATION_DECAY ** 3, 5);
    });
  });

  describe('Propagation Control', () => {
    it('should allow propagation when gravity is high and depth is low', () => {
      const ctx: EntityChangeContext = {
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test',
        trigger: 'user',
        inheritedGravity: 0.9,
        depth: 0,
      };

      expect(shouldContinuePropagation(ctx)).toBe(true);
    });

    it('should stop propagation when gravity falls below threshold', () => {
      const ctx: EntityChangeContext = {
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test',
        trigger: 'system',
        inheritedGravity: MIN_GRAVITY_THRESHOLD - 0.01,
        depth: 1,
      };

      expect(shouldContinuePropagation(ctx)).toBe(false);
    });

    it('should stop propagation when depth exceeds max', () => {
      const ctx: EntityChangeContext = {
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test',
        trigger: 'system',
        inheritedGravity: 0.9,
        depth: MAX_PROPAGATION_DEPTH,
      };

      expect(shouldContinuePropagation(ctx)).toBe(false);
    });

    it('should use defaults when gravity/depth not specified', () => {
      const ctx: EntityChangeContext = {
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test',
        trigger: 'user',
      };

      // Defaults: gravity=1.0, depth=0 → should propagate
      expect(shouldContinuePropagation(ctx)).toBe(true);
    });
  });

  describe('Clear Function', () => {
    it('should clear all registered hooks', () => {
      entityHooks.onEntityCreate(mock(() => {}));
      entityHooks.onEntityUpdate(mock(() => {}));
      entityHooks.onRelationCreate(mock(() => {}));
      
      entityHooks.clear();
      
      const stats = entityHooks.getStats();
      expect(stats.entityCreate).toBe(0);
      expect(stats.entityUpdate).toBe(0);
      expect(stats.relationCreate).toBe(0);
    });
  });
});
