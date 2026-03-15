/**
 * Migration V32: Add text_content to memories table
 * 
 * Separates HTML content from plain text:
 * - content: Original HTML (for future detailed view if needed)
 * - text_content: Plain text (for search, summaries, and card display)
 * 
 * Also backfills existing scout_snapshot records by stripping HTML tags.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

/**
 * Simple HTML tag stripper (no external dependencies)
 * Handles common cases from Readability output
 */
function stripHtmlTags(html: string): string {
  if (!html) return '';
  
  return html
    // Remove script/style content entirely
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Replace block elements with newlines
    .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Normalize whitespace
    .replace(/\n\s*\n/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export const migration: Migration = {
  version: 32,
  name: 'memories_text_content',
  description: 'Add text_content column to memories for plain text storage',

  up: (db: Database) => {
    // 1. Add text_content column
    console.error('  Adding text_content column to memories...');
    db.exec(`ALTER TABLE memories ADD COLUMN text_content TEXT`);

    // 2. Backfill existing scout_snapshot records
    console.error('  Backfilling text_content for existing scout_snapshot records...');
    
    const scoutMemories = db.query(`
      SELECT id, content FROM memories 
      WHERE source_type = 'scout_snapshot' AND content IS NOT NULL
    `).all() as Array<{ id: number; content: string }>;

    console.error(`  Found ${scoutMemories.length} scout_snapshot records to process`);

    const updateStmt = db.query(`
      UPDATE memories SET text_content = ? WHERE id = ?
    `);

    let processed = 0;
    for (const mem of scoutMemories) {
      const textContent = stripHtmlTags(mem.content);
      updateStmt.run(textContent, mem.id);
      processed++;
      
      if (processed % 100 === 0) {
        console.error(`  Processed ${processed}/${scoutMemories.length}`);
      }
    }

    // 3. Regenerate entity body summaries for findings (use text_content)
    console.error('  Updating finding entity bodies with clean text...');
    
    // For now, just truncate text_content as body fallback
    // The AI summary will be regenerated on next ingest
    db.exec(`
      UPDATE entities 
      SET body = SUBSTR(
        (SELECT text_content FROM memories WHERE memories.id = CAST(SUBSTR(entities.id, 9) AS INTEGER)),
        1, 500
      )
      WHERE id LIKE 'finding:%' 
        AND EXISTS (
          SELECT 1 FROM memories 
          WHERE memories.id = CAST(SUBSTR(entities.id, 9) AS INTEGER)
            AND memories.text_content IS NOT NULL
        )
    `);

    console.error(`  ✓ Migration complete: processed ${processed} records`);
  }
};

