/**
 * Extraction Management CLI
 * 
 * Commands for managing entity extraction batches with rollback support.
 * 
 * Usage:
 *   npm run extraction list              - List all extraction batches
 *   npm run extraction rollback <id>     - Rollback a specific batch
 *   npm run extraction clean             - Remove all rolled-back batches
 *   npm run extraction reset             - Remove ALL auto-extracted entities (dangerous!)
 */

import { initDB, getDB } from '../db.js';

// Initialize database
initDB();
const db = getDB();

interface ExtractionBatch {
  id: string;
  strategy_version: string;
  prompt_hash: string | null;
  source_type: string | null;
  description: string | null;
  entity_count: number;
  created_at: string;
  status: string;
}

// =============================================================================
// LIST BATCHES
// =============================================================================

function listBatches() {
  const batches = db.query(`
    SELECT 
      eb.*,
      (SELECT COUNT(*) FROM entities WHERE extraction_batch_id = eb.id) as current_count
    FROM extraction_batches eb
    ORDER BY created_at DESC
  `).all() as (ExtractionBatch & { current_count: number })[];

  if (batches.length === 0) {
    console.log('No extraction batches found.');
    return;
  }

  console.log('\n📦 Extraction Batches:\n');
  console.log('─'.repeat(80));
  
  for (const batch of batches) {
    const statusIcon = batch.status === 'active' ? '✓' : batch.status === 'rolled_back' ? '✗' : '○';
    console.log(`${statusIcon} ${batch.id.substring(0, 8)}...`);
    console.log(`   Strategy: ${batch.strategy_version}`);
    console.log(`   Source:   ${batch.source_type || 'unknown'}`);
    console.log(`   Entities: ${batch.current_count} (originally ${batch.entity_count})`);
    console.log(`   Created:  ${batch.created_at}`);
    console.log(`   Status:   ${batch.status}`);
    if (batch.description) {
      console.log(`   Note:     ${batch.description}`);
    }
    console.log('─'.repeat(80));
  }

  // Summary
  const activeCount = batches.filter(b => b.status === 'active').length;
  const totalEntities = batches.reduce((sum, b) => sum + b.current_count, 0);
  console.log(`\nTotal: ${batches.length} batches, ${activeCount} active, ${totalEntities} entities`);
}

// =============================================================================
// ROLLBACK BATCH
// =============================================================================

function rollbackBatch(batchId: string) {
  // Find batch (support partial ID match)
  const batch = db.query(`
    SELECT * FROM extraction_batches WHERE id LIKE ?
  `).get(`${batchId}%`) as ExtractionBatch | undefined;

  if (!batch) {
    console.error(`❌ Batch not found: ${batchId}`);
    process.exit(1);
  }

  if (batch.status === 'rolled_back') {
    console.log(`⚠️  Batch ${batch.id.substring(0, 8)} is already rolled back.`);
    return;
  }

  console.log(`\n🔄 Rolling back batch: ${batch.id.substring(0, 8)}...`);
  console.log(`   Strategy: ${batch.strategy_version}`);
  console.log(`   Created:  ${batch.created_at}`);

  // Count entities to be removed
  const count = db.query(`
    SELECT COUNT(*) as count FROM entities WHERE extraction_batch_id = ?
  `).get(batch.id) as { count: number };

  console.log(`   Entities to remove: ${count.count}`);

  // Start transaction
  const rollback = db.transaction(() => {
    // Delete page_blocks referencing these entities
    db.query(`
      DELETE FROM page_blocks 
      WHERE block_id IN (SELECT id FROM entities WHERE extraction_batch_id = ?)
         OR page_id IN (SELECT id FROM entities WHERE extraction_batch_id = ?)
    `).run(batch.id, batch.id);

    // Delete relations involving these entities
    db.query(`
      DELETE FROM relations 
      WHERE source IN (SELECT id FROM entities WHERE extraction_batch_id = ?)
         OR target IN (SELECT id FROM entities WHERE extraction_batch_id = ?)
    `).run(batch.id, batch.id);

    // Delete entities
    const result = db.query(`
      DELETE FROM entities WHERE extraction_batch_id = ?
    `).run(batch.id);

    // Update batch status
    db.query(`
      UPDATE extraction_batches SET status = 'rolled_back' WHERE id = ?
    `).run(batch.id);

    return result.changes;
  });

  const deleted = rollback();
  console.log(`\n✓ Rolled back: ${deleted} entities removed`);
}

