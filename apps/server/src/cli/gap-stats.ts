#!/usr/bin/env bun
/**
 * Data Gap Statistics CLI
 *
 * @ref data-gap/cli
 * @doc docs/DATA-GAP-DETECTION.md#8
 *
 * Commands:
 *   overview  - Show gap statistics overview
 *   entity    - Show gaps for a specific entity
 *   types     - Show gaps by entity type
 *   fill      - Trigger gap-filling for high-priority gaps
 *   detect    - Detect gaps for all entities (dry run or store)
 */

import { config } from '../config.js';
import { initDB, getDB } from '../db.js';
import { log } from '../lib/logger.js';
import {
  getGapStats,
  detectGaps,
  detectAndStoreGaps,
  getAllOpenGaps,
  getOpenGaps,
  type GapStats,
  type DataGap,
} from '../lib/data-gap/index.js';

// Initialize DB
const dbPath = process.env.DB_PATH || config.dbPath;
initDB(dbPath);
log(`[GapStats] Using database: ${dbPath}`);

// Parse command
const args = process.argv.slice(2);
const command = args[0] || 'overview';

switch (command) {
  case 'overview':
    showOverview();
    break;
  case 'entity':
    showEntityGaps(args[1]);
    break;
  case 'types':
    showByType();
    break;
  case 'detect':
    detectAllGaps(args.includes('--store'));
    break;
  case 'priority':
    showByPriority(args[1] as any);
    break;
  default:
    showHelp();
}

// =============================================================================
// Commands
// =============================================================================

function showOverview() {
  const stats = getGapStats();

  console.log('\n📊 Data Gap Statistics\n');
  console.log('─'.repeat(50));

  console.log(`\nTotal Gaps: ${stats.total}`);

  console.log('\n📈 By Status:');
  for (const [status, count] of Object.entries(stats.byStatus)) {
    const bar = '█'.repeat(Math.min(count, 30));
    console.log(`  ${status.padEnd(12)} ${bar} ${count}`);
  }

  console.log('\n🎯 By Priority:');
  const priorityOrder = ['critical', 'high', 'medium', 'low'];
  for (const priority of priorityOrder) {
    const count = stats.byPriority[priority] || 0;
    const bar = '█'.repeat(Math.min(count, 30));
    const emoji =
      priority === 'critical' ? '🔴' : priority === 'high' ? '🟠' : priority === 'medium' ? '🟡' : '🟢';
    console.log(`  ${emoji} ${priority.padEnd(10)} ${bar} ${count}`);
  }

  console.log('\n📦 By Entity Type (Top 10):');
  for (const [type, count] of Object.entries(stats.byEntityType)) {
    const bar = '█'.repeat(Math.min(count, 30));
    console.log(`  ${type.padEnd(12)} ${bar} ${count}`);
  }

  console.log('\n📊 Metrics:');
  console.log(`  Avg Search Attempts: ${stats.avgSearchAttempts.toFixed(1)}`);
  console.log(`  Recently Filled (7d): ${stats.recentlyFilled}`);

  console.log('\n' + '─'.repeat(50));
}

function showEntityGaps(entityId?: string) {
  if (!entityId) {
    console.log('Usage: pnpm gap-stats entity <entity_id>');
    console.log('Example: pnpm gap-stats entity person:simon_willison');
    return;
  }

  const result = detectGaps(entityId);

  console.log(`\n🔍 Gaps for: ${entityId}\n`);
  console.log('─'.repeat(50));

  console.log(`\nCompleteness: ${(result.completeness * 100).toFixed(0)}%`);
  console.log(`Existing Relations: ${result.existingRelations.join(', ') || '(none)'}`);

  if (result.gaps.length === 0) {
    console.log('\n✅ No gaps detected!');
    return;
  }

  console.log(`\n❓ Missing Relations (${result.gaps.length}):\n`);

  for (const gap of result.gaps) {
    const emoji =
      gap.priority === 'critical' ? '🔴' : gap.priority === 'high' ? '🟠' : gap.priority === 'medium' ? '🟡' : '🟢';
    console.log(`  ${emoji} ${gap.missingRelation} → ${gap.expectedTargetType}`);
    console.log(`     ${gap.reasoningZh}`);
    console.log(`     Query: "${gap.suggestedQueries[0]}"`);
    console.log();
  }

  console.log('─'.repeat(50));
}

