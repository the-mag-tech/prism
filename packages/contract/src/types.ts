/**
 * Prism Contract - Shared Type Definitions
 * 
 * This module defines the data contract between Prism Server and Magpie.
 * 
 * Design Principles:
 * 1. Prism Server owns CONTENT (title, body, relationships)
 * 2. Magpie owns PRESENTATION (colors, layout, animations)
 * 3. Entity ID is the bridge: "event:meeting-simon" → type derivation
 * 
 * SSOT (Single Source of Truth) for Colors:
 * - Color is ALWAYS derived from entity.id prefix
 * - "news:seed_funding" → intel → blue
 * - "event:meeting" → action → red
 * - "person:simon" → context → white
 * - See: prism-server/src/entity-semantics.ts for full mapping
 * 
 * Type System Hierarchy (2025-01-02):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  StorageOrigin (内容来源)                                        │
 * │  - How content entered the system (scout, user drop, email...)  │
 * │  - Stored in: memories.source_type                               │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  EntityCategory (实体类别)                                       │
 * │  - What kind of entity it is (person, event, project...)        │
 * │  - Stored in: entity.id prefix                                   │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  SemanticRole (语义角色) - Defined in entity-semantics.ts        │
 * │  - UI presentation role (anchor, intel, spark, context...)      │
 * │  - Derived from EntityCategory + context                         │
 * └─────────────────────────────────────────────────────────────────┘
 */

// =============================================================================
// STORAGE ORIGIN (内容来源 - memories.source_type)
// =============================================================================

/**
 * StorageOrigin - How content entered the system.
 * 
 * This is stored in `memories.source_type` and determines:
 * - Default entity prefix (finding: vs memory:)
 * - Processing pipeline (Scout extraction vs user import)
 * 
 * IMPORTANT: This is DIFFERENT from EntityCategory!
 * - StorageOrigin: "Where did this content come from?"
 * - EntityCategory: "What kind of entity is this?"
 */
export type StorageOrigin =
  | 'scout_snapshot'  // Scout discovered web content (HTTP/HTTPS URL)
  | 'user_drop'       // User manually imported content (local file)
  | 'email_sync'      // Synced from email (future)
  | 'rss_feed'        // RSS subscription (future)
  | 'api_ingest';     // API-based import (future)

/**
 * All valid storage origins (for validation).
 */
export const ALL_STORAGE_ORIGINS: StorageOrigin[] = [
  'scout_snapshot', 'user_drop', 'email_sync', 'rss_feed', 'api_ingest'
];

/**
 * Maps StorageOrigin to default EntityCategory prefix.
 * When content is ingested, this determines the entity ID prefix.
 */
export const STORAGE_ORIGIN_TO_DEFAULT_CATEGORY: Record<StorageOrigin, string> = {
  scout_snapshot: 'finding',  // finding:123
  user_drop: 'memory',        // memory:123
  email_sync: 'memory',       // memory:123 (future: may need dedicated type)
  rss_feed: 'news',           // news:123
  api_ingest: 'memory',       // memory:123
};

// =============================================================================
// ENTITY TYPE DEFINITIONS (SSOT)
// =============================================================================

/**
 * Entity Type Definitions - SINGLE SOURCE OF TRUTH
 * 
 * This dict defines ALL valid entity types and their descriptions.
 * Used by:
 * - Extract Prompt (dynamic injection)
 * - Extract Validation (whitelist)
 * - Prism Server (DB operations)
 * - Magpie (Rendering)
 * 
 * To add a new type: add it here, and all systems will automatically support it.
 */
/**
 * Entity Type Definitions - Simplified view for API contracts.
 * 
 * Classification Philosophy: Four Tribes of Memory
 * @see apps/landing/content/blog/the-four-tribes.md
 * @see packages/prism-contract/src/entity-definitions.ts for full definitions
 */
