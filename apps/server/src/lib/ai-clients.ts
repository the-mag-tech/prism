/**
 * @module ai-clients
 * @description Unified AI Client Manager - Single Source of Truth for all AI service clients
 * 
 * ============================================================================
 * AGENTIC MODULE REGISTRY - AI SERVICE CLIENTS
 * ============================================================================
 * 
 * Keywords for grep/search:
 *   - OPENAI_CLIENT, TAVILY_CLIENT, AI_SERVICE, LLM_CLIENT
 *   - getOpenAI, getTavily, requireOpenAI
 *   - lazy-load, graceful-degradation, runtime-injection, proxy-mode
 * 
 * This module provides lazy-loaded, safely-initialized AI clients.
 * All API clients are created on-demand to avoid crashes when keys are not set.
 * 
 * WHY THIS EXISTS:
 *   - Prevents app crash when API keys are missing (graceful degradation)
 *   - Centralizes all AI client management in one place (SSOT)
 *   - Enables easy mocking for tests
 *   - Supports runtime key injection (e.g., from Tauri/Frontend)
 *   - Supports Proxy Mode for users without their own API keys
 * 
 * KEY SOURCES (Priority Order):
 *   1. Runtime-injected keys (from frontend via configureKeys())
 *   2. Environment variables (OPENAI_API_KEY, TAVILY_API_KEY)
 *   3. Proxy Mode (MAGPIE_PROXY_TOKEN + MAGPIE_PROXY_URL)
 * 
 * USAGE:
 * ```typescript
 * import { getOpenAI, getTavily, isOpenAIAvailable, configureKeys } from './lib/ai-clients.js';
 * 
 * // Pattern 1: Optional AI (graceful degradation)
 * const openai = getOpenAI();
 * if (openai) {
 *   const response = await openai.chat.completions.create({...});
 * } else {
 *   // Fallback behavior when AI not available
 * }
 * 
 * // Pattern 2: Required AI (throw if missing)
 * const openai = requireOpenAI(); // throws if not configured
 * 
 * // Pattern 3: Check before expensive operations
 * if (isOpenAIAvailable()) {
 *   // Proceed with AI-dependent logic
 * }
 * 
 * // Pattern 4: Runtime key injection (from frontend)
 * configureKeys({ openaiKey: 'sk-...', tavilyKey: 'tvly-...' });
 * ```
 * 
 * ENVIRONMENT VARIABLES:
 *   - OPENAI_API_KEY: Required for OpenAI features (chat, embeddings)
 *   - TAVILY_API_KEY: Required for web search features
 *   - MAGPIE_PROXY_TOKEN: JWT for proxy mode
 *   - MAGPIE_PROXY_URL: Proxy server URL (e.g., https://api.fulmail.net)
 * 
 * @see docs/AI-CLIENTS.md for architecture details
 */

import OpenAI from 'openai';
import { tavily } from '@tavily/core';
import { log, logError } from './logger.js';
import { configureQverisKey, isQverisAvailable } from './qveris-client.js';

// TavilyClient type is not exported, so we define our own compatible interface
type TavilyClient = ReturnType<typeof tavily>;

// =============================================================================
// RUNTIME KEY STORAGE (injected from frontend)
// =============================================================================

interface RuntimeKeys {
    openaiKey?: string;
    tavilyKey?: string;
    qverisKey?: string;  // Qveris API key
    proxyToken?: string;
    proxyUrl?: string;
}

let _runtimeKeys: RuntimeKeys = {};

// Event listeners for key configuration changes
type KeysConfiguredCallback = () => void;
const _keysConfiguredCallbacks: KeysConfiguredCallback[] = [];

/**
 * Configure AI keys at runtime (called from frontend via API)
 * 
 * This allows the frontend to inject keys from localStorage/keychain
 * after the server has started.
 * 
 * @ref ai-clients/runtime-keys
 * @doc docs/AI-CLIENTS.md#priority-1-runtime-keys
 * @since 2025-12
 * 
 * @param keys - Object containing API keys and/or proxy credentials
 * @returns Summary of configured services
 * 
 * @example
 * configureKeys({
 *   openaiKey: 'sk-...',
 *   tavilyKey: 'tvly-...',
 * });
 * 
 * // Or for proxy mode:
 * configureKeys({
 *   proxyToken: 'eyJ...',
 *   proxyUrl: 'https://api.fulmail.net',
 * });
 */
