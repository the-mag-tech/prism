/**
 * Merge Entities CLI - 执行实体合并
 * 
 * 手动挡工具：从 CSV 文件批量执行合并，或查看/撤销已有合并
 * 
 * Usage:
 *   npm run merge-entities --target <primary_id> --source <alias_id>  - Merge two entities
 *   npm run merge-entities --file reviewed.csv                        - Batch merge
 *   npm run merge-entities --list                                     - List aliases
 *   npm run merge-entities --undo alias_id                            - Undo merge
 */

import { initDB, getDB } from '../db.js';
import { config } from '../config.js';
import fs from 'fs';

// =============================================================================
// TYPES
// =============================================================================

interface AliasRow {
  id: number;
  canonical_id: string;
  alias_id: string;
  alias_type: string;
  confidence: number;
  created_at: string;
}

interface MergeAction {
  primaryId: string;
  aliasId: string;
  action: 'merge' | 'skip';
}

// =============================================================================
// MERGE FUNCTIONS
// =============================================================================

/**
 * List all existing aliases
 */
function listAliases(): AliasRow[] {
  const db = getDB();
  return db.query(`
    SELECT id, canonical_id, alias_id, alias_type, confidence, created_at
    FROM entity_aliases
    ORDER BY created_at DESC
  `).all() as AliasRow[];
}

/**
 * Get entity title by ID
 */
function getEntityTitle(entityId: string): string | null {
  const db = getDB();
  const row = db.query('SELECT title FROM entities WHERE id = ?').get(entityId) as { title: string } | undefined;
  return row?.title || null;
}

/**
 * Create an alias (merge)
 */
function createAlias(canonicalId: string, aliasId: string, confidence: number = 1.0): boolean {
  const db = getDB();
  
  try {
    db.query(`
      INSERT INTO entity_aliases (canonical_id, alias_id, alias_type, confidence)
      VALUES (?, ?, 'manual', ?)
      ON CONFLICT(alias_id) DO UPDATE SET canonical_id = excluded.canonical_id
    `).run(canonicalId, aliasId, confidence);
    return true;
  } catch (error) {
    console.error('Merge error:', error);
    return false;
  }
}

/**
 * Remove an alias (undo merge)
 */
function removeAlias(aliasId: string): boolean {
  const db = getDB();
  const result = db.query('DELETE FROM entity_aliases WHERE alias_id = ?').run(aliasId);
  return result.changes > 0;
}

/**
 * Parse CSV file for merge actions
 */
function parseCSV(filePath: string): MergeAction[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const actions: MergeAction[] = [];
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse CSV (handle quoted values)
    const parts = line.match(/("([^"]*)"|[^,]+)/g);
    if (!parts || parts.length < 3) continue;
    
    const clean = (s: string) => s.replace(/^"|"$/g, '').trim();
    
    // Expected format: entity_a,title_a,entity_b,title_b,similarity,action
    // Or simpler: primary_id,alias_id,action
    let primaryId: string, aliasId: string, action: string;
    
    if (parts.length >= 6) {
      // Full format from find-duplicates export + action column
      primaryId = clean(parts[0]);
      aliasId = clean(parts[2]);
      action = clean(parts[5] || 'skip');
    } else if (parts.length >= 3) {
      // Simple format
      primaryId = clean(parts[0]);
      aliasId = clean(parts[1]);
      action = clean(parts[2]);
    } else {
      continue;
    }
    
    if (action.toLowerCase() === 'merge') {
      actions.push({ primaryId, aliasId, action: 'merge' });
    }
  }
  
  return actions;
}

/**
 * Execute merge actions from file
 */
