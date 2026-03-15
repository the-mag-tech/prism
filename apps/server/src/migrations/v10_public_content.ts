/**
 * Migration V10: Public Content System
 * 
 * Adds public_content table and seeds test data for Scout Anything Phase 1.
 * 
 * Public content is external/public information that can be "discovered"
 * while exploring your personal graph, then collected into your graph.
 * 
 * This batch is designed to be plug-in/plug-out for testing.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v10_public_content: Migration = {
  version: 10,
  name: 'public_content',
  description: 'Add public_content table and seed test data',
  
  up: (db: Database) => {
    console.error('  Creating public_content table...');
    
    // Create public_content table
    db.exec(`
      CREATE TABLE IF NOT EXISTS public_content (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,        -- 'rss' | 'api' | 'manual' | 'test'
        source_name TEXT,                 -- 'TechCrunch', 'Reuters', etc.
        source_url TEXT,
        title TEXT NOT NULL,
        body TEXT,
        topics TEXT,                      -- JSON: ['ai', 'startup']
        related_entities TEXT,            -- JSON: ['person:simon', 'company:ponder']
        published_at TEXT,
        fetched_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT,
        is_active INTEGER DEFAULT 1       -- For easy plug in/out
      );
      
      CREATE INDEX IF NOT EXISTS idx_public_content_topics ON public_content(topics);
      CREATE INDEX IF NOT EXISTS idx_public_content_active ON public_content(is_active);
    `);
    
    console.error('  ✓ public_content table created');
    
    // Seed test data (hardcoded batch for testing)
    console.error('  Seeding test public content...');
    
    const testContent = [
      {
        id: 'public:news-anthropic-funding',
        source_type: 'test',
        source_name: 'TechCrunch',
        source_url: 'https://techcrunch.com/example',
        title: 'Anthropic Raises $2B Series C',
        body: 'AI safety startup Anthropic has raised a $2B Series C round, valuing the company at $15B.',
        topics: JSON.stringify(['ai', 'startup', 'funding']),
        related_entities: JSON.stringify(['topic:ai-agents']),
        published_at: new Date().toISOString(),
      },
      {
        id: 'public:news-ponder-launch',
        source_type: 'test',
        source_name: 'VentureBeat',
        source_url: 'https://venturebeat.com/example',
        title: 'Ponder Launches AI Agent Platform',
        body: 'Stealth startup Ponder exits stealth with an innovative AI agent development platform.',
        topics: JSON.stringify(['ai', 'startup', 'product-launch']),
        related_entities: JSON.stringify(['project:ponder', 'person:simon']),
        published_at: new Date().toISOString(),
      },
      {
        id: 'public:news-ai-regulation',
        source_type: 'test',
        source_name: 'Reuters',
        source_url: 'https://reuters.com/example',
        title: 'EU Finalizes AI Act Regulations',
        body: 'The European Union has finalized its comprehensive AI regulatory framework, set to take effect in 2025.',
        topics: JSON.stringify(['ai', 'regulation', 'policy']),
        related_entities: JSON.stringify(['topic:ai-agents']),
        published_at: new Date().toISOString(),
      },
      {
        id: 'public:article-first-principles',
        source_type: 'test',
        source_name: 'Wikipedia',
        source_url: 'https://en.wikipedia.org/wiki/First_principle',
        title: 'First Principles Thinking',
        body: 'First principles thinking is a problem-solving approach that breaks down complex problems into basic elements.',
        topics: JSON.stringify(['thinking', 'methodology', 'problem-solving']),
        related_entities: JSON.stringify([]),
        published_at: null,
      },
    ];
    
    const insertStmt = db.query(`
      INSERT INTO public_content (id, source_type, source_name, source_url, title, body, topics, related_entities, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const content of testContent) {
      insertStmt.run(
        content.id,
        content.source_type,
        content.source_name,
        content.source_url,
        content.title,
        content.body,
        content.topics,
        content.related_entities,
        content.published_at,
      );
    }
    
    console.error(`  ✓ Seeded ${testContent.length} test public content items`);
  },
};

