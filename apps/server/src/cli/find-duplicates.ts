/**
 * Find Duplicates CLI - 找出可能重复的实体
 * 
 * 手动挡工具：用 OpenAI embedding 计算实体相似度，找出潜在重复
 * 
 * Usage:
 *   npm run find-duplicates
 *   npm run find-duplicates --threshold 0.8
 *   npm run find-duplicates --export
 */

import { initDB, getDB } from '../db.js';
import { config } from '../config.js';
import { getOpenAI, isOpenAIAvailable } from '../lib/ai-clients.js';
import fs from 'fs';
import readline from 'readline';

// =============================================================================
// TYPES
// =============================================================================

interface EntityRow {
  id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  tag: string | null;
}

interface SimilarityPair {
  entityA: string;
  titleA: string;
  entityB: string;
  titleB: string;
  similarity: number;
}

interface DuplicateResult {
  pairs: SimilarityPair[];
  threshold: number;
  totalEntities: number;
  computedAt: string;
}

// =============================================================================
// EMBEDDING & SIMILARITY
// =============================================================================

/**
 * Get all entities from database (excluding alias entities)
 */
function getAllEntities(): EntityRow[] {
  const db = getDB();
  return db.query(`
    SELECT id, title, subtitle, body, tag
    FROM entities e
    WHERE NOT EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.alias_id = e.id)
    ORDER BY id
  `).all() as EntityRow[];
}

/**
 * Get pairs that should be skipped (already merged or explicitly skipped)
 */
function getProcessedPairs(): Set<string> {
  const db = getDB();
  const rows = db.query(`
    SELECT entity_a, entity_b, status 
    FROM entity_similarities 
    WHERE status IN ('merged', 'skipped')
  `).all() as { entity_a: string; entity_b: string; status: string }[];
  
  const processed = new Set<string>();
  for (const row of rows) {
    // Add both directions
    processed.add(`${row.entity_a}|${row.entity_b}`);
    processed.add(`${row.entity_b}|${row.entity_a}`);
  }
  return processed;
}

/**
 * Build text representation of entity for embedding
 */
function entityToText(entity: EntityRow): string {
  const parts = [entity.title];
  if (entity.subtitle) parts.push(entity.subtitle);
  if (entity.body) parts.push(entity.body.substring(0, 200)); // Limit body length
  return parts.join(' | ');
}

/**
 * Compute embeddings for entities using OpenAI
 */
async function computeEmbeddings(texts: string[]): Promise<number[][]> {
  const openai = getOpenAI();
  if (!openai) {
    throw new Error('OpenAI not available');
  }
  
  // OpenAI allows up to 2048 inputs per request
  const batchSize = 100;
  const allEmbeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    process.stdout.write(`\r  Computing embeddings... ${i + batch.length}/${texts.length}`);
    
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });
    
    for (const item of response.data) {
      allEmbeddings.push(item.embedding);
    }
  }
  
  console.log(''); // New line after progress
  return allEmbeddings;
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find similar pairs above threshold
 */
