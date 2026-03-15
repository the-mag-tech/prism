/**
 * Entity Semantics - Backend Utilities
 * 
 * IMPORTANT: SemanticRole (anchor, intel, spark, context, feed, signal) is now
 * owned by the FRONTEND (Magpie). This file only provides backend utilities.
 * 
 * Design Principle (from ANTIGRAVITY-SPEC.md):
 * - Prism Server owns CONTENT (title, body, relationships, EntityCategory)
 * - Magpie owns PRESENTATION (colors, layout, SemanticRole)
 * 
 * @see apps/magpie/src/lib/entity-semantics-api.ts for SemanticRole SSOT
 */

import { ALL_ENTITY_TYPES, ENTITY_TYPE_DEFINITIONS } from '@prism/contract';

// =============================================================================
// TAG GENERATION (Backend-only)
// =============================================================================

/**
 * Get display tag for an entity type.
 * 
 * Returns the EntityCategory in uppercase (e.g., "event" → "EVENT").
 * This is stored in entity.tag field for display purposes.
 * 
 * The frontend may choose to display this differently based on SemanticRole
 * mapping (e.g., "EVENT" might be rendered as "ANCHOR" in the UI).
 * 
 * @param entityType - Entity type prefix (e.g., "event", "person")
 * @returns Uppercase tag string (e.g., "EVENT", "PERSON")
 */
export function getTagForEntityType(entityType: string): string {
  return entityType.toUpperCase();
}

// =============================================================================
// API RESPONSE TYPE
// =============================================================================

/**
 * API response for entity categories (SSOT from prism-contract).
 * 
 * Backend provides: valid entity type prefixes
 * Frontend handles: category → SemanticRole → color mapping
 */
export interface EntityCategoriesConfig {
  /** Valid entity type prefixes (from prism-contract SSOT) */
  categories: string[];
  /** Version for cache invalidation */
  version: string;
}

/**
 * Get category list for API response.
 * Frontend uses this to validate entity IDs and derive SemanticRole.
 */
export function getEntityCategoriesConfig(): EntityCategoriesConfig {
  return {
    categories: ALL_ENTITY_TYPES,
    version: '3.0.0', // Bumped: SemanticRole moved to frontend
  };
}

// =============================================================================
// DEPRECATED EXPORTS (for backward compatibility during migration)
// =============================================================================

/**
 * @deprecated SemanticRole is now owned by frontend.
 * Use apps/magpie/src/lib/entity-semantics-api.ts instead.
 */
export type SemanticRole = 'anchor' | 'intel' | 'spark' | 'context';

/**
 * @deprecated Use getTagForEntityType() which returns EntityCategory.toUpperCase()
 */
export function getRoleFromEntityId(entityId: string): SemanticRole {
  console.warn('[DEPRECATED] getRoleFromEntityId() - SemanticRole is now frontend-only');
  return 'context';
}

/**
 * @deprecated Use getTagForEntityType() which returns EntityCategory.toUpperCase()
 */
export function getBlockRole(entityId: string, tag?: string): SemanticRole {
  console.warn('[DEPRECATED] getBlockRole() - SemanticRole is now frontend-only');
  return 'context';
}