export function configureKeys(keys: RuntimeKeys): { openai: boolean; tavily: boolean; qveris: boolean; proxy: boolean } {
    log('[AI-Clients] Configuring runtime keys...');
    
    // Store new keys
    _runtimeKeys = { ..._runtimeKeys, ...keys };
    
    // Reset clients to force re-initialization with new keys
    _openaiClient = null;
    _openaiChecked = false;
    _tavilyClient = null;
    _tavilyChecked = false;
    
    // Configure Qveris key (unified key management)
    if (keys.qverisKey !== undefined) {
        configureQverisKey(keys.qverisKey);
    }
    
    const result = {
        openai: isOpenAIAvailable(),
        tavily: isTavilyAvailable(),
        qveris: isQverisAvailable(),
        proxy: isProxyMode(),
    };
    
    log('[AI-Clients] Keys configured:', {
        openai: result.openai ? '✓' : '✗',
        tavily: result.tavily ? '✓' : '✗',
        qveris: result.qveris ? '✓' : '✗',
        proxy: result.proxy ? '✓' : '✗',
    });
    
    // Notify listeners
    _keysConfiguredCallbacks.forEach(cb => cb());
    
    return result;
}

/**
 * Register a callback to be called when keys are configured
 * Used by ScoutSystem to start when keys become available
 */
export function onKeysConfigured(callback: KeysConfiguredCallback): void {
    _keysConfiguredCallbacks.push(callback);
}

/**
 * Check if running in proxy mode
 * 
 * This function now supports hot reload: it checks if the shared config
 * file has been updated and reloads it if necessary.
 * 
 * @ref ai-clients/proxy-mode
 * @doc docs/AI-CLIENTS.md#priority-4-proxy-mode
 * @since 2025-12
 */
export function isProxyMode(): boolean {
    // Ensure config is fresh before checking (TTL + mtime check)
    ensureConfigFresh();
    
    const token = _runtimeKeys.proxyToken || process.env.MAGPIE_PROXY_TOKEN;
    const url = _runtimeKeys.proxyUrl || process.env.MAGPIE_PROXY_URL;
    return Boolean(token && url);
}

/**
 * Get proxy configuration
 * 
 * This function now supports hot reload: it checks if the shared config
 * file has been updated and reloads it if necessary (TTL + mtime based).
 * 
 * @ref ai-clients/proxy-mode
 * @doc docs/AI-CLIENTS.md#priority-4-proxy-mode
 * @since 2025-12
 */
export function getProxyConfig(): { token: string; url: string } | null {
    // Ensure config is fresh before reading (TTL + mtime check)
    ensureConfigFresh();
    
    const token = _runtimeKeys.proxyToken || process.env.MAGPIE_PROXY_TOKEN;
    const url = _runtimeKeys.proxyUrl || process.env.MAGPIE_PROXY_URL;
    
    if (token && url) {
        return { token, url };
    }
    return null;
}

// =============================================================================
// OPENAI_CLIENT - Chat Completions & Embeddings
// =============================================================================

let _openaiClient: OpenAI | null = null;
let _openaiChecked = false;

/**
 * Get the OpenAI client (lazy-loaded)
 * 
 * Priority: runtime key > env var > proxy mode
 * 
 * @returns OpenAI client instance, or null if no key available
 * 
 * @example
 * const openai = getOpenAI();
 * if (openai) {
 *   const completion = await openai.chat.completions.create({
 *     model: 'gpt-4o',
 *     messages: [{ role: 'user', content: 'Hello' }]
 *   });
 * }
 * 
 * @tags OPENAI_CLIENT, LLM_CLIENT, AI_SERVICE
 */
