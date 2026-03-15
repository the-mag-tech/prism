# Code-Documentation Synchronization Guide

> **Purpose**: Establish bidirectional traceability between code and documentation.
> **Pattern**: Canonical Reference IDs + Frontmatter Metadata

---

## 1. The Problem

```
Code changes → Docs become stale
Docs changes → Code comments become misleading
No one knows what depends on what
```

## 2. Solution: Reference ID System

### 2.1 Reference ID Format

```
@ref:<module>/<concept>[-version]

Examples:
  @ref:scout/profile-v2
  @ref:scout/search-tool
  @ref:scout/lod-strategy
  @ref:mcp/tools-registry
```

### 2.2 In Code (TSDoc Style)

```typescript
/**
 * Profile Generation Pipeline
 * 
 * @ref scout/profile-v2
 * @doc docs/SCOUT-ANYTHING.md#7-mcp-tools
 * @since 2025-12-21
 * 
 * Key changes in v2:
 * - keyLinks from real search results
 * - Added searchMetadata
 * - Added rawSources (opt-in)
 */
async profile(entityName: string, context: string): Promise<EntityProfile> {
  // ...
}
```

### 2.3 In Documentation (Frontmatter + Inline)

```markdown
---
refs:
  - id: scout/profile-v2
    code: src/lib/scout/agent.ts#profile
    version: 2
    updated: 2025-12-21
  - id: scout/search-tool
    code: src/mcp/tools/search.ts
    version: 1
    updated: 2025-12-21
---

# Scout Documentation

## Profile Generation <!-- @ref:scout/profile-v2 -->

This section documents the `profile()` method.

**Code Location**: `src/lib/scout/agent.ts:448-520`
```

---

## 3. Reference Registry

Create a central registry file:

```yaml
# docs/REFERENCE-REGISTRY.yaml

refs:
  scout/profile-v2:
    description: "Profile generation with real keyLinks"
    code:
      - src/lib/scout/agent.ts#profile
      - src/lib/scout/agent.ts#synthesizeProfile
    docs:
      - docs/SCOUT-ANYTHING.md#7-mcp-tools
    types:
      - src/lib/graph-link/types.ts#EntityProfile
    version: 2
    updated: 2025-12-21
    
  scout/search-tool:
    description: "Raw search MCP tool"
    code:
      - src/mcp/tools/search.ts
    docs:
      - docs/SCOUT-ANYTHING.md#73-prism_search
    version: 1
    updated: 2025-12-21
    
  scout/lod-strategy:
    description: "Level of Detail scheduling"
    code:
      - src/systems/ScoutSystem.ts
    docs:
      - docs/SCOUT-ANYTHING.md#2-lod-strategy
    version: 1
    updated: 2025-12
```

---

## 4. Sync Check Script

```bash
#!/bin/bash
# scripts/check-doc-sync.sh

echo "🔍 Checking code-doc synchronization..."

# 1. Find all @ref tags in code
echo "📄 Scanning code for @ref tags..."
CODE_REFS=$(grep -rh "@ref:" src/ --include="*.ts" | grep -oE "@ref:[a-z/-]+" | sort -u)

# 2. Find all @ref tags in docs  
echo "📚 Scanning docs for @ref tags..."
DOC_REFS=$(grep -rh "@ref:" docs/ --include="*.md" | grep -oE "@ref:[a-z/-]+" | sort -u)

# 3. Check registry
echo "📋 Validating against registry..."
# ... validation logic

# 4. Report mismatches
echo "✅ Sync check complete"
```

---

## 5. Recommended Workflow

### When Modifying Code:

```
1. Check if function has @ref tag
2. If yes, note the ref ID
3. After code change, update:
   - [ ] Code comments (@since, change description)
   - [ ] Linked documentation sections
   - [ ] REFERENCE-REGISTRY.yaml (version, updated)
```

### When Modifying Docs:

```
1. Check frontmatter for refs
2. For each ref, verify code still matches
3. If code changed, update doc
4. If doc structure changed, update code @doc links
```

### Pre-commit Hook (Optional):

```bash
# .git/hooks/pre-commit
#!/bin/bash

# Check for @ref mismatches
./scripts/check-doc-sync.sh

if [ $? -ne 0 ]; then
  echo "❌ Doc-code sync check failed!"
  exit 1
fi
```

---

## 6. Quick Reference Card

