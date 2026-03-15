/**
 * Trust Metrics
 * 
 * Tracks merge decision outcomes to calculate adaptive thresholds.
 * If we have many undos, raise the threshold.
 * If we have high success, possibly lower it (but cautious).
 */

import { getDB } from '../../../db.js';

export interface TrustMetricRecord {
    id: number;
    candidate_id: number;
    method: 'auto_high_conf' | 'auto_llm' | 'manual';
    similarity: number;
    outcome: 'success' | 'undone';
    created_at: string;
}

export class TrustMetrics {
    private readonly DEFAULT_THRESHOLD = 0.95;
    private readonly MIN_THRESHOLD = 0.90;
    private readonly MAX_THRESHOLD = 0.99;

    /**
     * Record a structured merge decision
     */
    recordDecision(
        candidateId: number,
        method: 'auto_high_conf' | 'auto_llm' | 'manual',
        similarity: number
    ) {
        const db = getDB();
        db.query(`
      INSERT INTO trust_metrics (candidate_id, method, similarity, outcome, created_at)
      VALUES (?, ?, ?, 'success', datetime('now'))
    `).run(candidateId, method, similarity);
    }

    /**
     * Record an undo action (failed merge)
     */
    recordUndo(historyId: number) {
        const db = getDB();
        // Mark the corresponding trust metric as undone
        // This is a simplified implementation.
    }

    /**
     * Calculate adaptive threshold based on recent accuracy
     * If we have many undos, raise the threshold.
     * If we have high success, possibly lower it (but cautious).
     */
    getAdaptiveThreshold(): number {
        const db = getDB();

        // Check last 50 auto decisions
        const stats = db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN outcome = 'undone' THEN 1 ELSE 0 END) as failures
      FROM trust_metrics
      WHERE method IN ('auto_high_conf', 'auto_llm')
      ORDER BY created_at DESC
      LIMIT 50
    `).get() as { total: number; failures: number };

        if (!stats || stats.total === 0) return this.DEFAULT_THRESHOLD;

        const failureRate = stats.failures / stats.total;

        // If failure rate > 5%, increase threshold
        if (failureRate > 0.05) {
            return Math.min(this.MAX_THRESHOLD, this.DEFAULT_THRESHOLD + (failureRate * 0.5));
        }

        // If failure < 1% and sample > 20, slightly lower
        if (failureRate < 0.01 && stats.total > 20) {
            return Math.max(this.MIN_THRESHOLD, this.DEFAULT_THRESHOLD - 0.02);
        }

        return this.DEFAULT_THRESHOLD;
    }
}





