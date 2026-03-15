/**
 * Recall CLI - "Thought Tracing" from command line
 * 
 * Usage: npm run recall "为什么选择 SQLite"
 */

import { initDB } from '../db.js';
import { config } from '../config.js';
import { recall, listMemories } from '../recall.js';

function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let query = '';
  let limit = 10;
  let listAll = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' || args[i] === '-n') {
      limit = parseInt(args[i + 1]) || 10;
      i++;
    } else if (args[i] === '--list' || args[i] === '-l') {
      listAll = true;
    } else if (args[i] === '--json' || args[i] === '-j') {
      jsonOutput = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    } else if (!args[i].startsWith('-')) {
      query = args[i];
    }
  }

  // Init DB
  initDB(config.dbPath);

  // List all memories
  if (listAll) {
    const memories = listMemories(limit);
    
    if (jsonOutput) {
      console.log(JSON.stringify(memories, null, 2));
    } else {
      console.log(`\n📚 All Memories (${memories.length} shown)\n`);
      console.log('─'.repeat(60));
      
      for (const m of memories) {
        printMemory(m);
      }
    }
    return;
  }

  // Query required for recall
  if (!query) {
    console.error('❌ Please provide a search query.');
    console.error('');
    printHelp();
    process.exit(1);
  }

  // Run recall
  const result = recall(query, limit);

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Pretty print results
  console.log(`\n🔍 Recall: "${query}"\n`);
  console.log('─'.repeat(60));

  if (result.results.length === 0) {
    console.log('No memories found matching your query.');
    console.log('');
    console.log('Tips:');
    console.log('  - Try different keywords');
    console.log('  - Use "npm run recall --list" to see all memories');
    console.log('  - Ingest more files with "npm run ingest --type markdown --file <path>"');
    return;
  }

  console.log(`Found ${result.totalCount} memory fragments:\n`);

  for (const r of result.results) {
    printMemory(r);
  }

  // Print timeline
  if (result.timeline.length > 0) {
    console.log('─'.repeat(60));
    console.log(`📅 Timeline: ${result.timeline.join(' → ')}`);
  }
}

function printMemory(m: { id: number; sourcePath: string; sourceType: string; title: string | null; snippet: string; createdAt: string | null; relevance: number }) {
  const title = m.title || 'Untitled';
  const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : 'Unknown date';
  const typeIcon = m.sourceType === 'markdown' ? '📝' : '📄';
  
  console.log(`${typeIcon} [${date}] ${title}`);
  console.log(`   📁 ${m.sourcePath}`);
  console.log(`   ${m.snippet.replace(/\n/g, '\n   ')}`);
  console.log('');
}

function printHelp() {
  console.log(`
🧠 Recall - Find your thought traces

Usage:
  npm run recall "<query>"              Search memories
  npm run recall --list                 List all memories
  
Options:
  -n, --limit <number>    Max results (default: 10)
  -l, --list              List all memories without searching
  -j, --json              Output as JSON
  -h, --help              Show this help

Examples:
  npm run recall "为什么选择 SQLite"
  npm run recall "project decision" --limit 5
  npm run recall --list --json
`);
}

main();

