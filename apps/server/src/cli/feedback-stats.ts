/**
 * Feedback Stats CLI - 分析用户反馈数据
 * 
 * 手动挡工具：分析 memory_interactions 表，发现模式
 * 
 * Usage:
 *   npm run feedback-stats
 *   npm run feedback-stats --days 30
 *   npm run feedback-stats --json
 */

import { initDB, getDB } from '../db.js';
import { config } from '../config.js';
import fs from 'fs';

// =============================================================================
// TYPES
// =============================================================================

interface InteractionRow {
  id: number;
  memory_id: number;
  session_id: string | null;
  query: string | null;
  action: string;
  duration_ms: number | null;
  created_at: string;
}

interface MemoryRow {
  id: number;
  title: string | null;
  source_path: string;
  content: string;
}

interface ClickStats {
  memoryId: number;
  title: string | null;
  clickCount: number;
  copyCount: number;
  avgDwellMs: number | null;
}

interface QueryPattern {
  query: string;
  clickedMemories: number[];
  clickThroughRate: number;
}

interface FeedbackReport {
  period: { days: number; startDate: string; endDate: string };
  totalInteractions: number;
  byAction: Record<string, number>;
  topClickedMemories: ClickStats[];
  topCopiedMemories: ClickStats[];
  queryPatterns: QueryPattern[];
  insights: string[];
  generatedAt: string;
}

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

function getInteractions(days: number): InteractionRow[] {
  const db = getDB();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return db.query(`
    SELECT id, memory_id, session_id, query, action, duration_ms, created_at
    FROM memory_interactions
    WHERE created_at >= ?
    ORDER BY created_at DESC
  `).all(startDate.toISOString()) as InteractionRow[];
}

function getMemory(memoryId: number): MemoryRow | null {
  const db = getDB();
  return db.query(`
    SELECT id, title, source_path, content
    FROM memories
    WHERE id = ?
  `).get(memoryId) as MemoryRow | null;
}

function analyzeByAction(interactions: InteractionRow[]): Record<string, number> {
  const byAction: Record<string, number> = {};
  for (const i of interactions) {
    byAction[i.action] = (byAction[i.action] || 0) + 1;
  }
  return byAction;
}

function analyzeTopMemories(interactions: InteractionRow[]): ClickStats[] {
  const memoryStats = new Map<number, { clicks: number; copies: number; dwells: number[]; title: string | null }>();
  
  for (const i of interactions) {
    if (!memoryStats.has(i.memory_id)) {
      const mem = getMemory(i.memory_id);
      memoryStats.set(i.memory_id, { clicks: 0, copies: 0, dwells: [], title: mem?.title || null });
    }
    
    const stats = memoryStats.get(i.memory_id)!;
    if (i.action === 'clicked') stats.clicks++;
    if (i.action === 'copied') stats.copies++;
    if (i.action === 'dwelled' && i.duration_ms) stats.dwells.push(i.duration_ms);
  }
  
  return Array.from(memoryStats.entries())
    .map(([memoryId, stats]) => ({
      memoryId,
      title: stats.title,
      clickCount: stats.clicks,
      copyCount: stats.copies,
      avgDwellMs: stats.dwells.length > 0 
        ? Math.round(stats.dwells.reduce((a, b) => a + b, 0) / stats.dwells.length)
        : null,
    }))
    .sort((a, b) => (b.clickCount + b.copyCount * 2) - (a.clickCount + a.copyCount * 2));
}

function analyzeQueryPatterns(interactions: InteractionRow[]): QueryPattern[] {
  // Group by session to understand search → click patterns
  const sessionQueries = new Map<string, { query: string; displayed: number[]; clicked: number[] }>();
  
  for (const i of interactions) {
    if (!i.session_id || !i.query) continue;
    
    if (!sessionQueries.has(i.session_id)) {
      sessionQueries.set(i.session_id, { query: i.query, displayed: [], clicked: [] });
    }
    
    const session = sessionQueries.get(i.session_id)!;
    if (i.action === 'displayed') session.displayed.push(i.memory_id);
    if (i.action === 'clicked') session.clicked.push(i.memory_id);
  }
  
  // Aggregate by query
  const queryStats = new Map<string, { displayed: number; clicked: number; clickedMemories: Set<number> }>();
  
  for (const [, session] of sessionQueries) {
    const normalizedQuery = session.query.toLowerCase().trim();
    if (!queryStats.has(normalizedQuery)) {
      queryStats.set(normalizedQuery, { displayed: 0, clicked: 0, clickedMemories: new Set() });
    }
    
    const stats = queryStats.get(normalizedQuery)!;
    stats.displayed += session.displayed.length;
    stats.clicked += session.clicked.length;
    session.clicked.forEach(id => stats.clickedMemories.add(id));
  }
  
  return Array.from(queryStats.entries())
    .map(([query, stats]) => ({
      query,
      clickedMemories: Array.from(stats.clickedMemories),
      clickThroughRate: stats.displayed > 0 ? stats.clicked / stats.displayed : 0,
    }))
    .filter(p => p.clickedMemories.length > 0)
    .sort((a, b) => b.clickedMemories.length - a.clickedMemories.length)
    .slice(0, 10);
}

