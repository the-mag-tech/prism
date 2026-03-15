/**
 * Migration V28: Backfill Memory Entities
 * 
 * Creates entities records for existing memories that were ingested
 * via deprecated functions (ingestMarkdownFile, ingestMemoryContent).
 * 
 * This ensures Drop-to-Collect works for all memory blocks.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v28_backfill_memory_entities: Migration = {
  version: 28,
  name: 'backfill_memory_entities',
  description: 'Create entities records for existing memories without corresponding entities',
  
  up: (db: Database) => {
    console.error('  Scanning for memories without entities...');
    
    // Find all memories that don't have a corresponding entity
    const orphanMemories = db.query(`
      SELECT m.id, m.title, m.source_path, m.source_type, m.content, m.created_at
      FROM memories m
      LEFT JOIN entities e ON e.id = 'memory:' || m.id
      WHERE e.id IS NULL
        AND m.source_type != 'scout_snapshot'
        AND m.discarded = 0
    `).all() as Array<{
      id: number;
      title: string;
      source_path: string;
      source_type: string;
      content: string;
      created_at: string;
    }>;

    console.error(`  Found ${orphanMemories.length} memories without entities`);

    if (orphanMemories.length === 0) {
      return;
    }

    // Create entities for each orphan memory
    const insertEntity = db.query(`
      INSERT INTO entities (id, title, subtitle, body, tag, base_gravity, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'MEMORY', 0.5, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    let created = 0;
    for (const mem of orphanMemories) {
      const entityId = `memory:${mem.id}`;
      const subtitle = 'Dropped Item';
      const body = mem.content?.substring(0, 500) || mem.title;
      const now = new Date().toISOString();

      try {
        insertEntity.run(
          entityId,
          mem.title || 'Untitled Memory',
          subtitle,
          body,
          mem.created_at || now,
          now
        );
        created++;
      } catch (e) {
        console.warn(`  Failed to create entity for memory:${mem.id}:`, e);
      }
    }

    console.error(`  Created ${created} new entities for existing memories`);
  },
};

