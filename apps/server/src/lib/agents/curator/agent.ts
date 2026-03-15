/**
 * Curator Agent
 * 
 * Responsibilities: Knowledge graph structure maintenance
 * - Entity deduplication: Detect and record to merge_candidates, user decides
 * - Memory deduplication: Safe to auto-merge (exact hash match)
 * - Trust metrics: Adaptive threshold based on user feedback
 * 
 * NOTE: Previously named "Gardener", renamed to "Curator" to align with Tribe semantics.
 * The "Gardener" role is reserved for relationship maintenance (future feature).
 * 
 * @see TRIBE-STYLES.md for the distinction:
 * - Curator (this): Archive management, deduplication, structure
 * - Gardener (future): Relationship tending, care signals, people focus
 */

import { DeduplicatorService, type SimilarityPair, type MemoryDuplicate } from './deduplicator.js';
import { MergerService } from './merger.js';
import { TrustMetrics } from './trust-metrics.js';
import { getOpenAI } from '../../ai-clients.js';

export interface CuratorReport {
  memoryDuplicates: {
    found: number;
    merged: number;
  };
  entityCandidates: {
    found: number;
    recorded: number;
    pendingTotal: number;
  };
  timestamp: string;
}

// Legacy alias for backward compatibility
export type GardenerReport = CuratorReport;

export class CuratorAgent {
  private deduplicator: DeduplicatorService;
  private merger: MergerService;
  private trustMetrics: TrustMetrics;

  constructor() {
    this.deduplicator = new DeduplicatorService();
    this.merger = new MergerService();
    this.trustMetrics = new TrustMetrics();
  }

  /**
   * Run the full governance cycle.
   * 
   * Behavior:
   * - Memory duplicates: Auto-merge (safe, exact hash match)
   * - Entity duplicates: Layered automation (High Conf → LLM → Human)
   * 
   * @param autoMergeMemories - Whether to auto-merge exact memory duplicates (default: true)
   */
  async run(autoMergeMemories: boolean = true): Promise<CuratorReport> {
    console.log('📚 Curator waking up...');
    const report: CuratorReport = {
      memoryDuplicates: { found: 0, merged: 0 },
      entityCandidates: { found: 0, recorded: 0, pendingTotal: 0 },
      timestamp: new Date().toISOString(),
    };

    // =========================================================================
    // Phase A: Memory Governance (Content Deduplication)
    // Safe to auto-merge since these are exact hash matches
    // =========================================================================
    const memoryDupes = await this.deduplicator.findDuplicateMemories();
    report.memoryDuplicates.found = memoryDupes.length;

    if (memoryDupes.length > 0) {
      console.log(`[Curator] Found ${memoryDupes.length} duplicate memories.`);

      for (const dupe of memoryDupes) {
        if (autoMergeMemories) {
          const success = await this.merger.mergeMemories(dupe.targetId, dupe.sourceId);
          if (success) report.memoryDuplicates.merged++;
        } else {
          console.log(`[Curator] Suggestion: Merge Memory ${dupe.sourceId} -> ${dupe.targetId} (${dupe.reason})`);
        }
      }
    }

    // =========================================================================
    // Phase B: Entity Governance (Semantic Deduplication)
    // Layered Automation: Safe -> High Conf -> LLM -> Human
    // =========================================================================
    const candidates = await this.deduplicator.findAndRecordCandidates(0.90);
    report.entityCandidates.found = candidates.length;

    // Get Adaptive Threshold based on trust metrics
    const adaptiveThreshold = this.trustMetrics.getAdaptiveThreshold();
    console.log(`[Curator] Adaptive Threshold: ${adaptiveThreshold.toFixed(4)}`);

    for (const pair of candidates) {
      // LAYER 1: Cross-Source -> Human Only (Safety)
      if (pair.sourceDomainA !== pair.sourceDomainB) {
        console.log(`[Curator] Skipped Auto: Cross-source (${pair.titleA} vs ${pair.titleB})`);
        continue;
      }

      // LAYER 2: High Confidence + Same Source -> Auto Merge
      // Hardcoded safety ceiling: 0.98
      if (pair.similarity >= 0.98) {
        console.log(`[Curator] Auto-Merge (High Conf): ${pair.titleA} + ${pair.titleB}`);
        await this.merger.merge(pair.entityA, pair.entityB, 'auto_high_conf');
        if (pair.id) this.trustMetrics.recordDecision(pair.id, 'auto_high_conf', pair.similarity);
        continue;
      }

      // LAYER 3: Medium Confidence + Same Source -> LLM Diagnosis
      if (pair.similarity >= adaptiveThreshold) {
        console.log(`[Curator] Requesting Diagnosis: ${pair.titleA} vs ${pair.titleB}`);
        const diagnosis = await this.diagnose(pair);

        if (diagnosis === 'MERGE') {
          console.log(`[Curator] Auto-Merge (LLM Approved): ${pair.titleA} + ${pair.titleB}`);
          await this.merger.merge(pair.entityA, pair.entityB, 'auto_llm');
          if (pair.id) this.trustMetrics.recordDecision(pair.id, 'auto_llm', pair.similarity);
        } else if (diagnosis === 'KEEP') {
          console.log(`[Curator] Auto-Reject (LLM Rejected): ${pair.titleA} vs ${pair.titleB}`);
          await this.deduplicator.rejectCandidate(pair.entityA, pair.entityB, 'LLM: KEEP');
        } else {
          console.log(`[Curator] Uncertain (LLM): Leaving for human.`);
        }
      }
    }

    // Get final pending count
    const pending = this.deduplicator.getPendingCandidates();
    report.entityCandidates.pendingTotal = pending.length;
    report.entityCandidates.recorded = candidates.length;

    console.log('📚 Curator cycle complete.');
    return report;
  }

