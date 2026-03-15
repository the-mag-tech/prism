/**
 * Deduplicator Service
 * 
 * Strategy: "Record everything, decide nothing" (for entities)
 * - Detects potential duplicate entities using embedding similarity
 * - Records candidates to merge_candidates table
 * - Layered automation: High Conf → LLM → Human
 * 
 * Key insight: Same name ≠ Same entity. Source domain matters.
 */

import { getDB } from '../../../db.js';
import { getOpenAI } from '../../ai-clients.js';
import { getUserMemories } from '../../source-manager.js';
import crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface SimilarityPair {
  entityA: string;
  titleA: string;
  sourceDomainA: string | null;
  entityB: string;
  titleB: string;
  sourceDomainB: string | null;
  similarity: number;
  id?: number; // Added for TrustMetrics
}

export interface MergeCandidate {
  id: number;
  entityA: string;
  entityB: string;
  similarity: number;
  sourceDomainA: string | null;
  sourceDomainB: string | null;
  status: 'pending' | 'merged' | 'rejected' | 'deferred';
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

// Raw database row type (snake_case)
interface MergeCandidateRow {
  id: number;
  entity_a: string;
  entity_b: string;
  similarity: number;
  source_domain_a: string | null;
  source_domain_b: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface MemoryDuplicate {
  targetId: number;
  sourceId: number;
  title: string;
  reason: string;
}

// =============================================================================
// DEDUPLICATOR SERVICE
// =============================================================================

export class DeduplicatorService {
  /**
   * Scan for Entity duplicates and record to merge_candidates table.
   * 
   * @param threshold - Minimum similarity score (default 0.92)
   * @returns Array of newly found similarity pairs
   */
  async findAndRecordCandidates(threshold: number = 0.92): Promise<SimilarityPair[]> {
    const entities = this.getAllEntities();
    if (entities.length < 2) return [];

    console.log(`[Curator] Scanning ${entities.length} entities for duplicates...`);

    // 1. Get Embeddings
    const embeddings = await this.computeEmbeddings(
      entities.map(e => this.entityToText(e))
    );

    // 2. Find Pairs (excluding already processed)
    const pairs = this.findPairs(entities, embeddings, threshold);

    if (pairs.length === 0) {
      console.log('[Curator] No new duplicate candidates found.');
      return [];
    }

    // 3. Record to merge_candidates table
    const db = getDB();
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO merge_candidates 
      (entity_a, entity_b, similarity, source_domain_a, source_domain_b, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
    `);

    let recorded = 0;
    for (const pair of pairs) {
      const result = insertStmt.run(
        pair.entityA,
        pair.entityB,
        pair.similarity,
        pair.sourceDomainA,
        pair.sourceDomainB
      );
      if (result.changes > 0) recorded++;
    }

    // 4. Re-query to get IDs for the return value (for TrustMetrics)
    const pending = this.getPendingCandidates();
    const pairMap = new Map(pending.map(p => [`${p.entityA}|${p.entityB}`, p.id]));

    return pairs.map(p => ({
      ...p,
      id: pairMap.get(`${p.entityA}|${p.entityB}`) || pairMap.get(`${p.entityB}|${p.entityA}`)
    }));
  }

  /**
   * Get all pending merge candidates for user review.
   */
  getPendingCandidates(): MergeCandidate[] {
    const db = getDB();
    const rows = db.query(`
      SELECT 
        id, entity_a, entity_b, similarity,
        source_domain_a, source_domain_b,
        status, decided_by, decided_at, created_at
      FROM merge_candidates
      WHERE status = 'pending'
      ORDER BY similarity DESC
    `).all() as MergeCandidateRow[];

    return rows.map(r => ({
      id: r.id,
      entityA: r.entity_a,
      entityB: r.entity_b,
      similarity: r.similarity,
      sourceDomainA: r.source_domain_a,
      sourceDomainB: r.source_domain_b,
      status: r.status as MergeCandidate['status'],
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      createdAt: r.created_at,
    }));
  }

  /**
   * Get merge candidates with entity details for UI display.
   */
  getPendingCandidatesWithDetails(): Array<MergeCandidate & {
    titleA: string;
    titleB: string;
    subtitleA: string | null;
    subtitleB: string | null;
  }> {
    const db = getDB();
    const rows = db.query(`
      SELECT 
        mc.id, mc.entity_a, mc.entity_b, mc.similarity,
        mc.source_domain_a, mc.source_domain_b,
        mc.status, mc.decided_by, mc.decided_at, mc.created_at,
        ea.title as title_a, ea.subtitle as subtitle_a,
        eb.title as title_b, eb.subtitle as subtitle_b
      FROM merge_candidates mc
      LEFT JOIN entities ea ON mc.entity_a = ea.id
      LEFT JOIN entities eb ON mc.entity_b = eb.id
      WHERE mc.status = 'pending'
      ORDER BY mc.similarity DESC
    `).all() as (MergeCandidateRow & {
      title_a: string | null;
      subtitle_a: string | null;
      title_b: string | null;
      subtitle_b: string | null;
    })[];

    return rows.map(r => ({
      id: r.id,
      entityA: r.entity_a,
      entityB: r.entity_b,
      similarity: r.similarity,
      sourceDomainA: r.source_domain_a,
      sourceDomainB: r.source_domain_b,
      status: r.status as MergeCandidate['status'],
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      createdAt: r.created_at,
      titleA: r.title_a || r.entity_a,
      titleB: r.title_b || r.entity_b,
      subtitleA: r.subtitle_a,
      subtitleB: r.subtitle_b,
    }));
  }

  /**
   * Mark a candidate as rejected (user decided they are NOT the same entity).
   * This pair will never be suggested again.
   */
  rejectCandidate(entityA: string, entityB: string, reason?: string): boolean {
    const db = getDB();
    const result = db.query(`
      UPDATE merge_candidates 
      SET status = 'rejected', 
          decided_by = 'user', 
          decided_at = datetime('now'),
          decision_reason = ?,
          updated_at = datetime('now')
      WHERE (entity_a = ? AND entity_b = ?) 
         OR (entity_a = ? AND entity_b = ?)
    `).run(reason || 'User rejected', entityA, entityB, entityB, entityA);

    return result.changes > 0;
  }

  /**
   * Mark a candidate as deferred (user wants to decide later).
   */
  deferCandidate(entityA: string, entityB: string): boolean {
    const db = getDB();
    const result = db.query(`
      UPDATE merge_candidates 
      SET status = 'deferred',
          updated_at = datetime('now')
      WHERE (entity_a = ? AND entity_b = ?) 
         OR (entity_a = ? AND entity_b = ?)
    `).run(entityA, entityB, entityB, entityA);

    return result.changes > 0;
  }

  /**
   * Scan for Memory duplicates (Content Hash).
   * These are safe to auto-merge since they're exact content matches.
   */
  async findDuplicateMemories(): Promise<MemoryDuplicate[]> {
    // Use source-manager instead of direct SQL
    const memories = getUserMemories({ archived: false });

    console.log(`[Curator] Scanning ${memories.length} memories for exact duplicates...`);

    const hashes = new Map<string, number>();
    const duplicates: MemoryDuplicate[] = [];

    for (const mem of memories) {
      const hash = crypto.createHash('md5').update(mem.content).digest('hex');

      if (hashes.has(hash)) {
        const existingId = hashes.get(hash)!;
        duplicates.push({
          targetId: existingId,
          sourceId: mem.id,
          title: mem.title || 'Untitled',
          reason: 'Exact Content Match (Hash)',
        });
      } else {
        hashes.set(hash, mem.id);
      }
    }

    console.log(`[Curator] Found ${duplicates.length} duplicate memories.`);
    return duplicates;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private getAllEntities() {
    const db = getDB();
    return db.query(`
      SELECT e.id, e.title, e.subtitle, e.body, e.source_domain
      FROM entities e
      WHERE NOT EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.alias_id = e.id)
      ORDER BY e.id
    `).all() as {
      id: string;
      title: string;
      subtitle: string;
      body: string;
      source_domain: string | null;
    }[];
  }

  private entityToText(entity: { title: string; subtitle?: string }): string {
    return `${entity.title} | ${entity.subtitle || ''}`;
  }

  private async computeEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const openai = getOpenAI();
    if (!openai) {
      console.warn('[Deduplicator] OpenAI not available, cannot compute embeddings');
      return [];
    }

    // Batch in chunks of 100 to avoid API limits
    const batchSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
      });
      allEmbeddings.push(...response.data.map(d => d.embedding));
    }

    return allEmbeddings;
  }

  private findPairs(
    entities: Array<{ id: string; title: string; source_domain: string | null }>,
    embeddings: number[][],
    threshold: number
  ): SimilarityPair[] {
    const pairs: SimilarityPair[] = [];
    const processed = this.getProcessedPairs();

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        // Skip if already processed (merged, rejected, or pending)
        const pairKey = this.makePairKey(entities[i].id, entities[j].id);
        if (processed.has(pairKey)) continue;

        const similarity = this.cosineSimilarity(embeddings[i], embeddings[j]);

        if (similarity >= threshold) {
          pairs.push({
            entityA: entities[i].id,
            titleA: entities[i].title,
            sourceDomainA: entities[i].source_domain,
            entityB: entities[j].id,
            titleB: entities[j].title,
            sourceDomainB: entities[j].source_domain,
            similarity,
          });
        }
      }
    }
    return pairs;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get all pairs that have already been processed (any status except pending new).
   * This includes: merged, rejected, deferred, and existing pending candidates.
   */
  private getProcessedPairs(): Set<string> {
    const db = getDB();
    const set = new Set<string>();

    // From merge_candidates (new table)
    const candidates = db.query(`
      SELECT entity_a, entity_b FROM merge_candidates
    `).all() as { entity_a: string; entity_b: string }[];

    for (const r of candidates) {
      set.add(this.makePairKey(r.entity_a, r.entity_b));
    }

    // Also check legacy entity_similarities table for backward compatibility
    try {
      const legacy = db.query(`
        SELECT entity_a, entity_b FROM entity_similarities 
        WHERE status IN ('merged', 'skipped', 'never')
      `).all() as { entity_a: string; entity_b: string }[];

      for (const r of legacy) {
        set.add(this.makePairKey(r.entity_a, r.entity_b));
      }
    } catch {
      // Table might not exist, ignore
    }

    return set;
  }

  /**
   * Create a canonical pair key (sorted to ensure A|B === B|A)
   */
  private makePairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }
}





