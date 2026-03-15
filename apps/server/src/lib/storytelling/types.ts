/**
 * @module storytelling/types
 * @description Type definitions for the Storytelling module
 * 
 * Keywords: STORYTELLING_TYPES, NARRATIVE_TYPES, TRIBE_TYPES, STORY_STRUCTURE
 */

// =============================================================================
// TRIBE SYSTEM
// =============================================================================

/**
 * The four narrative Tribes, each with a distinct relationship to information
 */
export type TribeStyle = 'archivist' | 'salesman' | 'gardener' | 'logger';

/**
 * Tribe Vector - represents a user's blend of narrative preferences
 * Each value is 0-1, sum should approximate 1.0
 */
export interface TribeVector {
  archivist: number;  // Loves discovering hidden connections
  salesman: number;   // Focused on opportunities and timing
  gardener: number;   // Values authentic human connection
  logger: number;     // Seeks self-understanding through patterns
}

// =============================================================================
// STORY LENGTH
// =============================================================================

/**
 * Story length presets
 */
export type StoryLength = 'micro' | 'short' | 'medium' | 'long';

/**
 * Length configuration
 */
export const STORY_LENGTH_CONFIG: Record<StoryLength, {
  durationSeconds: [number, number];
  wordCount: [number, number];
  description: string;
}> = {
  micro: {
    durationSeconds: [10, 30],
    wordCount: [50, 100],
    description: 'Notifications, quick alerts',
  },
  short: {
    durationSeconds: [60, 120],
    wordCount: [200, 400],
    description: 'Daily brief, single insight',
  },
  medium: {
    durationSeconds: [180, 300],
    wordCount: [500, 800],
    description: 'Weekly summary, deep dive',
  },
  long: {
    durationSeconds: [300, 600],
    wordCount: [800, 1500],
    description: 'Full narrative, multiple threads',
  },
};

// =============================================================================
// STORY STRUCTURE (Ira Glass Model)
// =============================================================================

/**
 * Hook - the opening that grabs attention
 */
export interface StoryHook {
  type: 'surprise' | 'urgency' | 'curiosity' | 'relevance';
  entity: StoryEntity;
  reason: string;
}

/**
 * Protagonist - the main character/entity of the story
 */
export interface StoryProtagonist {
  entity: StoryEntity;
  userRelation: string;  // How does the user relate to this entity?
  currentState: string;  // What's happening with this entity now?
}

/**
 * Tension - the conflict or question driving the story
 */
export interface StoryTension {
  type: 'unknown' | 'changing' | 'fading' | 'converging';
  description: string;
}

/**
 * Journey - the path through entities and relations
 */
export interface StoryJourney {
  path: StoryRelation[];
  waypoints: StoryEntity[];
}

/**
 * Insight - the "moment of reflection" (Ira Glass)
 */
export interface StoryInsight {
  type: 'connection' | 'pattern' | 'prediction' | 'reflection';
  content: string;
}

/**
 * Resolution - how the story ends
 */
export interface StoryResolution {
  type: 'action' | 'question' | 'open';
  content: string;
}

/**
 * Complete Story Structure - the skeleton before rendering
 */
export interface StoryStructure {
  hook: StoryHook;
  protagonist: StoryProtagonist;
  tension: StoryTension;
  journey: StoryJourney;
  insight: StoryInsight;
  resolution: StoryResolution;
}

// =============================================================================
// GRAPH SNAPSHOT (Input)
// =============================================================================

/**
 * Simplified Entity for storytelling (subset of full Entity)
 */
export interface StoryEntity {
  id: string;
  title: string;
  subtitle?: string | null;
  type: string;
  gravity?: number;
  spark?: number;
  body?: string | null;
}

/**
 * Simplified Relation for storytelling
 */
export interface StoryRelation {
  from_id: string;
  to_id: string;
  type: string;
  description?: string | null;
}

/**
 * Scout Finding for storytelling
 */
export interface StoryFinding {
  id: number;
  title: string;
  snippet: string;
  sourceType: string;
  entityId?: string;
}

/**
 * Temporal Pattern detected in user behavior
 */
export interface TemporalPattern {
  type: 'convergence' | 'divergence' | 'cycle' | 'shift';
  description: string;
  entities: string[];  // Entity IDs involved
  timeframe: string;   // e.g., "past 7 days"
}

/**
 * Graph Snapshot - the raw material for story generation
 */
export interface GraphSnapshot {
  // Core entities by role
  topGravityEntities: StoryEntity[];   // Main characters (high gravity)
  recentSparks: StoryEntity[];         // New discoveries (high spark)
  dormantEntities: StoryEntity[];      // Sleeping connections (low recent activity)
  
  // Connections
  relations: StoryRelation[];
  
  // Discoveries
  serendipityFindings: StoryFinding[];
  
  // Patterns
  temporalPatterns: TemporalPattern[];
  
  // Context
  timestamp: Date;
  userId?: string;
}

// =============================================================================
// GENERATION CONFIG
// =============================================================================

/**
 * Configuration for story generation
 */
export interface StoryGenerationConfig {
  /** The graph data to generate story from */
  graphSnapshot: GraphSnapshot;
  
  /** Narrative style - single tribe or vector */
  tribeStyle: TribeStyle | TribeVector;
  
  /** Target length */
  targetLength: StoryLength;
  
  /** Optional: Focus on a specific entity */
  focusEntityId?: string;
  
  /** Optional: Include timestamp in narrative */
  includeTimestamp?: boolean;
  
  /** Optional: Language (default: 'en') */
  language?: 'en' | 'zh-CN' | 'ja';
}

// =============================================================================
// GENERATION OUTPUT
// =============================================================================

/**
 * Generated Story - the final output
 */
export interface GeneratedStory {
  /** The narrative text */
  text: string;
  
  /** The underlying structure */
  structure: StoryStructure;
  
  /** Tribe style used */
  tribeStyle: TribeStyle;
  
  /** Actual word count */
  wordCount: number;
  
  /** Estimated reading time in seconds */
  estimatedDuration: number;
  
  /** Entities mentioned in the story */
  mentionedEntities: string[];
  
  /** Generation metadata */
  metadata: {
    generatedAt: Date;
    targetLength: StoryLength;
    language: string;
  };
}

// =============================================================================
// TRIBE STYLE TEMPLATE
// =============================================================================

/**
 * Template for a Tribe narrative style
 */
export interface TribeStyleTemplate {
  name: TribeStyle;
  displayName: string;
  
  // Voice characteristics
  tone: string;
  pace: string;
  vocabulary: string[];
  
  // Story elements
  coreQuestion: string;
  openingPatterns: string[];
  closingPatterns: string[];
  
  // LLM prompt template
  systemPrompt: string;
}

