/**
 * Entity Schema Expectations
 *
 * @ref data-gap/schema-expectations
 * @doc docs/DATA-GAP-DETECTION.md#4
 *
 * Defines the "expected relationships" for each entity type.
 * Used by the Search Module to detect data gaps.
 *
 * Philosophy: Based on Four Tribes classification, each entity type
 * has expected relation patterns that help us understand "what's missing".
 */

/**
 * Priority levels for expected relations
 * - critical: Must have for basic understanding
 * - high: Very important, should actively search
 * - medium: Nice to have, search if convenient
 * - low: Optional, only if discovered naturally
 */
export type GapPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Expected relation definition
 */
export interface ExpectedRelation {
  /** Relation type (e.g., 'works_at', 'created') */
  relation: string;

  /** Target entity type(s), use '|' for multiple (e.g., 'company|organization') */
  targetType: string;

  /** How important is this relation? */
  priority: GapPriority;

  /** Search query template. Use {name} as placeholder for entity title */
  queryTemplate: string;

  /** Human-readable description of why this relation matters */
  description: string;

  /** Description in Chinese for UI */
  descriptionZh: string;
}

/**
 * Schema expectations for each entity type
 *
 * Organized by Four Tribes:
 * - Salesman: person, company, project (people matter)
 * - Archivist: topic, concept, problem, insight (links are knowledge)
 * - Logger: event, milestone, decision, news (capture timeline)
 * - Gardener: gift, hobby, location, agenda (relationships need context)
 */
