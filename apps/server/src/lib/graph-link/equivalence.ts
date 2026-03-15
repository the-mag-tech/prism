/**
 * Entity Equivalence Utilities
 * 
 * Provides functions to resolve entity equivalence groups.
 * Used when querying relations to include all equivalent entities.
 */

import { getDB } from '../../db.js';

/**
 * Get all entities that are equivalent to the given entity.
 * Returns the entity itself if not part of any group.
 */
export function getEquivalentEntities(entityId: string): string[] {
    const db = getDB();

    const group = db.query(`
    SELECT group_id FROM entity_groups WHERE entity_id = ?
  `).get(entityId) as { group_id: string } | null;

    if (!group) return [entityId];

    const members = db.query(`
    SELECT entity_id FROM entity_groups WHERE group_id = ?
  `).all(group.group_id) as { entity_id: string }[];

    return members.map(m => m.entity_id);
}

/**
 * Get the canonical (representative) ID for an entity.
 * Returns the entity itself if not part of any group.
 */
export function getCanonicalId(entityId: string): string {
    const db = getDB();

    const group = db.query(`
    SELECT group_id FROM entity_groups WHERE entity_id = ?
  `).get(entityId) as { group_id: string } | null;

    return group?.group_id || entityId;
}

/**
 * Check if two entities are in the same equivalence group.
 */
export function areEquivalent(entityA: string, entityB: string): boolean {
    const db = getDB();

    const groupA = db.query(`
    SELECT group_id FROM entity_groups WHERE entity_id = ?
  `).get(entityA) as { group_id: string } | null;

    const groupB = db.query(`
    SELECT group_id FROM entity_groups WHERE entity_id = ?
  `).get(entityB) as { group_id: string } | null;

    if (!groupA || !groupB) return entityA === entityB;
    return groupA.group_id === groupB.group_id;
}

/**
 * Add an entity to another entity's equivalence group.
 * Used during merge operations.
 */
export function addToEquivalenceGroup(
    entityId: string,
    groupRepresentative: string,
    joinedBy: string = 'system'
): void {
    const db = getDB();

    // Get or create group for the representative
    const existingGroup = db.query(`
    SELECT group_id FROM entity_groups WHERE entity_id = ?
  `).get(groupRepresentative) as { group_id: string } | null;

    const groupId = existingGroup?.group_id || groupRepresentative;

    // Add the entity to the group
    db.query(`
    INSERT INTO entity_groups (entity_id, group_id, joined_by)
    VALUES (?, ?, ?)
    ON CONFLICT(entity_id) DO UPDATE SET 
      group_id = excluded.group_id,
      joined_by = excluded.joined_by
  `).run(entityId, groupId, joinedBy);

    // Ensure the representative is also in the group
    db.query(`
    INSERT OR IGNORE INTO entity_groups (entity_id, group_id, joined_by)
    VALUES (?, ?, 'canonical')
  `).run(groupRepresentative, groupId);
}

/**
 * Get all members of a group by group ID.
 */
export function getGroupMembers(groupId: string): string[] {
    const db = getDB();

    const members = db.query(`
    SELECT entity_id FROM entity_groups WHERE group_id = ?
  `).all(groupId) as { entity_id: string }[];

    return members.map(m => m.entity_id);
}