function executeMergesFromFile(filePath: string): { merged: number; skipped: number; errors: string[] } {
  const actions = parseCSV(filePath);
  let merged = 0;
  let skipped = 0;
  const errors: string[] = [];
  
  for (const action of actions) {
    if (action.action === 'merge') {
      const success = createAlias(action.primaryId, action.aliasId);
      if (success) {
        merged++;
        console.log(`  ✓ Merged: ${action.aliasId} → ${action.primaryId}`);
      } else {
        skipped++;
        errors.push(`Already merged or invalid: ${action.aliasId}`);
      }
    }
  }
  
  return { merged, skipped, errors };
}

// =============================================================================
// APPLY MERGES - Actually update page_blocks to use canonical IDs
// =============================================================================

interface ApplyResult {
  pageBlocksUpdated: number;
  aliasesProcessed: number;
  details: Array<{ alias: string; canonical: string; blocksUpdated: number }>;
}

/**
 * Apply all aliases: update page_blocks to reference canonical IDs
 * 
 * 设计原则：
 * - entities 表保留所有实体（历史记录）
 * - page_blocks 中的 block_id 引用指向 canonical
 * - alias entity 的 page_blocks (作为 page_id) 也保留，但重定向到 canonical
 * - 前端/API 层面过滤 alias entities
 */
function applyMerges(dryRun: boolean = false): ApplyResult {
  const db = getDB();
  const result: ApplyResult = {
    pageBlocksUpdated: 0,
    aliasesProcessed: 0,
    details: [],
  };

  // Get all aliases
  const aliases = db.query(`
    SELECT canonical_id, alias_id FROM entity_aliases
  `).all() as { canonical_id: string; alias_id: string }[];

  if (aliases.length === 0) {
    console.log('No aliases to apply.\n');
    return result;
  }

  console.log(`\n🔄 Applying ${aliases.length} aliases to page_blocks...\n`);
  console.log(`   (Entities are preserved, only block references are updated)\n`);

  // Update block_id references
  const updateBlockStmt = db.query(`
    UPDATE page_blocks SET block_id = ? WHERE block_id = ?
  `);
  
  // Update page_id references (redirect alias pages to canonical)
  const updatePageStmt = db.query(`
    UPDATE page_blocks SET page_id = ? WHERE page_id = ?
  `);

  const countBlockStmt = db.query(`
    SELECT COUNT(*) as count FROM page_blocks WHERE block_id = ?
  `);
  
  const countPageStmt = db.query(`
    SELECT COUNT(*) as count FROM page_blocks WHERE page_id = ?
  `);

  let pagesRedirected = 0;

  for (const alias of aliases) {
    const blockCount = (countBlockStmt.get(alias.alias_id) as { count: number }).count;
    const pageCount = (countPageStmt.get(alias.alias_id) as { count: number }).count;
    
    const hasChanges = blockCount > 0 || pageCount > 0;
    
    if (hasChanges) {
      console.log(`  ${alias.alias_id} → ${alias.canonical_id}`);
      if (blockCount > 0) console.log(`     └─ ${blockCount} block refs redirected`);
      if (pageCount > 0) console.log(`     └─ ${pageCount} page entries merged into canonical`);
      
      if (!dryRun) {
        // Update block references (block_id)
        // Handle UNIQUE constraint: if canonical block already exists on same page, delete alias block
        const refsToUpdate = db.query('SELECT page_id, block_id FROM page_blocks WHERE block_id = ?').all(alias.alias_id) as { page_id: string, block_id: string }[];
        
        const updateRefStmt = db.query(`
          UPDATE OR IGNORE page_blocks 
          SET block_id = ? 
          WHERE page_id = ? AND block_id = ?
        `);
        
        const deleteRefStmt = db.query(`
          DELETE FROM page_blocks 
          WHERE page_id = ? AND block_id = ?
        `);

        for (const ref of refsToUpdate) {
          const info = updateRefStmt.run(alias.canonical_id, ref.page_id, ref.block_id);
          if (info.changes === 0) {
            // Conflict! Canonical block already exists on this page.
            // Remove the alias block reference to complete merge.
            deleteRefStmt.run(ref.page_id, ref.block_id);
          }
        }
        
        // Update page_id references (Merge Pages)
        // Handle UNIQUE constraint: iterate and update one by one
        const blocksToMove = db.query('SELECT block_id FROM page_blocks WHERE page_id = ?').all(alias.alias_id) as { block_id: string }[];
        
        const moveStmt = db.query(`
          UPDATE OR IGNORE page_blocks 
          SET page_id = ? 
          WHERE page_id = ? AND block_id = ?
        `);
        
        const deleteStmt = db.query(`
          DELETE FROM page_blocks 
          WHERE page_id = ? AND block_id = ?
        `);

        for (const b of blocksToMove) {
          // Try to move
          const info = moveStmt.run(alias.canonical_id, alias.alias_id, b.block_id);
          if (info.changes === 0) {
            // Conflict! The target page already has this block.
            // We should delete the source block to complete the "merge" (deduplication)
            deleteStmt.run(alias.alias_id, b.block_id);
          }
        }
      }
      
      result.pageBlocksUpdated += blockCount;
      if (pageCount > 0) pagesRedirected++;
      result.details.push({
        alias: alias.alias_id,
        canonical: alias.canonical_id,
        blocksUpdated: blockCount,
      });
    }
    
    result.aliasesProcessed++;
  }

  console.log(`\n${'─'.repeat(50)}`);
  if (dryRun) {
    console.log(`[DRY RUN] Would update:`);
    console.log(`   - ${result.pageBlocksUpdated} block refs redirected`);
    console.log(`   - ${pagesRedirected} pages merged`);
    console.log(`   - 0 entities deleted (preserved by design)`);
  } else {
    console.log(`✅ Applied:`);
    console.log(`   - ${result.pageBlocksUpdated} block refs redirected`);
    console.log(`   - ${pagesRedirected} pages merged`);
    console.log(`   - Entities preserved (filter at API/frontend level)`);
  }

  return result;
}