function findSimilarPairs(
  entities: EntityRow[],
  embeddings: number[][],
  threshold: number
): SimilarityPair[] {
  const pairs: SimilarityPair[] = [];
  const db = getDB();
  
  // Get existing aliases to exclude already-merged pairs
  const existingAliases = new Set<string>();
  const aliasRows = db.query('SELECT canonical_id, alias_id FROM entity_aliases').all() as { canonical_id: string; alias_id: string }[];
  for (const row of aliasRows) {
    existingAliases.add(`${row.canonical_id}|${row.alias_id}`);
    existingAliases.add(`${row.alias_id}|${row.canonical_id}`);
  }
  
  // Get already-processed pairs (merged/skipped/never)
  const processedPairs = new Set<string>();
  const similarityRows = db.query(`
    SELECT entity_a, entity_b FROM entity_similarities WHERE status IN ('merged', 'skipped', 'never')
  `).all() as { entity_a: string; entity_b: string }[];
  for (const row of similarityRows) {
    processedPairs.add(`${row.entity_a}|${row.entity_b}`);
    processedPairs.add(`${row.entity_b}|${row.entity_a}`);
  }
  
  const total = entities.length * (entities.length - 1) / 2;
  let checked = 0;
  
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      checked++;
      if (checked % 1000 === 0) {
        process.stdout.write(`\r  Comparing pairs... ${checked}/${total}`);
      }
      
      const pairKey = `${entities[i].id}|${entities[j].id}`;
      
      // Skip if already merged or processed
      if (existingAliases.has(pairKey) || processedPairs.has(pairKey)) {
        continue;
      }
      
      const similarity = cosineSimilarity(embeddings[i], embeddings[j]);
      
      if (similarity >= threshold) {
        pairs.push({
          entityA: entities[i].id,
          titleA: entities[i].title,
          entityB: entities[j].id,
          titleB: entities[j].title,
          similarity,
        });
        
        // Cache the similarity
        db.query(`
          INSERT OR REPLACE INTO entity_similarities (entity_a, entity_b, similarity, status)
          VALUES (?, ?, ?, 'pending')
        `).run(entities[i].id, entities[j].id, similarity);
      }
    }
  }
  
  console.log(''); // New line after progress
  
  return pairs.sort((a, b) => b.similarity - a.similarity);
}

// =============================================================================
// INTERACTIVE MODE
// =============================================================================

