/**
 * Entity Extraction - Extract entities from memories using AI
 * 
 * Extracts: people, projects, decisions, concepts, events
 * Each extraction creates a batch for rollback capability.
 * 
 * IMPORTANT: This creates BOTH entities AND page_blocks as an atomic operation.
 * Each entity becomes a "Perspective Page" with related entities as blocks.
 */

import { v4 as uuidv4 } from 'uuid';
import { log, logError, logWarn } from './lib/logger.js';
import crypto from 'crypto';
import { getDB } from './db.js';
import { EXTRACTION_PROMPT, getExtractionVersion } from './pipeline-version.js';
import { EXTRACTABLE_TYPES, type ExtractableType } from '@prism/contract';
import { SCOUTABLE_TYPES } from '@prism/contract';
import { BlockFactory, BlockOptions } from './lib/graph-link/block-factory.js';
import { getOpenAI } from './lib/ai-clients.js';
import { graphWriter } from './lib/graph-link/index.js';

// =============================================================================
// TYPES
// =============================================================================

// Re-export for consumers
export type { ExtractableType };

interface ExtractedEntity {
  type: ExtractableType;
  name: string;           // Used to generate ID: "person:simon"
  title: string;          // Display title
  subtitle?: string;      // Secondary text
  body?: string;          // Extended content
  tag?: string;           // Category tag
  // v1 (deprecated): relatedTo?: string[];
}

/**
 * Semantic relation extracted from content (v2.0)
 * @example { source: "person:simon", relation: "created", target: "project:datasette" }
 */
interface ExtractedRelation {
  source: string;         // Full entity ID (type:name)
  relation: string;       // Semantic relation type (works_at, created, uses, etc.)
  target: string;         // Full entity ID (type:name)
  context?: string;       // Optional evidence from text
}

// NOTE: Block size mapping moved to frontend (Magpie) as part of SemanticRole refactor.
// Backend only stores EntityCategory; frontend maps it to cols/rows/color via SemanticRole.
// @see apps/magpie/src/lib/entity-semantics-api.ts

interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];  // v2.0: Semantic relations
  reasoning: string;
}

interface MemoryRow {
  id: number;
  source_url: string;           // v50: renamed from source_path
  source_type: string;
  content: string;
  text_content: string | null;  // Plain text version for summaries
  title: string | null;
  ingested_at: string | null;   // v50: renamed from created_at
}

/**
 * Generate a short summary for entity.body display
 * Prioritizes text_content over content, strips HTML if needed
 */