// =============================================================================
// STATS
// =============================================================================

function printStats(): void {
  const db = getDB();
  
  const aliasCount = db.query('SELECT COUNT(*) as count FROM entity_aliases').get() as { count: number };
  const entityCount = db.query('SELECT COUNT(*) as count FROM entities').get() as { count: number };
  const pendingCount = db.query(`SELECT COUNT(*) as count FROM entity_similarities WHERE status = 'pending'`).get() as { count: number };
  
  // Count page_blocks still referencing aliases
  const staleBlocks = db.query(`
    SELECT COUNT(*) as count FROM page_blocks pb
    WHERE EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.alias_id = pb.block_id)
  `).get() as { count: number };
  
  console.log(`
📊 Entity Merge Statistics
${'═'.repeat(50)}

  Total Entities:        ${entityCount.count}
  Merged (aliases):      ${aliasCount.count}
  Pending Review:        ${pendingCount.count}
  
  ⚠️  Stale page_blocks:   ${staleBlocks.count}  ${staleBlocks.count > 0 ? '← Run --apply to fix!' : '✓'}
`);
}

// =============================================================================
// PRETTY PRINT
// =============================================================================

function printAliases(aliases: AliasRow[]) {
  if (aliases.length === 0) {
    console.log('No aliases found. Use find-duplicates to discover potential merges.\n');
    return;
  }
  
  console.log(`
📋 Current Entity Aliases (${aliases.length} total)
${'═'.repeat(50)}
`);

  for (const alias of aliases) {
    const canonicalTitle = getEntityTitle(alias.canonical_id) || '(unknown)';
    const aliasTitle = getEntityTitle(alias.alias_id) || '(unknown)';
    const date = alias.created_at.split('T')[0];
    
    console.log(`[${date}] ${alias.alias_type} (${(alias.confidence * 100).toFixed(0)}%)`);
    console.log(`  "${aliasTitle}" → "${canonicalTitle}"`);
    console.log(`  ${alias.alias_id} → ${alias.canonical_id}`);
    console.log('');
  }
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  
  let filePath: string | null = null;
  let listMode = false;
  let undoAliasId: string | null = null;
  let statsMode = false;
  let applyMode = false;
  let dryRun = false;
  let targetId: string | null = null;
  let sourceId: string | null = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' || args[i] === '-f') {
      filePath = args[i + 1];
      i++;
    } else if (args[i] === '--list' || args[i] === '-l') {
      listMode = true;
    } else if (args[i] === '--undo' || args[i] === '-u') {
      undoAliasId = args[i + 1];
      i++;
    } else if (args[i] === '--stats' || args[i] === '-s') {
      statsMode = true;
    } else if (args[i] === '--apply' || args[i] === '-a') {
      applyMode = true;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--target' || args[i] === '-t') {
      targetId = args[i + 1];
      i++;
    } else if (args[i] === '--source' || args[i] === '-src') {
      sourceId = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  
  // Init DB
  initDB(config.dbPath);
  
  // Direct merge mode (CLI)
  if (targetId && sourceId) {
    console.log(`\n🔗 Merging ${sourceId} → ${targetId}...`);
    const success = createAlias(targetId, sourceId);
    if (success) {
      console.log('✅ Alias created.');
      console.log('Run with --apply to update page_blocks immediately, or use --apply flag now.');
      if (applyMode) {
        applyMerges(dryRun);
      }
    } else {
      console.log('❌ Failed to create alias.');
    }
    return;
  }

  // Stats mode
  if (statsMode) {
    printStats();
    return;
  }
  
  // List mode
  if (listMode) {
    const aliases = listAliases();
    printAliases(aliases);
    return;
  }
  
  // Apply mode - update page_blocks with canonical IDs
  if (applyMode) {
    console.log(`
🔄 Apply Merges to page_blocks
${'═'.repeat(50)}
`);
    applyMerges(dryRun);
    return;
  }
  
  // Undo mode
  if (undoAliasId) {
    const aliasTitle = getEntityTitle(undoAliasId);
    const success = removeAlias(undoAliasId);
    
    if (success) {
      console.log(`✓ Removed alias: ${undoAliasId} ("${aliasTitle}")`);
    } else {
      console.log(`❌ Alias not found: ${undoAliasId}`);
    }
    return;
  }
  
  // Merge from file
  if (filePath) {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }
    
    console.log(`
🔗 Executing Merges from File
${'═'.repeat(50)}

📁 File: ${filePath}
`);
    
    const result = executeMergesFromFile(filePath);
    
    console.log(`
${'─'.repeat(50)}
✅ Complete: ${result.merged} merged, ${result.skipped} skipped
`);
    
    if (result.errors.length > 0) {
      console.log('⚠️ Errors:');
      for (const error of result.errors) {
        console.log(`   ${error}`);
      }
    }
    return;
  }
  
  // Default: show help
  printHelp();
}

function printHelp() {
  console.log(`
🔗 Merge Entities - Execute entity merges

Usage:
  npm run merge-entities --target <main_id> --source <alias_id>  Merge two entities
  npm run merge-entities --list                                  List current aliases
  npm run merge-entities --stats                                 Show merge statistics
  npm run merge-entities --apply                                 Apply aliases to page_blocks ⭐
  npm run merge-entities --file <csv>                            Merge from CSV file
  npm run merge-entities --undo <alias_id>                       Remove an alias (undo merge)

Options:
  -t, --target            Target (Canonical) Entity ID
  -src, --source          Source (Alias) Entity ID
  -a, --apply             Update page_blocks to use canonical IDs
      --dry-run           Preview changes without applying (use with --apply)
  -l, --list              List all current entity aliases
  -s, --stats             Show statistics
  -f, --file <path>       Execute merges from CSV file
  -u, --undo <alias_id>   Remove an alias by alias_id
  -h, --help              Show this help
`);
}

main();