export function getOpenAI(): OpenAI | null {
    if (!_openaiChecked) {
        _openaiChecked = true;
        
        // Priority 1: Runtime key (from frontend)
        // Priority 2: Environment variable
        const apiKey = _runtimeKeys.openaiKey || process.env.OPENAI_API_KEY;
        
        if (apiKey) {
            _openaiClient = new OpenAI({ apiKey });
            const source = _runtimeKeys.openaiKey ? 'runtime' : 'env';
            log(`[AI-Clients] ✓ OpenAI client initialized (source: ${source})`);
        } else if (isProxyMode()) {
            // Priority 3: Proxy mode - create client pointing to proxy
            const proxy = getProxyConfig()!;
            _openaiClient = new OpenAI({
                apiKey: proxy.token,  // Use proxy token as "API key"
                baseURL: `${proxy.url}/proxy/openai/v1`,
            });
            log('[AI-Clients] ✓ OpenAI client initialized (source: proxy)');
        } else {
            log('[AI-Clients] ⚠️ OpenAI not available (no key or proxy)');
        }
    }
    return _openaiClient;
}

/**
 * Check if OpenAI is available without initializing the client
 * Use this for conditional UI or to skip AI-dependent code paths
 * 
 * @tags OPENAI_CLIENT, AI_SERVICE
 */
export function isOpenAIAvailable(): boolean {
    return !!(_runtimeKeys.openaiKey || process.env.OPENAI_API_KEY || isProxyMode());
}

/**
 * Get OpenAI client or throw error (for required contexts)
 * Use this when AI is mandatory and failure should be explicit
 * 
 * @throws Error if OPENAI_API_KEY is not configured
 * @tags OPENAI_CLIENT, AI_SERVICE
 */
export function requireOpenAI(): OpenAI {
    const client = getOpenAI();
    if (!client) {
        throw new Error('OpenAI API key is required but not configured');
    }
    return client;
}

// =============================================================================
// TAVILY_CLIENT - Web Search & Research
// =============================================================================

let _tavilyClient: TavilyClient | null = null;
let _tavilyChecked = false;

/**
 * Get the Tavily client for web search (lazy-loaded)
 * 
 * Priority: runtime key > env var > proxy mode
 * 
 * Note: In proxy mode, returns a wrapped client that calls proxy endpoint.
 * 
 * @returns TavilyClient instance, or null if no key available
 * 
 * @example
 * const tavily = getTavily();
 * if (tavily) {
 *   const results = await tavily.search('latest AI news');
 * }
 * 
 * @tags TAVILY_CLIENT, SEARCH_CLIENT, AI_SERVICE
 */
export function getTavily(): TavilyClient | null {
    if (!_tavilyChecked) {
        _tavilyChecked = true;
        
        // Priority 1: Runtime key (from frontend)
        // Priority 2: Environment variable
        const apiKey = _runtimeKeys.tavilyKey || process.env.TAVILY_API_KEY;
        
        if (apiKey) {
            _tavilyClient = tavily({ apiKey });
            const source = _runtimeKeys.tavilyKey ? 'runtime' : 'env';
            log(`[AI-Clients] ✓ Tavily client initialized (source: ${source})`);
        } else if (isProxyMode()) {
            // Priority 3: Proxy mode - create a proxy wrapper
            _tavilyClient = createProxyTavilyClient();
            log('[AI-Clients] ✓ Tavily client initialized (source: proxy)');
        } else {
            log('[AI-Clients] ⚠️ Tavily not available (no key or proxy)');
        }
    }
    return _tavilyClient;
}

/**
 * Create a Tavily-compatible client that routes through the proxy
 * 
 * The proxy server handles the actual Tavily API call using its own key.
 */
function createProxyTavilyClient(): TavilyClient {
    const proxy = getProxyConfig()!;
    
    // Return an object that matches TavilyClient interface
    // The proxy endpoint mirrors Tavily's API
    return {
        search: async (query: string, options?: any) => {
            const response = await fetch(`${proxy.url}/proxy/tavily/search`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${proxy.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, ...options }),
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
                throw new Error(errData.error || `Proxy request failed: ${response.status}`);
            }
            
            return response.json();
        },
        // Tavily also has searchContext, searchQNA - add if needed
        searchContext: async (query: string, options?: any) => {
            const response = await fetch(`${proxy.url}/proxy/tavily/search-context`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${proxy.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, ...options }),
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
                throw new Error(errData.error || `Proxy request failed: ${response.status}`);
            }
            
            return response.json() as Promise<string>;
        },
    } as TavilyClient;
}