function showByType() {
  const db = getDB();

  const types = db
    .query(
      `
    SELECT entity_type, priority, COUNT(*) as cnt
    FROM data_gaps
    WHERE status = 'open'
    GROUP BY entity_type, priority
    ORDER BY entity_type, 
      CASE priority 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
      END
  `
    )
    .all() as { entity_type: string; priority: string; cnt: number }[];

  console.log('\n📦 Open Gaps by Entity Type\n');
  console.log('─'.repeat(50));

  let currentType = '';
  for (const row of types) {
    if (row.entity_type !== currentType) {
      if (currentType) console.log();
      currentType = row.entity_type;
      console.log(`\n${currentType}:`);
    }
    const emoji =
      row.priority === 'critical' ? '🔴' : row.priority === 'high' ? '🟠' : row.priority === 'medium' ? '🟡' : '🟢';
    console.log(`  ${emoji} ${row.priority}: ${row.cnt}`);
  }

  console.log('\n' + '─'.repeat(50));
}

function showByPriority(priority?: 'critical' | 'high' | 'medium' | 'low') {
  const priorities = priority ? [priority] : ['critical', 'high'];
  const gaps = getAllOpenGaps({ priority: priorities as any[], limit: 20 });

  console.log(`\n🎯 Open Gaps (${priorities.join(', ')})\n`);
  console.log('─'.repeat(50));

  if (gaps.length === 0) {
    console.log('\n✅ No gaps found!');
    return;
  }

  for (const gap of gaps) {
    const emoji =
      gap.priority === 'critical' ? '🔴' : gap.priority === 'high' ? '🟠' : gap.priority === 'medium' ? '🟡' : '🟢';
    console.log(`\n${emoji} ${gap.entityId}`);
    console.log(`   Missing: ${gap.missingRelation} → ${gap.expectedTargetType}`);
    console.log(`   Reason: ${gap.reasoningZh}`);
    console.log(`   Attempts: ${gap.searchAttempts}`);
  }

  console.log('\n' + '─'.repeat(50));
}

function detectAllGaps(store: boolean) {
  const db = getDB();

  // Get all entities with expectations
  const entities = db
    .query(
      `
    SELECT DISTINCT id FROM entities
    WHERE id LIKE 'person:%' 
       OR id LIKE 'company:%' 
       OR id LIKE 'project:%'
       OR id LIKE 'topic:%'
       OR id LIKE 'event:%'
    ORDER BY id
  `
    )
    .all() as { id: string }[];

  console.log(`\n🔍 Detecting gaps for ${entities.length} entities...\n`);
  console.log('─'.repeat(50));

  let totalGaps = 0;
  const typeCounts: Record<string, number> = {};

  for (const entity of entities) {
    const result = detectGaps(entity.id);
    if (result.gaps.length > 0) {
      const [type] = entity.id.split(':');
      typeCounts[type] = (typeCounts[type] || 0) + result.gaps.length;
      totalGaps += result.gaps.length;

      if (!store) {
        console.log(
          `  ${entity.id}: ${result.gaps.length} gaps (${(result.completeness * 100).toFixed(0)}% complete)`
        );
      }
    }
  }

  console.log('\n📊 Summary:');
  console.log(`  Total entities scanned: ${entities.length}`);
  console.log(`  Total gaps found: ${totalGaps}`);

  console.log('\n  By type:');
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`    ${type}: ${count}`);
  }

  if (store) {
    console.log('\n💾 Storing gaps...');
    const entityIds = entities.map((e) => e.id);
    const stored = detectAndStoreGaps(entityIds);
    console.log(`  ✓ Stored ${stored} new gaps`);
  } else {
    console.log('\n💡 Tip: Run with --store to save gaps to database');
  }

  console.log('\n' + '─'.repeat(50));
}

function showHelp() {
  console.log(`
📊 Data Gap Statistics CLI

Usage: pnpm gap-stats <command> [options]

Commands:
  overview              Show gap statistics overview (default)
  entity <id>           Show gaps for a specific entity
  types                 Show gaps grouped by entity type
  priority [level]      Show gaps by priority (default: critical, high)
  detect [--store]      Detect gaps for all entities

Examples:
  pnpm gap-stats
  pnpm gap-stats entity person:simon_willison
  pnpm gap-stats types
  pnpm gap-stats priority critical
  pnpm gap-stats detect --store
`);
}
