#!/usr/bin/env npx ts-node
/**
 * Seed Database Script
 * 
 * Migrates mock data from mock/pages.ts into SQLite database.
 * Run with: npx ts-node src/cli/seed-db.ts
 */

import { initDB, getDB } from '../db.js';
import { upsertEntity, addPageBlock, addRelation, clearPageData } from '../pages.js';
import type { PrismPage, PrismBlock, PrismRelation } from '@prism/contract';

// =============================================================================
// SEED DATA (copied from mock/pages.ts)
// =============================================================================

const SEED_PAGES: Record<string, PrismPage> = {};

// =============================================================================
// SEED FUNCTIONS
// =============================================================================

/**
 * Collect all unique entities from pages
 * Also adds page IDs as entities (they need to exist for foreign key)
 */
function collectEntities(): Map<string, PrismBlock> {
  const entities = new Map<string, PrismBlock>();

  for (const page of Object.values(SEED_PAGES)) {
    // Add page itself as an entity if not already present
    // (page_id needs to exist in entities for foreign key constraint)
    if (!entities.has(page.id)) {
      // Use the first block as the page entity data (usually the header)
      const headerBlock = page.blocks[0];
      if (headerBlock) {
        entities.set(page.id, {
          id: page.id,
          title: headerBlock.title,
          subtitle: headerBlock.subtitle,
          body: headerBlock.body,
          tag: headerBlock.tag,
          action: headerBlock.action,
        });
      } else {
        // Fallback if no blocks
        entities.set(page.id, {
          id: page.id,
          title: page.id,
        });
      }
    }

    // Add all blocks as entities
    for (const block of page.blocks) {
      // Use the first occurrence of each entity (usually has the most complete data)
      if (!entities.has(block.id)) {
        entities.set(block.id, block);
      }
    }
  }

  return entities;
}

/**
 * Collect all relations from pages
 */
function collectRelations(): PrismRelation[] {
  const relations: PrismRelation[] = [];
  const seen = new Set<string>();

  for (const page of Object.values(SEED_PAGES)) {
    if (page.relations) {
      for (const rel of page.relations) {
        const key = `${rel.source}|${rel.target}|${rel.type}`;
        if (!seen.has(key)) {
          seen.add(key);
          relations.push(rel);
        }
      }
    }
  }

  return relations;
}

/**
 * Seed the database
 */
async function seed() {
  console.log('🌱 Starting database seed...\n');

  // Initialize database
  initDB();
  console.log('✓ Database initialized\n');

  // Clear existing page data
  console.log('🗑️  Clearing existing page data...');
  clearPageData();
  console.log('✓ Cleared\n');

  // Collect and insert entities
  const entities = collectEntities();
  console.log(`📦 Inserting ${entities.size} entities...`);

  for (const [id, entity] of entities) {
    upsertEntity({
      id: entity.id,
      title: entity.title,
      subtitle: entity.subtitle,
      body: entity.body,
      tag: entity.tag,
      action: entity.action,
    });
  }
  console.log('✓ Entities inserted\n');

  // Note: Ghost Graph has been removed from prism-server
  // Ghost blocks are now generated client-side in Magpie
  // See: apps/magpie/src/lib/ghost-blocks.ts

  // Insert page blocks
  console.log(`📄 Inserting page blocks for ${Object.keys(SEED_PAGES).length} pages...`);

  for (const page of Object.values(SEED_PAGES)) {
    for (let i = 0; i < page.blocks.length; i++) {
      const block = page.blocks[i];
      addPageBlock(
        page.id,
        block.id,
        i,
        block.target,
        // Use tag from page context if different from entity tag
        block.tag
      );
    }
  }
  console.log('✓ Page blocks inserted\n');

  // Insert relations
  const relations = collectRelations();
  console.log(`🔗 Inserting ${relations.length} relations...`);

  for (const rel of relations) {
    addRelation({
      source: rel.source,
      target: rel.target,
      type: rel.type,
      weight: rel.weight,
      evidence: rel.evidence,
    });
  }
  console.log('✓ Relations inserted\n');

  // Verify
  const db = getDB();
  const entityCount = db.query('SELECT COUNT(*) as count FROM entities').get() as { count: number };
  const pageBlockCount = db.query('SELECT COUNT(*) as count FROM page_blocks').get() as { count: number };
  const relationCount = db.query('SELECT COUNT(*) as count FROM relations').get() as { count: number };

  console.log('📊 Database statistics:');
  console.log(`   Entities:    ${entityCount.count}`);
  console.log(`   Page blocks: ${pageBlockCount.count}`);
  console.log(`   Relations:   ${relationCount.count}`);

  console.log('\n✅ Seed complete!');
}

// Run
seed().catch(console.error);

