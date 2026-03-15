#!/usr/bin/env npx ts-node
/**
 * Retype Entity CLI - 修正实体类型的模块化工具
 * 
 * 用法：
 *   npm run retype-entity <old_id> <new_type>
 *   npm run retype-entity event:seed_funding news
 *   npm run retype-entity --dry-run event:seed_funding news
 *   npm run retype-entity --list-types
 * 
 * 自动处理：
 *   1. entities 表的 id 和 tag
 *   2. page_blocks 表的 page_id, block_id, target, tag_override
 *   3. entity_aliases 表的引用
 */

import { initDB, getDB } from '../db.js';
import { config } from '../config.js';
import { getTagForEntityType } from '../entity-semantics.js';
import { ALL_ENTITY_TYPES, ENTITY_TYPE_DEFINITIONS } from '@prism/contract';

interface RetypeResult {
  oldId: string;
  newId: string;
  entitiesUpdated: number;
  blocksUpdated: number;
  aliasesUpdated: number;
}

/**
 * 更改实体类型
 */
function retypeEntity(oldId: string, newType: string, dryRun = false): RetypeResult {
  const db = getDB();
  
  // 解析旧 ID
  const [oldType, ...nameParts] = oldId.split(':');
  const name = nameParts.join(':');
  const newId = `${newType}:${name}`;
  const newTag = getTagForEntityType(newType);
  
  console.log(`\n📝 Retype Entity Plan:`);
  console.log(`   Old: ${oldId} (${oldType})`);
  console.log(`   New: ${newId} (${newType} → ${newTag})`);
  
  if (dryRun) {
    console.log(`\n🔍 Dry Run - No changes will be made\n`);
  }
  
  let entitiesUpdated = 0;
  let blocksUpdated = 0;
  let aliasesUpdated = 0;
  
  // 检查实体是否存在
  const entity = db.query('SELECT * FROM entities WHERE id = ?').get(oldId);
  if (!entity) {
    console.log(`❌ Entity not found: ${oldId}`);
    return { oldId, newId, entitiesUpdated: 0, blocksUpdated: 0, aliasesUpdated: 0 };
  }
  
  if (!dryRun) {
    db.transaction(() => {
      // 1. 更新 entities 表
      const entityResult = db.query(`
        UPDATE entities SET id = ?, tag = ? WHERE id = ?
      `).run(newId, newTag, oldId);
      entitiesUpdated = entityResult.changes;
      
      // 2. 更新 page_blocks 表
      // 2a. page_id
      let result = db.query(`
        UPDATE page_blocks SET page_id = ? WHERE page_id = ?
      `).run(newId, oldId);
      blocksUpdated += result.changes;
      
      // 2b. block_id + 更新 HEADER 的 tag_override
      result = db.query(`
        UPDATE page_blocks 
        SET block_id = ?, 
            tag_override = CASE 
              WHEN tag_override = 'HEADER' THEN ?
              ELSE tag_override 
            END
        WHERE block_id = ?
      `).run(newId, newTag, oldId);
      blocksUpdated += result.changes;
      
      // 2c. target
      result = db.query(`
        UPDATE page_blocks SET target = ? WHERE target = ?
      `).run(newId, oldId);
      blocksUpdated += result.changes;
      
      // 3. 更新 entity_aliases 表
      result = db.query(`
        UPDATE entity_aliases SET canonical_id = ? WHERE canonical_id = ?
      `).run(newId, oldId);
      aliasesUpdated += result.changes;
      
      result = db.query(`
        UPDATE entity_aliases SET alias_id = ? WHERE alias_id = ?
      `).run(newId, oldId);
      aliasesUpdated += result.changes;
    })();
  } else {
    // Dry run: 只统计会影响的行数
    const entityCount = db.query('SELECT COUNT(*) as c FROM entities WHERE id = ?').get(oldId) as { c: number };
    entitiesUpdated = entityCount.c;
    
    const blockCount = db.query(`
      SELECT COUNT(*) as c FROM page_blocks 
      WHERE page_id = ? OR block_id = ? OR target = ?
    `).get(oldId, oldId, oldId) as { c: number };
    blocksUpdated = blockCount.c;
    
    const aliasCount = db.query(`
      SELECT COUNT(*) as c FROM entity_aliases 
      WHERE canonical_id = ? OR alias_id = ?
    `).get(oldId, oldId) as { c: number };
    aliasesUpdated = aliasCount.c;
  }
  
  console.log(`\n✅ Results:`);
  console.log(`   Entities: ${entitiesUpdated}`);
  console.log(`   Blocks: ${blocksUpdated}`);
  console.log(`   Aliases: ${aliasesUpdated}`);
  
  return { oldId, newId, entitiesUpdated, blocksUpdated, aliasesUpdated };
}