### Code → Doc Link
```typescript
/**
 * @ref scout/profile-v2
 * @doc docs/SCOUT-ANYTHING.md#7-mcp-tools
 */
```

### Doc → Code Link
```markdown
<!-- @ref:scout/profile-v2 -->
**Code**: `src/lib/scout/agent.ts:448`
```

### Registry Entry
```yaml
scout/profile-v2:
  code: [src/lib/scout/agent.ts#profile]
  docs: [docs/SCOUT-ANYTHING.md#7-mcp-tools]
  version: 2
  updated: 2025-12-21
```

---

## 7. Benefits

| Aspect | Before | After |
|--------|--------|-------|
| **Traceability** | Grep and hope | Direct links via @ref |
| **Staleness Detection** | Manual review | Automated check |
| **Onboarding** | "Where's the doc for this?" | Follow @doc link |
| **Refactoring** | Break docs silently | Registry shows dependencies |

---

## 8. Implementation Priority

1. **Phase 1** (Immediate): Add @ref to critical code paths
2. **Phase 2** (Soon): Create REFERENCE-REGISTRY.yaml
3. **Phase 3** (Later): Automated sync check script
4. **Phase 4** (Optional): Pre-commit hook

---

## Example: Scout Module References

| Ref ID | Code | Doc |
|--------|------|-----|
| `scout/profile-v2` | `agent.ts#profile` | `SCOUT-ANYTHING.md#7.2` |
| `scout/search-tool` | `search.ts` | `SCOUT-ANYTHING.md#7.3` |
| `scout/synthesize` | `agent.ts#synthesizeProfile` | `SCOUT-ANYTHING.md#7.4` |
| `scout/lod-strategy` | `ScoutSystem.ts` | `SCOUT-ANYTHING.md#2` |
| `scout/fingerprint` | `graphReader.ts#getFingerprint` | `SCOUT-ANYTHING.md#6.1` |

---

## 9. Logger Module <!-- @ref:infra/logger -->

### Problem

MCP stdio mode uses `stdout` exclusively for JSON-RPC communication. Any `console.log()` call pollutes the protocol and causes parsing errors:

```
Client error for command Unexpected token 'A', "[AI-Clients"... is not valid JSON
```

### Solution

Environment-aware logger that detects runtime mode:

```typescript
// src/lib/logger.ts
import { log, logError, logWarn, enableMcpMode } from './logger.js';

// MCP binary startup (src/mcp/index.ts):
enableMcpMode();  // All logs → stderr

// Usage (works in both modes):
log('[Scout] Starting...');      // stdout in HTTP, stderr in MCP
logError('[Scout] Failed:', e);  // always stderr
```

### Behavior Matrix

| Mode | `log()` | `logError()` | `logWarn()` |
|------|---------|--------------|-------------|
| HTTP Server | stdout | stderr | stderr |
| MCP Binary | stderr | stderr | stderr |

### Consumer Modules

- `src/lib/ai-clients.ts`
- `src/lib/scout/agent.ts`
- `src/lib/scout/query-generator.ts`
- `src/mcp/tools/search.ts`
- `src/mcp/index.ts`

---

## 10. Auth Module References (Magpie)

| Ref ID | Code | Description |
|--------|------|-------------|
| `auth/token-validation` | `data-layer.ts#validateProxyToken` | Validates JWT with proxy server |
| `auth/logout` | `data-layer.ts#logout` | Clears proxy token from storage |
| `auth/user-info` | `data-layer.ts#getLoggedInUser` | Decodes JWT to get user email |
| `auth/login-check` | `data-layer.ts#isLoggedIn` | Checks if token exists |

See `apps/magpie/AGENTS.md#authentication--token-management` for full documentation.

---

## 11. Graceful Shutdown & Worker Registry <!-- @ref:shutdown/graceful -->

### Background Workers

Prism Server has multiple background systems that need graceful shutdown:

| Worker | Code | Description | Busy Check |
|--------|------|-------------|------------|
| `ScoutSystem` | `server.ts` | Periodic entity profiling | `isScoutBusy()` |
| `RippleSystem` | `lib/ripple/system.ts` | Event-driven propagation | `isProcessing()` |
| `BackgroundWorker` | `background-worker.ts` | Stale entity refresh | `getWorkerStatus().isRunning` |
| `GardenerService` | `lib/gardener/service.ts` | Deduplication cycles | `isGardenerBusy()` |

### Shutdown API

