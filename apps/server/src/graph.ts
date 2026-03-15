import { getDB } from './db.js';

export function getRelatedEntities(targetEmail: string): string[] {
  const db = getDB();
  const related = new Set<string>();

  // 1. People I sent emails to
  const sent = db.query('SELECT to_addr FROM emails WHERE from_addr = ?').all(targetEmail) as { to_addr: string }[];
  for (const row of sent) {
    if (row.to_addr) {
      row.to_addr.split(',').forEach(addr => related.add(addr.trim()));
    }
  }

  // 2. People who sent emails to me (and co-recipients)
  // We use LIKE for simple "contains" check. 
  // Ideally we should normalize emails or use a junction table, but MVP is MVP.
  const received = db.query('SELECT from_addr, to_addr FROM emails WHERE to_addr LIKE ?').all(`%${targetEmail}%`) as { from_addr: string, to_addr: string }[];
  
  for (const row of received) {
    related.add(row.from_addr);
    if (row.to_addr) {
       row.to_addr.split(',').forEach(addr => {
         const clean = addr.trim();
         if (clean !== targetEmail) related.add(clean);
       });
    }
  }

  return Array.from(related);
}

// ============================================================================
// ENTITY MANAGEMENT (CRUD)
// ============================================================================

export interface EntityNode {
  id: string;
  title: string;
  tag?: string;
  type?: string; // Derived
}

export interface ImpactAnalysis {
  relationsCount: number;
  publicContentCount: number;
}

/**
 * Find an entity by name (flexible matching)
 */
export function findEntityByName(name: string): EntityNode | null {
  const db = getDB();
  const row = db.query(`
    SELECT id, title, tag 
    FROM entities 
    WHERE id = ? OR title = ? COLLATE NOCASE
  `).get(name, name) as any;

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    tag: row.tag,
    type: row.tag || row.id.split(':')[0]
  };
}

/**
 * Find closest match for suggestions
 */
export function findSimilarEntity(name: string): EntityNode | null {
  const db = getDB();
  const row = db.query('SELECT id, title, tag FROM entities WHERE title LIKE ? LIMIT 1').get(`%${name}%`) as any;
  
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    tag: row.tag
  };
}

/**
 * Analyze what would be deleted if this entity is removed
 */
export function analyzeDeleteImpact(entityId: string): ImpactAnalysis {
  const db = getDB();
  
  const relationCount = db.query('SELECT COUNT(*) as c FROM relations WHERE source = ? OR target = ?').get(entityId, entityId) as any;
  const contentCount = db.query('SELECT COUNT(*) as c FROM public_content WHERE related_entities LIKE ?').get(`%${entityId}%`) as any;

  return {
    relationsCount: relationCount.c,
    publicContentCount: contentCount.c
  };
}

/**
 * Execute surgical deletion
 */
export function deleteEntityFully(entityId: string): { relations: number, content: number, entity: number } {
  const db = getDB();
  
  let result = { relations: 0, content: 0, entity: 0 };

  db.transaction(() => {
    const delRelations = db.query('DELETE FROM relations WHERE source = ? OR target = ?').run(entityId, entityId);
    const delContent = db.query('DELETE FROM public_content WHERE related_entities LIKE ?').run(`%${entityId}%`);
    const delEntity = db.query('DELETE FROM entities WHERE id = ?').run(entityId);
    
    result = {
      relations: delRelations.changes,
      content: delContent.changes,
      entity: delEntity.changes
    };
  })();

  return result;
}
