# AI Clients Architecture

> **Keywords**: `OPENAI_CLIENT`, `TAVILY_CLIENT`, `AI_SERVICE`, `LLM_CLIENT`, `lazy-load`, `graceful-degradation`, `proxy-mode`, `shared-config`

## Overview

The `ai-clients.ts` module is the **Single Source of Truth (SSOT)** for all AI service client management in Prism Server.

```
┌─────────────────────────────────────────────────────────────────┐
│                         ai-clients.ts                          │
│                                                                 │
│  KEY SOURCES (Priority Order):                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Runtime Keys (from frontend via configureKeys())     │   │
│  │ 2. Shared Config (~/.magpie/prism-config.json)          │   │
│  │ 3. Environment Variables (OPENAI_API_KEY, etc.)         │   │
│  │ 4. Proxy Mode (MAGPIE_PROXY_TOKEN + PROXY_URL)          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ┌─────────────────┐     ┌─────────────────┐                  │
│   │  getOpenAI()    │     │  getTavily()    │                  │
│   │  (lazy-loaded)  │     │  (lazy-loaded)  │                  │
│   └────────┬────────┘     └────────┬────────┘                  │
│            │                       │                            │
│            ▼                       ▼                            │
│   ┌─────────────────┐     ┌─────────────────┐                  │
│   │ OpenAI Client   │     │ Tavily Client   │                  │
│   │ (Chat/Embed)    │     │ (Web Search)    │                  │
│   └─────────────────┘     └─────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ Strategies│   │  Scout   │    │ Gardener │
        │ (irony,   │   │  Agent   │    │  Agent   │
        │ causal...)│   │          │    │          │
        └──────────┘    └──────────┘    └──────────┘
```

## Why This Exists

### Problem: Startup Crashes

Before this module, each class directly instantiated OpenAI in its constructor:

```typescript
// ❌ OLD: Crashes if OPENAI_API_KEY not set
class IronyStrategy {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
```

When deployed as a Tauri sidecar (launched from Finder without shell environment), `OPENAI_API_KEY` is undefined, causing:

```
error: The OPENAI_API_KEY environment variable is missing or empty
```

### Solution: Lazy Loading + Graceful Degradation

```typescript
// ✅ NEW: Safe lazy-loading via ai-clients.ts
import { getOpenAI } from './lib/ai-clients.js';

class IronyStrategy {
  async evaluate(findings: Finding[]): Promise<DepthScore> {
    const openai = getOpenAI();
    if (!openai) {
      return { /* fallback response */ };
    }
    // Use openai...
  }
}
```

## Usage Patterns

### Pattern 1: Optional AI (Graceful Degradation)

Use when AI enhances but isn't required:

```typescript
import { getOpenAI } from './lib/ai-clients.js';

async function analyze(text: string) {
  const openai = getOpenAI();
  if (!openai) {
    // Fallback: return basic analysis or skip
    return { score: 0, reason: 'AI not configured' };
  }
  
  const response = await openai.chat.completions.create({...});
  return parseResponse(response);
}
```

### Pattern 2: Required AI (Explicit Failure)

Use when AI is mandatory:

```typescript
import { requireOpenAI } from './lib/ai-clients.js';

async function mustAnalyze(text: string) {
  const openai = requireOpenAI(); // Throws if not configured
  // ...
}
```

### Pattern 3: Conditional Logic

Use when deciding whether to show AI-dependent features:

```typescript
import { isOpenAIAvailable, isTavilyAvailable } from './lib/ai-clients.js';

if (isOpenAIAvailable()) {
  // Show AI-powered search
} else {
  // Show basic search only
}
```

## Key Sources & Priority

The module supports multiple key sources with the following priority:

### Priority 1: Runtime Keys (Frontend Injection)

```typescript
// Called by Magpie frontend after user login
configureKeys({
  openaiKey: 'sk-...',
  tavilyKey: 'tvly-...',
});
```

### Priority 2: Shared Config File (MCP Binary)

Location: `~/.magpie/prism-config.json`

```json
{
  "proxyToken": "eyJhbGciOiJIUzI1NiIs...",
  "proxyUrl": "https://api-proxy-magpie.up.railway.app",
  "openaiKey": "sk-...",
  "tavilyKey": "tvly-...",
  "updatedAt": "2025-12-21T...",
  "updatedBy": "magpie"
}
```

**Auto-sync**: When Magpie configures keys via `/api/config/keys`, they are automatically saved to this file for MCP binary access.

### Priority 3: Environment Variables

| Variable | Service | Required For |
|----------|---------|--------------|
| `OPENAI_API_KEY` | OpenAI | Chat completions, embeddings |
| `TAVILY_API_KEY` | Tavily | Web search, research |