function generateBodySummary(mem: MemoryRow, maxLength: number = 300): string {
  // Prefer text_content (plain text) over content (HTML)
  const source = mem.text_content || mem.content || '';
  
  // Strip HTML tags if content looks like HTML
  let text = source;
  if (text.includes('<') && text.includes('>')) {
    text = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  // Remove Scout metadata header if present
  text = text.replace(/^\[Scout Entity:.*?\]\s*\[Type:.*?\]\s*\[Source:.*?\]\s*/s, '');
  
  // Truncate and add ellipsis
  if (text.length > maxLength) {
    // Try to break at sentence boundary
    const truncated = text.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('. ');
    if (lastPeriod > maxLength * 0.6) {
      return truncated.substring(0, lastPeriod + 1);
    }
    return truncated.trimEnd() + '...';
  }
  
  return text;
}

// EXTRACTION_PROMPT is imported from pipeline-version.ts for centralized versioning

// =============================================================================
// EXTRACTION LOGIC
// =============================================================================

/**
 * Extract entities from a single memory using AI
 */
async function extractFromMemory(memory: MemoryRow): Promise<ExtractionResult> {
  // Truncate very long content
  const content = memory.content.length > 8000
    ? memory.content.substring(0, 8000) + '\n\n[... truncated ...]'
    : memory.content;

  const openai = getOpenAI();
  if (!openai) {
    throw new Error('OpenAI not available - configure API key or proxy');
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Document title: "${memory.title || 'Untitled'}"\nSource: ${memory.source_url || 'unknown'}\n\n---\n\n${content}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');

    // VALIDATION: Filter out invalid entity types
    // This protects the database from AI hallucinations
    // Uses EXTRACTABLE_TYPES from prism-contract (SSOT)
    const rawEntities = (result.entities || []) as ExtractedEntity[];
    const validEntities = rawEntities.filter(e => {
      const isValid = (EXTRACTABLE_TYPES as readonly string[]).includes(e.type);
      if (!isValid) {
        logWarn(`[Extract] Dropped invalid entity type: ${e.type} (${e.title})`);
      }
      return isValid;
    });

    // v2.0: Parse semantic relations
    const rawRelations = (result.relations || []) as ExtractedRelation[];
    
    // Validate relations: both source and target must be valid entity IDs
    const entityIds = new Set(validEntities.map(e => generateEntityId(e.type, e.name)));
    const validRelations = rawRelations.filter(r => {
      // Normalize source and target to type:name format
      const sourceType = r.source.split(':')[0];
      const targetType = r.target.split(':')[0];
      
      // Check if types are valid (either extractable or source types)
      const validSourceType = (EXTRACTABLE_TYPES as readonly string[]).includes(sourceType) || 
                              ['memory', 'finding'].includes(sourceType);
      const validTargetType = (EXTRACTABLE_TYPES as readonly string[]).includes(targetType) ||
                              ['memory', 'finding'].includes(targetType);
      
      if (!validSourceType || !validTargetType) {
        logWarn(`[Extract] Dropped relation with invalid type: ${r.source} -[${r.relation}]-> ${r.target}`);
        return false;
      }
      
      return true;
    });

    log(`[Extract] Parsed ${validEntities.length} entities, ${validRelations.length} semantic relations`);

    return {
      entities: validEntities,
      relations: validRelations,
      reasoning: result.reasoning || '',
    };

  } catch (error) {
    log(`[Extract] Failed for memory ${memory.id}:`, error);
    return { entities: [], relations: [], reasoning: 'Extraction failed' };
  }
}

/**
 * Generate entity ID from type and name
 */
function generateEntityId(type: string, name: string): string {
  // Normalize name to lowercase snake_case
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')  // Allow Chinese chars
    .replace(/^_+|_+$/g, '');
  return `${type}:${normalized}`;
}

/**
 * Hash the prompt for tracking changes
 */
function hashPrompt(prompt: string): string {
  return crypto.createHash('md5').update(prompt).digest('hex').substring(0, 8);
}

// =============================================================================
// BATCH EXTRACTION
// =============================================================================

export interface ExtractOptions {
  strategyVersion?: string;
  description?: string;
  memoryIds?: number[];      // Specific memories to extract from (default: all)
  dryRun?: boolean;          // Preview without saving
  newOnly?: boolean;         // Only process memories not yet extracted
  idempotent?: boolean;      // Idempotent mode: update existing, add missing relations
}

export interface ExtractResult {
  batchId: string;
  entitiesCreated: number;
  entitiesSkipped: number;
  memoriesProcessed: number;
  entities: Array<{ id: string; title: string; type: string; fromMemory: number }>;
}

/**
 * Run entity extraction on memories
 * 
 * @ref infra/memo-id
 * @doc docs/WORKER-CHECKLIST.md#4-管线完整性
 * @since 2025-12-24 Uses unified memo_id field
 * 
 * This should be called after ingestFinding() to complete the pipeline.
 * Extracted entities are linked to their source memory via memo_id.
 * 
 * @param options.memoryIds - Specific memory IDs to process (bypasses newOnly filter)
 * @param options.newOnly - Only process memories without existing entity links
 * @param options.idempotent - Update existing entities and add missing relations
 */
export async function extractEntities(options: ExtractOptions = {}): Promise<ExtractResult> {
  const db = getDB();
  const batchId = uuidv4();
  const strategyVersion = options.strategyVersion || 'v1-balanced';
  const promptHash = hashPrompt(EXTRACTION_PROMPT);

  log(`\n[Extract] Starting extraction batch: ${batchId.substring(0, 8)}`);
  log(`[Extract] Strategy: ${strategyVersion}, Prompt hash: ${promptHash}`);

  // Get memories to process (v50: uses user_memories table)
  let memories: MemoryRow[];
  if (options.memoryIds && options.memoryIds.length > 0) {
    const placeholders = options.memoryIds.map(() => '?').join(',');
    memories = db.query(`
      SELECT * FROM user_memories WHERE id IN (${placeholders})
    `).all(...options.memoryIds) as MemoryRow[];
  } else if (options.newOnly) {
    // Only get memories that haven't been extracted yet
    // v50: Uses extraction_status field for pipeline tracking
    memories = db.query(`
      SELECT * FROM user_memories WHERE extraction_status = 'pending'
    `).all() as MemoryRow[];
    log(`[Extract] Mode: new-only (pending extraction_status)`);
  } else {
    memories = db.query('SELECT * FROM user_memories WHERE archived = 0').all() as MemoryRow[];
  }

  log(`[Extract] Processing ${memories.length} memories...`);

  // Track results
  const result: ExtractResult = {
    batchId,
    entitiesCreated: 0,
    entitiesSkipped: 0,
    memoriesProcessed: 0,
    entities: [],
  };

  // Collect all extracted entities and relations
  const allEntities: Array<{
    entity: ExtractedEntity;
    memoryId: number;
    entityId: string;
  }> = [];
  
  // v2.0: Collect semantic relations
  const allRelations: Array<{
    relation: ExtractedRelation;
    memoryId: number;
  }> = [];

  // Process each memory
  for (const memory of memories) {
    log(`\n[Extract] Processing: "${memory.title || 'Untitled'}" (ID: ${memory.id})`);

    const extraction = await extractFromMemory(memory);
    log(`[Extract] Found ${extraction.entities.length} entities, ${extraction.relations.length} relations`);
    if (extraction.reasoning) {
      log(`[Extract] Reasoning: ${extraction.reasoning}`);
    }

    for (const entity of extraction.entities) {
      const entityId = generateEntityId(entity.type, entity.name);
      allEntities.push({ entity, memoryId: memory.id, entityId });
    }
    
    // v2.0: Collect semantic relations
    for (const relation of extraction.relations) {
      allRelations.push({ relation, memoryId: memory.id });
    }

    result.memoriesProcessed++;
  }

  // Deduplicate entities by ID (keep first occurrence)
  const uniqueEntities = new Map<string, typeof allEntities[0]>();
  
  // v2.0: Semantic relation map (source -> [{relation, target}])
  const semanticRelationsMap = new Map<string, Array<{ relation: string; target: string; context?: string }>>();

  // Group entities by source memory for auto-linking
  const entitiesByMemory = new Map<number, string[]>();  // memoryId -> entityIds

  for (const item of allEntities) {
    if (!uniqueEntities.has(item.entityId)) {
      uniqueEntities.set(item.entityId, item);
      semanticRelationsMap.set(item.entityId, []);
    }
    // Track which entities came from which memory
    if (!entitiesByMemory.has(item.memoryId)) {
      entitiesByMemory.set(item.memoryId, []);
    }
    entitiesByMemory.get(item.memoryId)!.push(item.entityId);
  }
  
  // v2.0: Process semantic relations
  for (const { relation } of allRelations) {
    const sourceId = relation.source;
    if (!semanticRelationsMap.has(sourceId)) {
      semanticRelationsMap.set(sourceId, []);
    }
    // Avoid duplicates
    const existing = semanticRelationsMap.get(sourceId)!;
    if (!existing.some(r => r.relation === relation.relation && r.target === relation.target)) {
      existing.push({ 
        relation: relation.relation, 
        target: relation.target, 
        context: relation.context 
      });
    }
  }

  // AUTO-LINK: Entities from same memory should be related (fallback if AI misses relations)
  // Only add if no semantic relation exists between entities
  for (const [memoryId, entityIds] of entitiesByMemory) {
    if (entityIds.length > 1) {
      // Find the "main" entity (prefer project > event > person > concept > decision)
      const priorityOrder = ['project', 'event', 'person', 'concept', 'decision'];
      const sortedIds = [...entityIds].sort((a, b) => {
        const typeA = a.split(':')[0];
        const typeB = b.split(':')[0];
        return priorityOrder.indexOf(typeA) - priorityOrder.indexOf(typeB);
      });

      const mainEntityId = sortedIds[0];

      // Link other entities to main entity (using 'related_to' as fallback)
      // Only if no semantic relation already exists
      for (const entityId of entityIds) {
        if (entityId !== mainEntityId) {
          const existingRels = semanticRelationsMap.get(entityId) || [];
          const hasRelToMain = existingRels.some(r => r.target === mainEntityId);
          if (!hasRelToMain) {
            existingRels.push({ relation: 'related_to', target: mainEntityId });
            semanticRelationsMap.set(entityId, existingRels);
          }
          
          // Bidirectional fallback
          const mainRels = semanticRelationsMap.get(mainEntityId) || [];
          const hasRelToOther = mainRels.some(r => r.target === entityId);
          if (!hasRelToOther) {
            mainRels.push({ relation: 'related_to', target: entityId });
            semanticRelationsMap.set(mainEntityId, mainRels);
          }
        }
      }
      log(`[Extract] Auto-fallback linked ${entityIds.length} entities from memory:${memoryId} (main: ${mainEntityId})`);
    }
  }

  // Create source entity references for tracking
  // IMPORTANT: Use correct entity ID based on source type:
  // - scout_snapshot → finding:xxx (created by ingestFinding)
  // - user_drop/other → memory:xxx
  const memoryEntities = new Map<number, { entityId: string; title: string; memoryRow: MemoryRow }>();
  for (const memory of memories) {
    // Scout snapshots use finding:xxx, others use memory:xxx
    const isScoutSnapshot = memory.source_type === 'scout_snapshot';
    const memEntityId = isScoutSnapshot ? `finding:${memory.id}` : `memory:${memory.id}`;
    memoryEntities.set(memory.id, {
      entityId: memEntityId,
      title: memory.title || 'Untitled Memory',
      memoryRow: memory,
    });
  }

  // Count semantic relations
  let totalSemanticRelations = 0;
  for (const rels of semanticRelationsMap.values()) {
    totalSemanticRelations += rels.length;
  }

  log(`\n[Extract] Unique entities: ${uniqueEntities.size}`);
  log(`[Extract] Semantic relations: ${totalSemanticRelations}`);
  log(`[Extract] Source memories: ${memoryEntities.size}`);

  if (options.dryRun) {
    log('\n[Extract] DRY RUN - Not saving to database');
    log('\n--- Entities ---');
    for (const [id, item] of uniqueEntities) {
      const rels = semanticRelationsMap.get(id) || [];
      log(`   ${item.entity.type}: ${item.entity.title} (${id})`);
      for (const rel of rels) {
        log(`      └─ [${rel.relation}] → ${rel.target}`);
      }
      result.entities.push({
        id,
        title: item.entity.title,
        type: item.entity.type,
        fromMemory: item.memoryId,
      });
    }
    log('\n--- Semantic Relations ---');
    for (const [sourceId, rels] of semanticRelationsMap) {
      for (const rel of rels) {
        log(`   ${sourceId} -[${rel.relation}]-> ${rel.target}`);
      }
    }
    result.entitiesCreated = uniqueEntities.size;
    return result;
  }

  // Create batch record
  db.query(`
    INSERT INTO extraction_batches (id, strategy_version, prompt_hash, source_type, description, entity_count, status)
    VALUES (?, ?, ?, 'memory', ?, ?, 'active')
  `).run(batchId, strategyVersion, promptHash, options.description || null, uniqueEntities.size);

  // Pipeline version for tracking which prompt/model was used
  const pipelineVersion = getExtractionVersion();

  // Prepared statements (with pipeline_version for lazy migration support)
  // memo_id is the unified field replacing source_memo_id and source_memory_id
  const insertEntity = db.query(`
    INSERT OR IGNORE INTO entities (id, title, subtitle, body, tag, memo_id, extraction_batch_id, is_auto_extracted, pipeline_version, is_stale)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0)
  `);

  const upsertEntity = db.query(`
    INSERT INTO entities (id, title, subtitle, body, tag, memo_id, extraction_batch_id, is_auto_extracted, pipeline_version, is_stale)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0)
    ON CONFLICT(id) DO UPDATE SET
      title = COALESCE(excluded.title, title),
      subtitle = COALESCE(excluded.subtitle, subtitle),
      body = COALESCE(excluded.body, body),
      tag = COALESCE(excluded.tag, tag),
      pipeline_version = excluded.pipeline_version,
      is_stale = 0
  `);

  // Schema V2: is_header and is_source are layout hints, colorOverride for explicit overrides
  // PREPARED STATEMENTS REMOVED: Replaced by BlockFactory usage

  const isIdempotent = options.idempotent ?? false;
  let relationsAdded = 0;

  // Transaction for atomicity
  const insertAll = db.transaction(() => {
    // 1. Insert memory/source entities first (they are referenced by other entities)
    // NOTE: Skip scout_snapshot memories - their finding:xxx entity was already created by ingestFinding
    for (const [memId, memEntity] of memoryEntities) {
      const mem = memEntity.memoryRow;
      
      // Skip scout_snapshot - finding:xxx already exists with proper AI-generated summary
      if (mem.source_type === 'scout_snapshot') {
        log(`   [Skip Source] ${memEntity.entityId} (scout_snapshot - finding already exists)`);
        continue;
      }
      
      const entityStmt = isIdempotent ? upsertEntity : insertEntity;
      
      // Generate a clean summary for entity.body (Grid card display)
      // Full content is accessed via source_memo_id → memories table
      const bodySummary = generateBodySummary(mem, 300);
      
      entityStmt.run(
        memEntity.entityId,
        memEntity.title,
        `Source: ${mem.source_type}`,
        bodySummary,  // Clean summary instead of full HTML
        'SOURCE',
        memId,
        batchId,
        pipelineVersion  // Track which pipeline created this entity
      );
    }

    // 2. Insert/Update extracted entities
    for (const [entityId, item] of uniqueEntities) {
      const { entity, memoryId } = item;

      // Check if entity already exists
      const existing = db.query('SELECT id FROM entities WHERE id = ?').get(entityId);

      if (existing && !isIdempotent) {
        log(`   [Skip] ${entityId} (already exists)`);
        result.entitiesSkipped++;
        continue;
      }

      // Determine tag based on type
      const tag = entity.tag || entity.type.toUpperCase();

      const entityStmt = isIdempotent ? upsertEntity : insertEntity;
      entityStmt.run(
        entityId,
        entity.title,
        entity.subtitle || null,
        entity.body || null,
        tag,
        memoryId,
        batchId,
        pipelineVersion  // Track which pipeline created this entity
      );

      if (existing) {
        log(`   [Update] ${entityId}: ${entity.title}`);
      } else {
        log(`   [Entity] ${entityId}: ${entity.title}`);
      }
      result.entitiesCreated++;
      result.entities.push({
        id: entityId,
        title: entity.title,
        type: entity.type,
        fromMemory: memoryId,
      });
    }

    // 3. Create/Update page_blocks for each entity (Perspective Pages)
    // In idempotent mode, also process existing entities to add missing relations
    let pageBlocksCreated = 0;

    const entitiesToProcess = isIdempotent
      ? [...uniqueEntities.keys()]  // All entities in idempotent mode
      : result.entities.map(e => e.id);  // Only new entities otherwise

    for (const entityId of entitiesToProcess) {
      const item = uniqueEntities.get(entityId);
      if (!item) continue;

      // Helper function to add block if not exists
      // Schema V2: isHeader/isSource are layout hints, colorOverride for explicit color
      // Uses BlockFactory (SSOT)

      const addBlockIfMissing = (pageId: string, blockId: string, opts: BlockOptions = {}): boolean => {
        return BlockFactory.addBlockIfMissing(pageId, blockId, opts);
      };

      // Block 0: Entity itself as header (no target - it's the page itself)
      // Color is derived from entityId prefix (SSOT)
      if (addBlockIfMissing(entityId, entityId, { isHeader: true })) {
        pageBlocksCreated++;
      }

      // Block 1: Source memory (target = memory entity page)
      // Color is derived from memEntity.entityId prefix (memory → CONTEXT)
      const memEntity = memoryEntities.get(item.memoryId);
      if (memEntity) {
        if (addBlockIfMissing(entityId, memEntity.entityId, { isSource: true, target: memEntity.entityId })) {
          pageBlocksCreated++;
        }
      }

      // Blocks 2+: Related entities from semantic relations
      // v2.0: Use semantic relation types instead of generic relatedTo
      const semanticRels = semanticRelationsMap.get(entityId) || [];
      for (const rel of semanticRels) {
        // Only add if the related entity exists in our extraction OR in database
        const relEntityInExtraction = uniqueEntities.get(rel.target);
        const relEntityInDb = db.query('SELECT id FROM entities WHERE id = ?').get(rel.target);

        if (relEntityInExtraction || relEntityInDb) {
          // Add page_block for display
          if (addBlockIfMissing(entityId, rel.target, { target: rel.target })) {
            pageBlocksCreated++;
          }
          
          // v2.0: Insert semantic relation into relations table
          const relInserted = db.query(`
            INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
            VALUES (?, ?, ?, 0.9, datetime('now'))
          `).run(entityId, rel.target, rel.relation);
          
          if (relInserted.changes > 0) {
            relationsAdded++;
            log(`   [+Relation] ${entityId} -[${rel.relation}]-> ${rel.target}`);
          }
        }
      }
    }

    log(`\n   [PageBlocks] Created ${pageBlocksCreated} entries${isIdempotent ? ` (${relationsAdded} new relations)` : ''}`);

    // 4. Link Finding entities to extracted entities
    // When memory comes from scout_snapshot, there's a corresponding finding:X entity
    // that should display the extracted entities on its page
    let findingBlocksCreated = 0;
    let findingRelationsCreated = 0;
    
    for (const memory of memories) {
      if (memory.source_type !== 'scout_snapshot') {
        log(`   [Finding] Skipping memory:${memory.id} (source_type=${memory.source_type})`);
        continue;
      }

      const findingId = `finding:${memory.id}`;

      // Check if finding entity exists
      const findingExists = db.query('SELECT id FROM entities WHERE id = ?').get(findingId);
      if (!findingExists) {
        log(`   [Finding] ⚠️ ${findingId} entity not found, skipping`);
        continue;
      }

      // Create header block for finding page
      if (BlockFactory.addBlockIfMissing(findingId, findingId, { isHeader: true })) {
        findingBlocksCreated++;
      }

      // Find all entities that were extracted from this memory
      // Note: memory.id is number, item.memoryId is also number (set in line 276)
      const extractedFromThisMemory = [...uniqueEntities.entries()]
        .filter(([_, item]) => item.memoryId === memory.id)
        .map(([entityId, _]) => entityId);

      log(`   [Finding] ${findingId}: found ${extractedFromThisMemory.length} entities from memory:${memory.id}`);
      if (extractedFromThisMemory.length === 0) {
        log(`   [Finding] ⚠️ No entities extracted from this memory. uniqueEntities has ${uniqueEntities.size} total.`);
      }

      // Add extracted entities as blocks AND relations on finding page
      for (const entityId of extractedFromThisMemory) {
        // 4a. Create page_block: finding shows entity
        if (BlockFactory.addBlockIfMissing(findingId, entityId, { target: entityId })) {
          findingBlocksCreated++;
        }

        // 4b. Create relation: finding → entity (contains)
        // This enables Scout/search to traverse the graph
        const relInserted = db.query(`
          INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
          VALUES (?, ?, 'contains', 0.8, datetime('now'))
        `).run(findingId, entityId);
        if (relInserted.changes > 0) {
          findingRelationsCreated++;
        }

        // 4c. Create relation: entity → finding (containedIn) for bidirectional traversal
        const revRelInserted = db.query(`
          INSERT OR IGNORE INTO relations (source, target, type, weight, created_at)
          VALUES (?, ?, 'containedIn', 0.8, datetime('now'))
        `).run(entityId, findingId);
        if (revRelInserted.changes > 0) {
          findingRelationsCreated++;
        }

        // 4d. Add finding to entity's page (shows source context)
        BlockFactory.addBlockIfMissing(entityId, findingId, { target: findingId, isSource: true });
      }

      // 4e. Mark finding as extraction completed
      db.query(`
        UPDATE entities SET extraction_status = 'completed' WHERE id = ?
      `).run(findingId);

      log(`   [Finding] ${findingId} linked to ${extractedFromThisMemory.length} extracted entities`);
    }

    if (findingBlocksCreated > 0 || findingRelationsCreated > 0) {
      log(`\n   [FindingBlocks] Created ${findingBlocksCreated} page_blocks, ${findingRelationsCreated} relations`);
    }
  });

  // Execute transaction
  insertAll();

  // Update batch with actual count
  db.query(`
    UPDATE extraction_batches SET entity_count = ? WHERE id = ?
  `).run(result.entitiesCreated, batchId);

  log(`\n[Extract] Complete!`);
  log(`   Batch ID: ${batchId.substring(0, 8)}`);
  log(`   Entities: ${result.entitiesCreated} created, ${result.entitiesSkipped} skipped`);
  log(`   Memory entities: ${memoryEntities.size}`);

  // =============================================================================
  // POST-EXTRACTION: Enqueue Scout Tasks for Scoutable Entities
  // Since CLI runs in separate process, we directly enqueue to shared SQLite queue
  // The server's Scout Worker will pick up and process these tasks
  // Uses SCOUTABLE_TYPES from prism-contract SSOT
  // =============================================================================
  const scoutableEntities = result.entities.filter(e => (SCOUTABLE_TYPES as readonly string[]).includes(e.type));
  
  if (scoutableEntities.length > 0) {
    try {
      const { initQueueClient, enqueueScout, isQueueInitialized } = await import('./lib/queue/index.js');
      
      // Initialize queue if not ready (CLI context)
      if (!isQueueInitialized()) {
        const queueDbPath = process.env.QUEUE_DB_PATH || 
          (process.env.DB_PATH?.replace('prism.db', 'prism-queue.db')) ||
          './prism-queue.db';
        initQueueClient(queueDbPath);
      }
      
      let scoutQueued = 0;
      for (const entityInfo of scoutableEntities) {
        await enqueueScout({
          entityId: entityInfo.id,
          entityTitle: entityInfo.title,
          trigger: 'schedule',  // Treated as scheduled task for queue processing
          gravity: 1.0,
        });
        scoutQueued++;
      }
      
      log(`   [Queue] Enqueued ${scoutQueued} entities for Scout (server will process)`);
    } catch (queueError) {
      logWarn(`   [Queue] Failed to enqueue scout tasks: ${queueError}`);
      // Non-fatal: entities are created, Scout can be triggered manually later
    }
  }

  // Post-processing: Link siblings (milestones of same project, etc.)
  if (result.entitiesCreated > 0 || isIdempotent) {
    const siblingLinks = linkProjectSiblings(db);
    if (siblingLinks > 0) {
      log(`   [Post] Linked ${siblingLinks} sibling entities`);
    }
  }

  return result;
}

// =============================================================================
// POST-PROCESSING: SIBLING LINKING
// =============================================================================

/**
 * Link entities that share a common parent (e.g., milestones of same project).
 * Rule: If A relates to P and B relates to P, then A and B are siblings.
 */
function linkProjectSiblings(db: ReturnType<typeof getDB>): number {
  // Find milestones grouped by project
  const projectMilestones = db.query(`
    SELECT DISTINCT pb.page_id as entity_id, pb.block_id as project_id
    FROM page_blocks pb
    WHERE pb.page_id LIKE 'milestone:%'
      AND pb.block_id LIKE 'project:%'
  `).all() as { entity_id: string; project_id: string }[];

  // Group by project
  const projectToEntities = new Map<string, string[]>();
  for (const row of projectMilestones) {
    if (!projectToEntities.has(row.project_id)) {
      projectToEntities.set(row.project_id, []);
    }
    projectToEntities.get(row.project_id)!.push(row.entity_id);
  }

  // Prepared statements
  const checkPageBlock = db.query(`SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ?`);
  const getMaxPosition = db.query(`SELECT COALESCE(MAX(position), 0) as max_pos FROM page_blocks WHERE page_id = ?`);
  const insertPageBlock = db.query(`
    INSERT INTO page_blocks (page_id, block_id, position, target, is_header, is_source, color_override)
    VALUES (?, ?, ?, ?, 0, 0, NULL)
  `);

  let linksAdded = 0;

  // For each project, link its entities to each other
  for (const [, entities] of projectToEntities) {
    if (entities.length < 2) continue;

    for (let i = 0; i < entities.length; i++) {
      for (let j = 0; j < entities.length; j++) {
        if (i === j) continue;

        const source = entities[i];
        const target = entities[j];

        // Add page_block if not exists
        if (!checkPageBlock.get(source, target)) {
          const maxPos = (getMaxPosition.get(source) as { max_pos: number }).max_pos;
          insertPageBlock.run(source, target, maxPos + 1, target);
          linksAdded++;
        }
      }
    }
  }

  return linksAdded;
}

// =============================================================================
// CLI SUPPORT
// =============================================================================

/**
 * Run extraction from CLI
 */
export async function runExtraction(args: string[]) {
  const dryRun = args.includes('--dry-run');
  const strategy = args.find(a => a.startsWith('--strategy='))?.split('=')[1] || 'v1-balanced';
  const description = args.find(a => a.startsWith('--desc='))?.split('=')[1];

  // Parse --memory-ids parameter (comma-separated list of memory IDs)
  const memoryIdsArg = args.find(a => a.startsWith('--memory-ids='))?.split('=')[1];
  let memoryIds = memoryIdsArg 
    ? memoryIdsArg.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id))
    : undefined;

  // Mode flags
  const processAll = args.includes('--all');
  const idempotent = args.includes('--idempotent') || args.includes('-i');
  const retryPending = args.includes('--retry-pending') || args.includes('--retry');

  // If --retry-pending, find all pending/failed findings and extract their memories
  if (retryPending) {
    const db = getDB();
    const pendingFindings = db.query(`
      SELECT id, memo_id FROM entities 
      WHERE extraction_status IN ('pending', 'failed')
      AND memo_id IS NOT NULL
    `).all() as Array<{ id: string; memo_id: number }>;

    if (pendingFindings.length === 0) {
      log('[Extract] No pending/failed extractions found. All caught up! ✓');
      return { batchId: '', entitiesCreated: 0, entitiesSkipped: 0, memoriesProcessed: 0, entities: [] };
    }

    log(`[Extract] Retry mode: found ${pendingFindings.length} pending/failed findings`);
    memoryIds = pendingFindings.map(f => f.memo_id);
  }

  // If specific memory IDs provided, don't use newOnly filtering
  // In idempotent mode, always process all to find missing relations
  const newOnly = memoryIds?.length ? false : (idempotent ? false : !processAll);

  if (idempotent) {
    log('[Extract] Idempotent mode: will update existing entities and add missing relations');
  }
  if (memoryIds?.length && !retryPending) {
    log(`[Extract] Processing specific memory IDs: ${memoryIds.join(', ')}`);
  }

  const result = await extractEntities({
    strategyVersion: strategy,
    description,
    memoryIds,
    dryRun,
    newOnly,
    idempotent,
  });

  if (!dryRun) {
    log(`\nTo rollback: npm run extraction rollback ${result.batchId.substring(0, 8)}`);
  }

  return result;
}

