import { log, logError, logWarn } from '../../logger.js';
/**
 * Deep Explorer Engine
 *
 * Generalized exploration loop with:
 * 1. Intent extraction (what user really wants)
 * 2. Multi-head exploration (parallel directions)
 * 3. Serendipity filtering (graph-aware novelty check)
 * 4. Strategy-based evaluation (pluggable depth definitions)
 * 5. Forced reflection (from DeepWideResearch)
 * 6. Anchored output (returns to original question)
 * 
 * @ref deep-explorer/engine
 * @since 2025-12-27 Added Serendipity filtering for search results
 */

import { getOpenAI, requireOpenAI } from '../../ai-clients.js';
import { search as searchWeb, isSearchAvailable } from '../../search-service.js';
import { IntentExtractor, intentExtractor } from './intent-extractor.js';
import { QueryAnalyzer, queryAnalyzer, type QueryAnalysis } from './query-analyzer.js';
import { createCompositeStrategy } from './strategies/composite.js';
import { graphWriter, graphReader } from '../../graph-link/index.js';
import type {
  IDepthStrategy,
  DepthConfig,
  DepthScore,
  Finding,
  ExplorationIntent,
  ExplorationDirection,
  DirectionResult,
  EvaluatedDirection,
  ExploreOptions,
  ExploreResult,
  ExploreStatus,
} from './types.js';
import { DEFAULT_DEPTH_CONFIG } from './types.js';
import { AgentLogger } from '../../agent-logger.js';

const logger = new AgentLogger('deep_explorer');

export interface AutoExploreResult extends ExploreResult {
  /** Query analysis that determined the configuration */
  queryAnalysis: QueryAnalysis;
}

export class DeepExplorer {
  private intentExtractor: IntentExtractor;
  private queryAnalyzer: QueryAnalyzer;

  constructor() {
    this.intentExtractor = intentExtractor;
    this.queryAnalyzer = queryAnalyzer;
  }

  /** Lazy-load OpenAI client (throws if not available) */
  private get openai() {
    return requireOpenAI();
  }

  /** Check if search is available (unified search service) */
  private get searchAvailable() {
    return isSearchAvailable();
  }

  /**
   * Auto mode: analyze query and auto-configure strategy
   * 
   * This is the recommended entry point for most use cases.
   * It analyzes the query to determine optimal strategy configuration.
   */
  async exploreAuto(
    topic: string,
    onProgress?: (status: ExploreStatus) => void,
  ): Promise<AutoExploreResult> {
    const sessionId = AgentLogger.newSessionId();
    const handle = logger.start('explore_auto', { topic: topic.substring(0, 100) }, sessionId);

    log(`\n${'='.repeat(60)}`);
    log(`[DeepExplorer] 🤖 AUTO MODE: "${topic.substring(0, 50)}..."`);
    log(`${'='.repeat(60)}\n`);

    try {
      // Phase 0: Analyze query to determine configuration
      onProgress?.({ phase: 'intent', message: '分析查询类型...' });
      const analysis = await this.queryAnalyzer.analyze(topic);

      log(`[DeepExplorer] 📊 Query Analysis:`);
      log(`[DeepExplorer]    Type: ${analysis.queryType}`);
      log(`[DeepExplorer]    Complexity: ${analysis.complexity}`);
      log(`[DeepExplorer]    Mode: ${analysis.recommendedConfig.mode}`);

    // Build strategy from analysis
    let strategy: IDepthStrategy;

    if (analysis.recommendedConfig.mode === 'composite') {
      const strategies = analysis.recommendedConfig.strategies || [];
      const executionOrder = analysis.recommendedConfig.executionOrder || 'parallel';
      strategy = createCompositeStrategy(strategies, executionOrder);

      const weights = strategies.map(s => `${s.name}:${(s.weight * 100).toFixed(0)}%`).join(' + ');
      log(`[DeepExplorer]    Composite: ${weights} (${executionOrder})`);
    } else {
      // Single strategy mode - use irony for now
      const { ironyStrategy } = await import('./strategies/irony.js');
      strategy = ironyStrategy;
      log(`[DeepExplorer]    Strategy: ${analysis.recommendedConfig.strategy || 'irony'}`);
    }

    // Build config from analysis
    const config: DepthConfig = {
      targetLevel: analysis.recommendedConfig.targetLevel,
      maxRounds: analysis.recommendedConfig.maxRounds,
      width: analysis.recommendedConfig.width,
    };

    log(`[DeepExplorer]    Config: level=${config.targetLevel}, width=${config.width}, rounds=${config.maxRounds}`);
    log(`[DeepExplorer]    Reason: ${analysis.reasoning}`);

    // Run exploration with auto-configured strategy
    const result = await this.explore(topic, { strategy, config, onProgress }, sessionId);

    handle.success({
      queryType: analysis.queryType,
      complexity: analysis.complexity,
      winnerLevel: result.winner.score.level,
      findingsCount: result.winner.findings.length,
    });

    return {
      ...result,
      queryAnalysis: analysis,
    };
    } catch (err) {
      handle.error(err);
      throw err;
    }
  }

