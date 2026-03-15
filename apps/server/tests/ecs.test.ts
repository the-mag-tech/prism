import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { initDB, getDB } from '../src/db.js';
import { PhysicsSystem } from '../src/systems/PhysicsSystem.js';
// RenderSystem was removed - tests below are skipped
// import { RenderSystem } from '../src/systems/RenderSystem.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'test-ecs.db');

describe('ECS Architecture', () => {
  beforeAll(() => {
    // Clean up previous test runs
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    initDB(TEST_DB_PATH);
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('ECS Tables', () => {
    it('should have entity_profiles table', () => {
      const db = getDB();
      const result = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='entity_profiles'"
      ).get();
      expect(result).toBeTruthy();
    });

    // Table was renamed from entity_physics_state to entity_physics in v34
    it('should have entity_physics table', () => {
      const db = getDB();
      const result = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='entity_physics'"
      ).get();
      expect(result).toBeTruthy();
    });

    it('should have render_frame_buffer table', () => {
      const db = getDB();
      const result = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='render_frame_buffer'"
      ).get();
      expect(result).toBeTruthy();
    });
  });

  describe('PhysicsSystem', () => {
    beforeAll(() => {
      // Seed test data
      const db = getDB();
      
      // Insert test entities into entity_profiles
      const profiles = [
        { id: 'test:anchor', title: 'Anchor Entity', type: 'person' },
        { id: 'test:spark', title: 'Spark Entity', type: 'concept' },
        { id: 'test:event', title: 'Today Meeting', type: 'event', tag: 'TODAY' },
      ];

      for (const p of profiles) {
        db.query(`
          INSERT OR REPLACE INTO entity_profiles (id, title, type, tag)
          VALUES (?, ?, ?, ?)
        `).run(p.id, p.title, p.type, p.tag || null);

        // Insert physics state with varying mass (table renamed to entity_physics in v34)
        const mass = p.type === 'person' ? 5.0 : p.type === 'event' ? 3.0 : 2.0;
        db.query(`
          INSERT OR REPLACE INTO entity_physics (entity_id, base_mass, heat, gravity)
          VALUES (?, ?, 0.5, 0.5)
        `).run(p.id, mass);
      }
    });

    it('should compute gravity for entities', async () => {
      const physics = new PhysicsSystem();
      const context = {
        time: new Date(),
        lens: 'general',
        userPath: []
      };

      const bodies = await physics.tick(context);
      
      expect(bodies.length).toBeGreaterThan(0);
      
      // All bodies should have _computed_gravity
      for (const body of bodies) {
        expect(body._computed_gravity).toBeDefined();
        expect(typeof body._computed_gravity).toBe('number');
        expect(body._computed_gravity).toBeGreaterThanOrEqual(0);
      }
    });

    it('should give higher gravity to events tagged TODAY', async () => {
      const physics = new PhysicsSystem();
      const context = {
        time: new Date(),
        lens: 'general',
        userPath: []
      };

      const bodies = await physics.tick(context);
      
      const eventBody = bodies.find((b: any) => b.id === 'test:event');
      const sparkBody = bodies.find((b: any) => b.id === 'test:spark');
      
      if (eventBody && sparkBody) {
        // Event with TODAY tag should have convergence bonus
        expect(eventBody._computed_gravity).toBeGreaterThan(sparkBody._computed_gravity);
      }
    });

    it('should boost gravity for entities in userPath', async () => {
      const db = getDB();
      const physics = new PhysicsSystem();
      
      // Reset heat to ensure consistent test (table renamed to entity_physics in v34)
      db.query('UPDATE entity_physics SET heat = 0 WHERE entity_id = ?')
        .run('test:anchor');
      
      // Single tick with userPath containing anchor
      const bodies = await physics.tick({
        time: new Date(),
        lens: 'general',
        userPath: ['test:anchor']
      });
      
      const anchor = bodies.find((b: any) => b.id === 'test:anchor');
      const spark = bodies.find((b: any) => b.id === 'test:spark');
      
      if (anchor && spark) {
        // Anchor in userPath should have path bonus (0.3 weight * 1.0 = 0.3 extra)
        // Spark not in userPath should not have path bonus
        // Both have same base mass contribution from test setup
        expect(anchor._computed_gravity).toBeGreaterThan(spark._computed_gravity);
      }
    });
  });

  // SKIPPED: RenderSystem was removed from the codebase
  describe.skip('RenderSystem', () => {
    it('should render entities to frame buffer', async () => {
      const db = getDB();
      const physics = new PhysicsSystem();
      const render = null as any; // RenderSystem removed
      
      // Run physics first
      const bodies = await physics.tick({
        time: new Date(),
        lens: 'general',
        userPath: []
      });
      
      // Render to test frame
      const visible = await render.render(bodies, 'vitest_frame');
      
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.length).toBeLessThanOrEqual(12); // Max 12 per frame
      
      // Check buffer was populated
      const bufferRows = db.query(
        "SELECT * FROM render_frame_buffer WHERE frame_id = 'vitest_frame'"
      ).all();
      
      expect(bufferRows.length).toBe(visible.length);
    });

    it('should assign visual weights based on rank', async () => {
      const db = getDB();
      const physics = new PhysicsSystem();
      const render = new RenderSystem();
      
      const bodies = await physics.tick({
        time: new Date(),
        lens: 'general',
        userPath: []
      });
      
      await render.render(bodies, 'vitest_weight_frame');
      
      const bufferRows = db.query(`
        SELECT entity_id, gravity_score, visual_weight 
        FROM render_frame_buffer 
        WHERE frame_id = 'vitest_weight_frame'
        ORDER BY gravity_score DESC
      `).all() as any[];
      
      if (bufferRows.length > 0) {
        // First item should be HEAVY
        expect(bufferRows[0].visual_weight).toBe('HEAVY');
      }
      
      if (bufferRows.length > 3) {
        // Items 2-3 should be MEDIUM
        expect(bufferRows[1].visual_weight).toBe('MEDIUM');
        expect(bufferRows[2].visual_weight).toBe('MEDIUM');
        // Items 4+ should be LIGHT
        expect(bufferRows[3].visual_weight).toBe('LIGHT');
      }
    });

    it('should clear old frame before rendering new', async () => {
      const db = getDB();
      const physics = new PhysicsSystem();
      const render = new RenderSystem();
      
      const bodies = await physics.tick({
        time: new Date(),
        lens: 'general',
        userPath: []
      });
      
      // Render twice to same frame
      await render.render(bodies, 'vitest_clear_frame');
      const countBefore = (db.query(
        "SELECT COUNT(*) as count FROM render_frame_buffer WHERE frame_id = 'vitest_clear_frame'"
      ).get() as any).count;
      
      await render.render(bodies, 'vitest_clear_frame');
      const countAfter = (db.query(
        "SELECT COUNT(*) as count FROM render_frame_buffer WHERE frame_id = 'vitest_clear_frame'"
      ).get() as any).count;
      
      // Count should be same (old cleared, new inserted)
      expect(countAfter).toBe(countBefore);
    });

    afterAll(() => {
      // Clean up test frames
      const db = getDB();
      db.query("DELETE FROM render_frame_buffer WHERE frame_id LIKE 'vitest_%'").run();
    });
  });

  // SKIPPED: RenderSystem was removed from the codebase
  describe.skip('ECS Integration', () => {
    it('should complete full Physics -> Render pipeline', async () => {
      const physics = new PhysicsSystem();
      const render = null as any; // RenderSystem removed
      
      // Full pipeline
      const context = {
        time: new Date(),
        lens: 'tech',
        userPath: ['test:anchor']
      };
      
      const bodies = await physics.tick(context);
      const visible = await render.render(bodies, 'vitest_integration');
      
      // Pipeline should produce output
      expect(bodies.length).toBeGreaterThan(0);
      expect(visible.length).toBeGreaterThan(0);
      
      // Top entity should have valid gravity
      const topEntity = visible[0];
      expect(topEntity._computed_gravity).toBeGreaterThan(0);
    });
  });
});

