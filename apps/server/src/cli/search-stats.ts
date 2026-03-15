#!/usr/bin/env bun
/**
 * Search Stats CLI
 * 
 * Analyze search quality logs for empirical optimization.
 * 
 * Usage:
 *   bun run src/cli/search-stats.ts [command] [options]
 * 
 * Commands:
 *   overview    - Overall search statistics (default)
 *   domains     - Top negative sample domains
 *   surprise    - Surprise score distribution
 *   recent      - Recent search logs
 * 
 * Options:
 *   --days=N    - Look back N days (default: 7)
 *   --limit=N   - Limit results (default: 20)
 *   --json      - Output as JSON
 * 
 * @since 2026-01-08
 */

import { initDB, getDB } from '../db.js';
import { getSearchStats, getTopNegativeDomains, getSurpriseDistribution } from '../lib/search-logger.js';

// =============================================================================
// CLI PARSING
// =============================================================================

const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith('--')) || 'overview';
const flags = Object.fromEntries(
  args
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, value] = a.slice(2).split('=');
      return [key, value ?? 'true'];
    })
);

const days = parseInt(flags.days || '7', 10);
const limit = parseInt(flags.limit || '20', 10);
const jsonOutput = flags.json === 'true';

// =============================================================================
// INITIALIZE DATABASE
// =============================================================================

const dbPath = process.env.DB_PATH || `${process.env.HOME}/Library/Application Support/com.magpie.desktop/prism.db`;
console.error(`[SearchStats] Using database: ${dbPath}`);
initDB(dbPath);

// =============================================================================
// COMMANDS
// =============================================================================

function runOverview(): void {
  const stats = getSearchStats(days);
  
  if (jsonOutput) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log('\n📊 Search Statistics (last ' + days + ' days)\n');
  console.log('─'.repeat(50));
  console.log(`Total Searches: ${stats.totalSearches}`);
  console.log(`Avg Latency: ${stats.avgLatency.toFixed(0)}ms`);
  console.log(`Avg Ingest Rate: ${(stats.avgIngestRate * 100).toFixed(1)}%`);
  
  console.log('\nBy Provider:');
  for (const [provider, count] of Object.entries(stats.byProvider)) {
    const pct = stats.totalSearches > 0 ? ((count / stats.totalSearches) * 100).toFixed(1) : '0';
    console.log(`  ${provider.padEnd(10)} ${count.toString().padStart(5)} (${pct}%)`);
  }
  
  console.log('\nBy Trigger:');
  for (const [trigger, count] of Object.entries(stats.byTrigger)) {
    const pct = stats.totalSearches > 0 ? ((count / stats.totalSearches) * 100).toFixed(1) : '0';
    console.log(`  ${trigger.padEnd(10)} ${count.toString().padStart(5)} (${pct}%)`);
  }
  console.log('');
}

function runDomains(): void {
  const domains = getTopNegativeDomains(limit);
  
  if (jsonOutput) {
    console.log(JSON.stringify(domains, null, 2));
    return;
  }

  console.log('\n🚫 Top Negative Sample Domains\n');
  console.log('─'.repeat(60));
  console.log('Domain'.padEnd(35) + 'Count'.padStart(8) + 'Avg Score'.padStart(12));
  console.log('─'.repeat(60));
  
  for (const d of domains) {
    const score = d.avgScore != null ? d.avgScore.toFixed(2) : 'N/A';
    console.log(`${d.domain.substring(0, 34).padEnd(35)}${d.count.toString().padStart(8)}${score.padStart(12)}`);
  }
  console.log('');
}

function runSurprise(): void {
  const distribution = getSurpriseDistribution();
  
  if (jsonOutput) {
    console.log(JSON.stringify(distribution, null, 2));
    return;
  }

  console.log('\n📈 Surprise Score Distribution (Negative Samples)\n');
  console.log('─'.repeat(40));
  
  const total = distribution.reduce((sum, d) => sum + d.count, 0);
  const maxCount = Math.max(...distribution.map(d => d.count), 1);
  
  for (const d of distribution) {
    const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : '0';
    const barLen = Math.round((d.count / maxCount) * 20);
    const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
    console.log(`${d.bucket.padEnd(10)} ${bar} ${d.count.toString().padStart(5)} (${pct}%)`);
  }
  
  console.log('\n💡 Insight: Most negative samples should be in 0.0-0.4 range.');
  console.log('   If many are in 0.4-0.6, consider lowering minSurpriseThreshold.\n');
}

function runRecent(): void {
  const db = getDB();
  const logs = db.query(`
    SELECT 
      id,
      query,
      provider,
      trigger,
      results_count,
      ingested_count,
      skipped_count,
      avg_surprise_score,
      latency_ms,
      entity_id,
      created_at
    FROM search_logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    query: string;
    provider: string;
    trigger: string;
    results_count: number;
    ingested_count: number;
    skipped_count: number;
    avg_surprise_score: number | null;
    latency_ms: number;
    entity_id: string | null;
    created_at: string;
  }>;

  if (jsonOutput) {
    console.log(JSON.stringify(logs, null, 2));
    return;
  }

  console.log('\n📜 Recent Search Logs\n');
  console.log('─'.repeat(100));
  
  for (const log of logs) {
    const query = log.query.length > 40 ? log.query.substring(0, 37) + '...' : log.query;
    const surprise = log.avg_surprise_score !== null ? log.avg_surprise_score.toFixed(2) : 'N/A';
    const entity = log.entity_id ? log.entity_id.substring(0, 20) : '-';
    
    console.log(`#${log.id.toString().padEnd(4)} [${log.trigger?.padEnd(7) || 'unknown'}] ${query.padEnd(42)}`);
    console.log(`      Provider: ${log.provider || 'N/A'} | Results: ${log.results_count} | Ingested: ${log.ingested_count}/${log.skipped_count + log.ingested_count} | Surprise: ${surprise}`);
    console.log(`      Entity: ${entity} | Latency: ${log.latency_ms}ms | ${log.created_at}`);
    console.log('');
  }
}

// =============================================================================
// MAIN
// =============================================================================

try {
  switch (command) {
    case 'overview':
      runOverview();
      break;
    case 'domains':
      runDomains();
      break;
    case 'surprise':
      runSurprise();
      break;
    case 'recent':
      runRecent();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('\nUsage: bun run src/cli/search-stats.ts [overview|domains|surprise|recent] [--days=N] [--limit=N] [--json]');
      process.exit(1);
  }
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
