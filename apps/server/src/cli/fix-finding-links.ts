/**
 * Fix Finding Links CLI - 修复 finding 与提取实体之间缺失的关联
 * 
 * 对于 scout_snapshot 类型的 memory，确保：
 * 1. finding:xxx 的 page_blocks 包含所有从该 memory 提取的实体
 * 2. finding:xxx 与提取实体之间有 contains/containedIn relations
 * 
 * Usage:
 *   pnpm fix-finding-links          执行修复
 *   pnpm fix-finding-links --dry-run 预览修复
 */

import { initDB, getDB } from '../db.js';
import { config } from '../config.js';
import { BlockFactory } from '../lib/graph-link/block-factory.js';

interface MemoryRow {
  id: number;
  title: string;
  source_type: string;
}

interface EntityRow {
  id: string;
  title: string;
  memo_id: number;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  initDB(config.dbPath);
  const db = getDB();
  
  console.log(`\n🔗 Fix Finding Links${dryRun ? ' (DRY RUN)' : ''}`);
  console.log('═'.repeat(50));
  
  // 0. Ensure ALL entities have header blocks
  console.log(`\n📋 Checking header blocks for all entities...`);
  const allEntities = db.query(`SELECT id FROM entities`).all() as { id: string }[];
  let headersAdded = 0;
  
  for (const entity of allEntities) {
    const headerExists = db.query(`
      SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ? AND is_header = 1
    `).get(entity.id, entity.id);
    
    if (!headerExists) {
      if (!dryRun) {
        db.query(`
          INSERT OR IGNORE INTO page_blocks (page_id, block_id, position, is_header)
          VALUES (?, ?, -1, 1)
        `).run(entity.id, entity.id);
      }
      headersAdded++;
    }
  }
  
  if (headersAdded > 0) {
    console.log(`   ${dryRun ? 'Would add' : 'Added'} ${headersAdded} missing header blocks`);
  } else {
    console.log(`   ✓ All entities have header blocks`);
  }
  
  // 1. Get all scout_snapshot memories
  const scoutMemories = db.query(`
    SELECT id, title, source_type 
    FROM memories 
    WHERE source_type = 'scout_snapshot'
    ORDER BY id DESC
  `).all() as MemoryRow[];
  
  console.log(`\n📦 Found ${scoutMemories.length} scout_snapshot memories\n`);
  
  let totalBlocksAdded = 0;
  let totalRelationsAdded = 0;
  let findingsFixed = 0;
  
  for (const memory of scoutMemories) {
    const findingId = `finding:${memory.id}`;
    
    // Check if finding entity exists
    const findingExists = db.query('SELECT id FROM entities WHERE id = ?').get(findingId);
    if (!findingExists) {
      console.log(`⚠️  ${findingId} entity not found, skipping`);
      continue;
    }
    
    // Get entities extracted from this memory
    const extractedEntities = db.query(`
      SELECT id, title, memo_id
      FROM entities
      WHERE memo_id = ?
        AND id != ?
        AND id NOT LIKE 'memory:%'
    `).all(memory.id, findingId) as EntityRow[];
    
    if (extractedEntities.length === 0) {
      continue;
    }
    
    console.log(`\n📄 ${findingId}: "${memory.title?.substring(0, 50) || 'Untitled'}..."`);
    console.log(`   Found ${extractedEntities.length} extracted entities`);
    
    let blocksAdded = 0;
    let relationsAdded = 0;
    
    // Ensure header block exists
    const headerExists = db.query(`
      SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ? AND is_header = 1
    `).get(findingId, findingId);
    
    if (!headerExists) {
      console.log(`   + Adding header block`);
      if (!dryRun) {
        BlockFactory.addBlockIfMissing(findingId, findingId, { isHeader: true });
      }
      blocksAdded++;
    }
    
    for (const entity of extractedEntities) {
      // Check if page_block exists: finding → entity
      const blockExists = db.query(`
        SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ?
      `).get(findingId, entity.id);
      
      if (!blockExists) {
        console.log(`   + Block: ${findingId} → ${entity.id}`);
        if (!dryRun) {
          BlockFactory.addBlockIfMissing(findingId, entity.id, { target: entity.id });
        }
        blocksAdded++;
      }
      
      // Check if page_block exists: entity → finding (source link)
      const reverseBlockExists = db.query(`
        SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ?
      `).get(entity.id, findingId);
      
      if (!reverseBlockExists) {
        console.log(`   + Block: ${entity.id} → ${findingId} (source)`);
        if (!dryRun) {
          BlockFactory.addBlockIfMissing(entity.id, findingId, { target: findingId, isSource: true });
        }
        blocksAdded++;
      }
      
      // Check if relation exists: finding → entity (contains)
      const containsExists = db.query(`
        SELECT 1 FROM relations WHERE source = ? AND target = ? AND type = 'contains'
      `).get(findingId, entity.id);
      
      if (!containsExists) {
        console.log(`   + Relation: ${findingId} --contains--> ${entity.id}`);
        if (!dryRun) {
          db.query(`
            INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
            VALUES (?, ?, 'contains', 0.8, datetime('now'))
          `).run(findingId, entity.id);
        }
        relationsAdded++;
      }
      
      // Check if relation exists: entity → finding (containedIn)
      const containedInExists = db.query(`
        SELECT 1 FROM relations WHERE source = ? AND target = ? AND type = 'containedIn'
      `).get(entity.id, findingId);
      
      if (!containedInExists) {
        console.log(`   + Relation: ${entity.id} --containedIn--> ${findingId}`);
        if (!dryRun) {
          db.query(`
            INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
            VALUES (?, ?, 'containedIn', 0.8, datetime('now'))
          `).run(entity.id, findingId);
        }
        relationsAdded++;
      }
    }
    
    if (blocksAdded > 0 || relationsAdded > 0) {
      console.log(`   ✓ Added ${blocksAdded} blocks, ${relationsAdded} relations`);
      findingsFixed++;
    } else {
      console.log(`   ✓ All links exist`);
    }
    
    totalBlocksAdded += blocksAdded;
    totalRelationsAdded += relationsAdded;
  }
  
  console.log(`\n${'─'.repeat(50)}`);
  if (dryRun) {
    console.log(`[DRY RUN] Would fix ${findingsFixed} findings:`);
    console.log(`   - ${totalBlocksAdded} page_blocks`);
    console.log(`   - ${totalRelationsAdded} relations`);
  } else {
    console.log(`✅ Fixed ${findingsFixed} findings:`);
    console.log(`   - ${totalBlocksAdded} page_blocks added`);
    console.log(`   - ${totalRelationsAdded} relations added`);
  }
  console.log('');
}

main();