### Priority 4: Proxy Mode (No API Keys Needed!)

For users without their own API keys, Magpie supports **Proxy Mode**:

| Variable | Description |
|----------|-------------|
| `MAGPIE_PROXY_TOKEN` | JWT from email login (OAuth) |
| `MAGPIE_PROXY_URL` | Proxy server URL (default: `https://api-proxy-magpie.up.railway.app`) |

```typescript
// Proxy mode creates clients pointing to proxy server
const openai = new OpenAI({
  apiKey: proxyToken,  // JWT as "API key"
  baseURL: `${proxyUrl}/proxy/openai/v1`,
});
```

---

## Shared Config File API

For MCP binary and cross-process key sharing:

| Function | Description |
|----------|-------------|
| `loadSharedConfig()` | Load keys from `~/.magpie/prism-config.json` |
| `saveSharedConfig(config)` | Save keys to shared config file |
| `getSharedConfigPath()` | Get the config file path |

**Usage in MCP Binary:**

```typescript
// src/mcp/index.ts
import { loadSharedConfig, logAIServicesStatus } from '../lib/ai-clients.js';

async function main() {
  // Load keys from shared config (written by Magpie)
  const configLoaded = loadSharedConfig();
  if (!configLoaded) {
    console.error('No shared config found. Some tools may not work.');
  }
  logAIServicesStatus();
  // ...
}
```

## Module API

### OpenAI

| Function | Returns | Description |
|----------|---------|-------------|
| `getOpenAI()` | `OpenAI \| null` | Lazy-loaded client, null if key missing |
| `requireOpenAI()` | `OpenAI` | Client or throws error |
| `isOpenAIAvailable()` | `boolean` | Check without initializing |

### Tavily

| Function | Returns | Description |
|----------|---------|-------------|
| `getTavily()` | `TavilyClient \| null` | Lazy-loaded client, null if key missing |
| `isTavilyAvailable()` | `boolean` | Check without initializing |

### Diagnostics

| Function | Description |
|----------|-------------|
| `getAIServicesStatus()` | Returns `{ openai: boolean, tavily: boolean }` |
| `logAIServicesStatus()` | Logs status to console |

## Modules Using ai-clients.ts

All 16 modules are fully migrated to use the centralized `ai-clients.ts`:

### Core Modules
- `ask.ts` - Memory recall & synthesis
- `extract.ts` - Entity extraction  
- `navigation.ts` - Navigation tracking
- `digest.ts` - Content digestion

### CLI Tools
- `cli/find-duplicates.ts` - Duplicate detection

### Deep Explorer (Strategies)
- `lib/deep-explorer/strategies/irony.ts`
- `lib/deep-explorer/strategies/evidence.ts`
- `lib/deep-explorer/strategies/causal.ts`
- `lib/deep-explorer/strategies/emotional.ts`

### Deep Explorer (Engine)
- `lib/deep-explorer/engine.ts`
- `lib/deep-explorer/query-analyzer.ts`
- `lib/deep-explorer/intent-extractor.ts`

### Scout Agent
- `lib/scout/agent.ts`
- `lib/scout/query-generator.ts`

### Gardener Agent
- `lib/gardener/agent.ts`
- `lib/gardener/deduplicator.ts`

## Adding New AI Services

1. Add lazy-loaded singleton in `ai-clients.ts`:

```typescript
let _anthropicClient: Anthropic | null = null;
let _anthropicChecked = false;

export function getAnthropic(): Anthropic | null {
  if (!_anthropicChecked) {
    _anthropicChecked = true;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      _anthropicClient = new Anthropic({ apiKey });
      console.error('[AI-Clients] ✓ Anthropic client initialized');
    }
  }
  return _anthropicClient;
}
```

2. Add availability check:

```typescript
export function isAnthropicAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
```

3. Update `AIServicesStatus` interface and `getAIServicesStatus()`

4. Update this documentation

## Searchable Tags

For grep/search when developing new agentic modules:

```bash
# Find all AI client usage
grep -r "getOpenAI\|getTavily\|ai-clients" src/

# Find modules that need AI
grep -r "OPENAI_CLIENT\|LLM_CLIENT\|AI_SERVICE" src/

# Find graceful degradation patterns
grep -r "if (!openai)\|if (!tavily)" src/
```

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system architecture
- [MODULE-BOUNDARIES.md](./MODULE-BOUNDARIES.md) - Module dependency rules
- [SCOUT-ANYTHING.md](./SCOUT-ANYTHING.md) - Scout agent using Tavily
- [DEEP-EXPLORER-STRATEGIES.md](./DEEP-EXPLORER-STRATEGIES.md) - Strategy implementations

