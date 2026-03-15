/**
 * Navigation Context - Path-based learning for entity associations
 * 
 * Records user navigation paths and learns entity associations from:
 * 1. Co-occurrence in same path
 * 2. Similar path patterns (via embedding similarity)
 * 
 * This implements the "user behavior defines semantics" philosophy.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDB } from './db.js';
import { getOpenAI } from './lib/ai-clients.js';
import { isNavigationTrackingEnabled, isEmbeddingEnabled, isAssociationLearningEnabled } from './feature-flags.js';

// =============================================================================
// TYPES
// =============================================================================

export interface NavigationRequest {
  path: string[];        // ["daily", "person:simon", "concept:light_side"]
  dwellTimeMs?: number;  // Time spent on final entity
}

export interface NavigationSession {
  id: string;
  path: string[];
  pathText: string;
  finalEntity: string | null;
  dwellTimeMs: number | null;
  createdAt: string;
}

export interface PathAssociation {
  entityA: string;
  entityB: string;
  coOccurrenceCount: number;
  avgPathSimilarity: number;
  lastSeen: string;
}

// =============================================================================
// OPENAI CLIENT (lazy-loaded via ai-clients)
// =============================================================================

// =============================================================================
// PATH RECORDING
// =============================================================================

/**
 * Record a navigation path and update associations
 */