/**
 * Check if Tavily is available without initializing
 * 
 * @tags TAVILY_CLIENT, AI_SERVICE
 */
/**
 * @deprecated Use isSearchAvailable() from search-service.ts instead.
 * This function only checks Tavily, not the unified search with Qveris fallback.
 */
export function isTavilyAvailable(): boolean {
    return !!(_runtimeKeys.tavilyKey || process.env.TAVILY_API_KEY || isProxyMode());
}

// =============================================================================
// AI_SERVICE STATUS - Diagnostics & Health Check
// =============================================================================

export interface AIServicesStatus {
    openai: boolean;
    tavily: boolean;
    qveris: boolean;
    proxy: boolean;
    sources: {
        openai: 'runtime' | 'env' | 'proxy' | 'none';
        tavily: 'runtime' | 'env' | 'proxy' | 'none';
        qveris: 'runtime' | 'env' | 'proxy' | 'none';
    };
}

/**
 * Get status of all AI services (without initializing them)
 * Useful for health checks and diagnostics
 * 
 * @tags AI_SERVICE, HEALTH_CHECK
 */
export function getAIServicesStatus(): AIServicesStatus {
    const proxyMode = isProxyMode();
    
    // Determine source for each service
    const openaiSource = _runtimeKeys.openaiKey ? 'runtime' 
        : process.env.OPENAI_API_KEY ? 'env'
        : proxyMode ? 'proxy'
        : 'none';
    
    const tavilySource = _runtimeKeys.tavilyKey ? 'runtime'
        : process.env.TAVILY_API_KEY ? 'env'
        : proxyMode ? 'proxy'
        : 'none';
    
    const qverisSource = _runtimeKeys.qverisKey ? 'runtime'
        : process.env.QVERIS_API_KEY ? 'env'
        : proxyMode ? 'proxy'
        : 'none';
    
    return {
        openai: isOpenAIAvailable(),
        tavily: isTavilyAvailable(),
        qveris: isQverisAvailable(),
        proxy: proxyMode,
        sources: {
            openai: openaiSource,
            tavily: tavilySource,
            qveris: qverisSource,
        },
    };
}

/**
 * Log AI services status on startup
 * Call this during server initialization to show available features
 * 
 * @tags AI_SERVICE, STARTUP
 */
export function logAIServicesStatus(): void {
    const status = getAIServicesStatus();
    log('[AI-Clients] Services status:');
    log(`  OpenAI: ${status.openai ? '✓ Available' : '✗ Not configured'} (${status.sources.openai})`);
    log(`  Tavily: ${status.tavily ? '✓ Available' : '✗ Not configured'} (${status.sources.tavily})`);
    log(`  Qveris: ${status.qveris ? '✓ Available' : '✗ Not configured'} (${status.sources.qveris})`);
    if (status.proxy) {
        log(`  Proxy: ✓ Enabled`);
    }
}

// =============================================================================
// SHARED CONFIG FILE SUPPORT (for MCP binary)
// =============================================================================
// 
// When running as standalone MCP binary (Claude Desktop), we need to load
// API keys from a shared config file since there's no frontend to inject them.
// 
// Config file location: ~/.magpie/prism-config.json
// 
// Format:
// {
//   "proxyToken": "...",
//   "proxyUrl": "https://api-proxy-magpie.up.railway.app",
//   "openaiKey": "sk-...",
//   "tavilyKey": "tvly-..."
// }
// =============================================================================

import { homedir } from 'node:os';
import { join } from 'pathe';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';

const SHARED_CONFIG_DIR = join(homedir(), '.magpie');
const SHARED_CONFIG_PATH = join(SHARED_CONFIG_DIR, 'prism-config.json');