  /**
   * Main entry: deep exploration with explicit strategy
   */
  async explore(topic: string, options: ExploreOptions, sessionId?: string): Promise<ExploreResult> {
    const { strategy, config, onProgress } = options;
    const sid = sessionId || AgentLogger.newSessionId();
    const handle = logger.start('explore', { topic: topic.substring(0, 100), strategy: strategy.name }, sid);

    log(`\n${'='.repeat(60)}`);
    log(`[DeepExplorer] 🚀 Starting exploration: "${topic}"`);
    log(`[DeepExplorer]    Strategy: ${strategy.name}`);
    log(`[DeepExplorer]    Target Level: ${config.targetLevel}`);
    log(`${'='.repeat(60)}\n`);

    try {
    // Phase 1: Intent Extraction
    onProgress?.({ phase: 'intent', message: '解析用户意图...' });
    const intent = await this.intentExtractor.extract(topic);

    // Phase 2: Multi-head exploration (constrained by intent)
    onProgress?.({ phase: 'explore', message: '多头探索中...' });
    const directions = await this.multiHeadExplore(intent, config.width);

    // Phase 3: Strategy-based evaluation
    onProgress?.({ phase: 'evaluate', message: '对抗性评估...' });
    const evaluated = await this.evaluateDirections(directions, strategy, intent);

    // Sort by score
    evaluated.sort((a, b) => b.score.total - a.score.total);
    const winner = evaluated[0];

    log(`\n[DeepExplorer] 🏆 Winner: ${winner.name} (${winner.score.total.toFixed(1)})`);

    // Phase 4: Deep dive loop with forced reflection
    let findings = winner.findings;
    let score = winner.score;

    for (let round = 0; round < config.maxRounds; round++) {
      // 4.1 Forced reflection
      onProgress?.({
        phase: 'reflect',
        message: `反思 Round ${round + 1}`,
        round,
        level: score.level,
      });
      this.reflect(score, strategy, round);

      // 4.2 Check if complete
      if (strategy.isComplete(score, config)) {
        onProgress?.({
          phase: 'complete',
          message: `达到目标深度 (Level ${score.level})`,
        });
        break;
      }

      // 4.3 Get next directions
      onProgress?.({
        phase: 'deepen',
        message: `深度挖掘 Round ${round + 1}`,
        round,
      });

      const nextQueries = await strategy.getNextDirections({
        intent,
        topic,
        findings,
        currentLevel: score.level,
        round,
      });

      if (nextQueries.length === 0) {
        log(`[DeepExplorer]    No more directions to explore`);
        break;
      }

      // 4.4 Execute deeper search
      const newFindings = await this.search(nextQueries);
      findings = [...findings, ...newFindings];

      // 4.5 Re-evaluate
      score = await strategy.evaluate(findings, intent);
    }

    // Phase 5: Format output (anchored to original intent)
    onProgress?.({ phase: 'format', message: '构建输出...' });
    const output = await strategy.format(findings, score, intent);

    log(`\n${'='.repeat(60)}`);
    log(`[DeepExplorer] ✅ Exploration complete`);
    log(`[DeepExplorer]    Final Level: ${score.level}`);
    log(`[DeepExplorer]    Final Score: ${score.total.toFixed(1)}`);
    log(`${'='.repeat(60)}\n`);

    handle.success({
      level: score.level,
      score: score.total,
      findingsCount: findings.length,
      directionsCount: evaluated.length,
    });

    return {
      intent,
      strategy: strategy.name,
      score,
      output,
      allDirections: evaluated,
      winner,
    };
    } catch (err) {
      handle.error(err);
      throw err;
    }
  }