export const ENTITY_TYPE_DEFINITIONS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // SOURCE LAYER (独立于 Four Tribes - 不是 AI 提取)
  // ═══════════════════════════════════════════════════════════════════════════
  memory:     'User-ingested raw content (markdown, email, pdf, etc.)',
  finding:    'Scout-fetched external webpage snapshots',

  // ═══════════════════════════════════════════════════════════════════════════
  // FROM ARCHIVIST (PKM) - 结构化思想
  // ═══════════════════════════════════════════════════════════════════════════
  topic:      'Recurring themes or subjects (AI, Design, etc.)',
  concept:    'Abstract ideas, frameworks, or mental models',
  problem:    'Explicit problems, pain points, or issues',
  insight:    'Crystallized thoughts, observations, or learnings',

  // ═══════════════════════════════════════════════════════════════════════════
  // FROM SALESMAN (CRM) - 人脉网络
  // ═══════════════════════════════════════════════════════════════════════════
  person:     'Named individuals in your network',
  company:    'Organizations or businesses',
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FROM GARDENER (PRM) - 关系细节
  // ═══════════════════════════════════════════════════════════════════════════
  gift:       'Gift ideas for people',
  hobby:      'Hobbies and interests',
  location:   'Places and venues',
  agenda:     'Meeting agendas',
  cheatsheet: 'Prep materials and notes',

  // ═══════════════════════════════════════════════════════════════════════════
  // FROM LOGGER (Lifelogging) - 时间线标记
  // ═══════════════════════════════════════════════════════════════════════════
  event:      'Time-bound occurrences (meetings, launches, deadlines)',
  news:       'External signal spikes (funding, announcements)',
  milestone:  'Project phases or progress markers (v1 Launch, Seed Round)',
  decision:   'Key choices made or concluded',
  project:    'Named endeavors or products',
} as const;

/**
 * All valid entity type keys.
 * Derived from ENTITY_TYPE_DEFINITIONS.
 */
export const ALL_ENTITY_TYPES = Object.keys(ENTITY_TYPE_DEFINITIONS) as (keyof typeof ENTITY_TYPE_DEFINITIONS)[];

/**
 * Entity category type.
 * @example "event:meeting-simon" → category = "event"
 */
export type EntityCategory = keyof typeof ENTITY_TYPE_DEFINITIONS | 'unknown';

/**
 * Types that AI extraction can produce.
 * Subset of all types - excludes system/UI types.
 */
/**
 * Types that AI extraction can produce from SOURCE content.
 * Does NOT include memory/finding (which are SOURCE, not EXTRACTED).
 * 
 * Organized by Four Tribes:
 * - ARCHIVIST: topic, concept, problem, insight
 * - SALESMAN: person, company
 * - GARDENER: gift, hobby, location, agenda, cheatsheet
 * - LOGGER: event, news, milestone, decision, project
 */
export const EXTRACTABLE_TYPES = [
  // FROM ARCHIVIST (PKM)
  'topic', 'concept', 'problem', 'insight',
  // FROM SALESMAN (CRM)
  'person', 'company',
  // FROM GARDENER (PRM)
  'gift', 'hobby', 'location', 'agenda', 'cheatsheet',
  // FROM LOGGER (Lifelogging)
  'event', 'news', 'milestone', 'decision', 'project',
] as const;

export type ExtractableType = typeof EXTRACTABLE_TYPES[number];

// =============================================================================
// RELATION TYPES
// =============================================================================

/**
 * Types of relationships between entities.
 * Used for future graph visualization and relationship reasoning.
 */
export type RelationType =
  | 'participant'   // Person participated in event
  | 'mentioned'     // Entity mentioned in content
  | 'about'         // Content is about this topic/entity
  | 'followup'      // Follow-up task/action
  | 'related'       // Generic relationship
  | 'co-occurred';  // Appeared together (e.g., same email thread)

// =============================================================================
// PRISM DATA STRUCTURES
// =============================================================================

/**
 * A single block of content from Prism Server.
 * 
 * Note: This is PURE DATA - no layout or styling information.
 * Magpie is responsible for deriving visual properties from the ID.
 */
export interface PrismBlock {
  /** 
   * Unique identifier with type prefix.
   * Format: "{category}:{slug}"
   * @example "event:meeting-simon", "person:alice", "topic:ai"
   */
  id: string;

  /** Primary display text */
  title: string;

  /** Secondary display text (optional) */
  subtitle?: string;

  /** Extended content (optional) */
  body?: string;

  /** 
   * Navigation target when clicked (optional).
   * If omitted, clicking navigates to this block's own page (id).
   */
  target?: string;

  /** Action label for CTA button (optional) */
  action?: string;

