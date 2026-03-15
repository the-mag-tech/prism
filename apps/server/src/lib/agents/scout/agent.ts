import { getOpenAI } from '../../ai-clients.js';
import { search as searchWeb } from '../../search-service.js';
import { snapshotUrl } from './snapshot.js';
import { v4 as uuidv4 } from 'uuid';
// NOTE: extractEntities import removed - entity extraction now handled by middleware atom
// which triggers Entity Lifecycle Hooks automatically
import { graphReader, graphWriter, ScoutEntity, GroundedResult, EntityProfile } from '../../graph-link/index.js';
import { scoutQueryGenerator } from './query-generator.js';
import { log, logError } from '../../logger.js';

// Types imported from graph-link
export type { ScoutEntity, GroundedResult, EntityProfile };

export interface ScoutTask {
  originalText: string;
  entities: ScoutEntity[];
}

// =============================================================================
// AGENT CLASS
// =============================================================================

export class ScoutAgent {
  /**
   * Phase 1: Extract entities from narrative text
   */
  async extract(text: string): Promise<ScoutEntity[]> {
    const openai = getOpenAI();
    if (!openai) {
      console.warn('[ScoutAgent] OpenAI not available, cannot extract entities');
      return [];
    }
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a Scout Agent. Your goal is to identify "Vague Entities" in a narrative that need to be grounded in reality.
          
          Look for:
          1. People mentioned by first name only (e.g., "Julian")
          2. Vague topics or news (e.g., "that new React compiler")
          3. Projects or Events without links
          4. Slogans or Vibe-checks (e.g., "Who is prompt king?", "Let's make it funny")
          
          Output JSON:
          {
            "entities": [
              {
                "name": "Prompt King",
                "type": "concept",
                "context": "User asked 'Who is prompt king?', likely referring to Riley Goodside or similar prompt engineer",
                "searchQuery": "Who is called the prompt king in AI engineering?"
              },
              {
                "name": "Funny Vibe",
                "type": "topic",
                "context": "User wants to 'make it funny', looking for humorous tech content",
                "searchQuery": "funny tech twitter accounts developer humor"
              }
            ]
          }`
        },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    const entities = result.entities || [];

    // Attempt to resolve against existing DB entities
    return this.resolveEntities(entities);
  }

  /**
   * Helper: Resolve Extracted Entities against DB
   * Tries to find if "Simon" is actually "person:simon_willison"
   */
  private resolveEntities(entities: ScoutEntity[]): ScoutEntity[] {
    return entities.map(entity => {
      const graphEntity = graphReader.resolveEntity(entity.name);

      if (graphEntity) {
        log(`[Scout] Resolved "${entity.name}" -> ${graphEntity.title} (${graphEntity.id})`);
        return {
          ...entity,
          prismId: graphEntity.id,
          // Enrich context immediately from DB to help scouting
          context: `${graphEntity.title} ${graphEntity.subtitle || ''} ${graphEntity.body?.substring(0, 100) || ''}. Original context: ${entity.context}`
        };
      }

      return entity;
    });
  }

  /**
   * Helper: Enrich Entity Context from DB (Fingerprinting)
   * Given a ScoutEntity with a prismId, fetch its full profile to build a better query.
   * 
   * Now uses the enhanced graphReader.enrichContext() which includes relations.
   */
  enrichContext(entity: ScoutEntity): ScoutEntity {
    if (!entity.prismId) return entity;

    // Use enhanced enrichContext with relations included
    const fingerprint = graphReader.enrichContext(entity.prismId);
    if (!fingerprint) return entity;

    // Generate a more precise search query
    const refinedQuery = `${fingerprint} latest news blog`;

    log(`[Scout] Enriched context for ${entity.name}: "${fingerprint.substring(0, 50)}..."`);

    return {
      ...entity,
      context: fingerprint,
      searchQuery: refinedQuery
    };
  }

  /**
   * Phase 2 & 3: Scout (Search) & Snapshot
   */
  async scout(entity: ScoutEntity): Promise<GroundedResult> {
    // 1. Enrich context if possible (Fingerprinting)
    const richEntity = this.enrichContext(entity);
    log(`[Scout] Searching for: ${richEntity.searchQuery}`);

    // Strategy 1: Check if context already has a URL
    const explicitUrl = this.findUrlInContext(richEntity.context);
    if (explicitUrl) {
      log(`[Scout] Found explicit URL: ${explicitUrl}`);
      return this.processUrl(explicitUrl, richEntity);
    }

    // Strategy 2: Use unified search service (Tavily → Qveris fallback)
    try {
      log(`[Scout] Invoking search service...`);
      const searchResult = await searchWeb(richEntity.searchQuery, {
        searchDepth: 'basic',
        includeAnswer: false,
        maxResults: 3, // Get top 3 to verify
      });

      if (searchResult.success && searchResult.results.length > 0) {
        log(`[Scout] Search succeeded via ${searchResult.provider} (${searchResult.latencyMs}ms)`);
        
        // Verify matches
        for (const candidate of searchResult.results) {
          log(`[Scout] Verifying candidate: ${candidate.url} (${candidate.title})`);
          const verification = await this.verifyCandidate(richEntity, {
            title: candidate.title,
            content: candidate.content,
            url: candidate.url,
          });

          if (verification.isMatch) {
            log(`[Scout] ✅ Verified! ${verification.reason}`);
            return this.processUrl(candidate.url, richEntity);
          } else {
            log(`[Scout] ❌ Rejected: ${verification.reason}`);
          }
        }
        log(`[Scout] No candidates passed verification.`);
      } else if (!searchResult.success) {
        log(`[Scout] Search failed: ${searchResult.error}`);
      }
    } catch (error) {
      logError(`[Scout] Search service failed:`, error);
    }

    // Strategy 3: Fallback (Failed)
    return {
      originalEntity: entity,
      confidence: 0,
    };
  }

  /**
   * Phase 2.5: Verify Candidate (Consistency Check)
   */
  private async verifyCandidate(entity: ScoutEntity, candidate: { title: string; content: string; url: string }): Promise<{ isMatch: boolean; reason: string }> {
    const openai = getOpenAI();
    if (!openai) {
      return { isMatch: false, reason: 'OpenAI not available' };
    }
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a Consistency Verifier. Your job is to check if a search result matches the specific entity we are looking for.
            
            Target Entity:
            - Name: ${entity.name}
            - Context/Fingerprint: ${entity.context}
            
            Search Candidate:
            - Title: ${candidate.title}
            - Snippet: ${candidate.content}
            - URL: ${candidate.url}
            
            Task: Does this candidate refer to the SAME entity as the target?
            - Beware of namesakes (e.g., Simon Willison vs Simon Cowell).
            - Beware of irrelevant content (e.g., general dictionary definitions).
            
            Output JSON:
            {
              "isMatch": boolean,
              "reason": "Short explanation"
            }`
          }
        ],
        response_format: { type: 'json_object' }
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      return {
        isMatch: result.isMatch ?? false,
        reason: result.reason || 'No reason provided'
      };
    } catch (error) {
      logError('[Scout] Verification failed:', error);
      return { isMatch: true, reason: 'Verification system error (defaulting to match)' }; // Fail open or closed? Let's fail open for dev.
    }
  }

  /**
   * Helper: Extract URL from text
   */
  private findUrlInContext(text: string): string | null {
    const match = text.match(/https?:\/\/[^\s]+/);
    return match ? match[0] : null;
  }

  /**
   * Helper: Process a found URL (Snapshot -> Save -> Result)
   * 
   * Deduplication: Skip URLs already processed within REFRESH_THRESHOLD_DAYS.
   * After threshold, content will be re-fetched and updated.
   */
  private static readonly REFRESH_THRESHOLD_DAYS = 7;

  private async processUrl(url: string, entity: ScoutEntity): Promise<GroundedResult> {
    // Deduplication: Check if URL was recently processed
    // v50: Uses scout_findings table (split from memories)
    const { getDB } = await import('../../../db.js');
    const db = getDB();
    
    const existing = db.query(`
      SELECT id, title, fetched_at,
             julianday('now') - julianday(fetched_at) as days_since_fetch
      FROM scout_findings 
      WHERE url = ?
    `).get(url) as { id: number; title: string; fetched_at: string; days_since_fetch: number } | undefined;

    if (existing && existing.days_since_fetch < ScoutAgent.REFRESH_THRESHOLD_DAYS) {
      log(`[Scout] ⏭️ URL already processed ${existing.days_since_fetch.toFixed(1)} days ago, skipping: ${url}`);
      return {
        originalEntity: entity,
        foundMemoryId: existing.id,
        foundUrl: url,
        summary: existing.title,
        confidence: 1.0,
        extractedEntitiesCount: 0,
      };
    }

    if (existing) {
      log(`[Scout] 🔄 URL exists but stale (${existing.days_since_fetch.toFixed(1)} days old), refreshing: ${url}`);
    }

    const snapshot = await snapshotUrl(url);

    if (snapshot) {
      // =========================================================================
      // SERENDIPITY GATE: Evaluate information gain BEFORE writing to graph
      // =========================================================================
      const contentSummary = `${snapshot.title}\n${(snapshot.textContent || snapshot.content || '').substring(0, 500)}`;
      const surprise = await graphReader.calculateSurprise(contentSummary, entity.prismId);
      
      log(`[Scout] 🔮 Serendipity: ${surprise.score.toFixed(2)} - ${surprise.reason}`);
      
      // Only write to graph if information gain is sufficient
      const SERENDIPITY_THRESHOLD = 0.5;
      if (surprise.score < SERENDIPITY_THRESHOLD) {
        log(`[Scout] ⏭️ Low information gain (${surprise.score.toFixed(2)} < ${SERENDIPITY_THRESHOLD}), skipping write`);
        return {
          originalEntity: entity,
          foundUrl: url,
          summary: snapshot.excerpt || snapshot.title,
          confidence: surprise.score, // Return actual serendipity score
          serendipityReason: surprise.reason,
        };
      }
      
      // =========================================================================
      // WRITE TO GRAPH: Only reaches here if serendipity > threshold
      // =========================================================================
      const relatedEntities: string[] = [];
      if (entity.prismId) relatedEntities.push(entity.prismId);

      // Pass clean content without metadata prefix
      // Metadata (entity, type, url) is tracked via:
      // - url: source URL
      // - relatedEntities: links to triggering entity
      // - subtitle: source url (set by ingestFinding)
      let memoryId: number;
      try {
        // ingestFinding() triggers entity-extraction atom via middleware chain
        // The atom uses GraphWriter.addEntityFromSource() which triggers Entity Lifecycle Hooks
        // This enables automatic Scout/Ripple propagation for newly discovered entities
        // See: src/lib/graph-link/hooks.ts
        memoryId = await graphWriter.ingestFinding(
          url,
          snapshot.title,
          snapshot.content,
          relatedEntities,
          snapshot.textContent || '',
          entity.prismId  // triggeredBy: link to source entity
        );
        log(`[Scout] ✅ Ingested finding #${memoryId}, entity extraction via middleware`);
      } catch (ingestError) {
        // ingestFinding failed (e.g., AI summary unavailable) - abort cleanly
        logError(`[Scout] ❌ Ingest failed, aborting:`, ingestError);
        return {
          originalEntity: entity,
          foundUrl: url,
          confidence: 0,
          serendipityReason: `Ingest failed: ${(ingestError as Error).message}`,
        };
      }

      // NOTE: Entity extraction is now handled by entity-extraction atom in middleware chain
      // No need to call extractEntities() manually - it would be redundant
      // The atom will:
      // 1. Extract entities from content
      // 2. Call addEntityFromSource() for each entity
      // 3. Trigger Entity Lifecycle Hooks (Scout + Ripple) automatically

      return {
        originalEntity: entity,
        foundMemoryId: memoryId,
        foundUrl: url,
        summary: snapshot.excerpt || snapshot.title,
        confidence: surprise.score, // Use serendipity score as confidence
        serendipityReason: surprise.reason,
      };
    } else {
      console.warn(`[Scout] Snapshot failed for ${url}`);
      return {
        originalEntity: entity,
        foundUrl: url,
        confidence: 0.1,
      };
    }
  }

  /**
   * Phase 4: Ground (Rewrite text)
   */
  async ground(text: string, results: GroundedResult[]): Promise<string> {
    let groundedText = text;

    for (const result of results) {
      if (result.confidence > 0.5 && result.foundMemoryId) {
        const pattern = new RegExp(result.originalEntity.name, 'g');
        groundedText = groundedText.replace(
          pattern,
          `[Memory:${result.foundMemoryId} ${result.originalEntity.name}]`
        );
      } else if (result.confidence > 0 && result.foundUrl) {
        const pattern = new RegExp(result.originalEntity.name, 'g');
        groundedText = groundedText.replace(
          pattern,
          `[Link ${result.originalEntity.name}](${result.foundUrl})`
        );
      }
    }

    return groundedText;
  }

  /**
   * NEW: Discovery Mode
   * Analyze a document and "discover" the most insightful entity to onboard.
   * Supports explicit INTENT injection.
   */
  async discover(docContext: string, intent?: string): Promise<{ name: string; reason: string; type: string } | null> {
    log(`[Scout] Discovering insights from document context...`);
    log(`[Scout] Intent Filter: ${intent || "General Discovery"}`);

    const openai = getOpenAI();
    if (!openai) {
      console.warn('[ScoutAgent] OpenAI not available, cannot discover');
      return null;
    }
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a "Serendipity Engine" and a Context Detective.
          
          Your Goal: 
          Analyze the text, which may contain anonymized code names like "[The Architect]" or "[The Data Engine]".
          
          CRITICAL: Apply the User's INTENT to filter your discovery.
          User Intent: "${intent || "Identify the creator of the technology described"}"
          
          Use your internal knowledge base to DE-ANONYMIZE entities that match the INTENT.
          
          Example Logic:
          - If Intent is "Find Tech Creator": Look for Simon Willison (Datasette).
          - If Intent is "Find UI/UX Inspiration": Look for Julian Benner (Generative UI) or Linus Lee (Notion AI), even if they are minor mentions.
          
          Identify the single most likely real-world Person who matches the Intent.
          
          Input Text: ${docContext.substring(0, 3000)}... (truncated)
          
          Output JSON:
          {
            "name": "Julian Benner",
            "type": "person",
            "reason": "The user is looking for UI/UX inspiration, and the text mentions 'Generative UI', which is a concept pioneered/discussed by Julian Benner."
          }`
        },
        { role: 'user', content: docContext }
      ],
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    if (!result.name) return null;

    return {
      name: result.name,
      type: result.type,
      reason: result.reason
    };
  }

  /**
   * NEW: Recursive Context Expansion
   * Parses the context for references like [project:naughty_labs] and injects their graph data.
   * 
   * Now uses the enhanced getFingerprint() which already includes relations.
   */
  private async expandContext(context: string): Promise<string> {
    let expanded = context;

    // Match patterns like [project:naughty_labs] or [person:simon]
    const matches = context.matchAll(/\[([a-z]+:[a-z0-9_]+)\]/g);

    for (const match of matches) {
      const fullTag = match[0];
      const entityId = match[1];

      // Use enhanced getFingerprint (includes relations)
      const fp = graphReader.getFingerprint(entityId);

      if (fp) {
        log(`[Scout] 💉 Injecting recursive context for ${entityId}...`);

        const injection = `
        (Context Injection from ${entityId}:
         Summary: ${fp.fingerprint.substring(0, 200)}
         Related to: ${fp.relatedTerms.join(', ')}
        )`;

        expanded = expanded.replace(fullTag, injection);
      }
    }

    return expanded;
  }

  /**
   * NEW: Profile Generation Pipeline
   * Used to "Wake Up" a ghost entity by searching and synthesizing a profile.
   */
  async profile(entityName: string, context: string): Promise<EntityProfile> {
    // 0. Recursive Context Expansion
    const expandedContext = await this.expandContext(context);
    if (context !== expandedContext) {
      log(`[Scout] Context Expanded: ${expandedContext.substring(0, 100)}...`);
    }

    log(`[Scout] Profiling ${entityName} with context: "${expandedContext}"`);

    // Track raw sources for transparency
    const rawSources: Array<{
      title: string;
      url: string;
      snippet: string;
      score?: number;
      query: string;
    }> = [];
    const aiAnswers: string[] = [];
    let searchResults: string[] = [];
    const queries: string[] = [];

    // 1. Deep Search (Triangulation) using unified search service
    queries.push(
      `${entityName} bio ${expandedContext}`,
      `${entityName} projects github`,
      `${entityName} latest thoughts blog`
    );

    log(`[Scout] Searching with ${queries.length} queries...`);

    // Parallel Search using unified search service
    const searchPromises = queries.map(q =>
      searchWeb(q, {
        searchDepth: 'basic',
        maxResults: 2,
        includeAnswer: true
      }).then(r => ({ query: q, result: r }))
    );

    let searchEngine = 'none';
    try {
      const results = await Promise.all(searchPromises);
      results.forEach(({ query, result: r }) => {
        if (r.success) {
          searchEngine = r.provider;
          if (r.answer) {
            aiAnswers.push(r.answer);
            searchResults.push(`AI Summary: ${r.answer}`);
          }
          r.results.forEach((res) => {
            // Store raw source with full metadata
            rawSources.push({
              title: res.title || 'Untitled',
              url: res.url || '',
              snippet: res.content || '',
              score: res.score,
              query,
            });
            searchResults.push(`Source (${res.title}): ${res.content} URL: ${res.url}`);
          });
        }
      });
      log(`[Scout] Found ${rawSources.length} sources from ${queries.length} queries (via ${searchEngine})`);
    } catch (e) {
      console.warn("[Scout] Search failed during profiling:", e);
      searchResults.push(`Context: ${expandedContext}`);
    }

    // 2. Synthesis (Bio & Connections) - pass raw sources for real URLs
    const synthesis = await this.synthesizeProfile(entityName, searchResults.join('\n---\n'), rawSources);

    // 3. Attach search metadata for transparency
    synthesis.rawSources = rawSources;
    synthesis.searchMetadata = {
      queries,
      totalResults: rawSources.length,
      searchEngine,
      timestamp: new Date().toISOString(),
      aiAnswers: aiAnswers.length > 0 ? aiAnswers : undefined,
    };

    return synthesis;
  }

  /**
   * NEW: Onboard & Ripple
   * Takes a profile, deep searches their content, and ingests it to trigger the Ripple Effect.
   */
  async onboard(profile: EntityProfile): Promise<void> {
    log(`\n🌊 Initiating Ripple Effect for: ${profile.name}`);
    log(`[Scout] Sourcing core content to ingest...`);

    // 1. Search for high-value content (Essays, Talks)
    // We prefer "essays", "blog", "manifesto" to get dense content
    const query = `${profile.name} best essays blog popular posts ${profile.role || ''}`;

    try {
      const searchResult = await searchWeb(query, {
        searchDepth: 'advanced',
        maxResults: 3,
      });

      if (!searchResult.success || searchResult.results.length === 0) {
        log(`[Scout] No content found to ingest (${searchResult.error || 'no results'}).`);
        return;
      }
      
      log(`[Scout] Found ${searchResult.results.length} sources via ${searchResult.provider}`);

      // 2. Ingest each result
      for (const result of searchResult.results) {
        log(`[Scout] 📥 Ingesting: ${result.title} (${result.url})`);

        // Snapshot & Save (triggers entity extraction via middleware atom + Entity Lifecycle Hooks)
        // We reuse processUrl but we construct a fake ScoutEntity context for it
        // We should also expand recursive context if present in profile bio or similar, but profile object is already synthesized
        const dummyEntity: ScoutEntity = {
          name: profile.name,
          type: 'person',
          context: `Core content by ${profile.name}. ${profile.bio}`,
          searchQuery: query,
          // If we had the real Entity ID here, we should pass it to link strongly
        };

        const groundResult = await this.processUrl(result.url, dummyEntity);

        if (groundResult.extractedEntitiesCount && groundResult.extractedEntitiesCount > 0) {
          log(`   ✅ Ripple: Extracted ${groundResult.extractedEntitiesCount} new entities from this article.`);
        }
      }

      log(`\n🌊 Ripple Effect Complete. ${profile.name} is now a grounded anchor in the graph.`);

    } catch (e) {
      logError("[Scout] Failed during onboard/sourcing:", e);
    }
  }

  /**
   * Helper: Synthesize unstructured search data into a JSON Profile
   * 
   * IMPORTANT: keyLinks are now derived from rawSources (real URLs),
   * NOT generated by LLM (which could produce fake URLs).
   */
  private async synthesizeProfile(
    name: string, 
    rawData: string,
    rawSources: Array<{ title: string; url: string; snippet: string; score?: number }> = []
  ): Promise<EntityProfile> {
    const openai = getOpenAI();
    
    // Build keyLinks from real search results (top 3 by score)
    const realKeyLinks = rawSources
      .filter(s => s.url && s.title)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 3)
      .map(s => ({
        title: s.title.slice(0, 80),
        url: s.url,
        source: 'search' as const,
      }));
    
    if (!openai) {
      return {
        name,
        role: 'unknown',
        bio: rawData.substring(0, 200),
        tags: [],
        keyLinks: realKeyLinks,
        relatedEntities: [],
      };
    }
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a Context Architect and Insight Decoder.
          Your job is to synthesize a structured profile based on scattered search snippets.
          
          Your Goal: Extract the "Soul" of the entity (Mental Models, Core Principles, Vibe).
          
          CRITICAL: Determine if the entity is a "Person/Expert" or a "Topic/Concept".
          
          If "Person/Expert" (e.g. "Linear", "Ogilvy", "Jobs"):
          - Focus on their **Philosophy**, **Aesthetic**, and **Voice**.
          - Extract "Core Principles" (Rules they live/build by).
          - Extract "Tone/Voice" (How they write/speak).
          
          If "Topic/Concept":
          - Focus on definition and key characteristics.
          
          Target: ${name}
          Context: ${rawData.substring(0, 500)}...
          
          IMPORTANT: Do NOT generate "keyLinks" - those will be provided from real search results.
          
          Output JSON:
          {
            "name": "${name}",
            "bio": "Concise bio focusing on their unique contribution/philosophy.",
            "role": "The specific archetype (e.g. 'The Craftsman', 'The Contrarian')",
            "tags": ["Tag1", "Tag2"],
            "relatedEntities": [
              { "name": "Related Entity", "reason": "Why it inspired this", "type": "project" }
            ],
            "assets": [
               "Principle: [Core Belief]",
               "Mental Model: [Concept Name]",
               "Tone: [Adjective]",
               "Quote: [Representative Quote]",
               "Example: [Specific example of their work/style]"
            ]
          }`
        },
        { role: 'user', content: rawData }
      ],
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    
    // Merge LLM-generated keyLinks (if any, marked as 'llm') with real ones
    const llmKeyLinks = (result.keyLinks || []).map((link: any) => ({
      ...link,
      source: 'llm' as const,
    }));
    
    return {
      name: result.name || name,
      bio: result.bio || "No description available.",
      role: result.role,
      tags: result.tags || [],
      // Real links first, then any LLM-suggested ones (clearly marked)
      keyLinks: [...realKeyLinks, ...llmKeyLinks],
      relatedEntities: result.relatedEntities || [],
      assets: result.assets || []
    };
  }

  /**
   * Phase 6: Multi-Anchor Parallel Scout
   */
  async scoutMultiple(entities: ScoutEntity[], concurrency: number = 3): Promise<GroundedResult[]> {
    const results: GroundedResult[] = [];
    const chunks = [];

    // Chunking
    for (let i = 0; i < entities.length; i += concurrency) {
      chunks.push(entities.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      log(`[Scout] Processing batch of ${chunk.length} entities...`);
      const batchResults = await Promise.all(chunk.map(e => this.scout(e)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Phase 6: Targeted Patrol (Replaces PatrolAgent)
   * Uses GraphLink to resolve entity and update activity.
   * 
   * Now uses AI-powered query generation for smarter searches.
   */
  async patrol(entityId: string): Promise<GroundedResult | null> {
    log(`[Scout] 🚔 Patrolling ${entityId}...`);

    // 1. Record Activity (LOD reset)
    await graphWriter.recordActivity(entityId, 'scout');

    // 2. Resolve Entity
    const entity = graphReader.getEntity(entityId);
    if (!entity) {
      console.warn(`[Scout] Entity not found: ${entityId}`);
      return null;
    }

    // 3. Build Fingerprint using enhanced GraphReader (includes relations)
    const fp = graphReader.getFingerprint(entityId);
    const fingerprint = fp?.fingerprint || entity.title;
    const relatedTerms = fp?.relatedTerms || [];

    // 4. Generate AI-powered search queries
    const queries = await scoutQueryGenerator.generate({
      type: entity.type,
      title: entity.title,
      subtitle: entity.subtitle,
      body: entity.body,
      relatedTerms,
    });

    // 5. Try each query until we find a valid result
    for (const query of queries) {
      const target: ScoutEntity = {
        name: entity.title,
        type: entity.type as any,
        context: fingerprint,
        searchQuery: query,
        prismId: entityId
      };

      const result = await this.scout(target);
      
      // If we found something with high confidence, return it
      if (result.confidence > 0.5) {
        return result;
      }
    }

    // 6. All queries failed
    logError(`[Scout] All ${queries.length} queries failed for ${entityId}`);
    return {
      originalEntity: {
        name: entity.title,
        type: entity.type as any,
        context: fingerprint,
        searchQuery: queries[0] || entity.title,
      },
      confidence: 0,
    };
  }
}