export const ENTITY_SCHEMA_EXPECTATIONS: Record<string, ExpectedRelation[]> = {
  // ============================================
  // SALESMAN TRIBE: People matter
  // ============================================

  person: [
    {
      relation: 'works_at',
      targetType: 'company|organization',
      priority: 'high',
      queryTemplate: '{name} current company employer work',
      description: 'Understand professional background',
      descriptionZh: '了解职业背景',
    },
    {
      relation: 'created',
      targetType: 'project',
      priority: 'high',
      queryTemplate: '{name} projects created founded built',
      description: 'Understand creative/entrepreneurial history',
      descriptionZh: '了解创作/创业经历',
    },
    {
      relation: 'educated_at',
      targetType: 'organization',
      priority: 'medium',
      queryTemplate: '{name} education university degree school',
      description: 'Understand educational background',
      descriptionZh: '了解教育背景',
    },
    {
      relation: 'collaborates_with',
      targetType: 'person',
      priority: 'medium',
      queryTemplate: '{name} collaborators co-founders teammates partners',
      description: 'Understand professional network',
      descriptionZh: '了解人际网络',
    },
    {
      relation: 'known_for',
      targetType: 'topic|concept|project',
      priority: 'medium',
      queryTemplate: '{name} famous for known expertise specialty',
      description: 'Understand key contributions',
      descriptionZh: '了解主要贡献',
    },
    {
      relation: 'influenced_by',
      targetType: 'person|concept',
      priority: 'low',
      queryTemplate: '{name} influences mentors inspiration',
      description: 'Understand intellectual origins',
      descriptionZh: '了解思想来源',
    },
  ],

  company: [
    {
      relation: 'founded_by',
      targetType: 'person',
      priority: 'critical',
      queryTemplate: '{name} founder CEO founders leadership team',
      description: 'Understand founding team',
      descriptionZh: '了解创始团队',
    },
    {
      relation: 'has_product',
      targetType: 'project',
      priority: 'high',
      queryTemplate: '{name} products services offerings main product',
      description: 'Understand product portfolio',
      descriptionZh: '了解产品矩阵',
    },
    {
      relation: 'located_in',
      targetType: 'location',
      priority: 'medium',
      queryTemplate: '{name} headquarters location offices based in',
      description: 'Understand geographic presence',
      descriptionZh: '了解地理分布',
    },
    {
      relation: 'funded_by',
      targetType: 'company|person',
      priority: 'medium',
      queryTemplate: '{name} investors funding raised series',
      description: 'Understand financial backing',
      descriptionZh: '了解资金背景',
    },
    {
      relation: 'competes_with',
      targetType: 'company',
      priority: 'low',
      queryTemplate: '{name} competitors alternatives vs compare',
      description: 'Understand competitive landscape',
      descriptionZh: '了解竞争格局',
    },
  ],

  project: [
    {
      relation: 'created_by',
      targetType: 'person',
      priority: 'critical',
      queryTemplate: '{name} author creator maintainer who made',
      description: 'Understand creator',
      descriptionZh: '了解创作者',
    },
    {
      relation: 'owned_by',
      targetType: 'company|person',
      priority: 'high',
      queryTemplate: '{name} organization company owner maintained by',
      description: 'Understand ownership',
      descriptionZh: '了解归属',
    },
    {
      relation: 'uses',
      targetType: 'technology|concept',
      priority: 'medium',
      queryTemplate: '{name} tech stack built with technology uses',
      description: 'Understand technical foundation',
      descriptionZh: '了解技术栈',
    },
    {
      relation: 'solves',
      targetType: 'problem',
      priority: 'medium',
      queryTemplate: '{name} solves problem use case why use',
      description: 'Understand value proposition',
      descriptionZh: '了解解决的问题',
    },
  ],

  // ============================================
  // ARCHIVIST TRIBE: Links are knowledge
  // ============================================

  topic: [
    {
      relation: 'related_to',
      targetType: 'topic|concept',
      priority: 'medium',
      queryTemplate: '{name} related concepts fields topics',
      description: 'Understand knowledge connections',
      descriptionZh: '了解知识关联',
    },
    {
      relation: 'pioneered_by',
      targetType: 'person',
      priority: 'medium',
      queryTemplate: '{name} pioneers experts thought leaders founders',
      description: 'Understand domain experts',
      descriptionZh: '了解领域专家',
    },
    {
      relation: 'applied_in',
      targetType: 'project|company',
      priority: 'low',
      queryTemplate: '{name} applications examples use cases companies using',
      description: 'Understand practical applications',
      descriptionZh: '了解实际应用',
    },
  ],

  concept: [
    {
      relation: 'derived_from',
      targetType: 'concept|topic',
      priority: 'medium',
      queryTemplate: '{name} origin based on derived from history',
      description: 'Understand conceptual origins',
      descriptionZh: '了解概念来源',
    },
    {
      relation: 'coined_by',
      targetType: 'person',
      priority: 'medium',
      queryTemplate: '{name} coined by who invented term origin',
      description: 'Understand who defined it',
      descriptionZh: '了解定义者',
    },
  ],

  problem: [
    {
      relation: 'solved_by',
      targetType: 'project|concept',
      priority: 'high',
      queryTemplate: '{name} solutions how to solve approaches',
      description: 'Understand available solutions',
      descriptionZh: '了解解决方案',
    },
    {
      relation: 'affects',
      targetType: 'person|company|topic',
      priority: 'medium',
      queryTemplate: '{name} who affected impact consequences',
      description: 'Understand impact scope',
      descriptionZh: '了解影响范围',
    },
  ],

  insight: [
    {
      relation: 'discovered_by',
      targetType: 'person',
      priority: 'medium',
      queryTemplate: '{name} who discovered research source',
      description: 'Understand source of insight',
      descriptionZh: '了解洞察来源',
    },
    {
      relation: 'relates_to',
      targetType: 'topic|concept',
      priority: 'medium',
      queryTemplate: '{name} context field domain',
      description: 'Understand context',
      descriptionZh: '了解相关领域',
    },
  ],

  // ============================================
  // LOGGER TRIBE: Capture the timeline
  // ============================================

  event: [
    {
      relation: 'involves',
      targetType: 'person|company|project',
      priority: 'high',
      queryTemplate: '{name} participants involved who attended',
      description: 'Understand participants',
      descriptionZh: '了解参与者',
    },
    {
      relation: 'happened_at',
      targetType: 'location',
      priority: 'medium',
      queryTemplate: '{name} location venue where held',
      description: 'Understand location',
      descriptionZh: '了解发生地点',
    },
    {
      relation: 'caused_by',
      targetType: 'event|decision',
      priority: 'low',
      queryTemplate: '{name} cause reason why triggered by',
      description: 'Understand causality',
      descriptionZh: '了解因果链',
    },
  ],

  milestone: [
    {
      relation: 'achieved_by',
      targetType: 'person|company|project',
      priority: 'high',
      queryTemplate: '{name} who achieved accomplished by',
      description: 'Understand achiever',
      descriptionZh: '了解达成者',
    },
    {
      relation: 'leads_to',
      targetType: 'event|milestone',
      priority: 'medium',
      queryTemplate: '{name} next result consequence led to',
      description: 'Understand consequences',
      descriptionZh: '了解后续影响',
    },
  ],

  decision: [
    {
      relation: 'made_by',
      targetType: 'person|company',
      priority: 'critical',
      queryTemplate: '{name} who decided decision maker',
      description: 'Understand decision maker',
      descriptionZh: '了解决策者',
    },
    {
      relation: 'affects',
      targetType: 'person|company|project',
      priority: 'high',
      queryTemplate: '{name} impact affects consequences who affected',
      description: 'Understand impact',
      descriptionZh: '了解影响对象',
    },
  ],

  news: [
    {
      relation: 'about',
      targetType: 'person|company|project|event',
      priority: 'high',
      queryTemplate: '{name} subject about concerning',
      description: 'Understand subject',
      descriptionZh: '了解主体',
    },
    {
      relation: 'reported_by',
      targetType: 'company|person',
      priority: 'low',
      queryTemplate: '{name} source reporter publication',
      description: 'Understand source',
      descriptionZh: '了解来源',
    },
  ],

  // ============================================
  // GARDENER TRIBE: Relationships need context
  // ============================================

  gift: [
    {
      relation: 'given_by',
      targetType: 'person',
      priority: 'critical',
      queryTemplate: '{name} from who gave giver',
      description: 'Understand giver',
      descriptionZh: '了解送礼人',
    },
    {
      relation: 'given_to',
      targetType: 'person',
      priority: 'critical',
      queryTemplate: '{name} to recipient who received',
      description: 'Understand recipient',
      descriptionZh: '了解收礼人',
    },
    {
      relation: 'for_occasion',
      targetType: 'event',
      priority: 'medium',
      queryTemplate: '{name} occasion why birthday anniversary',
      description: 'Understand occasion',
      descriptionZh: '了解场合',
    },
  ],

  hobby: [
    {
      relation: 'practiced_by',
      targetType: 'person',
      priority: 'high',
      queryTemplate: '{name} who does practitioners enthusiasts',
      description: 'Understand practitioners',
      descriptionZh: '了解爱好者',
    },
  ],

  location: [
    {
      relation: 'located_in',
      targetType: 'location',
      priority: 'medium',
      queryTemplate: '{name} in part of region country',
      description: 'Understand geographic hierarchy',
      descriptionZh: '了解地理层级',
    },
    {
      relation: 'known_for',
      targetType: 'topic|event',
      priority: 'low',
      queryTemplate: '{name} famous for known attractions',
      description: 'Understand significance',
      descriptionZh: '了解特色',
    },
  ],

  agenda: [
    {
      relation: 'involves',
      targetType: 'person',
      priority: 'high',
      queryTemplate: '{name} participants attendees who',
      description: 'Understand participants',
      descriptionZh: '了解参与者',
    },
    {
      relation: 'at_location',
      targetType: 'location',
      priority: 'medium',
      queryTemplate: '{name} where location venue',
      description: 'Understand location',
      descriptionZh: '了解地点',
    },
  ],
};

// ============================================
// Utility Functions
// ============================================

/**
 * Get expected relations for an entity type
 */
export function getExpectationsForType(entityType: string): ExpectedRelation[] {
  return ENTITY_SCHEMA_EXPECTATIONS[entityType] || [];
}

/**
 * Get only high-priority expectations (critical + high)
 */
export function getHighPriorityExpectations(entityType: string): ExpectedRelation[] {
  return getExpectationsForType(entityType).filter(
    (e) => e.priority === 'critical' || e.priority === 'high'
  );
}

/**
 * Generate search query from template
 */
export function generateGapQuery(template: string, entityTitle: string): string {
  return template.replace('{name}', entityTitle);
}

/**
 * Get all entity types that have expectations defined
 */
export function getTypesWithExpectations(): string[] {
  return Object.keys(ENTITY_SCHEMA_EXPECTATIONS);
}

/**
 * Check if a relation type is expected for an entity type
 */
export function isExpectedRelation(entityType: string, relationType: string): boolean {
  const expectations = getExpectationsForType(entityType);
  return expectations.some((e) => e.relation === relationType);
}
