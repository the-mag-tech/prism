/**
 * Migration V40: Extraction Status
 * 
 * @ref worker/checklist
 * @doc docs/WORKER-CHECKLIST.md#4-管线完整性
 * 
 * Adds extraction_status field to track pipeline completion.
 * This prevents "orphan findings" - findings that were ingested but never extracted.
 * 
 * Status values:
 * - 'pending': Needs extraction (default for new findings)
 * - 'completed': Extraction completed successfully
 * - 'failed': Extraction failed, needs retry
 * - 'skipped': Intentionally skipped (e.g., empty content)
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 40,
  name: 'extraction_status',
  description: 'Add extraction_status field for pipeline tracking',

  up: (db: Database) => {
    console.error('  Adding extraction_status column...');
    
    // Add column with default 'completed' for existing entities
    // (assume existing findings have been extracted)
    try {
      db.run(`
        ALTER TABLE entities 
        ADD COLUMN extraction_status TEXT DEFAULT 'completed'
      `);
    } catch (e) {
      console.error('  extraction_status column may already exist, continuing...');
    }

    // Create index for querying pending/failed extractions
    console.error('  Creating index on extraction_status...');
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_entities_extraction_status 
      ON entities(extraction_status) 
      WHERE extraction_status IN ('pending', 'failed')
    `);

    // Mark existing findings without extracted entities as 'pending'
    console.error('  Checking for orphan findings...');
    const orphanFindings = db.query(`
      SELECT f.id, f.memo_id
      FROM entities f
      WHERE f.id LIKE 'finding:%'
      AND NOT EXISTS (
        SELECT 1 FROM relations r 
        WHERE r.source = f.id AND r.type = 'contains'
      )
    `).all() as Array<{ id: string; memo_id: number }>;

    if (orphanFindings.length > 0) {
      console.error(`  Found ${orphanFindings.length} orphan findings, marking as 'pending'...`);
      const updateStmt = db.query(`
        UPDATE entities SET extraction_status = 'pending' WHERE id = ?
      `);
      for (const finding of orphanFindings) {
        updateStmt.run(finding.id);
        console.error(`    Marked ${finding.id} as pending`);
      }
    }

    console.error('  ✓ Migration complete');
  },
};





