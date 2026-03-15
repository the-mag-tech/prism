/**
 * Ripple System Types
 * 
 * The Ripple System propagates changes through the knowledge graph.
 * It uses Serendipity (surprise) scoring to decide what's worth spreading.
 */

import { PROFILEABLE_TYPES, type EntityType } from '@prism/contract';

// =============================================================================
// CORE TYPES
// =============================================================================

/**
 * Events that can trigger a ripple
 */
export type RippleEventType = 
  | 'ENTITY_CREATED'      // New entity extracted from content
  | 'ENTITY_UPDATED'      // Entity properties changed
  | 'ENTITY_MERGED'       // Two entities merged (deduplication)
  | 'SCOUT_CONFIRMED'     // Scout found new facts about entity
  | 'USER_CORRECTION';    // User manually corrected entity

/**
 * A ripple event - triggers propagation through the graph
 */
export interface RippleEvent {
  type: RippleEventType;
  entityId: string;
  entityType: EntityType;
  entityTitle: string;
  context?: string;           // Additional context for profiling
  trigger: 'user' | 'system' | 'scout';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Result of a ripple propagation
 */
export interface RippleResult {
  entityId: string;
  profileGenerated: boolean;
  contentIngested: number;      // Number of articles/pages ingested
  entitiesDiscovered: number;   // New entities found via ripple
  relationsCreated: number;     // New relations established
  surpriseScore: number;        // Average surprise of ingested content
  duration: number;             // Time taken in ms
}

/**
 * Entity profile synthesized from web search
 */
export interface EntityProfile {
  name: string;
  type: EntityType;
  role?: string;              // e.g., "Datasette creator", "AI researcher"
  bio?: string;               // Synthesized biography
  tags?: string[];            // Relevant tags
  keyLinks?: Array<{
    title: string;
    url: string;
  }>;
  relatedEntities?: Array<{
    name: string;
    type: EntityType;
    reason: string;
  }>;
  assets?: string[];          // Core principles, quotes, etc.
}

/**
 * Configuration for ripple propagation
 */
export interface RippleConfig {
  // Cost control
  maxEntitiesPerRipple: number;     // Max entities to ripple per trigger (default: 3)
  maxContentPerEntity: number;       // Max articles to ingest per entity (default: 3)
  maxDepth: number;                  // Max ripple depth (default: 1)
  
  // Quality control
  minSurpriseThreshold: number;      // Min surprise score to ingest (default: 0.5)
  
  // Type filtering - uses SSOT from entity-definitions.ts
  scoutableTypes: EntityType[];      // Entity types worth rippling (default: PROFILEABLE_TYPES)
}

/**
 * Default ripple configuration
 * 
 * Note: scoutableTypes now uses PROFILEABLE_TYPES from entity-definitions.ts (SSOT)
 * This includes all types from SALESMAN and LOGGER tribes that benefit from profile enrichment.
 */
export const DEFAULT_RIPPLE_CONFIG: RippleConfig = {
  maxEntitiesPerRipple: 3,
  maxContentPerEntity: 3,
  maxDepth: 1,
  minSurpriseThreshold: 0.65,  // Raised from 0.5 to reduce noise (only ingest truly surprising content)
  scoutableTypes: PROFILEABLE_TYPES as EntityType[],  // SSOT: person, company, project
};

// =============================================================================
// STRATEGY TYPES
// =============================================================================

/**
 * Strategy for how to search/profile different entity types
 */
export interface RippleStrategy {
  type: EntityType;
  
  // Generate search queries for this entity type
  generateQueries(entity: { title: string; subtitle?: string; body?: string }): string[];
  
  // What kind of content to prioritize
  contentPriority: 'thoughts' | 'evolution' | 'strategy' | 'debate';
}

/**
 * Search candidate before surprise evaluation
 */
export interface SearchCandidate {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

/**
 * Evaluated candidate with surprise score
 */
export interface EvaluatedCandidate extends SearchCandidate {
  surpriseScore: number;
  shouldIngest: boolean;
  reason?: string;
}







