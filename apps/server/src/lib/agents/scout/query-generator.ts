/**
 * Scout Query Generator
 * 
 * Uses lightweight AI to generate optimal search queries for entity patrol.
 * Instead of hardcoded templates, it infers the best search strategy
 * based on entity type definitions and category.
 * 
 * Cost: ~$0.0001 per call (gpt-4o-mini)
 */

import { getOpenAI } from '../../ai-clients.js';
import { ENTITY_DEFINITIONS } from '@prism/contract';
import { log, logError } from '../../logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface QueryGeneratorInput {
  type: string;
  title: string;
  subtitle?: string;
  body?: string;
  relatedTerms?: string[];
}

export interface GeneratedQueries {
  queries: string[];
  reasoning?: string;
}

// =============================================================================
// QUERY GENERATOR
// =============================================================================

export class ScoutQueryGenerator {
  /**
   * Generate optimized search queries for an entity
   */
  async generate(entity: QueryGeneratorInput): Promise<string[]> {
    const openai = getOpenAI();
    if (!openai) {
      // Return basic queries if OpenAI not available
      return [entity.title, `${entity.type} ${entity.title}`];
    }
    
    log(`[ScoutQueryGenerator] Generating queries for: ${entity.title} (${entity.type})`);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: this.buildSystemPrompt(),
          },
          {
            role: 'user',
            content: JSON.stringify({
              type: entity.type,
              title: entity.title,
              subtitle: entity.subtitle || '',
              context: entity.body?.substring(0, 200) || '',
              relatedTerms: entity.relatedTerms || [],
            }),
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 200,
        temperature: 0.3,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}') as GeneratedQueries;
      const queries = result.queries || [];

      if (queries.length > 0) {
        log(`[ScoutQueryGenerator] Generated ${queries.length} queries:`);
        queries.forEach((q, i) => log(`   [${i + 1}] ${q}`));
      }

      return queries;
    } catch (error) {
      logError('[ScoutQueryGenerator] Failed to generate queries:', error);
      // Fallback to simple query
      return [`${entity.title} ${entity.subtitle || ''} latest`.trim()];
    }
  }

  /**
   * Build the system prompt with entity definitions
   */
  private buildSystemPrompt(): string {
    return `You are a Search Query Optimizer for an entity monitoring system (Scout).

## Your Task
Generate 2-3 English search queries to find the LATEST updates about an entity.
Queries should be concise, specific, and optimized for web search (Tavily/Google).

## Entity Type Definitions (System Reference)
${this.formatDefinitions()}

## Search Strategy by Category

### MASS entities (have "real-world presence")
These entities have official sources. Search for:
- person → personal blog, twitter/X, recent talks, interviews, podcasts
- project → github releases, changelog, official blog, documentation updates
- company → official announcements, press releases, product launches
- event → event coverage, recaps, announcements, speaker lists
- milestone → launch announcements, release notes, celebration posts

### SIGNAL entities (conceptual/informational)
These entities are discussed in various places. Search for:
- topic → latest developments, trends, community discussions, HN/Reddit
- concept → new applications, case studies, critiques, tutorials
- problem → solutions, workarounds, status updates, fixes
- decision → rationale discussions, outcomes, lessons learned
- insight → related discussions, validations, counterpoints
- news → follow-up analysis, reactions, implications

## Few-Shot Examples

Input: {"type":"person","title":"Simon Willison","subtitle":"Datasette creator"}
Output: {"queries":["Simon Willison blog 2024","@simonw twitter recent","simonwillison.net latest posts"]}

Input: {"type":"project","title":"Cursor","subtitle":"AI Code Editor"}
Output: {"queries":["Cursor AI editor changelog 2024","Cursor IDE new features release"]}

Input: {"type":"topic","title":"MCP Protocol","subtitle":"Model Context Protocol"}
Output: {"queries":["Model Context Protocol MCP latest news","Anthropic MCP adoption examples"]}

Input: {"type":"problem","title":"LLM Hallucination","subtitle":"AI generating false information"}
Output: {"queries":["LLM hallucination solutions 2024","reducing AI hallucination techniques"]}

## Output Format
Return JSON: {"queries":["query1","query2","query3"]}

## Rules
1. Queries MUST be in English (better search results)
2. Include year (2024/2025) for time-sensitive searches
3. Be specific: use the entity's subtitle/context to narrow down
4. For persons: include their known platforms (blog domain, twitter handle if obvious)
5. For projects: prefer official sources (github, docs)
6. Keep queries under 10 words each`;
  }

  /**
   * Format entity definitions for the prompt
   */
  private formatDefinitions(): string {
    return Object.entries(ENTITY_DEFINITIONS)
      .filter(([_, def]) => (def as { category?: string }).category) // Only categorized types
      .map(([key, def]) => {
        const d = def as { category?: string; description: string };
        return `- ${key} (${d.category}): ${d.description}`;
      })
      .join('\n');
  }
}

// Singleton instance
export const scoutQueryGenerator = new ScoutQueryGenerator();
