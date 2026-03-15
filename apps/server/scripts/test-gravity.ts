#!/usr/bin/env bun
/**
 * Test Gravity Calculation
 * 
 * Verifies that all three signals (Convergence, Path, Spark) are working.
 * Run: cd apps/prism-server && bun run scripts/test-gravity.ts
 */

import { initDB, getDB } from '../src/db.js';

// Initialize
initDB();
const db = getDB();

console.log('\n=== Gravity System Diagnostic ===\n');

// 1. Check Path Associations
console.log('1. PATH ASSOCIATIONS (Top 10):');
const pathAssocs = db.query(`
  SELECT entity_a, entity_b, co_occurrence_count, avg_path_similarity
  FROM path_associations
  ORDER BY co_occurrence_count DESC
  LIMIT 10
`).all() as any[];

for (const pa of pathAssocs) {
  console.log(`   ${pa.entity_a} <-> ${pa.entity_b}: ${pa.co_occurrence_count} co-occurrences`);
}

// 2. Test calculatePathGravity for top entities
console.log('\n2. PATH GRAVITY SCORES:');

function calculatePathGravity(entityId: string): number {
  const associations = db.query(`
    SELECT 
      SUM(co_occurrence_count) as total_cooccurrence,
      AVG(avg_path_similarity) as avg_similarity
    FROM path_associations
    WHERE entity_a = ? OR entity_b = ?
  `).get(entityId, entityId) as { total_cooccurrence: number | null; avg_similarity: number | null };
  
  if (!associations.total_cooccurrence) return 0;
  
  const cooccurrenceScore = Math.log(1 + associations.total_cooccurrence) / 5;
  const similarityScore = associations.avg_similarity || 0;
  
  return Math.min(1, cooccurrenceScore * 0.6 + similarityScore * 0.4);
}

const testEntities = ['project:magpie', 'person:simon', 'event:seed_funding', 'project:ponder'];
for (const eid of testEntities) {
  const pathG = calculatePathGravity(eid);
  console.log(`   ${eid}: Path G = ${pathG.toFixed(4)}`);
}

// 3. Check Entity Visits (using the view)
console.log('\n3. ENTITY VISITS (Top 10):');
const visits = db.query(`
  SELECT entity_id, visit_count, last_visited
  FROM entity_visit_stats
  ORDER BY visit_count DESC
  LIMIT 10
`).all() as any[];

for (const v of visits) {
  console.log(`   ${v.entity_id}: ${v.visit_count} visits (last: ${v.last_visited})`);
}

// 4. Check Events with time info
console.log('\n4. EVENT ENTITIES:');
const events = db.query(`
  SELECT id, title, tag, created_at
  FROM entities
  WHERE id LIKE 'event:%'
  LIMIT 10
`).all() as any[];

if (events.length === 0) {
  console.log('   No event entities found');
} else {
  for (const e of events) {
    console.log(`   ${e.id}: "${e.title}" [${e.tag || 'no tag'}]`);
  }
}

// 5. Summary
console.log('\n=== SUMMARY ===');
console.log(`Path Associations: ${pathAssocs.length > 0 ? '✅ Working' : '❌ Empty'}`);
console.log(`Entity Visits: ${visits.length > 0 ? '✅ Working' : '❌ Empty'}`);
console.log(`Event Entities: ${events.length > 0 ? '✅ Found' : '⚠️ None'}`);

// 6. Calculate full gravity for a sample entity
console.log('\n6. FULL GRAVITY CALCULATION (project:magpie):');

const WEIGHTS = { convergence: 0.4, path: 0.3, spark: 0.2 };

const entity = db.query(`
  SELECT id, title, tag, base_gravity, event_time, last_scouted_at, created_at
  FROM entities 
  WHERE id = 'project:magpie'
`).get() as any;

if (entity) {
  // Convergence: check event_time or tag
  let convergence = 0;
  if (entity.event_time) {
    const eventDate = new Date(entity.event_time);
    const hoursDelta = (eventDate.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursDelta < 0 && hoursDelta > -24) convergence = 0.5;
    else if (hoursDelta >= 0 && hoursDelta <= 24) convergence = 1.0;
    else if (hoursDelta <= 72) convergence = 0.8;
  } else {
    const tag = entity.tag?.toUpperCase() || '';
    if (tag.includes('TODAY')) convergence = 1.0;
    else if (tag.includes('URGENT')) convergence = 0.8;
  }
  
  const path = calculatePathGravity(entity.id);
  
  // Spark: check last_scouted_at, created_at, or visit count
  let spark = 0.5; // default
  if (entity.last_scouted_at) {
    const hoursSince = (Date.now() - new Date(entity.last_scouted_at).getTime()) / (1000 * 60 * 60);
    spark = Math.exp(-hoursSince / 24);
  } else if (entity.created_at) {
    const hoursSince = (Date.now() - new Date(entity.created_at).getTime()) / (1000 * 60 * 60);
    spark = Math.exp(-hoursSince / 48);
  } else {
    // Fallback to visit stats
    const visitStats = db.query(`
      SELECT visit_count FROM entity_visit_stats WHERE entity_id = ?
    `).get(entity.id) as { visit_count: number } | null;
    spark = !visitStats || visitStats.visit_count < 3 ? 0.8 : 0.2;
  }
  
  const base = entity.base_gravity || 0.5;
  
  const gravity = 
    (WEIGHTS.convergence * convergence) +
    (WEIGHTS.path * path) +
    (WEIGHTS.spark * spark) +
    (base * 0.5);
  
  console.log(`   Convergence: ${convergence.toFixed(2)} (event_time: ${entity.event_time || 'none'}, tag: ${entity.tag || 'none'})`);
  console.log(`   Path:        ${path.toFixed(4)}`);
  console.log(`   Spark:       ${spark.toFixed(4)} (last_scouted: ${entity.last_scouted_at || 'never'})`);
  console.log(`   Base:        ${base.toFixed(2)}`);
  console.log(`   ─────────────────────`);
  console.log(`   TOTAL G:     ${gravity.toFixed(4)}`);
} else {
  console.log('   Entity not found');
}