// =============================================================================
// CLEAN ROLLED-BACK BATCHES
// =============================================================================

function cleanBatches() {
  const result = db.query(`
    DELETE FROM extraction_batches WHERE status = 'rolled_back'
  `).run();

  console.log(`✓ Cleaned ${result.changes} rolled-back batch records`);
}

// =============================================================================
// RESET ALL AUTO-EXTRACTED
// =============================================================================

function resetAll() {
  console.log('\n⚠️  WARNING: This will remove ALL auto-extracted entities!');
  console.log('   Manual/seeded entities will be preserved.\n');

  // Count what will be deleted
  const count = db.query(`
    SELECT COUNT(*) as count FROM entities WHERE is_auto_extracted = 1
  `).get() as { count: number };

  console.log(`   Entities to remove: ${count.count}`);

  if (count.count === 0) {
    console.log('   Nothing to remove.');
    return;
  }

  // Require confirmation via environment variable for safety
  if (process.env.CONFIRM_RESET !== 'yes') {
    console.log('\n   To confirm, run with: CONFIRM_RESET=yes npm run extraction reset');
    return;
  }

  const reset = db.transaction(() => {
    // Delete page_blocks
    db.query(`
      DELETE FROM page_blocks 
      WHERE block_id IN (SELECT id FROM entities WHERE is_auto_extracted = 1)
         OR page_id IN (SELECT id FROM entities WHERE is_auto_extracted = 1)
    `).run();

    // Delete relations
    db.query(`
      DELETE FROM relations 
      WHERE source IN (SELECT id FROM entities WHERE is_auto_extracted = 1)
         OR target IN (SELECT id FROM entities WHERE is_auto_extracted = 1)
    `).run();

    // Delete entities
    const result = db.query(`
      DELETE FROM entities WHERE is_auto_extracted = 1
    `).run();

    // Mark all batches as rolled back
    db.query(`
      UPDATE extraction_batches SET status = 'rolled_back'
    `).run();

    return result.changes;
  });

  const deleted = reset();
  console.log(`\n✓ Reset complete: ${deleted} entities removed`);
}

// =============================================================================
// STATS
// =============================================================================

function showStats() {
  const stats = db.query(`
    SELECT 
      (SELECT COUNT(*) FROM entities) as total_entities,
      (SELECT COUNT(*) FROM entities WHERE is_auto_extracted = 1) as auto_extracted,
      (SELECT COUNT(*) FROM entities WHERE is_auto_extracted = 0) as manual,
      (SELECT COUNT(*) FROM extraction_batches WHERE status = 'active') as active_batches,
      (SELECT COUNT(*) FROM memories) as total_memories
  `).get() as {
    total_entities: number;
    auto_extracted: number;
    manual: number;
    active_batches: number;
    total_memories: number;
  };

  console.log('\n📊 Extraction Stats:\n');
  console.log(`   Total Entities:     ${stats.total_entities}`);
  console.log(`   ├─ Auto-extracted:  ${stats.auto_extracted}`);
  console.log(`   └─ Manual/Seeded:   ${stats.manual}`);
  console.log(`   Active Batches:     ${stats.active_batches}`);
  console.log(`   Total Memories:     ${stats.total_memories}`);
}

// =============================================================================
// MAIN
// =============================================================================

const [,, command, ...args] = process.argv;

switch (command) {
  case 'list':
    listBatches();
    break;
  case 'rollback':
    if (!args[0]) {
      console.error('Usage: npm run extraction rollback <batch-id>');
      process.exit(1);
    }
    rollbackBatch(args[0]);
    break;
  case 'clean':
    cleanBatches();
    break;
  case 'reset':
    resetAll();
    break;
  case 'stats':
    showStats();
    break;
  default:
    console.log(`
Extraction Management CLI

Usage:
  npm run extraction list              List all extraction batches
  npm run extraction rollback <id>     Rollback a specific batch (supports partial ID)
  npm run extraction clean             Remove rolled-back batch records
  npm run extraction reset             Remove ALL auto-extracted entities
  npm run extraction stats             Show extraction statistics

Examples:
  npm run extraction list
  npm run extraction rollback a1b2c3d4
  CONFIRM_RESET=yes npm run extraction reset
`);
}