| Endpoint | Purpose |
|----------|---------|
| `GET /shutdown/status` | Check if any worker is busy |
| `POST /shutdown/prepare` | Stop all workers, prepare for exit |

### Tauri Integration

The Magpie desktop app (`apps/magpie/src-tauri/src/main.rs`) calls these endpoints:

1. **Cmd+Q / Menu Bar Quit** → `graceful_shutdown()`
   - Calls `/shutdown/prepare`
   - Polls `/shutdown/status` (max 30s timeout)
   - Then stops sidecar

2. **Tray → Force Quit** → `stop_prism_sidecar()`
   - Immediate SIGTERM/SIGKILL

### @ref Tags

| Ref ID | Code | Description |
|--------|------|-------------|
| `shutdown/status` | `app.ts#/shutdown/status` | Worker status aggregation |
| `shutdown/prepare` | `app.ts#/shutdown/prepare` | Graceful shutdown initiation |
| `shutdown/tauri-graceful` | `main.rs#graceful_shutdown` | Tauri-side shutdown polling |
| `worker/scout` | `server.ts#isScoutBusy` | Scout busy tracking |
| `worker/ripple` | `lib/ripple/system.ts` | Ripple queue processing |
| `worker/gardener` | `lib/gardener/service.ts` | Gardener cycle tracking |
| `worker/background` | `background-worker.ts` | Stale entity worker |

---

## 12. MCP Binary Verification <!-- @ref:mcp/binary-verification -->

### Problem

Two different binaries can be built from prism-server:

| Command | Entry Point | Purpose | Output to stdout |
|---------|-------------|---------|------------------|
| `pnpm build:tauri` | `src/server.ts` | HTTP server for Tauri sidecar | Logs (OK for HTTP) |
| `pnpm build:mcp` | `src/mcp/index.ts` | MCP stdio server for Cursor/Claude | **JSON-RPC only** |

Using `build:tauri` output as MCP binary causes:
```
Client error for command Unexpected token 'S', "[Startup] S"... is not valid JSON
```

### Solution

1. **Clear naming**: Renamed `build:bin` → `build:tauri` to prevent confusion
2. **Smoke test**: `pnpm test:mcp-binary` verifies correct entry point

### Smoke Test Script

```bash
# Test existing binary
pnpm test:mcp-binary

# Build and test
pnpm test:mcp-binary:build
```

The test checks:
1. Binary exists
2. Binary size is reasonable (~70MB for MCP, ~78MB for Tauri)
3. **stdout is clean** (no log pollution)

### @ref Tags

| Ref ID | Code | Description |
|--------|------|-------------|
| `mcp/binary-verification` | `scripts/test-mcp-binary.sh` | Smoke test script |
| `mcp/entry-stdio` | `src/mcp/index.ts` | Correct entry point for MCP |
| `mcp/entry-http` | `src/server.ts` | HTTP server entry (Tauri) |

---

## 13. Config Hot Reload <!-- @ref:ai-clients/config-hot-reload -->

### Problem

MCP binary loads `~/.magpie/prism-config.json` at startup only. If config is updated (e.g., new proxy token), the binary needs restart.

### Solution

TTL + mtime based hot reload:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  getProxyConfig() / isProxyMode()                                       │
│         │                                                               │
│         ▼                                                               │
│  ensureConfigFresh()                                                    │
│         │                                                               │
│         ├── Cache exists && age < 60s && mtime unchanged?               │
│         │      │                                                        │
│         │      └── YES → use cache (fast path)                          │
│         │                                                               │
│         └── NO → loadSharedConfigInternal() → update cache              │
│                                                                         │
│  Atomicity: If reload fails, keep old cached config                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| `CONFIG_CACHE_TTL_MS` | 60,000ms | `ai-clients.ts` |

### @ref Tags

| Ref ID | Code | Description |
|--------|------|-------------|
| `ai-clients/config-hot-reload` | `src/lib/ai-clients.ts#ensureConfigFresh` | TTL cache logic |
| `ai-clients/config-cache` | `src/lib/ai-clients.ts#_configCache` | Cache structure |
| `ai-clients/shared-config` | `src/lib/ai-clients.ts#loadSharedConfig` | Config file loading |

---

## 14. SSOT Constants <!-- @ref:contract/constants -->

### Purpose

Centralized configuration constants shared across Prism, Magpie, and API Proxy.
All "magic numbers" should live here to prevent drift.

