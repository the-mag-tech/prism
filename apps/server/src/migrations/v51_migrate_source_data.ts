/**
 * Migration v51: Migrate Source Data
 * 
 * Migrates data from monolithic `memories` table to specialized source tables:
 * - user_drop, markdown, mcp → user_memories
 * - scout_snapshot → scout_findings
 * 
 * After migration:
 * - memories table renamed to memories_backup (preserved for rollback)
 * - FTS triggers removed (will be rebuilt for new tables later)
 * 
 * @since 2026-01-08
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 51,
  name: 'migrate_source_data',
  description: 'Migrate memories data to user_memories and scout_findings',

  up: (db: Database) => {
    // ==========================================================================
    // STEP 1: Migrate user content (user_drop, markdown, mcp) → user_memories
    // ==========================================================================
    const userResult = db.query(`
      INSERT INTO user_memories (
        id,
        title,
        content,
        text_content,
        source_type,
        source_url,
        extraction_status,
        archived,
        ingested_at,
        entity_id
      )
      SELECT 
        id,
        title,
        content,
        text_content,
        source_type,
        source_path,
        'completed',  -- Assume existing memories are extracted
        discarded,
        COALESCE(ingested_at, created_at, datetime('now')),
        'memory:' || id
      FROM memories
      WHERE source_type IN ('user_drop', 'markdown', 'mcp', 'email', 'pdf')
    `).run();

    console.error(`  ✓ Migrated ${userResult.changes} user memories`);

    // ==========================================================================
    // STEP 2: Migrate scout content (scout_snapshot) → scout_findings
    // ==========================================================================
    const scoutResult = db.query(`
      INSERT INTO scout_findings (
        id,
        title,
        content,
        text_content,
        url,
        triggered_by,
        extraction_status,
        archived,
        fetched_at,
        entity_id
      )
      SELECT 
        id,
        title,
        content,
        text_content,
        source_path,
        NULL,  -- triggered_by not available in old schema
        'completed',
        discarded,
        COALESCE(ingested_at, created_at, datetime('now')),
        'finding:' || id
      FROM memories
      WHERE source_type = 'scout_snapshot'
    `).run();

    console.error(`  ✓ Migrated ${scoutResult.changes} scout findings`);

    // ==========================================================================
    // STEP 3: Drop FTS triggers on memories (they reference old table)
    // ==========================================================================
    db.exec(`
      DROP TRIGGER IF EXISTS memories_fts_insert;
      DROP TRIGGER IF EXISTS memories_fts_update;
      DROP TRIGGER IF EXISTS memories_fts_delete;
    `);

    console.error('  ✓ Dropped old FTS triggers');

    // ==========================================================================
    // STEP 4: Rename memories to memories_backup
    // ==========================================================================
    db.exec(`
      ALTER TABLE memories RENAME TO memories_backup;
    `);

    console.error('  ✓ Renamed memories → memories_backup');

    // ==========================================================================
    // STEP 5: Create FTS for new tables (simplified, content-only)
    // ==========================================================================
    db.exec(`
      -- FTS for user_memories
      CREATE VIRTUAL TABLE IF NOT EXISTS user_memories_fts USING fts5(
        title,
        content,
        text_content,
        content='user_memories',
        content_rowid='id'
      );

      -- Populate FTS
      INSERT INTO user_memories_fts(rowid, title, content, text_content)
      SELECT id, title, content, text_content FROM user_memories;

      -- FTS triggers for user_memories
      CREATE TRIGGER user_memories_fts_insert AFTER INSERT ON user_memories BEGIN
        INSERT INTO user_memories_fts(rowid, title, content, text_content)
        VALUES (NEW.id, NEW.title, NEW.content, NEW.text_content);
      END;

      CREATE TRIGGER user_memories_fts_update AFTER UPDATE ON user_memories BEGIN
        INSERT INTO user_memories_fts(user_memories_fts, rowid, title, content, text_content)
        VALUES ('delete', OLD.id, OLD.title, OLD.content, OLD.text_content);
        INSERT INTO user_memories_fts(rowid, title, content, text_content)
        VALUES (NEW.id, NEW.title, NEW.content, NEW.text_content);
      END;

      CREATE TRIGGER user_memories_fts_delete AFTER DELETE ON user_memories BEGIN
        INSERT INTO user_memories_fts(user_memories_fts, rowid, title, content, text_content)
        VALUES ('delete', OLD.id, OLD.title, OLD.content, OLD.text_content);
      END;
    `);

    console.error('  ✓ Created FTS for user_memories');

    db.exec(`
      -- FTS for scout_findings
      CREATE VIRTUAL TABLE IF NOT EXISTS scout_findings_fts USING fts5(
        title,
        content,
        text_content,
        content='scout_findings',
        content_rowid='id'
      );

      -- Populate FTS
      INSERT INTO scout_findings_fts(rowid, title, content, text_content)
      SELECT id, title, content, text_content FROM scout_findings;

      -- FTS triggers for scout_findings
      CREATE TRIGGER scout_findings_fts_insert AFTER INSERT ON scout_findings BEGIN
        INSERT INTO scout_findings_fts(rowid, title, content, text_content)
        VALUES (NEW.id, NEW.title, NEW.content, NEW.text_content);
      END;

      CREATE TRIGGER scout_findings_fts_update AFTER UPDATE ON scout_findings BEGIN
        INSERT INTO scout_findings_fts(scout_findings_fts, rowid, title, content, text_content)
        VALUES ('delete', OLD.id, OLD.title, OLD.content, OLD.text_content);
        INSERT INTO scout_findings_fts(rowid, title, content, text_content)
        VALUES (NEW.id, NEW.title, NEW.content, NEW.text_content);
      END;

      CREATE TRIGGER scout_findings_fts_delete AFTER DELETE ON scout_findings BEGIN
        INSERT INTO scout_findings_fts(scout_findings_fts, rowid, title, content, text_content)
        VALUES ('delete', OLD.id, OLD.title, OLD.content, OLD.text_content);
      END;
    `);

    console.error('  ✓ Created FTS for scout_findings');

    // ==========================================================================
    // STEP 6: Verify migration
    // Note: querying renamed table within the same transaction may fail on
    // some Bun/SQLite versions, so verification is best-effort.
    // ==========================================================================
    const userCount = db.query('SELECT COUNT(*) as count FROM user_memories').get() as { count: number };
    const scoutCount = db.query('SELECT COUNT(*) as count FROM scout_findings').get() as { count: number };

    let backupCount = { count: 0 };
    try {
      backupCount = db.query('SELECT COUNT(*) as count FROM memories_backup').get() as { count: number };
    } catch {
      // ALTER TABLE RENAME may not be visible within the same transaction
      // in some SQLite bindings. The rename itself succeeded (no throw above),
      // so this is a read-visibility issue, not a data-integrity issue.
      console.error('  ⚠️  memories_backup not queryable within transaction (expected on some Bun versions)');
    }

    console.error(`  ✓ Verification: user_memories=${userCount.count}, scout_findings=${scoutCount.count}, backup=${backupCount.count}`);

    if (backupCount.count > 0 && userCount.count + scoutCount.count !== backupCount.count) {
      console.error(`  ⚠️  Warning: Count mismatch! Some records may have unrecognized source_type`);
      
      try {
        const orphans = db.query(`
          SELECT source_type, COUNT(*) as count 
          FROM memories_backup 
          WHERE source_type NOT IN ('user_drop', 'markdown', 'mcp', 'email', 'pdf', 'scout_snapshot')
          GROUP BY source_type
        `).all() as Array<{ source_type: string; count: number }>;
        
        if (orphans.length > 0) {
          console.error(`  ⚠️  Unrecognized source_types:`, orphans);
        }
      } catch {
        // Same visibility issue as above
      }
    }
  },
};
