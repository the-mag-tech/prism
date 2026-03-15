/**
 * @module sandbox
 * @description The "Shadow Chessboard" API for Dynamic Presenter
 * 
 * ============================================================================
 * MARKOV-INSPIRED PREDICTION ENGINE
 * ============================================================================
 * 
 * This module implements the "Minesweeper" pattern:
 * 1. User mentions topic A
 * 2. System predicts next likely topics (B, C, D)
 * 3. System pre-fetches data for B, C, D as "shadow cards"
 * 4. When user mentions B, the shadow card is revealed instantly
 * 
 * Keywords: SANDBOX, SHADOW_CHESSBOARD, PREDICT, PREFETCH
 */

import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { search } from './lib/search-service.js';
import { getOpenAI } from './lib/ai-clients.js';
import { log, logError } from './lib/logger.js';
import { toFile } from 'openai';

// ============================================
// Types
// ============================================

interface PredictRequest {
  topic: string;
}

interface PredictResponse {
  predictions: string[];
  reasoning?: string;
}

interface PrefetchRequest {
  topics: string[];
  context?: string;
}

interface ShadowCard {
  trigger: string;
  headline: string;
  value: string;
  type: 'stat' | 'trend' | 'quote' | 'entity';
  color?: string;
  source?: string;
  prefetchedAt: number;
}

interface PrefetchResponse {
  cards: ShadowCard[];
}

// ============================================
// Color Palette for Card Types
// ============================================

const CARD_COLORS: Record<string, string> = {
  stat: '#3B82F6',     // Blue
  trend: '#10B981',    // Green
  quote: '#8B5CF6',    // Purple
  entity: '#F59E0B',   // Amber
  default: '#6366F1',  // Indigo
};

// ============================================
// Prediction Engine (Markov-style)
// ============================================

/**
 * Given a topic, predict the next 3-5 most likely related topics.
 * Uses LLM to simulate Markov transition probabilities.
 */
async function predictNextTopics(topic: string): Promise<string[]> {
  const openai = getOpenAI();
  
  if (!openai) {
    // Fallback: simple related terms
    log('[Sandbox] OpenAI not available, using fallback predictions');
    return getFallbackPredictions(topic);
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Fast model for predictions
      messages: [
        {
          role: 'system',
          content: `You are a "Narrative Predictor". Given a topic someone is discussing, predict the 3-5 most likely NEXT topics they will mention.

Think like a Markov chain: what topics have high transition probability from the current one?

Rules:
- Return single words or short phrases (max 2 words)
- Focus on concrete, searchable entities (companies, people, metrics)
- Consider natural conversation flow

Output JSON array only, no explanation:
["Topic1", "Topic2", "Topic3"]`
        },
        {
          role: 'user',
          content: `Current topic: "${topic}"`
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 100,
      temperature: 0.7,
    });
    
    const content = response.choices[0].message.content || '[]';
    // Handle both array and object formats
    const parsed = JSON.parse(content);
    const predictions = Array.isArray(parsed) ? parsed : (parsed.predictions || parsed.topics || []);
    
    log(`[Sandbox] Predicted: ${predictions.join(', ')}`);
    return predictions.slice(0, 5);
    
  } catch (error) {
    logError('[Sandbox] Prediction failed:', error);
    return getFallbackPredictions(topic);
  }
}

/**
 * Fallback predictions when LLM is not available
 */
function getFallbackPredictions(topic: string): string[] {
  const fallbackMap: Record<string, string[]> = {
    'tesla': ['elon musk', 'ev market', 'stock price', 'cybertruck', 'revenue'],
    'ai': ['openai', 'claude', 'machine learning', 'neural network', 'gpt'],
    'revenue': ['growth', 'profit', 'margin', 'quarter', 'forecast'],
    'startup': ['funding', 'investor', 'valuation', 'founder', 'product'],
    'competitor': ['market share', 'pricing', 'features', 'strategy', 'advantage'],
  };
  
  const lowerTopic = topic.toLowerCase();
  return fallbackMap[lowerTopic] || ['market', 'growth', 'trend', 'data', 'analysis'];
}

// ============================================
// Prefetch Engine (Shadow Card Generator)
// ============================================

/**
 * Given topics, search and generate shadow cards for each.
 * Uses Tavily's includeAnswer for fast AI-generated summaries.
 */
async function prefetchCards(topics: string[], context?: string): Promise<ShadowCard[]> {
  const cards: ShadowCard[] = [];
  
  // Parallel search for all topics
  const searchPromises = topics.map(async (topic) => {
    try {
      const query = context 
        ? `${topic} ${context} latest data statistics` 
        : `${topic} latest data statistics`;
        
      const result = await search(query, {
        maxResults: 2,
        searchDepth: 'basic',
        includeAnswer: true, // Key: get AI summary directly
      });
      
      if (result.success && result.results.length > 0) {
        const topResult = result.results[0];
        
        // Extract a "value" from the content (look for numbers/stats)
        const value = extractStatValue(topResult.content) || 'See details';
        const type = inferCardType(topResult.content);
        
        return {
          trigger: topic.toLowerCase().split(' ')[0], // First word as trigger
          headline: truncate(topResult.title, 60),
          value,
          type,
          color: CARD_COLORS[type] || CARD_COLORS.default,
          source: new URL(topResult.url).hostname,
          prefetchedAt: Date.now(),
        } as ShadowCard;
      }
    } catch (error) {
      logError(`[Sandbox] Prefetch failed for "${topic}":`, error);
    }
    return null;
  });
  
  const results = await Promise.all(searchPromises);
  
  for (const card of results) {
    if (card) cards.push(card);
  }
  
  log(`[Sandbox] Prefetched ${cards.length}/${topics.length} shadow cards`);
  return cards;
}

