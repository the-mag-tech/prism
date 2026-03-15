/**
 * Delete Entity CLI
 *
 * Surgical removal of specific entities without resetting the whole DB.
 * Useful for "depolluting" the graph from unwanted or test entities.
 *
 * Usage:
 *   npm run delete-entity "Simon Willison"          - Delete by name (Dry Run)
 *   npm run delete-entity "Simon Willison" --force  - Execute deletion
 */

import { initDB, getDB } from '../db.js';
import { config } from '../config.js';

async function main() {
  const args = process.argv.slice(2);
  const forceIndex = args.indexOf('--force');
  const isForce = forceIndex !== -1;

  // Remove --force from args to get the name
  const nameArgs = args.filter(a => a !== '--force');
  const entityName = nameArgs.join(' ');

  if (!entityName) {
    console.log('Usage:');
    console.log('  npm run delete-entity "Simon Willison"          (Dry Run)');
    console.log('  npm run delete-entity "Simon Willison" --force  (Execute)');
    return;
  }

  initDB(config.dbPath);
  const db = getDB();

  console.log(`\n🔍 Searching for entity: "${entityName}"...`);

  // 1. Find Entity ID (Support ID or Title)
  // Note: 'type' column does not exist in v1 schema, we use 'tag' or derive from ID.
  let row = db.query(`
    SELECT id, title, tag 
    FROM entities 
    WHERE id = ? OR title = ? COLLATE NOCASE
  `).get(entityName, entityName) as any;
  
  if (!row) {
    console.log('❌ Entity not found.');
    
    // Try LIKE for suggestion
    const likeRow = db.query('SELECT id, title FROM entities WHERE title LIKE ? LIMIT 1').get(`%${entityName}%`) as any;
    if (likeRow) {
        console.log(`Did you mean "${likeRow.title}"?`);
    }
    return;
  }

  const entityId = row.id;
  const type = row.tag || entityId.split(':')[0];
  console.log(`✅ Found Target: [${type}] ${row.title} (${entityId})`);

  // 2. Calculate Impact
  // Note: relations table uses 'source' and 'target', NOT 'from_id' and 'to_id'
  const relationCount = db.query('SELECT COUNT(*) as c FROM relations WHERE source = ? OR target = ?').get(entityId, entityId) as any;
  const contentCount = db.query('SELECT COUNT(*) as c FROM public_content WHERE related_entities LIKE ?').get(`%${entityId}%`) as any;

  console.log(`\n⚠️  IMPACT ANALYSIS:`);
  console.log(`   - Entity Node: 1`);
  console.log(`   - Relations:   ${relationCount.c}`);
  console.log(`   - Public Content: ~${contentCount.c} (Linked items)`);

  if (!isForce) {
    console.log(`\n🛑 DRY RUN MODE. No changes made.`);
    console.log(`   Run with --force to execute this deletion.`);
    return;
  }

  // 3. Execution
  console.log(`\n🚀 EXECUTING DELETE...`);
  
  db.transaction(() => {
    const delRelations = db.query('DELETE FROM relations WHERE source = ? OR target = ?').run(entityId, entityId);
    const delContent = db.query('DELETE FROM public_content WHERE related_entities LIKE ?').run(`%${entityId}%`);
    const delEntity = db.query('DELETE FROM entities WHERE id = ?').run(entityId);
    
    console.log(`   - Deleted ${delRelations.changes} relations.`);
    console.log(`   - Deleted ${delContent.changes} public content items.`);
    console.log(`   - Deleted Entity node.`);
  })();

  console.log(`\n✅ WIPE COMPLETE.`);
}

main().catch(console.error);