export async function recordNavigation(request: NavigationRequest): Promise<NavigationSession | { skipped: true; reason: string }> {
  // Check if tracking is enabled
  if (!isNavigationTrackingEnabled()) {
    return { skipped: true, reason: 'Navigation tracking is disabled' };
  }

  const db = getDB();
  const sessionId = uuidv4();
  const path = request.path;
  const pathText = path.join(' > ');
  const finalEntity = path.length > 0 ? path[path.length - 1] : null;

  console.log(`[Nav] Recording path: ${pathText}`);

  // Get embedding for the path (if enabled)
  let embedding: Buffer | null = null;
  if (isEmbeddingEnabled()) {
    try {
      embedding = await getPathEmbedding(pathText);
    } catch (error) {
      console.error('[Nav] Failed to get embedding:', error);
    }
  }

  // Insert navigation session
  db.query(`
    INSERT INTO navigation_sessions (id, path, path_text, final_entity, dwell_time_ms, embedding)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    JSON.stringify(path),
    pathText,
    finalEntity,
    request.dwellTimeMs || null,
    embedding
  );

  // Update co-occurrence associations for entities in path (if enabled)
  if (isAssociationLearningEnabled()) {
    updateCoOccurrences(path);

    // If we have embedding, find similar paths and strengthen associations
    if (embedding) {
      await updateSimilarPathAssociations(sessionId, path, embedding);
    }
  }

  return {
    id: sessionId,
    path,
    pathText,
    finalEntity,
    dwellTimeMs: request.dwellTimeMs || null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get embedding for a path string
 */
async function getPathEmbedding(pathText: string): Promise<Buffer | null> {
  const openai = getOpenAI();
  if (!openai) return null;
  
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: pathText,
  });

  const vector = response.data[0].embedding;
  // Convert to binary buffer for storage
  return Buffer.from(new Float32Array(vector).buffer);
}

/**
 * Update co-occurrence counts for entities in a path
 */
function updateCoOccurrences(path: string[]) {
  const db = getDB();
  
  // For each pair of entities in the path, update co-occurrence
  for (let i = 0; i < path.length; i++) {
    for (let j = i + 1; j < path.length; j++) {
      const [entityA, entityB] = [path[i], path[j]].sort(); // Sort for consistency
      
      db.query(`
        INSERT INTO path_associations (entity_a, entity_b, co_occurrence_count, last_seen)
        VALUES (?, ?, 1, datetime('now'))
        ON CONFLICT(entity_a, entity_b) DO UPDATE SET
          co_occurrence_count = co_occurrence_count + 1,
          last_seen = datetime('now')
      `).run(entityA, entityB);
    }
  }
}

/**
 * Find similar paths and strengthen associations
 */
async function updateSimilarPathAssociations(
  currentSessionId: string,
  currentPath: string[],
  currentEmbedding: Buffer
): Promise<void> {
  const db = getDB();
  
  // Get recent paths with embeddings (limit to last 100 for performance)
  const recentPaths = db.query(`
    SELECT id, path, embedding FROM navigation_sessions 
    WHERE embedding IS NOT NULL AND id != ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(currentSessionId) as { id: string; path: string; embedding: Buffer }[];

  const currentVector = new Float32Array(currentEmbedding.buffer);
  const SIMILARITY_THRESHOLD = 0.8; // Adjust as needed

  for (const other of recentPaths) {
    const otherVector = new Float32Array(other.embedding.buffer);
    const similarity = cosineSimilarity(currentVector, otherVector);

    if (similarity >= SIMILARITY_THRESHOLD) {
      const otherPath = JSON.parse(other.path) as string[];
      
      // Strengthen associations between entities from both paths
      const allEntities = [...new Set([...currentPath, ...otherPath])];
      
      for (let i = 0; i < allEntities.length; i++) {
        for (let j = i + 1; j < allEntities.length; j++) {
          const [entityA, entityB] = [allEntities[i], allEntities[j]].sort();
          
          // Update with similarity-weighted association
          db.query(`
            INSERT INTO path_associations (entity_a, entity_b, co_occurrence_count, avg_path_similarity, last_seen)
            VALUES (?, ?, 1, ?, datetime('now'))
            ON CONFLICT(entity_a, entity_b) DO UPDATE SET
              co_occurrence_count = co_occurrence_count + 1,
              avg_path_similarity = (avg_path_similarity * (co_occurrence_count - 1) + ?) / co_occurrence_count,
              last_seen = datetime('now')
          `).run(entityA, entityB, similarity, similarity);
        }
      }
    }
  }
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// =============================================================================
// QUERY ASSOCIATIONS
// =============================================================================

/**
 * Get entities associated with a given entity (learned from paths)
 */
export function getAssociatedEntities(entityId: string, limit: number = 10): PathAssociation[] {
  const db = getDB();
  
  return db.query(`
    SELECT 
      CASE WHEN entity_a = ? THEN entity_b ELSE entity_a END as related_entity,
      co_occurrence_count,
      avg_path_similarity,
      last_seen
    FROM path_associations
    WHERE entity_a = ? OR entity_b = ?
    ORDER BY co_occurrence_count DESC, avg_path_similarity DESC
    LIMIT ?
  `).all(entityId, entityId, entityId, limit) as PathAssociation[];
}

/**
 * Get navigation stats
 */
export function getNavigationStats() {
  const db = getDB();
  
  const sessions = db.query('SELECT COUNT(*) as count FROM navigation_sessions').get() as { count: number };
  const associations = db.query('SELECT COUNT(*) as count FROM path_associations').get() as { count: number };
  const avgPathLength = db.query(`
    SELECT AVG(json_array_length(path)) as avg FROM navigation_sessions
  `).get() as { avg: number };
  
  return {
    totalSessions: sessions.count,
    totalAssociations: associations.count,
    avgPathLength: avgPathLength.avg || 0,
  };
}

/**
 * Get recent navigation paths
 */
export function getRecentPaths(limit: number = 20): NavigationSession[] {
  const db = getDB();
  
  const rows = db.query(`
    SELECT id, path, path_text, final_entity, dwell_time_ms, created_at
    FROM navigation_sessions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as {
    id: string;
    path: string;
    path_text: string;
    final_entity: string | null;
    dwell_time_ms: number | null;
    created_at: string;
  }[];

  return rows.map(row => ({
    id: row.id,
    path: JSON.parse(row.path),
    pathText: row.path_text,
    finalEntity: row.final_entity,
    dwellTimeMs: row.dwell_time_ms,
    createdAt: row.created_at,
  }));
}

