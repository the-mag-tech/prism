/**
 * Search Logger - Quality tracking for search operations
 * 
 * Provides logging utilities for search_logs and negative_samples tables.
 * Designed for empirical analysis and optimization.
 * 
 * Usage:
 * ```typescript
 * import { SearchLogger } from './search-logger.js';
 * 
 * // Start a search log
 * const logger = new SearchLogger({ trigger: 'ripple', entityId: 'person:simon' });
 * 
 * // Record results
 * logger.recordResults(response);
 * 
 * // Record negative samples (skipped results)
 * logger.recordSkipped(url, title, content, 'low_surprise', 0.3, query);
 * 
 * // Finalize with metrics
 * logger.finalize({ ingestedCount: 2, avgSurpriseScore: 0.7 });
 * ```
 * 
 * @since 2026-01-08
 */

import { getDB } from '../db.js';
import { log, logError } from './logger.js';

// =============================================================================
// TYPES
// =============================================================================

export type SearchTrigger = 'ripple' | 'scout' | 'mcp' | 'explore' | 'manual';
export type SkipReason = 'low_surprise' | 'duplicate' | 'user_reject' | 'domain_blocklist' | 'error';

export interface SearchContext {
  trigger: SearchTrigger;
  entityId?: string;
  sessionId?: string;
}

export interface SearchLogMetrics {
  ingestedCount?: number;
  skippedCount?: number;
  avgSurpriseScore?: number;
  qualityScore?: number;
  diversityScore?: number;
  relevanceScore?: number;
  feedback?: string;
}

// =============================================================================
// SEARCH LOGGER
// =============================================================================

export class SearchLogger {
  private logId: number | null = null;
  private context: SearchContext;
  private startTime: number;

  constructor(context: SearchContext) {
    this.context = context;
    this.startTime = Date.now();
  }

  /**
   * Record the search response (creates the search_logs entry)
   */
  recordResults(
    query: string,
    provider: 'tavily' | 'qveris' | 'none',
    resultsCount: number,
    latencyMs: number
  ): number {
    try {
      const db = getDB();
      const result = db.query(`
        INSERT INTO search_logs (
          query, provider, trigger, results_count, latency_ms,
          entity_id, session_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        RETURNING id
      `).get(
        query,
        provider,
        this.context.trigger,
        resultsCount,
        latencyMs,
        this.context.entityId || null,
        this.context.sessionId || null
      ) as { id: number };

      this.logId = result.id;
      log(`[SearchLogger] Created log #${this.logId}: "${query}" (${resultsCount} results)`);
      return this.logId;
    } catch (error) {
      logError('[SearchLogger] Failed to record results:', error);
      return -1;
    }
  }

  /**
   * Record a skipped/filtered result (negative sample)
   */
  recordSkipped(
    url: string,
    title: string | undefined,
    contentPreview: string | undefined,
    reason: SkipReason,
    surpriseScore: number | undefined,
    query: string
  ): void {
    try {
      const db = getDB();
      const domain = extractDomain(url);

      // Upsert: if URL exists, increment occurrence_count
      db.query(`
        INSERT INTO negative_samples (
          url, domain, title, content_preview,
          skip_reason, surprise_score, query,
          entity_id, search_log_id,
          occurrence_count, first_seen, last_seen
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT(url) DO UPDATE SET
          occurrence_count = occurrence_count + 1,
          last_seen = datetime('now'),
          skip_reason = excluded.skip_reason,
          surprise_score = COALESCE(excluded.surprise_score, surprise_score)
      `).run(
        url,
        domain,
        title || null,
        contentPreview?.substring(0, 500) || null,
        reason,
        surpriseScore ?? null,
        query,
        this.context.entityId || null,
        this.logId
      );

      log(`[SearchLogger] Recorded negative sample: ${domain} (${reason})`);
    } catch (error) {
      logError('[SearchLogger] Failed to record negative sample:', error);
    }
  }

