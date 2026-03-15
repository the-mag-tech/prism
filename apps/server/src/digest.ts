/**
 * Magpie Digest Engine
 * 
 * Extracts "shiny bits" from URLs and text using AI.
 * Migrated from magpie/web/lib/utils.ts
 */

import { convert } from 'html-to-text';

// =============================================================================
// TYPES
// =============================================================================

export type FeedType = 'link' | 'text' | 'file';

export interface DigestResult {
  title: string;
  summary: string;
  tags: string[];
  color: 'red' | 'blue' | 'yellow' | 'white';
}

// =============================================================================
// OPENAI CLIENT (lazy-loaded)
// =============================================================================

import { getOpenAI } from './lib/ai-clients.js';

// =============================================================================
// DIGEST FUNCTION
// =============================================================================

/**
 * The "Digestion" Engine
 * Extracts shiny bits from URL or Text using AI
 */
export async function digestContent(content: string, type: FeedType): Promise<DigestResult> {
  let textToAnalyze = content;
  
  // 1. If Link, fetch and convert to text
  if (type === 'link') {
    try {
      console.log(`🌐 Magpie Fetching: ${content}`);
      const res = await fetch(content, {
        headers: { 'User-Agent': 'Magpie/1.0 (DigestBot)' }
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const html = await res.text();
      textToAnalyze = convert(html, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' }
        ]
      }).slice(0, 5000); // Limit context window
    } catch (e) {
      console.warn('⚠️ Fetch failed, falling back to URL analysis only', e);
    }
  }

  // 2. AI Analysis
  const openai = getOpenAI();
  if (!openai) {
    throw new Error('OpenAI not available - configure API key or proxy');
  }
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are Magpie, an AI that collects "Shiny Bits" from information.
          Analyze the input text (which might be a website scrape or a user note).
          
          Output a JSON object with:
          - title: A catchy, short headline (max 5 words).
          - summary: A concise, punchy insight (max 20 words).
          - tags: [Array of 1-2 tags, e.g. "INSIGHT", "URGENT", "NEWS"].
          - color: One of ["red", "blue", "yellow", "white"]. 
            - Red = Action/Urgent
            - Blue = New Information/Insight
            - Yellow = Warmth/People/Gift
            - White = General/Quote`
        },
        { role: "user", content: textToAnalyze }
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');
    
    return {
      title: result.title || 'New Drop',
      summary: result.summary || 'Magpie found something shiny.',
      tags: result.tags || ['NEW'],
      color: result.color || 'white'
    };

  } catch (error) {
    console.error('❌ AI Digestion failed:', error);
    // Fallback
    return {
      title: type === 'link' ? 'Link Saved' : 'Note Saved',
      summary: content.substring(0, 100),
      color: 'white',
      tags: ['SAVED']
    };
  }
}

