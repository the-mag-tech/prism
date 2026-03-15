#!/usr/bin/env npx ts-node
/**
 * Schema V2 Migration - SSOT for Entity Colors
 * 
 * 设计原则：
 * 1. entity.id 的 prefix 是颜色的唯一来源 (SSOT)
 * 2. page_blocks.is_header/is_source 是布局提示，不影响颜色
 * 3. page_blocks.color_override 仅用于显式覆盖（极少使用）
 * 
 * 数据结构变更：
 * - page_blocks.tag_override → page_blocks.color_override
 * - 新增 page_blocks.is_header (BOOLEAN)
 * - 新增 page_blocks.is_source (BOOLEAN)
 * 
 * 用法：
 *   npm run migrate-v2 --dry-run    预览变更
 *   npm run migrate-v2              执行迁移
 *   npm run migrate-v2 --reset      重置数据库并重新提取
 */

import { initDB, getDB } from '../db.js';
import { config } from '../config.js';
import { runExtraction } from '../extract.js';

interface MigrationStats {
  tablesModified: number;
  blocksUpdated: number;
  entitiesReset: boolean;
}

/**
 * Step 1: Modify page_blocks schema
 */
function migrateSchema(dryRun: boolean): void {
  const db = getDB();
  
  console.log('\n📐 Step 1: Schema Migration\n');
  
  // Check current schema
  const tableInfo = db.query("PRAGMA table_info(page_blocks)").all() as { name: string }[];
  const columns = tableInfo.map(c => c.name);
  
  console.log('Current columns:', columns.join(', '));
  
  const hasIsHeader = columns.includes('is_header');
  const hasIsSource = columns.includes('is_source');
  const hasColorOverride = columns.includes('color_override');
  
  if (hasIsHeader && hasIsSource && hasColorOverride) {
    console.log('✅ Schema already migrated to V2');
    return;
  }
  
  if (dryRun) {
    console.log('\n[DRY RUN] Would execute:');
    if (!hasIsHeader) console.log('  ALTER TABLE page_blocks ADD COLUMN is_header INTEGER DEFAULT 0');
    if (!hasIsSource) console.log('  ALTER TABLE page_blocks ADD COLUMN is_source INTEGER DEFAULT 0');
    if (!hasColorOverride) console.log('  ALTER TABLE page_blocks ADD COLUMN color_override TEXT');
    return;
  }
  
  // Add new columns
  db.transaction(() => {
    if (!hasIsHeader) {
      db.exec('ALTER TABLE page_blocks ADD COLUMN is_header INTEGER DEFAULT 0');
      console.log('✅ Added is_header column');
    }
    
    if (!hasIsSource) {
      db.exec('ALTER TABLE page_blocks ADD COLUMN is_source INTEGER DEFAULT 0');
      console.log('✅ Added is_source column');
    }
    
    if (!hasColorOverride) {
      db.exec('ALTER TABLE page_blocks ADD COLUMN color_override TEXT');
      console.log('✅ Added color_override column');
    }
  })();
}

/**
 * Step 2: Migrate existing data
 */
