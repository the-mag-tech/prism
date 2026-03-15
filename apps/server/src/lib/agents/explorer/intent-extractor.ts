/**
 * Intent Extractor
 *
 * Parses user queries to identify their true exploration focus.
 * This solves the "rain scene" problem where generic direction generation
 * loses the user's specific intent.
 *
 * Example:
 *   Input: "惊天魔盗团中'人为控制下雨'的片段解读"
 *   Output: {
 *     coreObject: "人为控制下雨的魔术场景",
 *     context: "惊天魔盗团 (Now You See Me)",
 *     desiredDepth: "scene_analysis",
 *     searchQueries: ["Now You See Me rain scene magic trick", ...]
 *   }
 */

import { getOpenAI } from '../../ai-clients.js';
import { log, logError, logWarn } from '../../logger.js';
import type { ExplorationIntent } from './types.js';
import { graphReader } from '../../graph-link/index.js';

export class IntentExtractor {
  /**
   * Extract structured intent from user query
   */
  async extract(query: string): Promise<ExplorationIntent> {
    const openai = getOpenAI();
    if (!openai) {
      // Return a basic intent if OpenAI is not available
      return {
        coreObject: query,
        context: '',
        originalQuery: query,
        searchQueries: [query],
        desiredDepth: 'general',
      };
    }
    
    log(`\n[IntentExtractor] 🎯 Parsing: "${query}"`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an intent parser for an exploration engine.

Given a user query, extract:
1. **coreObject**: The specific thing they want to explore (be precise!)
2. **context**: Background/setting for the core object
3. **desiredDepth**: What kind of analysis they want
4. **searchQueries**: 3-5 English search queries to find relevant information

IMPORTANT:
- coreObject should be SPECIFIC, not generic
- If user mentions a specific scene/moment/detail, that IS the coreObject
- searchQueries MUST be in English for better search results
- Keep searchQueries focused on the coreObject, not just the context

Example input: "惊天魔盗团中'人为控制下雨'的片段解读"
Example output:
{
  "coreObject": "人为控制下雨的魔术表演场景",
  "context": "惊天魔盗团 (Now You See Me, 2013)",
  "desiredDepth": "scene_analysis",
  "searchQueries": [
    "Now You See Me rain scene magic trick explanation",
    "Now You See Me money rain how it works",
    "Four Horsemen rain scene symbolism",
    "Now You See Me climax scene analysis"
  ]
}

Output JSON only.`,
        },
        {
          role: 'user',
          content: query,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');

    const intent: ExplorationIntent = {
      coreObject: result.coreObject || query,
      context: result.context || '',
      desiredDepth: this.mapDesiredDepth(result.desiredDepth),
      originalQuery: query,
      searchQueries: result.searchQueries || [query],
    };

    // ENRICHMENT: Check if we already know this entity
    // Uses enhanced enrichContext() which now includes relations
    const existingEntity = graphReader.resolveEntity(intent.coreObject);
    if (existingEntity) {
      log(`[IntentExtractor] 🧠 Found existing entity: ${existingEntity.title} (${existingEntity.id})`);
      const fp = graphReader.getFingerprint(existingEntity.id);
      if (fp) {
        // Include both the fingerprint and explicitly list related concepts
        const relatedInfo = fp.relatedTerms.length > 0 
          ? `\n[Related Concepts]: ${fp.relatedTerms.join(', ')}`
          : '';
        intent.context = `${intent.context} \n[Known Context]: ${fp.fingerprint}${relatedInfo}`;
      }
    }

    log(`[IntentExtractor]    Core: ${intent.coreObject}`);
    log(`[IntentExtractor]    Context: ${intent.context.substring(0, 50)}...`);
    log(`[IntentExtractor]    Depth: ${intent.desiredDepth}`);

    return intent;
  }

  /**
   * Map LLM output to valid desiredDepth value
   */
  private mapDesiredDepth(
    raw: string | undefined,
  ): ExplorationIntent['desiredDepth'] {
    if (!raw) return 'general';

    const normalized = raw.toLowerCase();

    if (
      normalized.includes('scene') ||
      normalized.includes('片段') ||
      normalized.includes('moment')
    ) {
      return 'scene_analysis';
    }
    if (
      normalized.includes('concept') ||
      normalized.includes('概念') ||
      normalized.includes('explore')
    ) {
      return 'concept_exploration';
    }
    if (
      normalized.includes('compare') ||
      normalized.includes('对比') ||
      normalized.includes('vs')
    ) {
      return 'comparison';
    }
    if (
      normalized.includes('deep') ||
      normalized.includes('深度') ||
      normalized.includes('analysis')
    ) {
      return 'deep_dive';
    }

    return 'general';
  }

  /**
   * Quick extraction without LLM (for simple queries)
   */
  extractSimple(query: string): ExplorationIntent {
    // Detect if query has explicit focus markers
    const quotedMatch = query.match(/['"""''](.*?)['"""'']/);
    const coreObject = quotedMatch ? quotedMatch[1] : query;

    // Extract context (text before/after quoted part)
    let context = '';
    if (quotedMatch) {
      context = query.replace(quotedMatch[0], '').trim();
      // Remove common suffixes
      context = context
        .replace(/的?片段解读$/g, '')
        .replace(/的?分析$/g, '')
        .replace(/中$/g, '')
        .trim();
    }

    return {
      coreObject,
      context,
      desiredDepth: quotedMatch ? 'scene_analysis' : 'general',
      originalQuery: query,
      searchQueries: [query],
    };
  }
}

// Singleton
export const intentExtractor = new IntentExtractor();