// =============================================================================
// TTL CACHE FOR SHARED CONFIG (Hot Reload Support)
// =============================================================================
// 
// @ref ai-clients/config-hot-reload
// @ref ai-clients/config-cache
// @doc docs/CODE-DOC-SYNC.md#13-config-hot-reload
// @since 2025-12-30
// 
// The shared config is cached with a TTL to avoid reading from disk on every
// request, while still supporting hot reload when the config file is updated.
// 
// Cache invalidation strategy:
//   1. TTL-based: Re-read file after CONFIG_CACHE_TTL_MS (60 seconds)
//   2. mtime-based: Re-read if file modification time changed
// 
// Atomicity guarantee:
//   - If loading new config fails, keep using the old cached config
//   - Never leave the system in an inconsistent state
// =============================================================================

// SSOT: docs/CODE-DOC-SYNC.md#13-config-hot-reload
const CONFIG_CACHE_TTL_MS = 60_000; // 60 seconds

interface ConfigCache {
    config: SharedConfig;
    loadedAt: number;      // Timestamp when config was loaded
    fileMtime: number;     // File modification time when loaded
}

let _configCache: ConfigCache | null = null;

interface SharedConfig {
    proxyToken?: string;
    proxyUrl?: string;
    openaiKey?: string;
    tavilyKey?: string;
    qverisKey?: string;  // Qveris API key
    // Metadata
    updatedAt?: string;
    updatedBy?: 'magpie' | 'manual';
}

/**
 * Check if the config cache needs to be refreshed
 * 
 * Refresh conditions:
 *   1. Cache doesn't exist (first load)
 *   2. TTL expired (older than CONFIG_CACHE_TTL_MS)
 *   3. File mtime changed (config was updated externally)
 */
function isConfigCacheStale(): boolean {
    if (!_configCache) {
        return true;
    }
    
    const now = Date.now();
    const age = now - _configCache.loadedAt;
    
    // Check TTL
    if (age > CONFIG_CACHE_TTL_MS) {
        return true;
    }
    
    // Check file mtime (early detection of changes)
    try {
        if (existsSync(SHARED_CONFIG_PATH)) {
            const stats = statSync(SHARED_CONFIG_PATH);
            const currentMtime = stats.mtimeMs;
            if (currentMtime !== _configCache.fileMtime) {
                return true;
            }
        }
    } catch {
        // If we can't stat the file, don't invalidate cache
    }
    
    return false;
}

/**
 * Ensure the shared config is fresh (reload if stale)
 * 
 * This is called automatically by getProxyConfig() and other functions
 * that depend on the shared config. It implements the TTL + mtime cache
 * invalidation strategy.
 * 
 * Atomicity: If reload fails, the old config is preserved.
 * 
 * @returns true if config is available (fresh or cached)
 */
export function ensureConfigFresh(): boolean {
    if (!isConfigCacheStale()) {
        return _configCache !== null;
    }
    
    // Try to reload - if it fails, keep the old cache (atomicity)
    const reloaded = loadSharedConfigInternal();
    
    // If reload failed but we have a cached config, use it
    if (!reloaded && _configCache) {
        log('[AI-Clients] Config reload failed, using cached config');
        return true;
    }
    
    return reloaded;
}

/**
 * Internal function to load config from file and update cache
 * 
 * @returns true if config was loaded successfully
 */
