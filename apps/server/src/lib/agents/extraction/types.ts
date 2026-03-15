/**
 * Extraction Types
 * 
 * Type definitions for entity extraction from memories.
 * 
 * @since 2026-01-08
 */

import type { ExtractableType } from '@prism/contract';

// Re-export for consumers
export type { ExtractableType };

/**
 * Raw entity extracted by AI
 */
export interface ExtractedEntity {
  type: ExtractableType;
  name: string;           // Used to generate ID: "person:simon"
  title: string;          // Display title
  subtitle?: string;      // Secondary text
  body?: string;          // Extended content
  tag?: string;           // Category tag
  relatedTo?: string[];   // IDs of related entities (format: "type:name")
}

/**
 * Result of single memory extraction
 */
export interface ExtractionResult {
  entities: ExtractedEntity[];
  reasoning: string;
}

/**
 * Memory row from database
 */
export interface MemoryRow {
  id: number;
  source_path: string;
  source_type: string;
  content: string;
  text_content: string | null;  // Plain text version for summaries
  title: string | null;
  created_at: string | null;
}

/**
 * Options for extraction
 */
export interface ExtractOptions {
  strategyVersion?: string;
  description?: string;
  memoryIds?: number[];      // Specific memories to extract from (default: all)
  dryRun?: boolean;          // Preview without saving
  newOnly?: boolean;         // Only process memories not yet extracted
  idempotent?: boolean;      // Idempotent mode: update existing, add missing relations
}

/**
 * Result of batch extraction
 */
export interface ExtractResult {
  batchId: string;
  entitiesCreated: number;
  entitiesSkipped: number;
  memoriesProcessed: number;
  entities: Array<{ id: string; title: string; type: string; fromMemory: number }>;
}
