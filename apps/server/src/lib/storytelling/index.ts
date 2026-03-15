/**
 * @module storytelling
 * @description Storytelling toolkit - types, styles, and graph data extraction
 * 
 * ============================================================================
 * STORYTELLING TOOLKIT (v2 - Simplified)
 * ============================================================================
 * 
 * ⚠️ ARCHITECTURE NOTE:
 * This module is a TOOLKIT, not a narrative generator.
 * 
 * The actual storytelling happens in Claude Agent conversations,
 * guided by rules in `.claude/skills/storytelling/`.
 * 
 * This module provides:
 * 1. Type definitions (TribeStyle, GraphSnapshot, etc.)
 * 2. Tribe style templates (voice, vocabulary, patterns)
 * 3. Graph data extraction utilities
 * 
 * ============================================================================
 * WHY NOT CODE-GENERATED NARRATIVES?
 * ============================================================================
 * 
 * We learned that wrapping LLM calls in functions leads to:
 * - "Metaphor Trap": Fabricating allegories instead of telling real stories
 * - "Data Dump": Listing facts without narrative arc
 * - Rigid outputs that can't adapt to conversation context
 * 
 * Better approach: Let Claude Agent apply storytelling principles
 * naturally during conversation, using real graph data as material.
 * 
 * ============================================================================
 * CORE CONCEPTS (Reference for .claude/skills/storytelling/)
 * ============================================================================
 * 
 * TRIBE STYLES - Four narrative personas:
 *   - Archivist: "What's the hidden connection?" (curious, insightful)
 *   - Salesman: "What should I do right now?" (direct, action-oriented)
 *   - Gardener: "Who might need my attention?" (warm, relationship-focused)
 *   - Logger: "What am I becoming?" (reflective, pattern-focused)
 * 
 * STORY STRUCTURE (Ira Glass Model):
 *   - Hook → Anecdote Chain → Moment of Reflection → Resolution
 * 
 * GRAPH SNAPSHOT - Raw material for stories:
 *   - topGravityEntities: Main characters
 *   - recentSparks: New discoveries (hooks)
 *   - relations: Plot connections
 *   - serendipityFindings: Twists and surprises
 * 
 * ============================================================================
 * USAGE
 * ============================================================================
 * 
 * ```typescript
 * // Get graph data for storytelling
 * import { buildGraphSnapshot, TRIBE_STYLES } from './lib/storytelling/index.js';
 * 
 * const snapshot = await buildGraphSnapshot({ limit: 10 });
 * const archivistStyle = TRIBE_STYLES.archivist;
 * 
 * // Then let Claude Agent use this data + style to tell a story naturally
 * ```
 * 
 * @see .claude/skills/storytelling/SKILL.md - Full storytelling guide
 * @see .claude/skills/storytelling/ANTI-PATTERNS.md - What NOT to do
 */

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type {
  // Core types
  TribeStyle,
  TribeVector,
  StoryLength,
  
  // Story structure (for reference, not code generation)
  StoryHook,
  StoryProtagonist,
  StoryTension,
  StoryJourney,
  StoryInsight,
  StoryResolution,
  StoryStructure,
  
  // Graph data
  GraphSnapshot,
  StoryEntity,
  StoryRelation,
  StoryFinding,
  TemporalPattern,
  
  // Templates
  TribeStyleTemplate,
} from './types.js';

export { STORY_LENGTH_CONFIG } from './types.js';

// =============================================================================
// TRIBE STYLE EXPORTS (Reference for Claude Agent)
// =============================================================================

export {
  TRIBE_STYLES,
  getDominantTribe,
  getSecondaryTribe,
  normalizeTribeVector,
  createDefaultTribeVector,
  createTribeVectorFromStyle,
  blendTribeVectors,
} from './tribe-styles.js';

// =============================================================================
// DATA EXTRACTION UTILITIES
// =============================================================================

export {
  buildGraphSnapshot,
  buildGraphContext,
  createTestSnapshot,
} from './story-generator.js';



