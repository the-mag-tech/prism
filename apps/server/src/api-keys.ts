/**
 * API Keys Management
 * 
 * Centralized module for managing API keys with priority:
 * 1. Proxy Token (MAGPIE_PROXY_TOKEN) - for proxied requests
 * 2. Keychain keys (passed via env from Tauri) - KEYCHAIN_OPENAI_API_KEY
 * 3. Direct environment variables - OPENAI_API_KEY
 * 
 * Usage:
 *   import { getOpenAIClient, getApiKey } from './api-keys';
 *   const openai = getOpenAIClient(); // Returns configured OpenAI client
 *   const key = getApiKey('OPENAI'); // Returns the key string
 */

import OpenAI from 'openai';

// =============================================================================
// KEY SOURCES (Priority Order)
// =============================================================================

export type KeyName = 'OPENAI' | 'TAVILY';

interface KeyConfig {
  envKey: string;           // Direct env var name
  keychainEnvKey: string;   // Keychain-passed env var name
  required: boolean;
}

const KEY_CONFIGS: Record<KeyName, KeyConfig> = {
  OPENAI: {
    envKey: 'OPENAI_API_KEY',
    keychainEnvKey: 'KEYCHAIN_OPENAI_API_KEY',
    required: true,
  },
  TAVILY: {
    envKey: 'TAVILY_API_KEY',
    keychainEnvKey: 'KEYCHAIN_TAVILY_API_KEY',
    required: false,
  },
};

// =============================================================================
// PROXY MODE
// =============================================================================

/**
 * Check if running in proxy mode (using Magpie API proxy)
 */
export function isProxyMode(): boolean {
  return Boolean(process.env.MAGPIE_PROXY_TOKEN && process.env.MAGPIE_PROXY_URL);
}

/**
 * Get proxy configuration
 */
export function getProxyConfig(): { token: string; url: string } | null {
  const token = process.env.MAGPIE_PROXY_TOKEN;
  const url = process.env.MAGPIE_PROXY_URL;
  
  if (token && url) {
    return { token, url };
  }
  return null;
}

// =============================================================================
// KEY RETRIEVAL
// =============================================================================

/**
 * Get an API key with priority:
 * 1. Keychain-passed env var (KEYCHAIN_*)
 * 2. Direct env var
 */
export function getApiKey(keyName: KeyName): string | null {
  const config = KEY_CONFIGS[keyName];
  
  // Priority 1: Keychain-passed key
  const keychainKey = process.env[config.keychainEnvKey];
  if (keychainKey) {
    console.log(`[API Keys] Using ${keyName} from Keychain`);
    return keychainKey;
  }
  
  // Priority 2: Direct env var
  const envKey = process.env[config.envKey];
  if (envKey) {
    console.log(`[API Keys] Using ${keyName} from environment`);
    return envKey;
  }
  
  if (config.required) {
    console.warn(`[API Keys] ${keyName} not found (checked: ${config.keychainEnvKey}, ${config.envKey})`);
    console.warn(`[API Keys] Running in DEGRADED MODE. Some features will be disabled.`);
  }
  
  return null;
}

/**
 * Ensure a key is available, or throw an error
 * Used by endpoints that strictly require the key
 */
export function ensureApiKey(keyName: KeyName): string {
  const key = getApiKey(keyName);
  if (!key) {
    throw new Error(`Missing required API key: ${keyName}. Please configure it in settings.`);
  }
  return key;
}

/**
 * Check if a key is available
 */
export function hasApiKey(keyName: KeyName): boolean {
  return getApiKey(keyName) !== null;
}

// =============================================================================
// OPENAI CLIENT
// =============================================================================

let openaiClient: OpenAI | null = null;

/**
 * Get a configured OpenAI client
 * 
 * In proxy mode, requests should go through the proxy instead.
 * This function returns a client for direct API calls.
 */
export function getOpenAIClient(): OpenAI | null {
  if (openaiClient) {
    return openaiClient;
  }
  
  const apiKey = getApiKey('OPENAI');
  if (!apiKey) {
    return null;
  }
  
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

/**
 * Create a new OpenAI client with optional configuration
 */
export function createOpenAIClient(options?: { baseURL?: string }): OpenAI | null {
  const apiKey = getApiKey('OPENAI');
  if (!apiKey) {
    return null;
  }
  
  return new OpenAI({
    apiKey,
    ...options,
  });
}

// =============================================================================
// PROXY CLIENT (for embedding requests through Magpie proxy)
// =============================================================================

interface ProxyEmbeddingRequest {
  model: string;
  input: string | string[];
}

interface ProxyEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage: {
    total_tokens: number;
  };
}

/**
 * Make an embedding request through the proxy
 */
export async function proxyEmbedding(request: ProxyEmbeddingRequest): Promise<ProxyEmbeddingResponse> {
  const config = getProxyConfig();
  if (!config) {
    throw new Error('Proxy not configured');
  }
  
  const response = await fetch(`${config.url}/proxy/openai/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    const error = await response.json() as { error?: string };
    throw new Error(error.error || 'Proxy request failed');
  }
  
  return response.json() as Promise<ProxyEmbeddingResponse>;
}

// =============================================================================
// STARTUP VALIDATION
// =============================================================================

/**
 * Log API key status at startup
 */
export function logApiKeyStatus(): void {
  console.log('[API Keys] Status:');
  
  if (isProxyMode()) {
    console.log('  - Mode: PROXY');
    console.log(`  - Proxy URL: ${process.env.MAGPIE_PROXY_URL}`);
    return;
  }
  
  console.log('  - Mode: DIRECT');
  
  for (const [name, config] of Object.entries(KEY_CONFIGS)) {
    const hasKey = hasApiKey(name as KeyName);
    const status = hasKey ? '✓' : (config.required ? '✗ MISSING' : '○ optional');
    console.log(`  - ${name}: ${status}`);
  }
}