### Code Location

`packages/prism-contract/src/constants.ts`

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `SCOUT_QUOTA_DEFAULT` | 25 | Default daily Scout limit |
| `SCOUT_COST_PER_CALL` | 0.04 | Estimated cost per Scout ($) |
| `TAVILY_DAILY_QUOTA` | 50 | API Proxy: Tavily calls/day/user |
| `QVERIS_DAILY_QUOTA` | 30 | API Proxy: Qveris calls/day/user |
| `OPENAI_TOKEN_DAILY_QUOTA` | 100000 | API Proxy: tokens/day/user |

### Consumer Matrix

| Consumer | Import Method | Sync Status |
|----------|---------------|-------------|
| `apps/magpie/.../SettingsPanel.tsx` | Direct import | ✅ Auto-synced |
| `apps/prism-server/.../scout-quota.ts` | Inline + comment | ⚠️ Manual sync |
| `apps/api-proxy/src/proxy.ts` | Inline + comment | ⚠️ Manual sync |
| `apps/api-proxy/src/server.ts` | Inline + comment | ⚠️ Manual sync |

### Why Inline for Some Consumers?

- **Prism Server**: Bun binary builds can't resolve workspace imports
- **API Proxy**: Standalone deployment (Cloudflare Workers / Railway)

### Modification Checklist

When modifying any constant in `constants.ts`:

```
1. [ ] Update prism-contract/src/constants.ts (SSOT)
2. [ ] Update apps/prism-server/src/lib/scout-quota.ts (if Scout-related)
3. [ ] Update apps/api-proxy/src/proxy.ts (if API quota-related)
4. [ ] Update apps/api-proxy/src/server.ts (if API quota-related)
5. [ ] Redeploy API Proxy if quotas changed
```

### @ref Tags

| Ref ID | Code | Description |
|--------|------|-------------|
| `contract/constants` | `prism-contract/src/constants.ts` | SSOT for all shared constants |
| `quota/scout-default` | `scout-quota.ts` | Scout daily limit |
| `quota/api-tavily` | `proxy.ts`, `server.ts` | Tavily API limit |
| `quota/api-qveris` | `proxy.ts`, `server.ts` | Qveris API limit |

---

## 15. Agent Workers & Queue System <!-- @ref:agents/workers -->

### Problem

Background workers (Scout, Ripple, etc.) previously:
- Lost tasks on crash (in-memory retry counts)
- Had no centralized logging for debugging
- Lacked structured operation tracking

### Solution

1. **Durable Queue**: SQLite-backed job persistence (`bun-queue.ts`)
2. **AgentLogger**: Structured logging to `agent_logs` table
3. **Unified Worker Structure**: All workers in `lib/agents/{name}/worker.ts`

### Worker Registry

| Worker | Code Location | AgentLogger | Doc |
|--------|--------------|-------------|-----|
| **Ripple** | `lib/agents/ripple/worker.ts` | `scout` / `ripple` | `RIPPLE-EFFECT-SPEC.md` |
| **Scout** | `lib/agents/scout/worker.ts` | `scout` / `patrol` | `SCOUT-ANYTHING.md` |
| **Explorer** | `lib/agents/explorer/worker.ts` | `deep_explorer` / `explore` | `DEEP-EXPLORER-STRATEGIES.md` |
| **Curator** | `lib/agents/curator/worker.ts` | `curator` / `cycle` | `GARDENER-PROTOCOL.md` |

### Queue System

| Component | Code | Description |
|-----------|------|-------------|
| `bun-queue.ts` | `lib/queue/bun-queue.ts` | SQLite-backed job persistence |
| `client.ts` | `lib/queue/client.ts` | Type-safe enqueue APIs |
| `types.ts` | `lib/queue/types.ts` | Zod schemas for task payloads |
| `workers/index.ts` | `lib/queue/workers/index.ts` | Worker registration & startup |

### @ref Tags

| Ref ID | Code | Doc |
|--------|------|-----|
| `agents/ripple-worker` | `lib/agents/ripple/worker.ts` | `RIPPLE-EFFECT-SPEC.md#4` |
| `agents/scout-worker` | `lib/agents/scout/worker.ts` | `SCOUT-ANYTHING.md` |
| `agents/explorer-worker` | `lib/agents/explorer/worker.ts` | `DEEP-EXPLORER-STRATEGIES.md` |
| `agents/curator-worker` | `lib/agents/curator/worker.ts` | `GARDENER-PROTOCOL.md` |
| `queue/bun-queue` | `lib/queue/bun-queue.ts` | `WORKER-CHECKLIST.md#6` |
| `queue/types` | `lib/queue/types.ts` | `WORKER-CHECKLIST.md#6` |
| `infra/agent-logger` | `lib/agent-logger.ts` | `WORKER-CHECKLIST.md#1` |