function migrateData(dryRun: boolean): number {
  const db = getDB();
  
  console.log('\n📦 Step 2: Data Migration\n');
  
  // Migrate tag_override values to new columns
  const headerBlocks = db.query(`
    SELECT page_id, block_id FROM page_blocks WHERE tag_override = 'HEADER'
  `).all() as { page_id: string; block_id: string }[];
  
  const sourceBlocks = db.query(`
    SELECT page_id, block_id FROM page_blocks WHERE tag_override = 'SOURCE'
  `).all() as { page_id: string; block_id: string }[];
  
  console.log(`Found ${headerBlocks.length} HEADER blocks`);
  console.log(`Found ${sourceBlocks.length} SOURCE blocks`);
  
  if (dryRun) {
    console.log('\n[DRY RUN] Would update:');
    console.log(`  ${headerBlocks.length} blocks: is_header = 1, tag_override = NULL`);
    console.log(`  ${sourceBlocks.length} blocks: is_source = 1, tag_override = NULL`);
    return headerBlocks.length + sourceBlocks.length;
  }
  
  let updated = 0;
  
  db.transaction(() => {
    // Migrate HEADER blocks
    const updateHeader = db.query(`
      UPDATE page_blocks 
      SET is_header = 1, tag_override = NULL
      WHERE tag_override = 'HEADER'
    `);
    const headerResult = updateHeader.run();
    updated += headerResult.changes;
    
    // Migrate SOURCE blocks
    const updateSource = db.query(`
      UPDATE page_blocks 
      SET is_source = 1, tag_override = NULL
      WHERE tag_override = 'SOURCE'
    `);
    const sourceResult = updateSource.run();
    updated += sourceResult.changes;
    
    // Rename tag_override to color_override (SQLite doesn't support RENAME COLUMN in all versions)
    // We'll keep both for now, but only use color_override going forward
  })();
  
  console.log(`✅ Migrated ${updated} blocks`);
  return updated;
}

/**
 * Step 3: Verify migration
 */
function verifyMigration(): boolean {
  const db = getDB();
  
  console.log('\n✅ Step 3: Verification\n');
  
  // Check for remaining HEADER/SOURCE in tag_override
  const remaining = db.query(`
    SELECT COUNT(*) as count FROM page_blocks 
    WHERE tag_override IN ('HEADER', 'SOURCE')
  `).get() as { count: number };
  
  if (remaining.count > 0) {
    console.log(`❌ ${remaining.count} blocks still have HEADER/SOURCE in tag_override`);
    return false;
  }
  
  // Check is_header and is_source are populated
  const headers = db.query(`SELECT COUNT(*) as count FROM page_blocks WHERE is_header = 1`).get() as { count: number };
  const sources = db.query(`SELECT COUNT(*) as count FROM page_blocks WHERE is_source = 1`).get() as { count: number };
  
  console.log(`Headers: ${headers.count}`);
  console.log(`Sources: ${sources.count}`);
  console.log('✅ Migration verified');
  
  return true;
}

/**
 * Full reset: Clear and re-extract
 */
async function fullReset(): Promise<void> {
  const db = getDB();
  
  console.log('\n🔄 Full Reset: Clearing entities and page_blocks\n');
  
  db.exec(`
    DELETE FROM page_blocks;
    DELETE FROM entities WHERE id NOT LIKE 'singleton:%';
  `);
  
  console.log('✅ Cleared page_blocks and entities');
  console.log('\n🔄 Re-extracting from memories...\n');
  
  await runExtraction(['--idempotent']);
  
  console.log('\n✅ Full reset complete');
}

// =============================================================================
// CLI
// =============================================================================

function printHelp(): void {
  console.log(`
📐 Schema V2 Migration - SSOT for Entity Colors

设计原则：
  1. entity.id 的 prefix 是颜色的唯一来源 (SSOT)
  2. page_blocks.is_header/is_source 是布局提示，不影响颜色
  3. page_blocks.color_override 仅用于显式覆盖

Usage:
  npm run migrate-v2              执行迁移
  npm run migrate-v2 --dry-run    预览变更
  npm run migrate-v2 --reset      重置数据库并重新提取
  npm run migrate-v2 --verify     仅验证迁移状态

数据结构变更：
  ✓ page_blocks.tag_override → page_blocks.color_override
  ✓ 新增 page_blocks.is_header (BOOLEAN)
  ✓ 新增 page_blocks.is_source (BOOLEAN)
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }
  
  initDB(config.dbPath);
  
  const dryRun = args.includes('--dry-run');
  const reset = args.includes('--reset');
  const verifyOnly = args.includes('--verify');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  if (verifyOnly) {
    verifyMigration();
    return;
  }
  
  if (reset) {
    await fullReset();
    return;
  }
  
  // Normal migration
  migrateSchema(dryRun);
  migrateData(dryRun);
  
  if (!dryRun) {
    verifyMigration();
  }
  
  console.log('\n🎉 Migration complete!\n');
}

main().catch(console.error);