function loadSharedConfigInternal(): boolean {
    try {
        if (!existsSync(SHARED_CONFIG_PATH)) {
            log('[AI-Clients] No shared config file found at:', SHARED_CONFIG_PATH);
            return false;
        }
        
        // Get file stats for mtime tracking
        const stats = statSync(SHARED_CONFIG_PATH);
        const fileMtime = stats.mtimeMs;
        
        // Read and parse config
        const content = readFileSync(SHARED_CONFIG_PATH, 'utf-8');
        const config: SharedConfig = JSON.parse(content);
        
        // Update cache BEFORE applying (so if apply fails, we still have valid cache)
        const oldCache = _configCache;
        _configCache = {
            config,
            loadedAt: Date.now(),
            fileMtime,
        };
        
        // Check if this is a real change (avoid unnecessary client resets)
        const isRealChange = !oldCache || 
            oldCache.config.proxyToken !== config.proxyToken ||
            oldCache.config.proxyUrl !== config.proxyUrl ||
            oldCache.config.openaiKey !== config.openaiKey ||
            oldCache.config.tavilyKey !== config.tavilyKey ||
            oldCache.config.qverisKey !== config.qverisKey;
        
        if (isRealChange) {
            log('[AI-Clients] Config changed, applying new keys...');
            
            // Apply config via configureKeys
            const result = configureKeys({
                proxyToken: config.proxyToken,
                proxyUrl: config.proxyUrl,
                openaiKey: config.openaiKey,
                tavilyKey: config.tavilyKey,
                qverisKey: config.qverisKey,
            });
            
            log('[AI-Clients] Shared config reloaded:', {
                openai: result.openai ? '✓' : '✗',
                tavily: result.tavily ? '✓' : '✗',
                proxy: result.proxy ? '✓' : '✗',
            });
        }
        
        return true;
    } catch (error) {
        logError('[AI-Clients] Failed to load shared config:', error);
        return false;
    }
}

/**
 * Load keys from shared config file (~/.magpie/prism-config.json)
 * Used by MCP binary when running standalone (Claude Desktop)
 * 
 * @ref ai-clients/shared-config
 * @doc docs/AI-CLIENTS.md#shared-config-file-api
 * @since 2025-12-21
 * 
 * @returns true if config was loaded and applied
 * 
 * @example
 * // In MCP binary startup:
 * if (loadSharedConfig()) {
 *   console.log('Loaded keys from shared config');
 * }
 * 
 * @tags SHARED_CONFIG, MCP_BINARY
 */
export function loadSharedConfig(): boolean {
    return loadSharedConfigInternal();
}

/**
 * Save keys to shared config file (~/.magpie/prism-config.json)
 * Called by Magpie frontend when user saves API keys
 * 
 * @ref ai-clients/shared-config
 * @doc docs/AI-CLIENTS.md#shared-config-file-api
 * @since 2025-12-21
 * 
 * @param config - Keys to save
 * @returns true if saved successfully
 * 
 * @tags SHARED_CONFIG, MCP_BINARY
 */
export function saveSharedConfig(config: Omit<SharedConfig, 'updatedAt' | 'updatedBy'>): boolean {
    try {
        // Ensure directory exists
        if (!existsSync(SHARED_CONFIG_DIR)) {
            mkdirSync(SHARED_CONFIG_DIR, { recursive: true });
        }
        
        const fullConfig: SharedConfig = {
            ...config,
            updatedAt: new Date().toISOString(),
            updatedBy: 'magpie',
        };
        
        writeFileSync(SHARED_CONFIG_PATH, JSON.stringify(fullConfig, null, 2));
        log('[AI-Clients] Saved shared config to:', SHARED_CONFIG_PATH);
        
        return true;
    } catch (error) {
        logError('[AI-Clients] Failed to save shared config:', error);
        return false;
    }
}

/**
 * Get the shared config file path (for UI display)
 */
export function getSharedConfigPath(): string {
    return SHARED_CONFIG_PATH;
}

// =============================================================================
// FUTURE: Additional AI Services
// =============================================================================
// 
// When adding new AI services, follow this pattern:
// 
// 1. Add lazy-loaded singleton:
//    let _newClient: NewClientType | null = null;
//    let _newClientChecked = false;
// 
// 2. Add getter function:
//    export function getNewClient(): NewClientType | null { ... }
// 
// 3. Add availability check:
//    export function isNewClientAvailable(): boolean { ... }
// 
// 4. Update AIServicesStatus interface and getAIServicesStatus()
// 
// 5. Update docs/AI-CLIENTS.md
//
// Candidates for future integration:
//   - Anthropic Claude (ANTHROPIC_API_KEY)
//   - Google Gemini (GOOGLE_API_KEY)
//   - Perplexity (PERPLEXITY_API_KEY)
//   - Local LLMs via Ollama
// =============================================================================
