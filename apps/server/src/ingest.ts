/**
 * Ingest Module
 * 
 * Email ingestion functions for the Prism system.
 * 
 * NOTE: For markdown/text content ingestion, use:
 *   import { graphWriter } from './lib/graph-link/index.js';
 *   await graphWriter.ingestFinding(sourceUrl, title, content, []);
 * 
 * This provides the full pipeline: LLM summary, entity extraction, atoms.
 */

import { getDB } from './db.js';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';

// =============================================================================
// EMAIL TYPES & FUNCTIONS
// =============================================================================

export interface ParsedEmail {
  id: string;
  subject: string;
  from: string;
  to: string;
  bodyText: string;
  sentAt: Date;
  hasAttachments: boolean;
}

export function ingestEmail(email: ParsedEmail) {
  const db = getDB();

  const insert = db.query(`
    INSERT OR IGNORE INTO emails (id, subject, from_addr, to_addr, body_text, sent_at)
    VALUES ($id, $subject, $from, $to, $bodyText, $sentAt)
  `);

  insert.run({
    $id: email.id,
    $subject: email.subject,
    $from: email.from,
    $to: email.to,
    $bodyText: email.bodyText,
    $sentAt: email.sentAt.toISOString()
  });
}

export async function parseAndIngestEml(filePath: string) {
  const emlContent = fs.readFileSync(filePath, 'utf-8');
  const parsed = await simpleParser(emlContent);

  // Extract metadata
  const from = parsed.from?.value[0]?.address || '';

  let to = '';
  if (parsed.to) {
    const toValue = (parsed.to as any).value || parsed.to;
    if (Array.isArray(toValue)) {
      to = toValue.map((v: any) => v.address || v).join(',');
    } else if (toValue) {
      to = toValue.address || toValue || '';
    }
  }

  const bodyText = parsed.text || parsed.html || ''; // Prefer text for FTS
  const providerId = parsed.messageId || path.basename(filePath, '.eml');

  const email: ParsedEmail = {
    id: providerId,
    subject: parsed.subject || '',
    from,
    to,
    bodyText,
    sentAt: parsed.date || new Date(),
    hasAttachments: (parsed.attachments?.length || 0) > 0
  };

  ingestEmail(email);
  return email;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get count of memories in database
 * NOTE: After v50 migration, memories are split into user_memories and scout_findings
 */
export function getMemoriesCount(): number {
  const db = getDB();
  // Count from both user_memories and scout_findings
  const userMemories = db.query('SELECT COUNT(*) as count FROM user_memories').get() as { count: number };
  const scoutFindings = db.query('SELECT COUNT(*) as count FROM scout_findings').get() as { count: number };
  return userMemories.count + scoutFindings.count;
}