  /**
   * Finalize the search log with metrics
   */
  finalize(metrics: SearchLogMetrics): void {
    if (!this.logId) {
      logError('[SearchLogger] Cannot finalize - no log ID');
      return;
    }

    try {
      const db = getDB();
      db.query(`
        UPDATE search_logs SET
          ingested_count = COALESCE(?, ingested_count),
          skipped_count = COALESCE(?, skipped_count),
          avg_surprise_score = COALESCE(?, avg_surprise_score),
          quality_score = COALESCE(?, quality_score),
          diversity_score = COALESCE(?, diversity_score),
          relevance_score = COALESCE(?, relevance_score),
          feedback = COALESCE(?, feedback)
        WHERE id = ?
      `).run(
        metrics.ingestedCount ?? null,
        metrics.skippedCount ?? null,
        metrics.avgSurpriseScore ?? null,
        metrics.qualityScore ?? null,
        metrics.diversityScore ?? null,
        metrics.relevanceScore ?? null,
        metrics.feedback ?? null,
        this.logId
      );

      const duration = Date.now() - this.startTime;
      log(`[SearchLogger] Finalized log #${this.logId} (${duration}ms)`);
    } catch (error) {
      logError('[SearchLogger] Failed to finalize:', error);
    }
  }

  /**
   * Get the log ID (for linking negative samples)
   */
  getLogId(): number | null {
    return this.logId;
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    // Fallback: try to extract from string
    const match = url.match(/^(?:https?:\/\/)?([^\/]+)/);
    return match?.[1] || 'unknown';
  }
}

// =============================================================================
// STATIC QUERY HELPERS
// =============================================================================

/**
 * Get search statistics
 */
export function getSearchStats(days: number = 7): {
  totalSearches: number;
  byProvider: Record<string, number>;
  byTrigger: Record<string, number>;
  avgLatency: number;
  avgIngestRate: number;
} {
  const db = getDB();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const total = db.query(`
    SELECT COUNT(*) as count FROM search_logs WHERE created_at >= ?
  `).get(since) as { count: number };

  const byProvider = db.query(`
    SELECT provider, COUNT(*) as count 
    FROM search_logs WHERE created_at >= ?
    GROUP BY provider
  `).all(since) as Array<{ provider: string; count: number }>;

  const byTrigger = db.query(`
    SELECT trigger, COUNT(*) as count 
    FROM search_logs WHERE created_at >= ?
    GROUP BY trigger
  `).all(since) as Array<{ trigger: string; count: number }>;

  const avgMetrics = db.query(`
    SELECT 
      AVG(latency_ms) as avg_latency,
      AVG(CAST(ingested_count AS REAL) / NULLIF(results_count, 0)) as avg_ingest_rate
    FROM search_logs WHERE created_at >= ?
  `).get(since) as { avg_latency: number | null; avg_ingest_rate: number | null };

  return {
    totalSearches: total.count,
    byProvider: Object.fromEntries(byProvider.map(r => [r.provider || 'unknown', r.count])),
    byTrigger: Object.fromEntries(byTrigger.map(r => [r.trigger || 'unknown', r.count])),
    avgLatency: avgMetrics.avg_latency ?? 0,
    avgIngestRate: avgMetrics.avg_ingest_rate ?? 0,
  };
}

/**
 * Get top negative sample domains
 */
export function getTopNegativeDomains(limit: number = 20): Array<{
  domain: string;
  count: number;
  avgScore: number | null;
}> {
  const db = getDB();
  const rows = db.query(`
    SELECT 
      domain,
      SUM(occurrence_count) as count,
      AVG(surprise_score) as avg_score
    FROM negative_samples
    GROUP BY domain
    ORDER BY count DESC
    LIMIT ?
  `).all(limit) as Array<{ domain: string; count: number; avg_score: number | null }>;
  
  // Map snake_case to camelCase
  return rows.map(row => ({
    domain: row.domain,
    count: row.count,
    avgScore: row.avg_score,
  }));
}

/**
 * Get surprise score distribution for threshold analysis
 */
export function getSurpriseDistribution(): Array<{
  bucket: string;
  count: number;
}> {
  const db = getDB();
  return db.query(`
    SELECT 
      CASE 
        WHEN surprise_score < 0.2 THEN '0.0-0.2'
        WHEN surprise_score < 0.4 THEN '0.2-0.4'
        WHEN surprise_score < 0.6 THEN '0.4-0.6'
        WHEN surprise_score < 0.8 THEN '0.6-0.8'
        ELSE '0.8-1.0'
      END as bucket,
      COUNT(*) as count
    FROM negative_samples
    WHERE surprise_score IS NOT NULL
    GROUP BY bucket
    ORDER BY bucket
  `).all() as Array<{ bucket: string; count: number }>;
}