  // =============================================================================
  // MULTI-HEAD EXPLORATION
  // =============================================================================

  /**
   * Explore multiple directions in parallel (constrained by intent)
   */
  private async multiHeadExplore(
    intent: ExplorationIntent,
    width: number,
  ): Promise<DirectionResult[]> {
    log(`\n[DeepExplorer] 🔍 Multi-head exploring...`);
    log(`[DeepExplorer]    Core: ${intent.coreObject}`);

    // Generate directions constrained by intent
    const directions = await this.generateDirections(intent, width);
    log(`[DeepExplorer]    ${directions.length} directions generated`);

    // Parallel search
    const results = await Promise.all(
      directions.map(async (dir) => {
        const findings: Finding[] = [];
        let rawContent = '';

        for (const query of dir.queries.slice(0, 2)) {
          try {
            const searchResult = await searchWeb(query, {
              maxResults: 3,
              searchDepth: 'basic',
            });

            if (searchResult.success) {
              for (const r of searchResult.results) {
                // Serendipity check: Is this result novel to the graph?
                const contentPreview = `${r.title}\n${(r.content || '').substring(0, 500)}`;
                const surprise = await graphReader.calculateSurprise(contentPreview, intent.coreObject);
                
                // Skip low-novelty results (already known to graph)
                if (surprise.score < 0.3) {
                  log(`[DeepExplorer]    ⏭️  Skipping (surprise=${surprise.score.toFixed(2)}): ${r.title.substring(0, 40)}...`);
                  continue;
                }

                // Ingest finding to graph (now with serendipity pre-filter)
                await graphWriter.ingestFinding(
                  r.url,
                  r.title,
                  r.content || '',
                  [] // We might infer related entities later/from intent
                );

                findings.push({
                  title: r.title,
                  url: r.url,
                  content: r.content || '',
                  source: 'search',
                });
                rawContent += `${r.title}: ${r.content}\n\n`;
                log(`[DeepExplorer]    ✨ Added (surprise=${surprise.score.toFixed(2)}): ${r.title.substring(0, 40)}...`);
              }
            }
          } catch {
            logWarn(`[DeepExplorer] Search failed for "${query}"`);
          }
        }

        // Fallback: LLM-generated content
        if (findings.length === 0) {
          rawContent = await this.generateFallbackContent(dir.name, dir.queries, intent);
          findings.push({
            title: dir.name,
            content: rawContent,
            url: '',
            source: 'llm',
          });
          log(`[DeepExplorer]    ⚡ ${dir.name}: LLM fallback`);
        } else {
          log(`[DeepExplorer]    ✅ ${dir.name}: ${findings.length} findings`);
        }

        return { name: dir.name, findings, rawContent };
      }),
    );

    return results;
  }

  /**
   * Generate exploration directions constrained by intent
   * 
   * ENHANCED: Now queries the Graph for existing knowledge to enrich directions.
   * This creates a "Graph ↔ Explorer" feedback loop.
   */
  private async generateDirections(
    intent: ExplorationIntent,
    width: number,
  ): Promise<ExplorationDirection[]> {
    // ENHANCEMENT: Query Graph for related entities
    let graphContext = '';
    const existingEntity = graphReader.resolveEntity(intent.coreObject);
    if (existingEntity) {
      const fp = graphReader.getFingerprint(existingEntity.id);
      if (fp && fp.relatedTerms.length > 0) {
        graphContext = `\n\nKNOWN FROM GRAPH:
- Entity: ${fp.title} (${existingEntity.id})
- Related concepts: ${fp.relatedTerms.join(', ')}
- Consider exploring connections to: ${fp.relatedTerms.slice(0, 3).join(', ')}`;
        log(`[DeepExplorer] 🧠 Found graph context for "${intent.coreObject}": ${fp.relatedTerms.join(', ')}`);
      }
    }

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Generate ${width} exploration directions for the user's query.

CRITICAL: All directions must focus on the CORE OBJECT, not just the context!

User's core object: ${intent.coreObject}
Context: ${intent.context}
Original query: ${intent.originalQuery}${graphContext}

Requirements:
1. Each direction should explore the CORE OBJECT from a different angle
2. Direction names can be in Chinese (for display)
3. Search queries MUST be in English (for better search results)
4. Queries should be specific to ${intent.coreObject}, NOT generic ${intent.context} queries
5. Include the pre-generated queries if relevant: ${intent.searchQueries.join(', ')}
6. If KNOWN FROM GRAPH is provided, leverage those connections for richer exploration

Example for "惊天魔盗团中'人为控制下雨'的片段解读":
GOOD directions:
- "魔术机关解析" with queries ["Now You See Me rain scene mechanism", "money rain magic trick how"]
- "场景象征意义" with queries ["Now You See Me rain symbolism meaning", "Four Horsemen climax metaphor"]

BAD directions (too generic):
- "电影情节分析" with queries ["Now You See Me plot summary"] ← NO! This ignores the rain scene

Output JSON:
{
  "directions": [
    {
      "name": "方向名称 (Chinese)",
      "queries": ["specific english query about core object", "another specific query"]
    }
  ]
}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    return result.directions || [];
  }