  /** 
   * Tag/label for categorization.
   * @deprecated Magpie now computes display tag from entity ID + gravity signals.
   * Use `displayTag` (computed by Magpie) for rendering.
   * @see apps/magpie/src/lib/entity-system.ts (deriveDisplayTag)
   */
  tag?: string;

  // ==========================================================================
  // GRAVITY FIELDS (Physics System)
  // ==========================================================================

  /**
   * Computed gravity score (0-1).
   * Used by Magpie for sorting blocks by importance.
   * Higher gravity = higher visual prominence.
   */
  gravity_score?: number;

  /**
   * Spark component score (0-1).
   * Indicates novelty/freshness from PhysicsSystem.
   * Used by Magpie to:
   * - Display "SPARK" badge when > 0.5
   * - Control badge opacity (fades as spark decays)
   * 
   * @see PhysicsSystem.calculateSpark() for calculation logic
   */
  spark_score?: number;

  // ==========================================================================
  // LAYOUT FIELDS (Deprecated - Magpie computes these from gravity_score)
  // ==========================================================================

  /** 
   * @deprecated Removed in Phase 2. Magpie computes from gravity_score.
   * @see apps/magpie/src/lib/data-layer.ts (getLayoutHint)
   */
  cols?: number;

  /** 
   * @deprecated Removed in Phase 2. Magpie computes from gravity_score.
   */
  rows?: number;

  /** 
   * @deprecated Removed in Phase 2. Magpie computes from entity ID.
   * @see apps/magpie/src/lib/entity-system.ts (processBlock)
   */
  colorClass?: string;

  /** 
   * @deprecated Removed in Phase 2. Use colorClass derivation.
   */
  type?: string;

  /** Whether this is the Omnibar block (Magpie) */
  isOmnibar?: boolean;

  /** Whether this is a header block (Magpie) */
  isHeader?: boolean;

  // ==========================================================================
  // PUBLIC CONTENT FIELDS (Scout Anything)
  // ==========================================================================

  /**
   * Whether this block is from a public/external source.
   * Public blocks have visual distinction (foggy effect, source attribution).
   * @default false
   */
  isPublic?: boolean;

  /**
   * Source name for public content.
   * Displayed as attribution (e.g., "Reuters", "TechCrunch").
   * Only relevant when isPublic is true.
   */
  publicSource?: string;

  /**
   * External URL for public content.
   * Used for "Read original →" link, NOT for block click navigation.
   * Only relevant when isPublic is true.
   */
  publicUrl?: string;

  /**
   * Publication time for public content (ISO string).
   * Displayed as relative time (e.g., "2h ago").
   * Only relevant when isPublic is true.
   */
  publicTime?: string;

  // ==========================================================================
  // DROP-TO-GRID FIELDS
  // ==========================================================================

  /**
   * Whether this block can be discarded (×  button shown).
   * Used for recently imported memories via Drop-to-Grid.
   * @default false
   */
  canDiscard?: boolean;
}

/**
 * An explicit relationship between two entities.
 * Optional - used for graph visualization and relationship reasoning.
 */
export interface PrismRelation {
  /** Source entity ID */
  source: string;

  /** Target entity ID */
  target: string;

  /** Type of relationship */
  type: RelationType;

  /** Relationship strength (0-1, optional) */
  weight?: number;

  /** Evidence/source of this relationship (e.g., email ID) */
  evidence?: string;
}

/**
 * A page of content from Prism Server.
 * Represents a "perspective" centered on a specific entity.
 */
export interface PrismPage {
  /** 
   * Page identifier - matches the central entity.
   * @example "event:meeting-simon" for a meeting page
   */
  id: string;

  /** 
   * Blocks to display on this page.
   * First block is typically the "header" (the central entity itself).
   */
  blocks: PrismBlock[];

