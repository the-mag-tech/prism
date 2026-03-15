/**
 * Migration V35: Backfill Memory Entity Body Summaries
 * 
 * Updates existing memory:* and finding:* entities that have raw HTML
 * in their body field to use clean text summaries instead.
 * 
 * Problem: Old entities stored full HTML content in body, causing:
 * - Poor Grid card display (showing raw HTML tags)
 * - Inconsistent with new entity creation (which generates summaries)
 * 
 * Solution: Generate clean summaries from memories.text_content or strip HTML
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

/**
 * Strip HTML tags and clean up content for summary
 */
function stripHtmlAndClean(content: string): string {
  if (!content) return '';
  
  let text = content;
  
  // Remove script and style blocks
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  
  // Remove Scout metadata header if present
  text = text.replace(/^\[Scout Entity:.*?\]\s*\[Type:.*?\]\s*\[Source:.*?\]\s*/s, '');
  
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Generate a summary from content (max 300 chars)
 */
function generateSummary(content: string, maxLength: number = 300): string {
  const cleaned = stripHtmlAndClean(content);
  
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  
  // Try to break at sentence boundary
  const truncated = cleaned.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('. ');
  
  if (lastPeriod > maxLength * 0.6) {
    return truncated.substring(0, lastPeriod + 1);
  }
  
  return truncated.trimEnd() + '...';
}

/**
 * Check if content looks like HTML or contains Scout metadata + HTML
 */
function isHtmlContent(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  
  // Direct HTML
  if (trimmed.startsWith('<') && /<[a-z][\s\S]*>/i.test(trimmed.substring(0, 200))) {
    return true;
  }
  
  // Scout metadata header followed by HTML (e.g., "[Scout Entity:...]\n<DIV...")
  if (trimmed.startsWith('[Scout Entity:') && /<[a-z][\s\S]*>/i.test(trimmed)) {
    return true;
  }
  
  // Contains significant HTML tags anywhere
  const htmlTagCount = (trimmed.match(/<[a-z][^>]*>/gi) || []).length;
  return htmlTagCount > 3;
}

export const migration: Migration = {
  version: 35,
  name: 'backfill_memory_body_summary',
  description: 'Replace raw HTML in memory/finding entity bodies with clean summaries',
  
  up: (db: Database) => {
    console.error('  Scanning for entities with HTML in body...');
    
    // Find memory:* and finding:* entities that might have HTML in body
    const entities = db.query(`
      SELECT e.id, e.body, e.source_memo_id
      FROM entities e
      WHERE (e.id LIKE 'memory:%' OR e.id LIKE 'finding:%')
        AND e.body IS NOT NULL
        AND LENGTH(e.body) > 50
    `).all() as Array<{
      id: string;
      body: string;
      source_memo_id: number | null;
    }>;
    
    console.error(`  Found ${entities.length} memory/finding entities to check`);
    
    let updated = 0;
    let skipped = 0;
    
    const updateStmt = db.query(`
      UPDATE entities SET body = ?, updated_at = datetime('now') WHERE id = ?
    `);
    
    for (const entity of entities) {
      // Check if body looks like HTML
      if (!isHtmlContent(entity.body)) {
        skipped++;
        continue;
      }
      
      // Try to get text_content from linked memory
      let summary: string;
      
      if (entity.source_memo_id) {
        const memo = db.query(`
          SELECT text_content, content FROM memories WHERE id = ?
        `).get(entity.source_memo_id) as { text_content: string | null; content: string } | null;
        
        if (memo?.text_content) {
          // Use clean text_content
          summary = generateSummary(memo.text_content);
        } else if (memo?.content) {
          // Strip HTML from content
          summary = generateSummary(memo.content);
        } else {
          // No memo found, strip HTML from body
          summary = generateSummary(entity.body);
        }
      } else {
        // No source_memo_id, strip HTML from body
        summary = generateSummary(entity.body);
      }
      
      // Update entity with clean summary
      updateStmt.run(summary, entity.id);
      updated++;
      
      if (updated % 50 === 0) {
        console.error(`  Progress: ${updated} entities updated`);
      }
    }
    
    console.error(`  Migration complete: ${updated} updated, ${skipped} already clean`);
  },
};

