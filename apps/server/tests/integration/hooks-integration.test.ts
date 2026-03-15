/**
 * Entity Lifecycle Hooks Integration Tests
 * 
 * Tests the integration between:
 * - GraphWriter entity creation
 * - Entity Lifecycle Hooks
 * - RippleSystem hook subscription
 * - ScoutSystem hook subscription
 * 
 * @since 2026-01-08
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { 
  entityHooks, 
  type EntityChangeContext,
  PROPAGATION_DECAY,
  shouldContinuePropagation,
} from '../../src/lib/graph-link/hooks.js';

describe('Entity Lifecycle Hooks Integration', () => {
  // Track hook invocations
  let rippleInvocations: EntityChangeContext[] = [];
  let scoutInvocations: EntityChangeContext[] = [];

  beforeEach(() => {
    // Clear hooks and tracking
    entityHooks.clear();
    rippleInvocations = [];
    scoutInvocations = [];
  });

  describe('Hook Registration', () => {
    it('should allow multiple systems to register hooks', () => {
      // Simulate RippleSystem registration
      entityHooks.onEntityCreate((ctx) => {
        rippleInvocations.push(ctx);
      });

      // Simulate ScoutSystem registration
      entityHooks.onEntityCreate((ctx) => {
        scoutInvocations.push(ctx);
      });

      const stats = entityHooks.getStats();
      expect(stats.entityCreate).toBe(2);
    });
  });

  describe('Parallel Hook Execution', () => {
    it('should trigger both RippleSystem and ScoutSystem hooks in parallel', async () => {
      // Register mock hooks
      entityHooks.onEntityCreate(async (ctx) => {
        await new Promise(r => setTimeout(r, 10));
        rippleInvocations.push({ ...ctx, trigger: 'ripple' as any });
      });

      entityHooks.onEntityCreate(async (ctx) => {
        await new Promise(r => setTimeout(r, 5));
        scoutInvocations.push({ ...ctx, trigger: 'scout' as any });
      });

      // Trigger entity creation
      const ctx: EntityChangeContext = {
        entityId: 'person:test_user',
        entityType: 'person',
        entityTitle: 'Test User',
        trigger: 'user',
        inheritedGravity: 1.0,
        depth: 0,
      };

      entityHooks.triggerEntityCreate(ctx);

      // Wait for parallel execution
      await new Promise(r => setTimeout(r, 50));

      // Both should be invoked
      expect(rippleInvocations.length).toBe(1);
      expect(scoutInvocations.length).toBe(1);
      
      // Verify context passed correctly
      expect(rippleInvocations[0].entityId).toBe('person:test_user');
      expect(scoutInvocations[0].entityId).toBe('person:test_user');
    });
  });

  describe('Scoutable Type Filtering', () => {
    it('should only trigger for scoutable entity types', async () => {
      const scoutableTypes = ['person', 'project', 'company', 'event', 'topic'];
      const nonScoutableTypes = ['memory', 'finding', 'concept', 'decision'];

      // Register scout-like hook that filters by type
      entityHooks.onEntityCreate((ctx) => {
        if (scoutableTypes.includes(ctx.entityType)) {
          scoutInvocations.push(ctx);
        }
      });

      // Test scoutable types
      for (const type of scoutableTypes) {
        entityHooks.triggerEntityCreate({
          entityId: `${type}:test`,
          entityType: type,
          entityTitle: 'Test',
          trigger: 'system',
        });
      }

      // Test non-scoutable types
      for (const type of nonScoutableTypes) {
        entityHooks.triggerEntityCreate({
          entityId: `${type}:test`,
          entityType: type,
          entityTitle: 'Test',
          trigger: 'system',
        });
      }

      await new Promise(r => setTimeout(r, 20));

      // Only scoutable types should be invoked
      expect(scoutInvocations.length).toBe(scoutableTypes.length);
    });
  });

  describe('Propagation Decay Control', () => {
    it('should respect decay threshold in propagation', () => {
      // Depth 0, high gravity - should continue
      expect(shouldContinuePropagation({
        entityId: 'test:1',
        entityType: 'test',
        entityTitle: 'Test',
        trigger: 'user',
        inheritedGravity: 1.0,
        depth: 0,
      })).toBe(true);

      // Depth 3 (max) - should stop
      expect(shouldContinuePropagation({
        entityId: 'test:2',
        entityType: 'test',
        entityTitle: 'Test',
        trigger: 'system',
        inheritedGravity: 0.5,
        depth: 3,
      })).toBe(false);

      // Low gravity (below 0.3) - should stop
      expect(shouldContinuePropagation({
        entityId: 'test:3',
        entityType: 'test',
        entityTitle: 'Test',
        trigger: 'system',
        inheritedGravity: 0.2,
        depth: 1,
      })).toBe(false);
    });

    it('should apply correct decay factor', () => {
      let contextAtDepth1: EntityChangeContext | null = null;
      let contextAtDepth2: EntityChangeContext | null = null;

      // Simulate chained propagation
      entityHooks.onEntityCreate((ctx) => {
        if (ctx.depth === 0) {
          // First level - propagate with decay
          const { withDecay } = require('../../src/lib/graph-link/hooks.js');
          const nextCtx = withDecay(ctx);
          contextAtDepth1 = nextCtx;
          
          // Simulate second level
          const nextNextCtx = withDecay(nextCtx);
          contextAtDepth2 = nextNextCtx;
        }
      });

      entityHooks.triggerEntityCreate({
        entityId: 'person:root',
        entityType: 'person',
        entityTitle: 'Root',
        trigger: 'user',
        inheritedGravity: 1.0,
        depth: 0,
      });

      // Give time for async execution
      expect(contextAtDepth1).not.toBeNull();
      expect(contextAtDepth1!.depth).toBe(1);
      expect(contextAtDepth1!.inheritedGravity).toBeCloseTo(PROPAGATION_DECAY, 5);

      expect(contextAtDepth2).not.toBeNull();
      expect(contextAtDepth2!.depth).toBe(2);
      expect(contextAtDepth2!.inheritedGravity).toBeCloseTo(PROPAGATION_DECAY * PROPAGATION_DECAY, 5);
    });
  });

  describe('Error Isolation', () => {
    it('should not let one hook failure affect others', async () => {
      let hook1Called = false;
      let hook2Called = false;
      let hook3Called = false;

      entityHooks.onEntityCreate(() => {
        hook1Called = true;
      });

      entityHooks.onEntityCreate(() => {
        hook2Called = true;
        throw new Error('Hook 2 failed!');
      });

      entityHooks.onEntityCreate(() => {
        hook3Called = true;
      });

      // Trigger should not throw
      entityHooks.triggerEntityCreate({
        entityId: 'test:error',
        entityType: 'test',
        entityTitle: 'Test',
        trigger: 'system',
      });

      await new Promise(r => setTimeout(r, 20));

      // All hooks should be called despite error in hook 2
      expect(hook1Called).toBe(true);
      expect(hook2Called).toBe(true);
      expect(hook3Called).toBe(true);
    });
  });

  describe('Update vs Create Distinction', () => {
    it('should trigger different hooks for create vs update', async () => {
      let createCount = 0;
      let updateCount = 0;

      entityHooks.onEntityCreate(() => {
        createCount++;
      });

      entityHooks.onEntityUpdate(() => {
        updateCount++;
      });

      const ctx: EntityChangeContext = {
        entityId: 'person:test',
        entityType: 'person',
        entityTitle: 'Test',
        trigger: 'system',
      };

      entityHooks.triggerEntityCreate(ctx);
      entityHooks.triggerEntityUpdate(ctx);
      entityHooks.triggerEntityCreate(ctx);

      await new Promise(r => setTimeout(r, 20));

      expect(createCount).toBe(2);
      expect(updateCount).toBe(1);
    });
  });
});