function generateInsights(
  interactions: InteractionRow[],
  topMemories: ClickStats[],
  queryPatterns: QueryPattern[]
): string[] {
  const insights: string[] = [];
  
  // High engagement memories
  const highEngagement = topMemories.filter(m => m.clickCount >= 5 || m.copyCount >= 2);
  if (highEngagement.length > 0) {
    insights.push(`🔥 ${highEngagement.length} 个记忆碎片有高参与度，考虑提升其搜索权重`);
  }
  
  // Low click-through queries
  const lowCTR = queryPatterns.filter(p => p.clickThroughRate < 0.2 && p.clickedMemories.length > 0);
  if (lowCTR.length > 0) {
    insights.push(`⚠️ ${lowCTR.length} 个搜索词的点击率较低，可能需要优化搜索结果排序`);
  }
  
  // Scattered results (same query hits many different memories)
  const scatteredQueries = queryPatterns.filter(p => p.clickedMemories.length >= 3);
  if (scatteredQueries.length > 0) {
    const example = scatteredQueries[0];
    insights.push(`🔍 "${example.query}" 搜索结果分散到 ${example.clickedMemories.length} 个不同碎片，可能需要实体去重`);
  }
  
  // Copy-heavy memories (high value content)
  const copyHeavy = topMemories.filter(m => m.copyCount >= 2);
  if (copyHeavy.length > 0) {
    insights.push(`📋 ${copyHeavy.length} 个记忆碎片被频繁复制，这些是高价值内容`);
  }
  
  if (insights.length === 0) {
    insights.push('📊 数据量不足，继续使用以积累更多反馈数据');
  }
  
  return insights;
}

function generateReport(days: number): FeedbackReport {
  const interactions = getInteractions(days);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const byAction = analyzeByAction(interactions);
  const topMemories = analyzeTopMemories(interactions);
  const queryPatterns = analyzeQueryPatterns(interactions);
  const insights = generateInsights(interactions, topMemories, queryPatterns);
  
  return {
    period: {
      days,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    },
    totalInteractions: interactions.length,
    byAction,
    topClickedMemories: topMemories.filter(m => m.clickCount > 0).slice(0, 10),
    topCopiedMemories: topMemories.filter(m => m.copyCount > 0).slice(0, 5),
    queryPatterns,
    insights,
    generatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// PRETTY PRINT
// =============================================================================

function printReport(report: FeedbackReport) {
  console.log(`
📊 Feedback Analysis Report
${'═'.repeat(50)}

📅 Period: Last ${report.period.days} days (${report.period.startDate} ~ ${report.period.endDate})
📈 Total Interactions: ${report.totalInteractions}
`);

  // By Action
  console.log('📌 By Action Type:');
  for (const [action, count] of Object.entries(report.byAction)) {
    console.log(`   ${action}: ${count}`);
  }
  console.log('');

  // Top Clicked
  if (report.topClickedMemories.length > 0) {
    console.log('🔥 Most Clicked Memories:');
    for (const m of report.topClickedMemories.slice(0, 5)) {
      const title = m.title || `(memory #${m.memoryId})`;
      console.log(`   [${m.clickCount} clicks] ${title}`);
    }
    console.log('');
  }

  // Top Copied
  if (report.topCopiedMemories.length > 0) {
    console.log('📋 Most Copied Memories:');
    for (const m of report.topCopiedMemories) {
      const title = m.title || `(memory #${m.memoryId})`;
      console.log(`   [${m.copyCount} copies] ${title}`);
    }
    console.log('');
  }

  // Query Patterns
  if (report.queryPatterns.length > 0) {
    console.log('🔍 Search → Click Patterns:');
    for (const p of report.queryPatterns.slice(0, 5)) {
      const ctr = (p.clickThroughRate * 100).toFixed(0);
      console.log(`   "${p.query}" → ${p.clickedMemories.length} memories (${ctr}% CTR)`);
    }
    console.log('');
  }

  // Insights
  console.log('💡 Insights:');
  for (const insight of report.insights) {
    console.log(`   ${insight}`);
  }
  console.log('');
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  
  let days = 30;
  let jsonOutput = false;
  let exportFile = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' || args[i] === '-d') {
      days = parseInt(args[i + 1]) || 30;
      i++;
    } else if (args[i] === '--json' || args[i] === '-j') {
      jsonOutput = true;
    } else if (args[i] === '--export' || args[i] === '-e') {
      exportFile = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  
  // Init DB
  initDB(config.dbPath);
  
  // Generate report
  const report = generateReport(days);
  
  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
  
  // Export to file
  if (exportFile) {
    const filename = `feedback-report-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(`📁 Exported: ./${filename}`);
  }
}

function printHelp() {
  console.log(`
📊 Feedback Stats - Analyze user feedback data

Usage:
  npm run feedback-stats                   Analyze last 30 days
  npm run feedback-stats --days 7          Analyze last 7 days
  npm run feedback-stats --json            Output as JSON
  npm run feedback-stats --export          Export report to file

Options:
  -d, --days <number>    Analysis period in days (default: 30)
  -j, --json             Output as JSON
  -e, --export           Export to JSON file
  -h, --help             Show this help
`);
}

main();