  /**
   * Layer 3: LLM Diagnosis for ambiguous cases
   */
  private async diagnose(pair: SimilarityPair): Promise<'MERGE' | 'KEEP' | 'UNCERTAIN'> {
    const openai = getOpenAI();
    if (!openai) {
      console.warn('[Curator] OpenAI not available for diagnosis');
      return 'UNCERTAIN';
    }
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a Data Integrity Specialist.
                    Determine if two entities refer to the EXACT SAME real-world object and should be merged.
                    
                    Rules:
                    1. MERGE only if you are 100% sure they are the same.
                    2. KEEP if they are distinct (e.g., "iphone" vs "iphone 15").
                    3. UNCERTAIN if there is not enough context.

                    Entities:
                    A: "${pair.titleA}" (Domain: ${pair.sourceDomainA})
                    B: "${pair.titleB}" (Domain: ${pair.sourceDomainB})
                    
                    Output JSON: { "decision": "MERGE" | "KEEP" | "UNCERTAIN", "reason": "string" }`
          }
        ],
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      return result.decision || 'UNCERTAIN';
    } catch (e) {
      console.error("Diagnosis failed:", e);
      return 'UNCERTAIN';
    }
  }

  /**
   * Get a summary of pending work for the Curator.
   */
  getStatus(): { pendingCandidates: number; recentMerges: number; adaptiveThreshold: number } {
    const pending = this.deduplicator.getPendingCandidates();
    const history = this.merger.getMergeHistory(10);
    const recentMerges = history.filter(h => {
      const mergedAt = new Date(h.mergedAt);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return mergedAt > dayAgo;
    }).length;

    const adaptiveThreshold = this.trustMetrics.getAdaptiveThreshold();

    return {
      pendingCandidates: pending.length,
      recentMerges,
      adaptiveThreshold,
    };
  }

  /**
   * User-triggered: Approve a merge candidate.
   */
  async approveMerge(entityA: string, entityB: string, reason?: string) {
    // Convention: Merge shorter ID into longer ID, or alphabetically first
    const [target, source] = entityA < entityB ? [entityA, entityB] : [entityB, entityA];
    return this.merger.merge(target, source, 'user', reason || 'User approved merge');
  }

  /**
   * User-triggered: Reject a merge candidate.
   */
  rejectMerge(entityA: string, entityB: string, reason?: string) {
    return this.deduplicator.rejectCandidate(entityA, entityB, reason);
  }

  /**
   * User-triggered: Defer decision on a merge candidate.
   */
  deferMerge(entityA: string, entityB: string) {
    return this.deduplicator.deferCandidate(entityA, entityB);
  }

  /**
   * User-triggered: Undo a previous merge.
   */
  async undoMerge(historyId: number) {
    return this.merger.undoMerge(historyId);
  }
}

// Legacy alias for backward compatibility
export { CuratorAgent as GardenerAgent };





