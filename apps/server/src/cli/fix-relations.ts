/**
 * Fix Relations CLI - 修复缺失的实体关联
 * 
 * 对于同一 memory 提取的实体，自动建立 page_blocks 关联
 * 
 * Usage:
 *   npm run fix-relations          执行修复
 *   npm run fix-relations --dry-run 预览修复
 */

import { initDB, getDB } from '../db.js';
import { config } from '../config.js';

interface EntityInfo {
  id: string;
  title: string;
  memoId: number;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  initDB(config.dbPath);
  const db = getDB();
  
  console.log(`\n🔗 Fix Missing Relations${dryRun ? ' (DRY RUN)' : ''}`);
  console.log('═'.repeat(50));
  
  // 1. Get all entities grouped by memo_id
  const entities = db.query(`
    SELECT id, title, memo_id
    FROM entities
    WHERE memo_id IS NOT NULL
      AND id NOT LIKE 'memory:%'
      AND NOT EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.alias_id = id)
    ORDER BY memo_id, id
  `).all() as EntityInfo[];
  
  // Group by memory
  const byMemory = new Map<number, EntityInfo[]>();
  for (const entity of entities) {
    if (!byMemory.has(entity.memoId)) {
      byMemory.set(entity.memoId, []);
    }
    byMemory.get(entity.memoId)!.push(entity);
  }
  
  console.log(`\n📦 Found ${byMemory.size} memories with multiple entities\n`);
  
  // 2. For each memory with multiple entities, ensure cross-links exist
  const insertStmt = db.query(`
    INSERT OR IGNORE INTO page_blocks (page_id, block_id, position, tag_override, target)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const checkStmt = db.query(`
    SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ?
  `);
  
  const getMaxPosition = db.query(`
    SELECT COALESCE(MAX(position), 0) as max_pos FROM page_blocks WHERE page_id = ?
  `);
  
  let totalAdded = 0;
  
  // Priority for main entity selection
  const typePriority: Record<string, number> = {
    'project': 1,
    'company': 2,
    'person': 3,
    'event': 4,
    'decision': 5,
    'concept': 6,
  };
  
  // Tag mapping
  const typeToTag: Record<string, string> = {
    'project': 'INTEL',
    'company': 'INTEL',
    'person': 'CONTEXT',
    'event': 'ACTION',
    'decision': 'ACTION',
    'concept': 'SPARK',
  };
  
  for (const [memoryId, memoryEntities] of byMemory) {
    if (memoryEntities.length < 2) continue;
    
    console.log(`\n📄 Memory ${memoryId}: ${memoryEntities.length} entities`);
    for (const e of memoryEntities) {
      console.log(`   - ${e.id}: ${e.title}`);
    }
    
    // Sort by priority
    const sorted = [...memoryEntities].sort((a, b) => {
      const typeA = a.id.split(':')[0];
      const typeB = b.id.split(':')[0];
      return (typePriority[typeA] ?? 99) - (typePriority[typeB] ?? 99);
    });
    
    let addedForMemory = 0;
    
    // Ensure all entities link to each other
    for (const entityA of sorted) {
      for (const entityB of sorted) {
        if (entityA.id === entityB.id) continue;
        
        // Check if link exists
        const exists = checkStmt.get(entityA.id, entityB.id);
        if (exists) continue;
        
        // Get next position
        const maxPos = (getMaxPosition.get(entityA.id) as { max_pos: number }).max_pos;
        const position = maxPos + 1;
        
        // Determine tag based on entityB type
        const typeB = entityB.id.split(':')[0];
        const tag = typeToTag[typeB] ?? 'CONTEXT';
        
        console.log(`   + Adding: ${entityA.id} → ${entityB.id} (${tag})`);
        
        if (!dryRun) {
          insertStmt.run(entityA.id, entityB.id, position, tag, entityB.id);
        }
        
        addedForMemory++;
        totalAdded++;
      }
    }
    
    if (addedForMemory > 0) {
      console.log(`   ✓ Added ${addedForMemory} links`);
    } else {
      console.log(`   ✓ All links exist`);
    }
  }
  
  console.log(`\n${'─'.repeat(50)}`);
  if (dryRun) {
    console.log(`[DRY RUN] Would add ${totalAdded} page_block entries`);
  } else {
    console.log(`✅ Added ${totalAdded} page_block entries`);
  }
  console.log('');
}

main();