async function interactiveReview(pairs: SimilarityPair[]): Promise<void> {
  const db = getDB();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };
  
  console.log('\n🔍 Interactive Review Mode\n');
  console.log('Options: [M]erge / [S]kip / [N]ever show again / [Q]uit\n');
  
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    console.log(`─────────────────────────────────────────`);
    console.log(`${i + 1}/${pairs.length} | Similarity: ${(pair.similarity * 100).toFixed(1)}%`);
    console.log(`  A: "${pair.titleA}" (${pair.entityA})`);
    console.log(`  B: "${pair.titleB}" (${pair.entityB})`);
    
    const answer = await question('  → ');
    const cmd = answer.toLowerCase().trim();
    
    if (cmd === 'm' || cmd === 'merge') {
      // Save to entity_aliases (A is canonical, B is alias)
      db.query(`
        INSERT OR REPLACE INTO entity_aliases (canonical_id, alias_id, alias_type, confidence)
        VALUES (?, ?, 'manual', ?)
      `).run(pair.entityA, pair.entityB, pair.similarity);
      
      db.query(`
        UPDATE entity_similarities SET status = 'merged'
        WHERE (entity_a = ? AND entity_b = ?) OR (entity_a = ? AND entity_b = ?)
      `).run(pair.entityA, pair.entityB, pair.entityB, pair.entityA);
      
      console.log(`  ✓ Merged: ${pair.entityB} → ${pair.entityA}\n`);
      
    } else if (cmd === 's' || cmd === 'skip') {
      db.query(`
        UPDATE entity_similarities SET status = 'skipped'
        WHERE (entity_a = ? AND entity_b = ?) OR (entity_a = ? AND entity_b = ?)
      `).run(pair.entityA, pair.entityB, pair.entityB, pair.entityA);
      console.log(`  ○ Skipped\n`);
      
    } else if (cmd === 'n' || cmd === 'never') {
      db.query(`
        UPDATE entity_similarities SET status = 'never'
        WHERE (entity_a = ? AND entity_b = ?) OR (entity_a = ? AND entity_b = ?)
      `).run(pair.entityA, pair.entityB, pair.entityB, pair.entityA);
      console.log(`  ✗ Will not show again\n`);
      
    } else if (cmd === 'q' || cmd === 'quit') {
      console.log('\nExiting review mode.\n');
      break;
    } else {
      console.log(`  ? Unknown command, skipping\n`);
    }
  }
  
  rl.close();
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  let threshold = 0.8;
  let interactive = false;
  let exportFile = false;
  let jsonOutput = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--threshold' || args[i] === '-t') {
      threshold = parseFloat(args[i + 1]) || 0.8;
      i++;
    } else if (args[i] === '--interactive' || args[i] === '-i') {
      interactive = true;
    } else if (args[i] === '--export' || args[i] === '-e') {
      exportFile = true;
    } else if (args[i] === '--json' || args[i] === '-j') {
      jsonOutput = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  
  // Check OpenAI availability (supports env, runtime keys, or proxy)
  if (!isOpenAIAvailable()) {
    console.error('❌ OpenAI not available - configure API key or proxy');
    process.exit(1);
  }
  
  // Init DB
  initDB(config.dbPath);
  
  console.log(`
🔍 Finding Duplicate Entities
${'═'.repeat(50)}
`);
  
  // Get entities
  const entities = getAllEntities();
  console.log(`📦 Found ${entities.length} entities`);
  
  if (entities.length < 2) {
    console.log('Not enough entities to compare.');
    return;
  }
  
  // Compute embeddings
  console.log('\n🧮 Computing embeddings (using text-embedding-3-small)...');
  const texts = entities.map(entityToText);
  const embeddings = await computeEmbeddings(texts);
  
  // Find similar pairs
  console.log(`\n🔎 Finding similar pairs (threshold: ${threshold})...`);
  const pairs = findSimilarPairs(entities, embeddings, threshold);
  
  console.log(`\n✨ Found ${pairs.length} potential duplicates\n`);
  
  if (pairs.length === 0) {
    console.log('No duplicates found above threshold.');
    return;
  }
  
  // Output results
  const result: DuplicateResult = {
    pairs,
    threshold,
    totalEntities: entities.length,
    computedAt: new Date().toISOString(),
  };
  
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!interactive) {
    // Pretty print
    console.log('🎯 Potential Duplicates:\n');
    for (let i = 0; i < Math.min(pairs.length, 20); i++) {
      const pair = pairs[i];
      console.log(`${i + 1}. Similarity: ${(pair.similarity * 100).toFixed(1)}%`);
      console.log(`   A: "${pair.titleA}" (${pair.entityA})`);
      console.log(`   B: "${pair.titleB}" (${pair.entityB})`);
      console.log('');
    }
    
    if (pairs.length > 20) {
      console.log(`... and ${pairs.length - 20} more. Use --export to see all.\n`);
    }
  }
  
  // Export to file
  if (exportFile) {
    const filename = `duplicates-${new Date().toISOString().split('T')[0]}.csv`;
    const csv = [
      'entity_a,title_a,entity_b,title_b,similarity',
      ...pairs.map(p => `"${p.entityA}","${p.titleA}","${p.entityB}","${p.titleB}",${p.similarity.toFixed(4)}`)
    ].join('\n');
    fs.writeFileSync(filename, csv);
    console.log(`📁 Exported: ./${filename}`);
  }
  
  // Interactive mode
  if (interactive) {
    await interactiveReview(pairs);
  } else if (pairs.length > 0) {
    console.log('💡 Tip: Use --interactive to review and merge duplicates one by one');
  }
}

function printHelp() {
  console.log(`
🔍 Find Duplicates - Detect similar entities using embeddings

Usage:
  npm run find-duplicates                      Find duplicates (threshold: 0.8)
  npm run find-duplicates --threshold 0.85    Custom similarity threshold
  npm run find-duplicates --interactive       Review and merge interactively
  npm run find-duplicates --export            Export results to CSV

Options:
  -t, --threshold <0.0-1.0>    Similarity threshold (default: 0.8)
  -i, --interactive            Interactive review mode
  -e, --export                 Export to CSV file
  -j, --json                   Output as JSON
  -h, --help                   Show this help

Environment:
  OPENAI_API_KEY               Required for embedding computation
`);
}

main().catch(console.error);