---

## 16. Ripple System <!-- @ref:ripple/system -->

### Architecture

```
Event Trigger → RippleSystem.emit() → enqueueRipple() → Worker → RippleAgent.propagate()
```

### Components

| Component | Code | Description |
|-----------|------|-------------|
| `RippleSystem` | `systems/RippleSystem.ts` | Event orchestration, quota management |
| `RippleAgent` | `lib/ripple/agent.ts` | Core logic (propagate/profile/onboard) |
| `RippleWorker` | `lib/agents/ripple/worker.ts` | Queue consumer with AgentLogger |
| `RippleTask` | `lib/queue/types.ts` | Zod-validated task payload |

### Key Methods

| Method | Location | Description |
|--------|----------|-------------|
| `emit()` | `RippleSystem.ts` | Enqueue event to persistent queue |
| `handleEventDirect()` | `RippleSystem.ts` | Direct processing (bypasses queue) |
| `propagate()` | `RippleAgent.ts` | Profile generation + content onboarding |
| `evaluateCandidates()` | `RippleAgent.ts` | Serendipity filtering (surprise score) |

### @ref Tags

| Ref ID | Code | Doc |
|--------|------|-----|
| `ripple/system` | `systems/RippleSystem.ts` | `RIPPLE-EFFECT-SPEC.md` |
| `ripple/agent` | `lib/ripple/agent.ts` | `RIPPLE-EFFECT-SPEC.md#4.2` |
| `ripple/propagate` | `lib/ripple/agent.ts#propagate` | `RIPPLE-EFFECT-SPEC.md#4.2` |
| `ripple/serendipity` | `lib/ripple/agent.ts#evaluateCandidates` | `SERENDIPITY-EXPERIMENT.md` |
| `ripple/profileable-types` | `prism-contract/entity-definitions.ts` | `MODULE-BOUNDARIES.md#2.3` |

---

## 17. Entity Definitions (SSOT) <!-- @ref:contract/entity-definitions -->

### Purpose

Centralized entity type definitions used by:
- **Prism Server**: Extraction prompts, type validation
- **Magpie**: UI presentation (SemanticRole mapping)
- **Ripple**: `PROFILEABLE_TYPES` for profile generation

### Code Location

`packages/prism-contract/src/entity-definitions.ts`

### Key Exports

| Export | Description |
|--------|-------------|
| `ENTITY_DEFINITIONS` | Full definitions with tribe classification |
| `EXTRACTABLE_TYPES` | Types AI can produce (for prompts) |
| `PROFILEABLE_TYPES` | Types that get web profiles (person, company, project) |
| `TRIBE_PROFILE_STRATEGIES` | Search query templates per tribe |
| `getTribeFromType()` | Get tribe for any entity type |
| `needsProfileEnrichment()` | Check if entity needs profile |

### Consumer Matrix

| Consumer | Import | Usage |
|----------|--------|-------|
| `pipeline-version.ts` | `EXTRACTABLE_TYPES`, `ENTITY_TYPE_DEFINITIONS` | Build extraction prompt |
| `entity-extraction.ts` | `EXTRACTABLE_TYPES` | Validate extracted types |
| `ripple/agent.ts` | `PROFILEABLE_TYPES`, `TRIBE_PROFILE_STRATEGIES` | Profile filtering |
| `ripple/types.ts` | `PROFILEABLE_TYPES` | Default config |
| `magpie/entity-semantics-api.ts` | `EntityCategory` | UI role mapping |

### Four Tribes Classification

| Tribe | Philosophy | Example Types |
|-------|------------|---------------|
| **Source** | Raw input soil | `memory`, `finding` |
| **Archivist** | Links are knowledge | `topic`, `concept`, `problem`, `insight` |
| **Salesman** | People matter | `person`, `company`, `project` |
| **Gardener** | Relationships need context | `gift`, `hobby`, `location`, `agenda` |
| **Logger** | Capture the timeline | `event`, `milestone`, `decision`, `news` |

