import type { EntityType } from '@prism/contract';

export interface GraphEntity {
    id: string; // e.g. "person:simon"
    title: string;
    subtitle?: string;
    body?: string;
    type: EntityType;
    created_at?: string;
    updated_at?: string;
    last_scouted_at?: string;
}

export interface GraphRelation {
    source: string;
    target: string;
    type: string; // "created", "mentions", "related_to"
    weight?: number;
}

export interface EntityAnnotation {
    entityId: string;
    key: "irony" | "conflict" | "novelty" | "usage" | "evidence" | "emotional" | "causal";
    value: any; // JSON payload
    createdAt: string;
}

// Re-exporting/Adapting Scout types for compatibility
export interface ScoutEntity {
    name: string;
    type: EntityType;
    context: string;
    searchQuery: string;
    prismId?: string;
}

export interface GroundedResult {
    originalEntity: ScoutEntity;
    foundMemoryId?: number;
    foundUrl?: string;
    summary?: string;
    confidence: number;  // Now equals serendipity score (information gain)
    extractedEntitiesCount?: number;
    serendipityReason?: string;  // Explanation of serendipity evaluation
}

export interface GraphMiddlewareContext {
    op: 'ingest' | 'upsert' | 'annotate';
    payload: any;
    result?: any;
}

export type GraphMiddleware = (
    context: GraphMiddlewareContext,
    next: () => Promise<void>
) => Promise<void>;

/**
 * Raw search result from Tavily or similar
 */
export interface RawSearchSource {
    title: string;
    url: string;
    snippet: string;
    score?: number;
    publishedDate?: string;
    query: string; // Which query found this result
}

/**
 * Metadata about the search process
 */
export interface SearchMetadata {
    queries: string[];           // Search queries used
    totalResults: number;        // Total results found
    searchEngine: string;        // 'tavily' | 'none'
    timestamp: string;           // When search was performed
    aiAnswers?: string[];        // AI-generated summaries from search
}

export interface EntityProfile {
    name: string;
    bio: string;
    avatar?: string;
    role?: string;
    tags: string[];
    keyLinks: { title: string; url: string; source: 'search' | 'llm' }[]; // Added source tracking
    relatedEntities: { name: string; reason: string; type: EntityType }[];
    assets?: string[];
    // New fields for transparency
    rawSources?: RawSearchSource[];    // Original search results
    searchMetadata?: SearchMetadata;   // Search process info
}

/**
 * Options for enrichContext() fingerprint generation
 */
export interface EnrichContextOptions {
    /** Include relations in fingerprint (default: true) */
    includeRelations?: boolean;
    /** Max number of relations to include (default: 3) */
    relationLimit?: number;
    /** Max body length to include (default: 100) */
    bodyLength?: number;
    /** Output format (default: 'string') */
    format?: 'string' | 'structured';
}

/**
 * Structured fingerprint result (when format: 'structured')
 */
export interface EntityFingerprint {
    entityId: string;
    title: string;
    subtitle?: string;
    bodyExcerpt?: string;
    relatedTerms: string[];
    fingerprint: string;  // Combined string for search queries
}

/**
 * Result of surprise/serendipity calculation
 * 
 * Surprise measures how different new content is from existing graph knowledge.
 * Used to filter out redundant content and prioritize novel insights.
 */
export interface SurpriseScore {
    /** 0.0 = redundant, 1.0 = paradigm shift */
    score: number;
    /** Brief explanation of the score */
    reason: string;
    /** Whether this content should be ingested based on threshold */
    shouldIngest: boolean;
}
