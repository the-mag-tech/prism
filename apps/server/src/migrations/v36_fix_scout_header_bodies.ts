/**
 * Migration V36: Fix Scout Header Bodies
 * 
 * Fixes entities that have Scout metadata header followed by HTML.
 * These were missed by v35 which only checked for content starting with '<'.
 * 
 * Pattern: "[Scout Entity: X]\n[Type: Y]\n[Source: Z]\n\n<DIV..."
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

/**
 * Strip HTML tags and clean up content for summary
 */
function stripHtmlAndClean(content: string): string {
  if (!content) return '';
  
  let text = content;
  
  // Remove Scout metadata header
  text = text.replace(/^\[Scout Entity:[\s\S]*?\]\s*\[Type:[\s\S]*?\]\s*\[Source:[\s\S]*?\]\s*/m, '');
  
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

export const migration: Migration = {
  version: 36,
  name: 'fix_scout_header_bodies',
  description: 'Fix entities with Scout metadata header followed by HTML in body',
  
  up: (db: Database) => {
    console.error('  Scanning for entities with Scout header + HTML pattern...');
    
    // Find entities with Scout metadata header followed by HTML
    const entities = db.query(`
      SELECT e.id, e.body, e.source_memo_id
      FROM entities e
      WHERE (e.id LIKE 'memory:%' OR e.id LIKE 'finding:%')
        AND e.body LIKE '%[Scout Entity:%'
        AND (e.body LIKE '%<DIV%' OR e.body LIKE '%<div%' OR e.body LIKE '%<p>%' OR e.body LIKE '%<P>%')
    `).all() as Array<{
      id: string;
      body: string;
      source_memo_id: number | null;
    }>;
    
    console.error(`  Found ${entities.length} entities with Scout header + HTML`);
    
    if (entities.length === 0) {
      return;
    }
    
    let updated = 0;
    
    const updateStmt = db.query(`
      UPDATE entities SET body = ?, updated_at = datetime('now') WHERE id = ?
    `);
    
    for (const entity of entities) {
      // Try to get text_content from linked memory first
      let summary: string;
      
      if (entity.source_memo_id) {
        const memo = db.query(`
          SELECT text_content, content FROM memories WHERE id = ?
        `).get(entity.source_memo_id) as { text_content: string | null; content: string } | null;
        
        if (memo?.text_content) {
          summary = generateSummary(memo.text_content);
        } else if (memo?.content) {
          summary = generateSummary(memo.content);
        } else {
          summary = generateSummary(entity.body);
        }
      } else {
        summary = generateSummary(entity.body);
      }
      
      updateStmt.run(summary, entity.id);
      updated++;
      
      if (updated % 50 === 0) {
        console.error(`  Progress: ${updated}/${entities.length} entities updated`);
      }
    }
    
    console.error(`  Migration complete: ${updated} entities fixed`);
  },
};

