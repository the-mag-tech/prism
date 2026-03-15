/**
 * Mark existing seed data as batch0 (production seed)
 * 
 * This script marks all existing entities (from seed-db.ts) as batch0,
 * making them the "golden examples" for cold start.
 * 
 * Key characteristics of batch0:
 * - is_auto_extracted = 0 (hand-crafted, not AI-generated)
 * - extraction_batch_id = 'batch0-production-seed'
 * - Won't be affected by extraction rollbacks
 * - Can be replaced or kept during productization
 * 
 * Usage: npm run mark-batch0
 */

import { initDB, getDB } from '../db.js';

const BATCH0_ID = 'batch0-production-seed';

function markBatch0() {
  initDB();
  const db = getDB();

  console.log('\n🏷️  Marking existing seed data as batch0...\n');

  // Check if batch0 already exists
  const existingBatch = db.query(
    'SELECT * FROM extraction_batches WHERE id = ?'
  ).get(BATCH0_ID);

  if (existingBatch) {
    console.log('⚠️  batch0 already exists. Skipping creation.');
  } else {
    // Count existing entities that are not auto-extracted
    const seedCount = db.query(`
      SELECT COUNT(*) as count FROM entities 
      WHERE is_auto_extracted = 0 OR is_auto_extracted IS NULL
    `).get() as { count: number };

    // Create batch0 record
    db.query(`
      INSERT INTO extraction_batches (id, strategy_version, prompt_hash, source_type, description, entity_count, status)
      VALUES (?, 'manual', 'hand-crafted', 'seed', 'Production seed data for cold start. Hand-crafted golden examples.', ?, 'active')
    `).run(BATCH0_ID, seedCount.count);

    console.log(`✓ Created batch0 record (${seedCount.count} entities)`);
  }

  // Update existing entities to reference batch0
  const updateResult = db.query(`
    UPDATE entities 
    SET extraction_batch_id = ?,
        is_auto_extracted = 0
    WHERE extraction_batch_id IS NULL 
       OR extraction_batch_id = ''
  `).run(BATCH0_ID);

  console.log(`✓ Marked ${updateResult.changes} entities as batch0`);

  // Verify
  const stats = db.query(`
    SELECT 
      extraction_batch_id,
      COUNT(*) as count,
      SUM(CASE WHEN is_auto_extracted = 1 THEN 1 ELSE 0 END) as auto_count
    FROM entities
    GROUP BY extraction_batch_id
  `).all() as { extraction_batch_id: string | null; count: number; auto_count: number }[];

  console.log('\n📊 Entity distribution by batch:\n');
  console.log('─'.repeat(60));
  for (const row of stats) {
    const batchId = row.extraction_batch_id || '(none)';
    const displayId = batchId.length > 20 ? batchId.substring(0, 20) + '...' : batchId;
    console.log(`   ${displayId.padEnd(25)} ${row.count} entities (${row.auto_count} auto-extracted)`);
  }
  console.log('─'.repeat(60));

  // Show batch0 info
  const batch0 = db.query(
    'SELECT * FROM extraction_batches WHERE id = ?'
  ).get(BATCH0_ID) as { description: string; entity_count: number; created_at: string } | undefined;

  if (batch0) {
    console.log('\n📦 batch0 details:');
    console.log(`   ID:          ${BATCH0_ID}`);
    console.log(`   Description: ${batch0.description}`);
    console.log(`   Entities:    ${batch0.entity_count}`);
    console.log(`   Created:     ${batch0.created_at}`);
  }

  console.log('\n✅ batch0 marking complete!');
  console.log('\nNext steps:');
  console.log('  1. Run extraction: npm run extract -- --desc="First AI extraction"');
  console.log('  2. View batches:   npm run extraction list');
  console.log('  3. Rollback if needed: npm run extraction rollback <batch-id>');
}

// Run
markBatch0();

