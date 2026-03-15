/**
 * Prism Search CLI - Unified Entity Search
 * 
 * Usage: npm run search "knowledge graph" --types=finding,entity --limit=10
 */

import '../config.js';  // Load env
import { initDB } from '../db.js';
import { config } from '../config.js';
import { searchEntities, EntitySearchResult } from '../recommend.js';

function main() {
    const args = process.argv.slice(2);

    // Parse arguments
    let query = '';
    let types: string[] = ['entity', 'finding', 'memory', 'public'];
    let limit = 20;
    let sort: 'gravity' | 'relevance' | 'created_at' | 'title' = 'relevance';
    let jsonOutput = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--types' || args[i] === '-t') {
            types = (args[i + 1] || '').split(',').map(t => t.trim());
            i++;
        } else if (args[i] === '--limit' || args[i] === '-n') {
            limit = parseInt(args[i + 1]) || 20;
            i++;
        } else if (args[i] === '--sort' || args[i] === '-s') {
            sort = args[i + 1] as any || 'relevance';
            i++;
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

    // Run search
    const result = searchEntities({
        q: query || undefined,
        types,
        limit,
        sort: query ? 'relevance' : sort,
    });

    if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    // Pretty print results
    const searchType = query ? `🔍 Search: "${query}"` : '📋 Browse';
    console.log(`\n${searchType} (types: ${types.join(', ')})\n`);
    console.log('─'.repeat(70));

    if (result.results.length === 0) {
        console.log('No entities found.');
        console.log('');
        console.log('Tips:');
        console.log('  - Try different keywords');
        console.log('  - Use --types=finding to search Scout discoveries');
        console.log('  - Ingest content with "prism ingest <url>"');
        return;
    }

    console.log(`Found ${result.meta.total} entities (showing ${result.meta.returned}) in ${result.meta.query_ms}ms\n`);

    for (const r of result.results) {
        printEntity(r);
    }

    console.log('─'.repeat(70));
    console.log(`📊 Sort: ${sort} | Query: ${result.meta.query_ms}ms`);
}

function printEntity(e: EntitySearchResult) {
    const typeIcon: Record<string, string> = {
        person: '👤',
        company: '🏢',
        topic: '🏷️',
        event: '📅',
        finding: '🔎',
        memory: '📝',
        public: '🌐',
        insight: '💡',
        problem: '🔥',
        project: '📦',
    };

    const icon = typeIcon[e.type] || '📄';
    const gravity = e.gravity.toFixed(2);
    const relevance = e.relevance !== undefined ? ` rel=${e.relevance.toFixed(2)}` : '';
    const date = e.created_at ? new Date(e.created_at).toLocaleDateString() : '';

    console.log(`${icon} [${e.type}] ${e.title}`);
    console.log(`   ID: ${e.id} | G=${gravity}${relevance}${date ? ` | ${date}` : ''}`);
    if (e.subtitle) {
        console.log(`   ${e.subtitle}`);
    }
    if (e.body) {
        const snippet = e.body.length > 100 ? e.body.substring(0, 100) + '...' : e.body;
        console.log(`   ${snippet.replace(/\n/g, ' ')}`);
    }
    console.log('');
}

function printHelp() {
    console.log(`
🔍 Prism Search - Unified Entity Search

Usage:
  prism search "<query>"              Text search (FTS)
  prism search --types=finding        Browse by type
  
Options:
  -t, --types <list>      Entity types (default: all)
                          Options: entity,finding,memory,public
  -n, --limit <number>    Max results (default: 20)
  -s, --sort <field>      Sort by: gravity, relevance, created_at, title
  -j, --json              Output as JSON
  -h, --help              Show this help

Examples:
  prism search "knowledge graph" --types=finding --limit=10
  prism search --types=entity --sort=gravity
  prism search "semantic" --json
`);
}

main();