/**
 * 批量修正：根据规则自动修正
 */
function autoFix(dryRun = false): void {
  const db = getDB();
  
  console.log(`\n🔧 Auto-fix: Scanning for mistyped entities...\n`);
  
  // 规则 1: 包含 "funding", "raised", "launch" 的 event 应该是 news
  const fundingEvents = db.query(`
    SELECT id FROM entities 
    WHERE id LIKE 'event:%' 
    AND (title LIKE '%funding%' OR title LIKE '%raised%' OR title LIKE '%launch%')
  `).all() as { id: string }[];
  
  if (fundingEvents.length > 0) {
    console.log(`📰 Found ${fundingEvents.length} events that should be news:`);
    for (const e of fundingEvents) {
      console.log(`   - ${e.id}`);
      retypeEntity(e.id, 'news', dryRun);
    }
  } else {
    console.log(`✅ No mistyped events found`);
  }
}

/**
 * 列出所有可用类型
 * Note: SemanticRole mapping is now frontend-only (Magpie)
 */
function listTypes(): void {
  console.log(`\n📚 Available Entity Types (from prism-contract SSOT):\n`);
  
  // Group by category
  const groups = {
    'SOURCE (原始内容)': ['memory', 'finding'],
    'EXTRACTED (AI提取)': [
      'person', 'company',
      'project', 'milestone', 'decision',
      'event', 'news',
      'topic', 'concept', 'problem', 'insight',
      'location', 'gift', 'hobby', 'agenda', 'cheatsheet',
    ],
  };
  
  for (const [groupName, types] of Object.entries(groups)) {
    console.log(`📁 ${groupName}:`);
    for (const type of types) {
      const desc = ENTITY_TYPE_DEFINITIONS[type as keyof typeof ENTITY_TYPE_DEFINITIONS] || '(unknown)';
      console.log(`   ${type.padEnd(12)} → ${desc}`);
    }
    console.log('');
  }
  
  console.log(`ℹ️  SemanticRole mapping (anchor/intel/spark/context) is frontend-only.`);
  console.log(`   @see apps/magpie/src/lib/entity-semantics-api.ts\n`);
}

// =============================================================================
// CLI
// =============================================================================

function printHelp(): void {
  console.log(`
📝 Retype Entity - 修正实体类型的模块化工具

Usage:
  npm run retype-entity <old_id> <new_type>     修改单个实体类型
  npm run retype-entity --dry-run <old_id> <new_type>   预览变更
  npm run retype-entity --auto-fix              自动修正常见错误
  npm run retype-entity --list-types            列出所有可用类型

Examples:
  npm run retype-entity event:seed_funding news
  npm run retype-entity --dry-run event:ponder_launch news
  npm run retype-entity --auto-fix --dry-run

自动处理：
  ✓ entities 表的 id 和 tag
  ✓ page_blocks 表的 page_id, block_id, target
  ✓ HEADER blocks 的 tag_override (继承新类型的颜色)
  ✓ entity_aliases 表的引用
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }
  
  // Initialize database
  initDB(config.dbPath);
  
  if (args.includes('--list-types')) {
    listTypes();
    return;
  }
  
  const dryRun = args.includes('--dry-run');
  const filteredArgs = args.filter(a => !a.startsWith('--'));
  
  if (args.includes('--auto-fix')) {
    autoFix(dryRun);
    return;
  }
  
  if (filteredArgs.length < 2) {
    console.error('❌ Error: Missing arguments. Use --help for usage.');
    process.exit(1);
  }
  
  const [oldId, newType] = filteredArgs;
  
  // 验证新类型 (使用 prism-contract SSOT)
  if (!ALL_ENTITY_TYPES.includes(newType as any)) {
    console.error(`❌ Unknown type: ${newType}`);
    console.error(`   Use --list-types to see available types`);
    process.exit(1);
  }
  
  retypeEntity(oldId, newType, dryRun);
}

main().catch(console.error);