### @ref Tags

| Ref ID | Code | Doc |
|--------|------|-----|
| `contract/entity-definitions` | `prism-contract/entity-definitions.ts` | `MODULE-BOUNDARIES.md#1.1` |
| `contract/profileable-types` | `prism-contract/entity-definitions.ts#PROFILEABLE_TYPES` | `RIPPLE-EFFECT-SPEC.md#4.2` |
| `contract/tribe-strategies` | `prism-contract/entity-definitions.ts#TRIBE_PROFILE_STRATEGIES` | `MODULE-BOUNDARIES.md#2.3` |
| `contract/four-tribes` | `prism-contract/entity-definitions.ts` | `the-four-tribes.md` |

---

## 18. Module Boundaries Update (2026-01-08) <!-- @ref:architecture/module-boundaries -->

### Recent Structural Changes

| Change | Before | After |
|--------|--------|-------|
| Worker location | Scattered | `lib/agents/{name}/worker.ts` |
| Gardener naming | `lib/gardener/` | `lib/agents/curator/` |
| Queue system | In-memory | `lib/queue/bun-queue.ts` (SQLite) |
| Ripple logic | `lib/ripple/` only | `lib/ripple/` + `lib/agents/ripple/` |

### Current Directory Structure

```
lib/
├── agents/              # Worker implementations (with AgentLogger)
│   ├── ripple/
│   ├── scout/
│   ├── explorer/
│   └── curator/
├── queue/               # Durable task queue
│   ├── bun-queue.ts
│   ├── client.ts
│   ├── types.ts
│   └── workers/
├── ripple/              # Ripple core logic
│   ├── agent.ts
│   └── types.ts
└── ...
```

### @ref Tags

| Ref ID | Doc |
|--------|-----|
| `architecture/module-boundaries` | `MODULE-BOUNDARIES.md` |
| `architecture/prism-map` | `PRISM-ARCHITECTURE-MAP.md` |
| `architecture/main` | `ARCHITECTURE.md` |
| `worker/checklist` | `WORKER-CHECKLIST.md` |

---

## 19. Data Gap Detection System <!-- @ref:data-gap/system -->

### Purpose

主动识别 KG 膨胀过程中"理想情况下应该补充什么数据"，驱动 Scout/Ripple 进行针对性搜索。

### Components

| Component | Code | Description |
|-----------|------|-------------|
| Schema Expectations | `prism-contract/schema-expectations.ts` | 每种实体类型的预期关系 |
| Gap Detector | `lib/data-gap/detector.ts` | 检测缺失关系 |
| Gap Logger | `lib/data-gap/logger.ts` | 记录 gaps 到数据库 |
| Extraction Logs | `extraction_logs` table | Extraction 质量日志 |
| Scout Logs | `scout_logs` table | Scout 质量日志 |
| Ripple Logs | `ripple_logs` table | Ripple 质量日志 |

### Integration Points

| Stage | Hook | Purpose |
|-------|------|---------|
| **Extraction** | After entity extraction | Detect gaps for new entities |
| **Scout** | After profile generation | Check which gaps were filled |
| **Ripple** | Query generation | Prioritize gap-filling queries |

### @ref Tags

| Ref ID | Code | Doc |
|--------|------|-----|
| `data-gap/system` | Multiple files | `DATA-GAP-DETECTION.md` |
| `data-gap/schema-expectations` | `prism-contract/schema-expectations.ts` | `DATA-GAP-DETECTION.md#4` |
| `data-gap/tables` | `migrations/v52_data_gap_detection.ts` | `DATA-GAP-DETECTION.md#5` |
| `data-gap/detect-gaps` | `lib/data-gap/detector.ts` | `DATA-GAP-DETECTION.md#6` |
| `data-gap/integration` | Multiple files | `DATA-GAP-DETECTION.md#6.2` |
| `data-gap/llm-prompt` | `lib/data-gap/llm-assistant.ts` | `DATA-GAP-DETECTION.md#7` |
| `data-gap/cli` | `cli/gap-stats.ts`, `cli/gap-fill.ts` | `DATA-GAP-DETECTION.md#8` |

---

## 20. Search Quality Logging <!-- @ref:search/quality-logs -->

### Purpose

记录搜索操作的质量指标，支持数据质量分析和负样本收集。

### Tables

