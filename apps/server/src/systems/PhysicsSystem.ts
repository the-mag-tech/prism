/**
 * Physics System (L2 Origin Engine)
 * 
 * THE SINGLE SOURCE OF TRUTH for Gravity calculation.
 * 
 * INPUT:  Entity Profiles, Relations, Memories (Events)
 * OUTPUT: Gravity scores (via static methods or tick updates)
 * 
 * Usage:
 * - Static methods: `PhysicsSystem.calculateEntityGravity(entity)` for on-demand calculation
 * - Instance tick: `new PhysicsSystem().tick(context)` for batch field simulation
 * 
 * @see docs/ORIGIN-ALGORITHM.md for the Gravity formula
 */

import { getDB } from '../db.js';

// =============================================================================
// TYPES
// =============================================================================

export interface PhysicsContext {
  time: Date;
  lens?: string; // e.g., 'tech', 'design'
  userPath?: string[]; // Last visited IDs (optional, fallback to path_associations)
}

export interface GravityComponents {
  convergence: number; // Mass / Time
  path: number;        // History / Trajectory
  spark: number;       // Novelty / Entropy
  base: number;        // Resting Mass
}

export interface GravityResult {
  gravity: number;
  components: GravityComponents;
}

/**
 * Entity data required for gravity calculation
 * Can be from entities table, memories, or any source
 */
export interface GravityCandidate {
  id: string;
  tag?: string | null;
  base_gravity?: number;
  event_time?: string | null;
  last_scouted_at?: string | null;
  created_at?: string | null;
  source_type?: 'entity' | 'public' | 'memory' | 'finding';
  related_entities_json?: string;
}

// Weights from ANTIGRAVITY-SPEC
const WEIGHTS = {
  convergence: 0.4,
  path: 0.3,
  spark: 0.2,
  base: 0.1 // Base mass provides a floor
};

// =============================================================================
// STATIC API (Single Source of Truth for Gravity Calculation)
// =============================================================================

/**
 * Calculate gravity for a single entity (stateless, on-demand)
 * 
 * This is the canonical implementation - all other gravity calculations
 * should call this function.
 * 
 * @param entity - Entity data with optional temporal fields
 * @param context - Optional context (defaults to current time)
 * @returns Gravity score and component breakdown
 */
export function calculateEntityGravity(
  entity: GravityCandidate,
  context: PhysicsContext = { time: new Date() }
): GravityResult {
  const convergence = calculateConvergence(entity, context);
  
  const path = entity.source_type === 'public' && entity.related_entities_json
    ? calculatePath({ id: JSON.parse(entity.related_entities_json)[0] } as GravityCandidate, context)
    : calculatePath(entity, context);
  
  const spark = calculateSpark(entity, context);
  const base = entity.base_gravity ?? 0.5;

  // The Gravity Equation: G = αC + βP + γS + δBase
  const gravity =
    (WEIGHTS.convergence * convergence) +
    (WEIGHTS.path * path) +
    (WEIGHTS.spark * spark) +
    (WEIGHTS.base * base);

  return {
    gravity,
    components: { convergence, path, spark, base }
  };
}

/**
 * Calculate Convergence Gravity (Time/Event Proximity)
 * Standalone function for direct use
 */
function calculateConvergence(entity: GravityCandidate, context: PhysicsContext): number {
  const tag = entity.tag?.toUpperCase() || '';
  
  // 1. Use real event_time if available
  if (entity.event_time) {
    const eventDate = new Date(entity.event_time);
    const hoursDelta = (eventDate.getTime() - context.time.getTime()) / (1000 * 60 * 60);
    
    if (hoursDelta < -24) return 0.1; // Past event (>24h ago)
    if (hoursDelta < 0) return Math.max(0.3, 1.0 + hoursDelta / 24); // Recent past
    if (hoursDelta <= 24) return 1.0; // Within 24h - high gravity
    if (hoursDelta <= 72) return 0.8; // Within 3 days
    if (hoursDelta <= 168) return 0.5; // Within a week
    return Math.max(0.2, 1.0 / (hoursDelta / 24 + 1));
  }
  
  // 2. Fallback to tag-based heuristics
  if (entity.id?.startsWith('event:')) {
    if (tag.includes('NOW') || tag.includes('TODAY')) return 1.0;
    if (tag.includes('TOMORROW') || tag.includes('TMRW')) return 0.8;
    if (tag.includes('WEEK') || tag.includes('UPCOMING')) return 0.5;
    return 0.3;
  }

  if (entity.id?.startsWith('task:')) {
    if (tag.includes('URGENT')) return 0.9;
    if (tag.includes('TODAY')) return 0.8;
    return 0.4;
  }

  if (tag.includes('URGENT')) return 0.8;
  if (tag.includes('TODAY')) return 0.6;
  
  return 0;
}

/**
 * Calculate Path Gravity (Context/History)
 * Based on path_associations table (co-occurrence from user navigation)
 */
