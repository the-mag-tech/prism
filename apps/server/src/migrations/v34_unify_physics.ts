/**
 * Migration v34: Unify Physics Tables
 * 
 * Consolidates entity_physics_state and entity_gravity into a single entity_physics table.
 * 
 * Rationale:
 * - entity_physics_state had unused fields (velocity, temperature)
 * - entity_gravity was the actual source of truth for gravity scores
 * - Single table is cleaner and more maintainable
 * 
 * New schema is extensible for future physics properties (momentum, heat).
 */

import { Database } from 'bun:sqlite';

export const migration = {
  version: 34,
  name: 'unify_physics',
  description: 'Consolidate entity_physics_state and entity_gravity into entity_physics',

  up: (db: Database) => {
    console.error('[v34] Creating unified entity_physics table...');

    // 1. Create new unified table
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity_physics (
        entity_id TEXT PRIMARY KEY,
        
        -- Core computed gravity (the main output)
        gravity REAL DEFAULT 0.5,
        
        -- Input factors for gravity calculation
        base_mass REAL DEFAULT 0.5,
        
        -- Gravity components breakdown (for debugging/transparency)
        convergence REAL,  -- Time/event proximity factor
        path REAL,         -- Context/history factor  
        spark REAL,        -- Novelty factor
        
        -- Future extensibility (nullable for now)
        momentum REAL,     -- Trend/velocity (v2)
        heat REAL,         -- Recency/activity (v2)
        
        -- Metadata
        updated_at TEXT DEFAULT (datetime('now')),
        
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      )
    `);

    // 2. Create index for gravity-based queries
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entity_physics_gravity 
      ON entity_physics(gravity DESC)
    `);

    // 3. Migrate data from old tables
    // Priority: entity_gravity.gravity_score > entity_physics_state.mass > default 0.5
    console.error('[v34] Migrating data from old tables...');
    
    db.exec(`
      INSERT OR REPLACE INTO entity_physics (entity_id, gravity, base_mass, updated_at)
      SELECT 
        COALESCE(g.entity_id, p.entity_id) as entity_id,
        COALESCE(g.gravity_score, p.mass, 0.5) as gravity,
        COALESCE(p.mass, 0.5) as base_mass,
        COALESCE(g.updated_at, p.last_updated_at, datetime('now')) as updated_at
      FROM entity_physics_state p
      LEFT JOIN entity_gravity g ON p.entity_id = g.entity_id
      WHERE p.entity_id IS NOT NULL
    `);

    // Also insert any entity_gravity records that don't have physics_state
    db.exec(`
      INSERT OR IGNORE INTO entity_physics (entity_id, gravity, base_mass, updated_at)
      SELECT 
        g.entity_id,
        g.gravity_score,
        0.5,
        g.updated_at
      FROM entity_gravity g
      WHERE g.entity_id NOT IN (SELECT entity_id FROM entity_physics)
    `);

    // 4. Drop old tables
    console.error('[v34] Dropping old tables...');
    db.exec('DROP TABLE IF EXISTS entity_physics_state');
    db.exec('DROP TABLE IF EXISTS entity_gravity');

    // 5. Log migration stats
    const count = db.query('SELECT COUNT(*) as c FROM entity_physics').get() as { c: number };
    console.error(`[v34] Migration complete. ${count.c} entities in entity_physics table.`);
  },
};

