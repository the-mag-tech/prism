/**
 * Prism Contract - Public API
 * 
 * This package defines the data contract between Prism Server and Magpie.
 */

// Types
export type {
  // Storage & Entity types
  StorageOrigin,
  EntityCategory,
  ExtractableType,
  RelationType,
  // Data structures
  PrismBlock,
  PrismRelation,
  PrismPage,
  // API types
  PagesListResponse,
  PageResponse,
  ErrorResponse,
  // Search API types (Unified Type System)
  SourceType,
  EntitySearchParams,
  EntitySearchResult,
  EntitySearchResponse,
} from './types.js';

// Constants (SSOT for entity types)
export {
  // Storage origins
  ALL_STORAGE_ORIGINS,
  STORAGE_ORIGIN_TO_DEFAULT_CATEGORY,
  // Entity types
  ENTITY_TYPE_DEFINITIONS,
  ALL_ENTITY_TYPES,
  EXTRACTABLE_TYPES,
} from './types.js';

// Utility functions
export {
  extractCategory,
  isValidId,
} from './types.js';

// Runtime validation functions
export {
  validateEntityId,
  validateBlock,
  validateRelation,
  validatePage,
} from './schema.js';

// Shared Constants (SSOT)
export {
  SCOUT_QUOTA_DEFAULT,
  SCOUT_COST_PER_CALL,
  TAVILY_DAILY_QUOTA,
  QVERIS_DAILY_QUOTA,
  OPENAI_TOKEN_DAILY_QUOTA,
} from './constants.js';

// Entity Definitions (Four Tribes)
export {
  ENTITY_DEFINITIONS as ENTITY_TYPE_DEFINITIONS_V2,
  PROFILEABLE_TYPES,
  SCOUTABLE_TYPES,
  TRIBE_PROFILE_STRATEGIES,
  getTribeFromType,
  getTribeFromEntityId,
  needsProfileEnrichment,
  isScoutableType,
  getTypesByTribe,
} from './entity-definitions.js';

export type {
  EntityDefinition,
  EntityType,
  Tribe,
} from './entity-definitions.js';

// Schema Expectations (Data Gap Detection)
export {
  ENTITY_SCHEMA_EXPECTATIONS,
  getExpectationsForType,
  getHighPriorityExpectations,
  generateGapQuery,
  getTypesWithExpectations,
  isExpectedRelation,
} from './schema-expectations.js';

export type {
  GapPriority,
  ExpectedRelation,
} from './schema-expectations.js';