function calculatePath(entity: GravityCandidate, context: PhysicsContext): number {
  const db = getDB();
  
  // 1. Check if entity is in the current user path (if provided)
  if (context.userPath && context.userPath.includes(entity.id)) {
    return 1.0; // Direct hit
  }
  
  // 2. Use path_associations for learned co-occurrence
  try {
    const tableExists = db.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='path_associations'
    `).get();
    
    if (!tableExists) return 0;
    
    const associations = db.query(`
      SELECT 
        SUM(co_occurrence_count) as total_cooccurrence,
        AVG(avg_path_similarity) as avg_similarity
      FROM path_associations
      WHERE entity_a = ? OR entity_b = ?
    `).get(entity.id, entity.id) as { total_cooccurrence: number | null; avg_similarity: number | null };
    
    if (associations.total_cooccurrence) {
      const cooccurrenceScore = Math.log(1 + associations.total_cooccurrence) / 5;
      const similarityScore = associations.avg_similarity || 0;
      return Math.min(1, cooccurrenceScore * 0.6 + similarityScore * 0.4);
    }
  } catch {
    // Table might not exist
  }
  
  return 0;
}

/**
 * Calculate Spark Gravity (Novelty/Serendipity)
 * Uses last_scouted_at and created_at with exponential decay
 */
function calculateSpark(entity: GravityCandidate, context: PhysicsContext): number {
  const db = getDB();
  const now = context.time.getTime();
  
  // 1. Scout-based novelty (highest priority)
  if (entity.last_scouted_at) {
    const scoutedAt = new Date(entity.last_scouted_at);
    const hoursSince = (now - scoutedAt.getTime()) / (1000 * 60 * 60);
    const scoutSpark = Math.exp(-hoursSince / 24); // 24h half-life
    if (scoutSpark > 0.3) return scoutSpark;
  }
  
  // 2. Creation-based novelty
  if (entity.created_at) {
    const createdAt = new Date(entity.created_at);
    const hoursSince = (now - createdAt.getTime()) / (1000 * 60 * 60);
    
    // Memory specific: High spark for very fresh memories
    if (entity.source_type === 'memory') {
      if (hoursSince < 1) return 1.0; // Brand new < 1h
      if (hoursSince < 4) return 0.8; // Very fresh < 4h
    }
    
    const creationSpark = Math.exp(-hoursSince / 48); // 48h half-life
    if (creationSpark > 0.5) return creationSpark;
  }
  
  // 3. Public content uses fetch time
  if (entity.source_type === 'public') {
    try {
      const fetchedAt = db.query('SELECT fetched_at FROM public_content WHERE id = ?').get(entity.id) as { fetched_at: string } | null;
      if (fetchedAt) {
        const hoursSince = (now - new Date(fetchedAt.fetched_at).getTime()) / (1000 * 60 * 60);
        return Math.exp(-hoursSince / 12); // Fast decay for public content
      }
    } catch { /* ignore */ }
  }
  
  // 4. Weak ties: Low visit count = more spark potential
  try {
    const stats = db.query(`
      SELECT visit_count FROM entity_visit_stats WHERE entity_id = ?
    `).get(entity.id) as { visit_count: number } | null;
    
    if (!stats || stats.visit_count < 3) return 0.8; // Rarely visited = high spark
    if (stats.visit_count < 10) return 0.5;
    return 0.2;
  } catch {
    return 0.5;
  }
}

// =============================================================================
// SYSTEM CLASS (Batch tick operations)
// =============================================================================

export class PhysicsSystem {
  
  /**
   * Run a physics simulation tick.
   * Updates the `entity_physics` table with new gravity values.
   */
  async tick(context: PhysicsContext) {
    const db = getDB();
    const now = context.time.toISOString();

    console.log(`[Physics] Ticking field at ${now} (Lens: ${context.lens || 'General'})`);

    // 1. Load Active Candidates from entity_profiles with physics data
    const candidates = db.query(`
      SELECT 
        p.id, p.type, p.tag, p.event_time, p.last_scouted_at, p.created_at,
        COALESCE(ph.base_mass, 0.5) as base_mass,
        COALESCE(ph.heat, 0) as heat
      FROM entity_profiles p
      LEFT JOIN entity_physics ph ON p.id = ph.entity_id
      WHERE COALESCE(ph.base_mass, 0.5) > 0.1
      LIMIT 200
    `).all() as any[];

    console.log(`[Physics] Simulating ${candidates.length} bodies...`);

    const updateBatch = db.transaction(() => {
      for (const entity of candidates) {
        // Use the canonical gravity calculation
        const candidate: GravityCandidate = {
          id: entity.id,
          tag: entity.tag,
          base_gravity: entity.base_mass,
          event_time: entity.event_time,
          last_scouted_at: entity.last_scouted_at,
          created_at: entity.created_at,
        };
        
        const { gravity, components } = calculateEntityGravity(candidate, context);

        // Update entity_physics table with new gravity and components
        // Heat decays over time but gets contribution from path activity
        const newHeat = Math.max(0, (entity.heat || 0) * 0.95 + (components.path * 0.5));
        
        db.query(`
          INSERT INTO entity_physics (entity_id, gravity, base_mass, convergence, path, spark, heat, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(entity_id) DO UPDATE SET
            gravity = excluded.gravity,
            convergence = excluded.convergence,
            path = excluded.path,
            spark = excluded.spark,
            heat = excluded.heat,
            updated_at = excluded.updated_at
        `).run(
          entity.id, 
          gravity, 
          entity.base_mass,
          components.convergence,
          components.path,
          components.spark,
          newHeat,
          now
        );
        
        // Attach computed values for downstream consumers
        entity._computed_gravity = gravity;
        entity._components = components;
      }
    });

    updateBatch();
    
    return candidates;
  }
}