/**
 * Extract a stat/number from content for the card "value" field
 */
function extractStatValue(content: string): string | null {
  // Look for patterns like "$X billion", "X%", "X million", etc.
  const patterns = [
    /\$[\d,.]+\s*(billion|million|B|M|K)/i,
    /[\d,.]+%/,
    /[\d,.]+\s*(billion|million|users|customers)/i,
    /\d{4}\s*(revenue|profit|growth)/i,
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[0];
  }
  
  return null;
}

/**
 * Infer card type from content
 */
function inferCardType(content: string): 'stat' | 'trend' | 'quote' | 'entity' {
  const lowerContent = content.toLowerCase();
  
  if (/\$|revenue|profit|billion|million|%/.test(lowerContent)) return 'stat';
  if (/growth|increase|decrease|trend|forecast/.test(lowerContent)) return 'trend';
  if (/said|according to|quoted|statement/.test(lowerContent)) return 'quote';
  return 'entity';
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

// ============================================
// Whisper Transcription
// ============================================

/**
 * Transcribe audio using OpenAI Whisper API
 */
async function transcribeAudio(audioBuffer: Buffer, language?: string): Promise<{ text: string; detectedLanguage?: string }> {
  const openai = getOpenAI();
  
  if (!openai) {
    throw new Error('OpenAI client not available');
  }
  
  try {
    const file = await toFile(audioBuffer, 'audio.webm', { type: 'audio/webm' });
    
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: language || undefined, // Let Whisper auto-detect if not specified
      response_format: 'json',
    });
    
    log(`[Sandbox] Whisper transcribed: "${transcription.text}"`);
    
    return {
      text: transcription.text,
    };
    
  } catch (error) {
    logError('[Sandbox] Whisper transcription failed:', error);
    throw error;
  }
}

// ============================================
// Fastify Routes
// ============================================

export function registerSandboxRoutes(app: FastifyInstance) {
  // Register multipart plugin for file uploads
  app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max
    },
  });

  /**
   * POST /api/sandbox/transcribe
   * Transcribe audio using OpenAI Whisper API
   */
  app.post('/api/sandbox/transcribe', async (request, reply) => {
    // #region agent log
    const fs = await import('fs');
    const logPath = '/Users/j.z/code/fulmail/.cursor/debug.log';
    const logEntry = (msg: string, data: any) => {
      try {
        fs.appendFileSync(logPath, JSON.stringify({location:'sandbox.ts:transcribe',message:msg,data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H,I,J'})+'\n');
      } catch(e) {}
    };
    // #endregion

    logEntry('Route hit', { method: 'POST', url: '/api/sandbox/transcribe' });

    try {
      const data = await request.file();
      
      logEntry('After request.file()', { hasData: !!data, dataFields: data ? Object.keys(data) : null });

      if (!data) {
        logEntry('No file provided', {});
        return reply.status(400).send({ error: 'No audio file provided' });
      }
      
      const buffer = await data.toBuffer();
      
      logEntry('Got buffer', { bufferSize: buffer.length });

      // Get optional language hint from form field
      const language = (request.body as any)?.language as string | undefined;
      
      log(`[Sandbox] Transcribe request: ${buffer.length} bytes, language: ${language || 'auto'}`);
      
      logEntry('Calling transcribeAudio', { bufferSize: buffer.length, language });
      
      const result = await transcribeAudio(buffer, language);
      
      logEntry('Transcription result', { text: result.text?.slice(0, 50), textLen: result.text?.length });
      
      return reply.send(result);
      
    } catch (error) {
      logEntry('Error caught', { errorMsg: (error as Error).message, stack: (error as Error).stack?.slice(0, 200) });
      logError('[Sandbox] Transcribe endpoint error:', error);
      return reply.status(500).send({ 
        error: 'Transcription failed',
        message: (error as Error).message 
      });
    }
  });
  
  /**
   * POST /api/sandbox/predict
   * Given a topic, return predicted next topics (Markov-style)
   */
  app.post<{ Body: PredictRequest }>('/api/sandbox/predict', async (request, reply) => {
    const { topic } = request.body;
    
    if (!topic) {
      return reply.status(400).send({ error: 'Missing topic' });
    }
    
    log(`[Sandbox] Predict request: "${topic}"`);
    
    const predictions = await predictNextTopics(topic);
    
    return reply.send({ predictions } as PredictResponse);
  });
  
  /**
   * POST /api/sandbox/prefetch
   * Given topics, return shadow cards with pre-searched data
   */
  app.post<{ Body: PrefetchRequest }>('/api/sandbox/prefetch', async (request, reply) => {
    const { topics, context } = request.body;
    
    if (!topics || topics.length === 0) {
      return reply.status(400).send({ error: 'Missing topics' });
    }
    
    log(`[Sandbox] Prefetch request: ${topics.join(', ')}`);
    
    const cards = await prefetchCards(topics, context);
    
    return reply.send({ cards } as PrefetchResponse);
  });
  
  log('[Sandbox] Routes registered: /api/sandbox/transcribe, /api/sandbox/predict, /api/sandbox/prefetch');
}
