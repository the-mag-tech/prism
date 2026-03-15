/**
 * Migration V16: ECS Architecture Refactor (Phase 1)
 * 
 * Introduces the Entity-Component-System (ECS) table structure.
 * 
 * 1. entity_profiles (Persistent Truth): Replaces the monolithic 'entities' table.
 * 2. entity_physics_state (Dynamic State): Stores real-time physics properties.
 * 3. render_frame_buffer (Volatile View): Stores per-session render state.
 * 
 * Note: The existing 'entities' table is preserved for backward compatibility
 * until Phase 2 is complete.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v16_ecs_refactor: Migration = {
  version: 16,
  name: 'ecs_refactor',
  description: 'Introduce ECS architecture tables: entity_profiles, entity_physics_state, render_frame_buffer',
  
  up: (db: Database) => {
    // 1. entity_profiles (Persistent Truth)
    // Only stores identity and content components.
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity_profiles (
        id TEXT PRIMARY KEY,
        type TEXT, -- Derived from ID prefix (e.g. 'person', 'event')
        title TEXT NOT NULL,
        subtitle TEXT,
        body TEXT,
        tag TEXT,
        action TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_scouted_at TEXT
      );
    `);

    // Migrate data from legacy 'entities' table
    console.error('  Migrating data to entity_profiles...');
    db.exec(`
      INSERT OR IGNORE INTO entity_profiles (
        id, type, title, subtitle, body, tag, action, created_at, updated_at, last_scouted_at
      )
      SELECT 
        id, 
        substr(id, 1, instr(id, ':') - 1), -- Simple type extraction
        title, subtitle, body, tag, action, created_at, updated_at, last_scouted_at
      FROM entities;
    `);

    // 2. entity_physics_state (Dynamic State)
    // Stores the current physical properties of the entity in the field.
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity_physics_state (
        entity_id TEXT PRIMARY KEY,
        mass REAL DEFAULT 0.5,       -- Base weight derived from type
        velocity REAL DEFAULT 0.0,   -- Momentum/Trend (Rate of change)
        temperature REAL DEFAULT 0.0,-- Heat/Recency
        last_updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (entity_id) REFERENCES entity_profiles(id)
      );
    `);

    // Initialize physics state from legacy base_gravity
    console.error('  Initializing entity_physics_state...');
    db.exec(`
      INSERT OR IGNORE INTO entity_physics_state (entity_id, mass)
      SELECT id, base_gravity FROM entities;
    `);

    // 3. render_frame_buffer (Volatile View)
    // Stores the calculated layout and visual state for a session/frame.
    // This replaces the direct API response generation.
    db.exec(`
      CREATE TABLE IF NOT EXISTS render_frame_buffer (
        frame_id TEXT,               -- Session ID or 'global'
        entity_id TEXT,
        gravity_score REAL,          -- The calculated G
        visual_weight TEXT,          -- 'HEAVY' (Anchor) | 'MEDIUM' (Banner) | 'LIGHT' (Spark)
        calculated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (frame_id, entity_id),
        FOREIGN KEY (entity_id) REFERENCES entity_profiles(id)
      );
    `);
    
    // Create index for fast frame retrieval
    db.exec(`CREATE INDEX IF NOT EXISTS idx_frame_buffer_id ON render_frame_buffer(frame_id);`);

    console.error('  ✓ ECS tables created and initialized.');
  },
};





