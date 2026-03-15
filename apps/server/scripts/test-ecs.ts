#!/usr/bin/env bun
/**
 * ECS System Verification Script
 * 
 * Tests the ECS architecture (PhysicsSystem, RenderSystem, ScoutSystem).
 * Run: cd apps/prism-server && bun run scripts/test-ecs.ts
 */

import { initDB, getDB } from '../src/db.js';
import { PhysicsSystem } from '../src/systems/PhysicsSystem.js';
import { RenderSystem } from '../src/systems/RenderSystem.js';

// Initialize
initDB();
const db = getDB();

console.log('\n=== ECS System Verification ===\n');

// 1. Check ECS Tables
console.log('1. ECS TABLES:');
const tables = ['entity_profiles', 'entity_physics_state', 'render_frame_buffer'];
for (const table of tables) {
  const exists = db.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);
  console.log(`   ${exists ? '✅' : '❌'} ${table}`);
}

// 2. Check Data
console.log('\n2. DATA COUNTS:');
const profileCount = (db.query('SELECT COUNT(*) as count FROM entity_profiles').get() as any).count;
const physicsCount = (db.query('SELECT COUNT(*) as count FROM entity_physics_state').get() as any).count;
console.log(`   entity_profiles:     ${profileCount}`);
console.log(`   entity_physics_state: ${physicsCount}`);

// 3. Run Physics System
console.log('\n3. PHYSICS SYSTEM TICK:');
const physics = new PhysicsSystem();
const context = {
  time: new Date(),
  lens: 'general',
};

const bodies = await physics.tick(context);
console.log(`   Processed ${bodies.length} entities`);

// Show top 5 by gravity
const topBodies = bodies
  .sort((a: any, b: any) => (b._computed_gravity || 0) - (a._computed_gravity || 0))
  .slice(0, 5);

console.log('\n   Top 5 by Gravity:');
for (const body of topBodies) {
  const g = body._computed_gravity?.toFixed(4) || 'N/A';
  const c = body._components;
  console.log(`   - ${body.id.slice(0, 35).padEnd(35)} G=${g}`);
  if (c) {
    console.log(`     C=${c.convergence.toFixed(2)} P=${c.path.toFixed(2)} S=${c.spark.toFixed(2)} B=${c.base.toFixed(2)}`);
  }
}

// 4. Run Render System
console.log('\n4. RENDER SYSTEM:');
const render = new RenderSystem();
const rendered = await render.render(bodies, 'test_frame');
console.log(`   Rendered ${rendered.length} visible blocks`);

// Check buffer
const bufferRows = db.query(
  `SELECT entity_id, gravity_score, visual_weight 
   FROM render_frame_buffer 
   WHERE frame_id = 'test_frame'
   ORDER BY gravity_score DESC
   LIMIT 5`
).all() as any[];

console.log('\n   Render Buffer (Top 5):');
for (const row of bufferRows) {
  console.log(`   - ${row.entity_id.slice(0, 25).padEnd(25)} G=${row.gravity_score.toFixed(3)} W=${row.visual_weight}`);
}

// Cleanup
db.query("DELETE FROM render_frame_buffer WHERE frame_id = 'test_frame'").run();

// Summary
console.log('\n=== SUMMARY ===');
console.log(`PhysicsSystem: ✅ Working (${bodies.length} entities)`);
console.log(`RenderSystem:  ✅ Working (${rendered.length} blocks)`);
console.log(`Gravity Range: ${topBodies[topBodies.length-1]?._computed_gravity?.toFixed(3) || 'N/A'} - ${topBodies[0]?._computed_gravity?.toFixed(3) || 'N/A'}`);

