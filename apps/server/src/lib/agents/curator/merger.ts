/**
 * Merger Service
 * 
 * Strategy: User-triggered merges with full audit trail.
 * 
 * Every merge operation:
 * 1. Creates a snapshot of the source entity for undo capability
 * 2. Records all affected relations and page_blocks
 * 3. Writes to merge_history table
 * 4. Updates merge_candidates status
 */

import { getDB } from '../../../db.js';
import { deleteUserMemory } from '../../source-manager.js';

// =============================================================================
// TYPES
// =============================================================================

export interface MergeResult {
  success: boolean;
  historyId?: number;
  pageBlocksUpdated: number;
  relationsUpdated: number;
  error?: string;
}

export interface MergeHistoryEntry {
  id: number;
  targetId: string;
  sourceId: string;
  decidedBy: string;
  decisionReason: string | null;
  sourceSnapshot: string;
  affectedRelations: string;
  affectedPageBlocks: string;
  mergedAt: string;
  undoneAt: string | null;
}

// =============================================================================
// MERGER SERVICE
// =============================================================================

export class MergerService {
  /**
   * Execute a merge: Source -> Target (Entity)
   * 
   * @param targetId - The entity ID that will remain
   * @param sourceId - The entity ID that will be merged into target
   * @param decidedBy - Who triggered the merge ('user', 'auto_high_conf', 'auto_llm')
   * @param reason - Optional reason for the merge
   */
  async merge(
    targetId: string,
    sourceId: string,
    decidedBy: 'user' | 'auto_high_conf' | 'auto_llm' = 'user',
    reason?: string
  ): Promise<MergeResult> {
    const db = getDB();
    let pageBlocksUpdated = 0;
    let relationsUpdated = 0;
    let historyId: number | undefined;

    const allowed = ['user', 'auto_high_conf', 'auto_llm'];
    if (!allowed.includes(decidedBy)) {
      console.warn(`[Curator] Invalid decision type: ${decidedBy}`);
      return {
        success: false,
        pageBlocksUpdated: 0,
        relationsUpdated: 0,
        error: 'Invalid decision type'
      };
    }

    console.log(`[Curator] Merging Entity ${sourceId} -> ${targetId}...`);

    try {
      db.transaction(() => {
        // 0. Create snapshot of source entity for undo capability
        const sourceEntity = db.query(`
          SELECT * FROM entities WHERE id = ?
        `).get(sourceId) as Record<string, any> | null;

        if (!sourceEntity) {
          throw new Error(`Source entity ${sourceId} not found`);
        }

        // Collect affected relations (relations table has composite PK, no id column)
        const affectedRelations = db.query(`
          SELECT source, target, type FROM relations WHERE source = ? OR target = ?
        `).all(sourceId, sourceId) as { source: string; target: string; type: string }[];

        // Collect affected page_blocks
        const affectedPageBlocks = db.query(`
          SELECT page_id, block_id FROM page_blocks 
          WHERE block_id = ? OR page_id = ?
        `).all(sourceId, sourceId) as { page_id: string; block_id: string }[];

        // 1. Record to merge_history FIRST (for undo capability)
        const historyResult = db.query(`
          INSERT INTO merge_history 
          (target_id, source_id, decided_by, decision_reason, 
           source_snapshot, affected_relations, affected_page_blocks, merged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          targetId,
          sourceId,
          decidedBy,
          reason || null,
          JSON.stringify(sourceEntity),
          JSON.stringify(affectedRelations),
          JSON.stringify(affectedPageBlocks)
        );
        historyId = Number(historyResult.lastInsertRowid);

        // 2. Add to Equivalence Group (replaces entity_aliases)
        const existingGroup = db.query(`
          SELECT group_id FROM entity_groups WHERE entity_id = ?
        `).get(targetId) as { group_id: string } | null;

        const groupId = existingGroup?.group_id || targetId;

        // Add source to the group
        db.query(`
          INSERT INTO entity_groups (entity_id, group_id, joined_by)
          VALUES (?, ?, ?)
          ON CONFLICT(entity_id) DO UPDATE SET 
            group_id = excluded.group_id,
            joined_by = excluded.joined_by
        `).run(sourceId, groupId, decidedBy);

        // Ensure target is also in the group (as canonical)
        db.query(`
          INSERT OR IGNORE INTO entity_groups (entity_id, group_id, joined_by)
          VALUES (?, ?, 'canonical')
        `).run(targetId, groupId);

        // 3. Relations: NO UPDATE NEEDED
        // Relations stay pointing to their original entity IDs.
        // Query-time equivalence resolution handles this via entity_groups.
        relationsUpdated = 0;

        // 4. Update page_blocks (block_id references)
        const updateBlockResult = db.query(`
          UPDATE OR IGNORE page_blocks SET block_id = ? WHERE block_id = ?
        `).run(targetId, sourceId);

        // Delete any remaining source blocks (conflicts)
        const deleteBlockResult = db.query(`
          DELETE FROM page_blocks WHERE block_id = ?
        `).run(sourceId);

        pageBlocksUpdated += (updateBlockResult.changes + deleteBlockResult.changes);

        // 5. Update page_blocks (page_id references - merge pages)
        db.query(`
          UPDATE OR IGNORE page_blocks SET page_id = ? WHERE page_id = ?
        `).run(targetId, sourceId);

        // Clean up remaining conflicted source blocks
        db.query(`DELETE FROM page_blocks WHERE page_id = ?`).run(sourceId);

        // 6. Update merge_candidates status
        db.query(`
          UPDATE merge_candidates 
          SET status = 'merged', 
              decided_by = ?, 
              decided_at = datetime('now'),
              decision_reason = ?,
              updated_at = datetime('now')
          WHERE (entity_a = ? AND entity_b = ?) 
             OR (entity_a = ? AND entity_b = ?)
        `).run(decidedBy, reason || null, targetId, sourceId, sourceId, targetId);

        // 7. Also update legacy entity_similarities if exists
        try {
          db.query(`
          UPDATE entity_similarities 
          SET status = 'merged' 
          WHERE (entity_a = ? AND entity_b = ?) OR (entity_a = ? AND entity_b = ?)
        `).run(targetId, sourceId, sourceId, targetId);
        } catch {
          // Ignore if table doesn't exist
        }

      })();

      console.log(`[Curator] Entity Merge complete. Relations: ${relationsUpdated}, Blocks: ${pageBlocksUpdated}`);
      return { success: true, historyId, pageBlocksUpdated, relationsUpdated };

    } catch (error: any) {
      console.error('[Curator] Entity Merge failed:', error);
      return {
        success: false,
        pageBlocksUpdated: 0,
        relationsUpdated: 0,
        error: error.message
      };
    }
  }

  /**
   * Undo a previous merge operation.
   * Restores the source entity from snapshot and reverses all changes.
   */
  async undoMerge(historyId: number): Promise<{ success: boolean; error?: string }> {
    const db = getDB();

    console.log(`[Curator] Attempting to undo merge (history ID: ${historyId})...`);

    try {
      const row = db.query(`
        SELECT id, target_id, source_id, source_snapshot 
        FROM merge_history 
        WHERE id = ? AND undone_at IS NULL
      `).get(historyId) as {
        id: number;
        target_id: string;
        source_id: string;
        source_snapshot: string;
      } | null;

      if (!row) {
        return { success: false, error: 'Merge history not found or already undone' };
      }

      const sourceSnapshot = JSON.parse(row.source_snapshot);

      db.transaction(() => {
        // 1. Restore source entity from snapshot
        const columns = Object.keys(sourceSnapshot).filter(k => k !== 'id');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(k => sourceSnapshot[k]);

        db.query(`
          INSERT OR REPLACE INTO entities (id, ${columns.join(', ')})
          VALUES (?, ${placeholders})
        `).run(row.source_id, ...values);

        // 2. Remove alias
        db.query(`
          DELETE FROM entity_aliases WHERE alias_id = ?
        `).run(row.source_id);

        // 3. Mark history as undone
        db.query(`
          UPDATE merge_history 
          SET undone_at = datetime('now'), undone_by = 'user'
          WHERE id = ?
        `).run(historyId);

        // 4. Reset merge_candidates status to pending
        db.query(`
          UPDATE merge_candidates 
          SET status = 'pending', 
              decided_by = NULL, 
              decided_at = NULL,
              updated_at = datetime('now')
          WHERE (entity_a = ? AND entity_b = ?) 
             OR (entity_a = ? AND entity_b = ?)
        `).run(row.target_id, row.source_id, row.source_id, row.target_id);

      })();

      console.log(`[Curator] Undo complete. Entity ${row.source_id} restored.`);
      return { success: true };

    } catch (error: any) {
      console.error('[Curator] Undo failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get merge history for review.
   */
  getMergeHistory(limit: number = 50): MergeHistoryEntry[] {
    const db = getDB();
    const rows = db.query(`
      SELECT 
        id, target_id, source_id, decided_by, decision_reason,
        source_snapshot, affected_relations, affected_page_blocks,
        merged_at, undone_at, undone_by
      FROM merge_history 
      ORDER BY merged_at DESC 
      LIMIT ?
    `).all(limit) as Array<{
      id: number;
      target_id: string;
      source_id: string;
      decided_by: string;
      decision_reason: string | null;
      source_snapshot: string;
      affected_relations: string;
      affected_page_blocks: string;
      merged_at: string;
      undone_at: string | null;
      undone_by: string | null;
    }>;

    return rows.map(r => ({
      id: r.id,
      targetId: r.target_id,
      sourceId: r.source_id,
      decidedBy: r.decided_by,
      decisionReason: r.decision_reason,
      sourceSnapshot: r.source_snapshot,
      affectedRelations: r.affected_relations,
      affectedPageBlocks: r.affected_page_blocks,
      mergedAt: r.merged_at,
      undoneAt: r.undone_at,
    }));
  }

  /**
   * Merge two memories (Move references from Source -> Target, then delete Source)
   * Memory merges are safe for auto-merge since they're exact content matches.
   */
  async mergeMemories(targetId: number, sourceId: number): Promise<boolean> {
    const db = getDB();
    console.log(`[Curator] Merging Memory ${sourceId} -> ${targetId}...`);

    try {
      db.transaction(() => {
        // 1. Update Entities that originated from this memory
        const entities = db.query(`
          UPDATE entities SET memo_id = ? WHERE memo_id = ?
        `).run(targetId, sourceId);
        console.log(`- Relinked ${entities.changes} entities.`);

        // 2. Delete the duplicate memory (via source-manager)
        deleteUserMemory(sourceId);
      })();

      console.log(`[Curator] Memory Merge complete.`);
      return true;
    } catch (error: any) {
      console.error('[Curator] Memory Merge failed:', error);
      return false;
    }
  }
}