  /**
   * Fallback content generation when search fails
   */
  private async generateFallbackContent(
    directionName: string,
    queries: string[],
    intent: ExplorationIntent,
  ): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a knowledge expert. Provide detailed information about:

Core object: ${intent.coreObject}
Context: ${intent.context}
Direction: ${directionName}
Related queries: ${queries.join(', ')}

IMPORTANT: Focus on the specific "${intent.coreObject}", not generic information about "${intent.context}".

Provide 3-4 concrete facts, stories, or examples. Include:
- Specific names, dates, numbers when possible
- Surprising or counter-intuitive facts
- Real-world examples or case studies

Keep it concise but informative (200-400 words).`,
        },
      ],
    });

    return response.choices[0].message.content || '';
  }

  // =============================================================================
  // EVALUATION
  // =============================================================================

  /**
   * Evaluate all directions using strategy
   */
  private async evaluateDirections(
    directions: DirectionResult[],
    strategy: IDepthStrategy,
    intent: ExplorationIntent,
  ): Promise<EvaluatedDirection[]> {
    log(`\n[DeepExplorer] 🎯 Evaluating ${directions.length} directions...`);

    const evaluated: EvaluatedDirection[] = [];

    for (const dir of directions) {
      const score = await strategy.evaluate(dir.findings, intent);
      evaluated.push({ ...dir, score });
      log(`[DeepExplorer]    ${dir.name}: ${score.total.toFixed(1)} (L${score.level})`);
    }

    return evaluated;
  }

  // =============================================================================
  // SEARCH
  // =============================================================================

  /**
   * Execute search queries using unified search service
   */
  private async search(queries: string[]): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const query of queries) {
      try {
        const searchResult = await searchWeb(query, {
          maxResults: 3,
          searchDepth: 'advanced',
        });

        if (searchResult.success) {
          for (const r of searchResult.results) {
            // Ingest finding to graph
            await graphWriter.ingestFinding(
              r.url,
              r.title,
              r.content || '',
              []
            );

            findings.push({
              title: r.title,
              url: r.url,
              content: r.content || '',
              source: 'search',
            });
          }
        }
      } catch {
        // Ignore search errors
      }
    }

    return findings;
  }

  // =============================================================================
  // REFLECTION (from DeepWideResearch)
  // =============================================================================

  /**
   * Forced reflection - log current state for debugging/auditing
   */
  private reflect(score: DepthScore, strategy: IDepthStrategy, round: number): void {
    log(`\n[Reflect] Round ${round + 1}`);
    log(`  Strategy: ${strategy.name}`);
    log(`  Current Level: ${score.level}`);
    log(`  Dimensions:`);
    for (const [key, value] of Object.entries(score.dimensions)) {
      const bar = '█'.repeat(Math.round(value)) + '░'.repeat(10 - Math.round(value));
      log(`    - ${key}: ${bar} ${value}`);
    }
    log(`  Total: ${score.total.toFixed(1)}`);
    log(`  Reason: ${score.reason}`);
  }
}

// Singleton
export const deepExplorer = new DeepExplorer();