  /** 
   * Explicit relationships (optional).
   * Reserved for future graph visualization.
   */
  relations?: PrismRelation[];
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * Response from GET /pages
 */
export interface PagesListResponse {
  pages: Array<{
    id: string;
    title: string;
  }>;
}

/**
 * Response from GET /pages/:id
 */
export interface PageResponse {
  page: PrismPage;
}

/**
 * Generic error response
 */
export interface ErrorResponse {
  error: string;
  details?: string;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Extracts entity category from ID.
 * @example extractCategory("event:meeting-simon") → "event"
 */
export function extractCategory(id: string): EntityCategory {
  const prefix = id.split(':')[0];
  
  // Validate against known categories (uses SSOT)
  if (prefix in ENTITY_TYPE_DEFINITIONS) {
    return prefix as EntityCategory;
  }
  
  return 'unknown';
}

/**
 * Validates that an ID follows the correct format.
 * @example isValidId("event:meeting-simon") → true
 * @example isValidId("invalid") → false
 */
export function isValidId(id: string): boolean {
  const parts = id.split(':');
  if (parts.length < 2) return false;
  const category = extractCategory(id);
  return category !== 'unknown';
}

// =============================================================================
// SEARCH API TYPES (Unified Type System)
// =============================================================================

/**
 * Source types for API filtering.
 * 
 * These are "high-level" source types used in API queries:
 * - 'entity': Regular entities (excludes memory:, finding:, public:)
 * - 'finding': Scout discoveries (memories with source_type='scout_snapshot')
 * - 'memory': User memories (memories with source_type!='scout_snapshot')
 * - 'public': External public content (public_content table)
 * 
 * @deprecated Use `categories` parameter for entity filtering instead.
 * This parameter is kept for backward compatibility.
 */
export type SourceType = 'entity' | 'finding' | 'memory' | 'public';

/**
 * Entity search parameters - Unified API interface.
 * 
 * This provides a clean separation between:
 * - `sources`: Filter by content source (entity, finding, memory, public)
 * - `categories`: Filter by entity ID prefix (event, person, project...)
 * 
 * @example
 * // Get all event and decision entities (anchor slot)
 * searchEntities({ sources: ['entity'], categories: ['event', 'decision'] })
 * 
 * @example
 * // Get all findings (spark slot)
 * searchEntities({ sources: ['finding'] })
 * 
 * @example
 * // Get all person entities (context slot)
 * searchEntities({ sources: ['entity'], categories: ['person', 'memory'] })
 */
export interface EntitySearchParams {
  /**
   * Full-text search query (optional).
   * Searches across title, body, and related fields.
   */
  q?: string;

  /**
   * Filter by source type (backward compatible).
   * - 'entity': Regular extracted entities
   * - 'finding': Scout discoveries
   * - 'memory': User-dropped content
   * - 'public': Public/external content
   * 
   * @default ['entity', 'finding', 'memory', 'public']
   */
  sources?: SourceType[];

  /**
   * Filter by entity ID prefix (NEW).
   * Only applies when sources includes 'entity'.
   * 
   * @example ['event', 'decision'] - Get only event and decision entities
   * @example ['person'] - Get only person entities
   */
  categories?: EntityCategory[];

  /**
   * Maximum results to return.
   * @default 20
   * @max 100
   */
  limit?: number;

  /**
   * Pagination offset.
   * @default 0
   */
  offset?: number;

  /**
   * Sort field.
   * - 'gravity': Sort by importance (default for browse)
   * - 'relevance': Sort by search match (default when q is provided)
   * - 'created_at': Sort by creation time
   * 
   * @default 'gravity' (or 'relevance' if q is provided)
   */
  sort?: 'gravity' | 'relevance' | 'created_at';

  /**
   * Sort order.
   * @default 'desc'
   */
  order?: 'asc' | 'desc';
}

/**
 * Entity search result item.
 */
export interface EntitySearchResult {
  /** Entity ID (e.g., "event:meeting-simon") */
  id: string;

  /** Entity category extracted from ID */
  type: string;

  /** Display title */
  title: string;

  /** Secondary text */
  subtitle?: string;

  /** Content body */
  body?: string;

  /** Display tag */
  tag?: string;

  /** Gravity score (0-1) */
  gravity: number;

  /** Creation timestamp */
  created_at?: string;

  /** Source type for this result */
  source_type: SourceType;

  /** Search relevance score (when q is provided) */
  relevance?: number;

  /** Source URL (for findings) */
  sourceUrl?: string;
}

/**
 * Entity search response.
 */
export interface EntitySearchResponse {
  results: EntitySearchResult[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    query?: string;
    sources: SourceType[];
    categories?: EntityCategory[];
    sort: string;
    order: string;
    took_ms: number;
  };
}