| Table | Purpose |
|-------|---------|
| `search_logs` | 搜索请求、结果、延迟、质量评分 |
| `negative_samples` | 被跳过的搜索结果（负样本） |

### Key Fields

```sql
-- search_logs
query, provider, trigger, results_count, latency_ms,
quality_score, diversity_score, relevance_score,
ingested_count, skipped_count, avg_surprise_score

-- negative_samples
url, domain, title, skip_reason, surprise_score,
occurrence_count, first_seen, last_seen
```

### CLI

```bash
pnpm search-stats overview    # 搜索统计总览
pnpm search-stats domains     # 按域名统计
pnpm search-stats surprise    # 惊喜度分析
pnpm search-stats recent      # 最近搜索
```

### @ref Tags

| Ref ID | Code | Doc |
|--------|------|-----|
| `search/quality-logs` | `lib/search-logger.ts` | Phase 0.5 implementation |
| `search/negative-samples` | `negative_samples` table | For learning & analysis |
| `search/cli` | `cli/search-stats.ts` | Statistics CLI |

---

## 21. Data Access Layer (GraphReader Encapsulation) <!-- @ref:dal/graph-reader -->

### Purpose

统一数据库访问层，减少 MCP/API 层直接 SQL 调用，提高可测试性和可维护性。

### Problem (2026-01-08 Snapshot)

```
Before refactoring:
- Direct getDB() / db.query calls: 877 (94.3%)
- Via graphReader / graphWriter: 50 (5.7%)

Key pain points:
- Schema changes painful (memories → user_memories required 100+ edits)
- Testing difficult (business logic mixed with SQL)
- Inconsistent query implementations
```

### Solution

扩展 `GraphReader` 封装常用查询：

```typescript
// lib/graph-link/reader.ts

// 获取相关实体（含关系类型）
getRelatedEntities(entityId: string, limit?: number): Array<{
  id: string;
  title: string;
  relationType: string;
}>

// 按 Gravity 排序获取 Top N 实体
getTopByGravity(limit?: number, entityType?: string): Array<{
  id: string;
  title: string;
  subtitle: string | null;
  gravity: number;
  type: string;
}>

// 搜索用户记忆（FTS + LIKE 回退）
searchMemories(query: string, limit?: number): Array<{
  id: number;
  title: string | null;
  snippet: string;
  sourceType: string;
  createdAt: string;
}>
```

### Refactored Consumers

| File | Before | After |
|------|--------|-------|
| `mcp/tools/get-context.ts` | 5 direct SQL | 0 (uses GraphReader) |
| `mcp/tools/gravity-top.ts` | 1 direct SQL | 0 (uses GraphReader) |
| `mcp/tools/recall.ts` | Uses `recall()` | ✅ Already encapsulated |

### Migration Status

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | ✅ Done | Fix critical MCP paths |
| **Phase 2** | ✅ Done | Add GraphReader methods |
| **Phase 3** | ⏳ Future | Lint rule enforcement |

### Unit Tests

```bash
# Run GraphReader tests
bun test tests/unit/graph-reader.test.ts

# Run MCP Recall tests  
bun test tests/unit/mcp-recall.test.ts
```

### @ref Tags

| Ref ID | Code | Description |
|--------|------|-------------|
| `dal/graph-reader` | `lib/graph-link/reader.ts` | Main encapsulation layer |
| `dal/get-related-entities` | `reader.ts#getRelatedEntities` | Relation query with types |
| `dal/get-top-by-gravity` | `reader.ts#getTopByGravity` | Gravity-sorted entity list |
| `dal/search-memories` | `reader.ts#searchMemories` | FTS search with fallback |
| `dal/mcp-get-context` | `mcp/tools/get-context.ts` | Refactored MCP tool |
| `dal/mcp-gravity-top` | `mcp/tools/gravity-top.ts` | Refactored MCP tool |
| `dal/tests` | `tests/unit/graph-reader.test.ts` | Unit test suite |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                 MCP Tools / REST API                         │
│  get-context.ts    gravity-top.ts    recall.ts               │
└──────────────────────────┬──────────────────────────────────┘
                           │ ✅ Calls encapsulated methods
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              GraphReader (Encapsulation Layer)               │
│  getEntity()  getRelatedEntities()  getTopByGravity()       │
│  searchMemories()  getFingerprint()  calculateSurprise()    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    db.ts (bun:sqlite)                        │
└─────────────────────────────────────────────────────────────┘
```
