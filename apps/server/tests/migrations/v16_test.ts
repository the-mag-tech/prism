import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { v16_ecs_refactor } from "../../src/migrations/v16_ecs_refactor.js";

/**
 * Migration V16 Test Suite
 * 
 * Verifies that the ECS refactor migration:
 * 1. Creates the new tables
 * 2. Correctly migrates data from the legacy 'entities' table
 * 3. Initializes physics state
 */

describe("Migration V16: ECS Refactor", () => {
  let db: Database;

  beforeEach(() => {
    // Use in-memory database for speed and isolation
    db = new Database(":memory:");
    
    // Setup: Create the legacy 'entities' table and seed it with mock data
    // This simulates the state of the DB *before* V16 runs
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        title TEXT,
        subtitle TEXT,
        body TEXT,
        tag TEXT,
        action TEXT,
        base_gravity REAL DEFAULT 0.5,
        created_at TEXT DEFAULT '2023-01-01',
        updated_at TEXT DEFAULT '2023-01-01',
        last_scouted_at TEXT
      );
    `);

    // Seed Data
    // 1. Person (Type derivation test)
    db.run(`
      INSERT INTO entities (id, title, subtitle, base_gravity)
      VALUES ('person:simon', 'Simon Willison', 'Creator of Datasette', 0.8)
    `);

    // 2. Event (Different base gravity)
    db.run(`
      INSERT INTO entities (id, title, tag, base_gravity)
      VALUES ('event:meeting_1', 'Team Sync', 'URGENT', 0.9)
    `);

    // 3. Topic (Low gravity)
    db.run(`
      INSERT INTO entities (id, title, base_gravity)
      VALUES ('topic:sqlite', 'SQLite Tips', 0.4)
    `);
  });

  afterEach(() => {
    db.close();
  });

  test("should create ECS tables and migrate profile data", () => {
    // Run the migration
    v16_ecs_refactor.up(db);

    // 1. Verify entity_profiles (Content)
    const simon = db.query("SELECT * FROM entity_profiles WHERE id = 'person:simon'").get() as any;
    expect(simon).toBeTruthy();
    expect(simon.title).toBe('Simon Willison');
    expect(simon.type).toBe('person'); // Derived type check
    expect(simon.subtitle).toBe('Creator of Datasette');

    const event = db.query("SELECT * FROM entity_profiles WHERE id = 'event:meeting_1'").get() as any;
    expect(event.type).toBe('event');
    expect(event.tag).toBe('URGENT');
  });

  test("should initialize physics state from legacy base_gravity", () => {
    // Run the migration
    v16_ecs_refactor.up(db);

    // 2. Verify entity_physics_state (Physics)
    const simonPhysics = db.query("SELECT * FROM entity_physics_state WHERE entity_id = 'person:simon'").get() as any;
    expect(simonPhysics).toBeTruthy();
    expect(simonPhysics.mass).toBe(0.8); // Should match base_gravity
    expect(simonPhysics.velocity).toBe(0.0); // Default

    const topicPhysics = db.query("SELECT * FROM entity_physics_state WHERE entity_id = 'topic:sqlite'").get() as any;
    expect(topicPhysics.mass).toBe(0.4);
  });

  test("should create render_frame_buffer table", () => {
    // Run the migration
    v16_ecs_refactor.up(db);

    // 3. Verify render_frame_buffer exists and allows insertion
    try {
      db.run(`
        INSERT INTO render_frame_buffer (frame_id, entity_id, gravity_score, visual_weight)
        VALUES ('test_frame', 'person:simon', 0.95, 'HEAVY')
      `);
      
      const frame = db.query("SELECT * FROM render_frame_buffer WHERE frame_id = 'test_frame'").get() as any;
      expect(frame.visual_weight).toBe('HEAVY');
    } catch (e) {
      throw new Error(`Render buffer table issue: ${e}`);
    }
  });
  
  test("should handle idempotency (run twice without error)", () => {
    v16_ecs_refactor.up(db);
    
    // Running it again should not throw 'table already exists' errors
    // because we use IF NOT EXISTS and INSERT OR IGNORE
    expect(() => v16_ecs_refactor.up(db)).not.toThrow();
    
    // Data should not be duplicated
    const count = db.query("SELECT COUNT(*) as c FROM entity_profiles").get() as any;
    expect(count.c).toBe(3); // Still 3 entities
  });
});





