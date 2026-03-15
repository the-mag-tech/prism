/**
 * Entity Definitions - The ABSOLUTE Single Source of Truth
 * 
 * Classification Philosophy: Four Tribes of Memory
 * @see apps/landing/content/blog/the-four-tribes.md
 * 
 * Magpie is the rebellious child of four knowledge management tribes:
 * - ARCHIVIST (PKM): We kept the structured links, rejected "people as notes"
 * - SALESMAN (CRM): We kept the network, rejected the transaction funnel
 * - GARDENER (PRM): We kept the relationship context, rejected manual entry
 * - LOGGER (Lifelogging): We kept passive capture, added meaning extraction
 * 
 * Plus a SOURCE layer that feeds all tribes.
 */

export interface EntityDefinition {
  id: string;
  description: string;    // Used in LLM Prompt
  tribe: 'source' | 'archivist' | 'salesman' | 'gardener' | 'logger';
  examples?: string;      // Optional examples for LLM
}

export const ENTITY_DEFINITIONS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // SOURCE LAYER (独立于 Four Tribes)
  // "The soil where all knowledge grows"
  // 不是 AI 提取，是原始输入
  // ═══════════════════════════════════════════════════════════════════════════
  memory: {
    id: 'memory',
    description: 'User-ingested raw content (markdown, email, pdf, etc.).',
    tribe: 'source',
  },
  finding: {
    id: 'finding',
    description: 'Scout-fetched external webpage snapshots.',
    tribe: 'source',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FROM ARCHIVIST (PKM)
  // "Links are knowledge" - 结构化思想，但不把人当笔记
  // ═══════════════════════════════════════════════════════════════════════════
  topic: {
    id: 'topic',
    description: 'Recurring themes or broad subject areas (e.g., "AI Agents", "Rust").',
    tribe: 'archivist',
  },
  concept: {
    id: 'concept',
    description: 'Abstract ideas, frameworks, theoretical constructs, or mental models.',
    tribe: 'archivist',
  },
  problem: {
    id: 'problem',
    description: 'Explicit problems, pain points, friction points, or issues.',
    tribe: 'archivist',
  },
  insight: {
    id: 'insight',
    description: 'A crystallized thought or observation. Intellectual capital.',
    tribe: 'archivist',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FROM SALESMAN (CRM)
  // "People matter" - 人脉网络，但拒绝漏斗和交易
  // ═══════════════════════════════════════════════════════════════════════════
  person: {
    id: 'person',
    description: 'Named individuals in your network.',
    tribe: 'salesman',
  },
  company: {
    id: 'company',
    description: 'Organizations or businesses you interact with.',
    tribe: 'salesman',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FROM GARDENER (PRM)
  // "Relationships need context" - 关系细节，但不需要手动维护
  // ═══════════════════════════════════════════════════════════════════════════
  gift: {
    id: 'gift',
    description: 'Gift ideas for people (relationship artifacts).',
    tribe: 'gardener',
  },
  hobby: {
    id: 'hobby',
    description: 'Personal interests and hobbies (identity signals).',
    tribe: 'gardener',
  },
  location: {
    id: 'location',
    description: 'Physical places and venues (spatial anchors).',
    tribe: 'gardener',
  },
  agenda: {
    id: 'agenda',
    description: 'Meeting agendas and preparation notes.',
    tribe: 'gardener',
  },
  cheatsheet: {
    id: 'cheatsheet',
    description: 'Reference materials and quick notes.',
    tribe: 'gardener',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FROM LOGGER (Lifelogging)
  // "Capture the timeline" - 时间轴上的标记点，但提取意义
  // ═══════════════════════════════════════════════════════════════════════════
  event: {
    id: 'event',
    description: 'Time-bound convergence points (meetings, launches, deadlines).',
    tribe: 'logger',
  },
  news: {
    id: 'news',
    description: 'External signal spikes (e.g. "Competitor raised $10M").',
    tribe: 'logger',
  },
  milestone: {
    id: 'milestone',
    description: 'Project phase markers (e.g. "v1 Launch", "Seed Round").',
    tribe: 'logger',
  },
  decision: {
    id: 'decision',
    description: 'Key choices made or concluded.',
    tribe: 'logger',
  },
  project: {
    id: 'project',
    description: 'Named endeavors or products.',
    tribe: 'logger',
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// DERIVED TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type EntityType = keyof typeof ENTITY_DEFINITIONS;
export type Tribe = EntityDefinition['tribe'];

export const ALL_ENTITY_TYPES = Object.keys(ENTITY_DEFINITIONS) as EntityType[];
export const ALL_TRIBES: Tribe[] = ['source', 'archivist', 'salesman', 'gardener', 'logger'];

/**
 * EXTRACTABLE_TYPES - Types that AI can extract from SOURCE content.
 * Excludes 'source' tribe (memory, finding) since they ARE the source.
 */
export const EXTRACTABLE_TYPES = Object.values(ENTITY_DEFINITIONS)
  .filter(def => def.tribe !== 'source')
  .map(def => def.id);

/**
 * Get all entity types belonging to a specific tribe.
 */
export function getTypesByTribe(tribe: Tribe): EntityType[] {
  return Object.entries(ENTITY_DEFINITIONS)
    .filter(([_, def]) => def.tribe === tribe)
    .map(([key]) => key as EntityType);
}

/**
 * SOURCE_TYPES - Raw input types (not AI-extracted).
 */
export const SOURCE_TYPES = getTypesByTribe('source');

/**
 * Tribe metadata for UI display.
 */
export const TRIBE_META: Record<Tribe, { name: string; tagline: string }> = {
  source:    { name: 'Source',    tagline: 'The soil where knowledge grows' },
  archivist: { name: 'Archivist', tagline: 'Links are knowledge' },
  salesman:  { name: 'Salesman',  tagline: 'People matter' },
  gardener:  { name: 'Gardener',  tagline: 'Relationships need context' },
  logger:    { name: 'Logger',    tagline: 'Capture the timeline' },
};

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM BEHAVIOR TYPES (for Ripple/Scout)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get tribe from entity ID.
 * @example getTribeFromEntityId("person:simon") → "salesman"
 */
export function getTribeFromEntityId(entityId: string): Tribe | null {
  const type = entityId.split(':')[0] as EntityType;
  const def = ENTITY_DEFINITIONS[type];
  return def?.tribe ?? null;
}

/**
 * Get tribe from entity type.
 * @example getTribeFromType("person") → "salesman"
 */
export function getTribeFromType(type: string): Tribe | null {
  const def = ENTITY_DEFINITIONS[type as EntityType];
  return def?.tribe ?? null;
}

/**
 * PROFILEABLE_TYPES - Entity types that benefit from Ripple profile generation.
 * 
 * Only specific types need external web search to enrich their profiles:
 * - person (salesman): Bio, background, social presence, blog/essays
 * - company (salesman): About, funding, products, news
 * - project (logger): Official site, changelog, getting started
 * 
 * Note: Not all types in salesman/logger tribes need profiling.
 * event/news/milestone/decision are time-bound and don't need web enrichment.
 */
export const PROFILEABLE_TYPES: EntityType[] = ['person', 'company', 'project'];

/**
 * Check if an entity needs profile enrichment based on its type.
 * @param entityId - Full entity ID (e.g., "person:simon")
 */
export function needsProfileEnrichment(entityId: string): boolean {
  const type = entityId.split(':')[0] as EntityType;
  return PROFILEABLE_TYPES.includes(type);
}

/**
 * SCOUTABLE_TYPES - Entity types that trigger automatic Scout (web search).
 * 
 * These are "real-world" entities worth searching for external information:
 * - person (salesman): Bio, social presence, writings
 * - company (salesman): About, funding, products
 * - project (logger): Official site, changelog
 * - event (logger): Event details, speakers, agenda
 * - topic (archivist): Trending discussions, definitions
 * 
 * Note: Superset of PROFILEABLE_TYPES.
 * - PROFILEABLE: Gets a curated profile (person, company, project)
 * - SCOUTABLE: Triggers automatic web search (adds event, topic)
 */
export const SCOUTABLE_TYPES: EntityType[] = ['person', 'company', 'project', 'event', 'topic'];

/**
 * Check if an entity type should trigger Scout (web search).
 * @param entityId - Full entity ID (e.g., "event:meeting")
 */
export function isScoutableType(entityId: string): boolean {
  const type = entityId.split(':')[0] as EntityType;
  return SCOUTABLE_TYPES.includes(type);
}

/**
 * TRIBE_PROFILE_STRATEGIES - How to profile entities from each tribe.
 * 
 * Used by RippleAgent to generate search queries based on entity tribe.
 */
export const TRIBE_PROFILE_STRATEGIES: Record<Tribe, {
  queryTemplates: string[];
  contentPriority: 'thoughts' | 'news' | 'evolution' | 'context';
}> = {
  source: {
    queryTemplates: [],  // Source types don't get profiled
    contentPriority: 'context',
  },
  archivist: {
    queryTemplates: ['{name} definition', '{name} examples', '{name} best practices'],
    contentPriority: 'thoughts',
  },
  salesman: {
    queryTemplates: ['{name} bio {context}', '{name} blog essays', '{name} projects work', '{name} news'],
    contentPriority: 'thoughts',
  },
  gardener: {
    queryTemplates: ['{name} guide', '{name} recommendations'],
    contentPriority: 'context',
  },
  logger: {
    queryTemplates: ['{name} {context} official', '{name} changelog', '{name} news updates'],
    contentPriority: 'evolution',
  },
};
