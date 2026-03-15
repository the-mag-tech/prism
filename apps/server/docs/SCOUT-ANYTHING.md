# Scout Anything: The Agentic Recall Tower

> **Role**: The "Eyes" of the System.
> **Architecture**: Agentic Recall (Open World).
> **Strategy**: **LOD (Level of Detail)** Scheduling.
> **Version**: v2 (2025-12) - Enhanced transparency & source traceability.

---

## 1. The Concept: Open-World Recall

Unlike traditional systems that search a static database, Scout treats the **Entire Internet** as its Recall Database.
It fetches, verifies, and ingests context **Just-In-Time**.

*   **Problem**: You can't crawl the whole web for every entity every second.
*   **Solution**: **Gravity-Driven LOD (Level of Detail)**.

---

## 2. The LOD Strategy

Scout does not patrol randomly. It patrols based on **Physical Importance (Gravity)**.
The `ScoutSystem` monitors the `entity_physics_state` and assigns missions.

| LOD Level | Trigger Condition | Scout Frequency | Depth | Cost |
| :--- | :--- | :--- | :--- | :--- |
| **LOD 0** (Focus) | **Anchor** ($G > 0.8$) | **Every 10 min** | **Deep**. Check Twitter, News, RSS. | High |
| **LOD 1** (View) | **Banner** ($G > 0.5$) | **Every 6 hours** | **Summary**. Major updates only. | Med |
| **LOD 2** (Peripheral) | **Spark** ($G > 0.1$) | **Every 24 hours** | **Ping**. Existence check. | Low |
| **LOD 3** (Dormant) | **Cold** ($G \le 0.1$) | **Never** | Sleep. Wakes only on user interaction. | Zero |

### 2.1 The Wake-Up Mechanism
When a Dormant entity (LOD 3) is interacted with (e.g., user searches for it), it is instantly **Woken Up**:
1.  Set `Temperature = 1.0`.
2.  Gravity spikes.
3.  Promoted to LOD 0 for immediate Deep Scout.

---

## 3. Architecture: The Scout Pipeline

### Step 1: Identification (The "Vague Entity")
*   Input: Raw Text (Meeting Note, Email).
*   Action: LLM extracts vague entities (e.g., "Julian", "The React Compiler").
*   Output: `ScoutEntity` candidates.

### Step 2: Investigation (The "Recall")
*   **Agent**: `ScoutAgent`.
*   **Tool**: Tavily API / Browser Use.
*   **Process**:
    *   **Fingerprinting**: Uses `graphReader.getFingerprint()` to build context-aware search queries.
        *   Input: Entity ID (e.g., `person:julian`)
        *   Output: `{ fingerprint: "Julian Zheng Design Linear UI", relatedTerms: ["linear", "design", "ui"] }`
        *   **Enhanced (2025-12)**: Now includes related entity names from graph relations.
    *   **Search**: Query external sources with enriched fingerprint.
    *   **Verify**: LLM checks if the search result matches the fingerprint (Disambiguation).

### Step 3: Ingestion (The "Snapshot")
*   Action: `snapshotUrl()`.
*   Output: Markdown Snapshot.
*   **Effect**:
    *   Updates `entity_profiles` (Truth).
    *   Triggers **Ripple Effect** (New connections found).
    *   **Wakes Up** the entity (Spark Signal).

---

## 4. Modes of Operation

1.  **Patrol Mode (Background)**:
    *   Driven by `ScoutSystem` tick.
    *   Maintenance of the Field health.

2.  **Discovery Mode (Active)**:
    *   Driven by **User Lens**.
    *   User clicks "Design Lens" -> Scout actively searches for "Design" connections in the current view.
    *   Generates ephemeral insights.

---

## 5. Data Privacy

*   **Local First**: All "Profiles" and "Fingerprints" stay local.
*   **Anonymized Query**: We only send the *Search Query* to Tavily, not the full context.
*   **Verification**: Done locally by LLM (or via private endpoint).

> *Scout is the bridge between your private graph and the public world.*

---

## 6. Graph Link Integration (2025-12 Enhancement)

Scout uses `graph-link/` for both **reading** and **writing** to the Prism Graph.

### 6.1 Reading: `graphReader`

| Method | Usage in Scout | Purpose |
|--------|----------------|---------|
| `getFingerprint(entityId)` | `patrol()`, `expandContext()` | Build search queries with relation context |
| `getEntity(entityId)` | `patrol()` | Get entity basic info |
| `getRelations(entityId)` | (via `getFingerprint`) | Get related entities for disambiguation |

**Example:**
```typescript
// Before (manual, repeated code)
const context = graphReader.enrichContext(entityId);
const relations = graphReader.getRelations(entityId, 'both').slice(0, 3);
const relatedTerms = relations.map(...).join(' ');
const fingerprint = `${context} ${relatedTerms}`;

// After (unified)
const fp = graphReader.getFingerprint(entityId);
// fp.fingerprint already includes relations
// fp.relatedTerms available for separate use
```

### 6.2 Writing: `graphWriter`

| Method | Usage in Scout | Purpose |
|--------|----------------|---------|
| `ingestFinding(url, title, content, relatedEntities)` | `processUrl()` | Store scout discoveries |
| `recordActivity(entityId, 'scout')` | `patrol()` | Update LOD timestamp |

### 6.3 The Scout → Graph Feedback Loop

```text
User interacts with entity
        ↓
ScoutSystem.tick() triggers patrol
        ↓
ScoutAgent.patrol(entityId)
        ↓
graphReader.getFingerprint() ──► Build enriched search query
        ↓
Tavily search with fingerprint
        ↓
Verify result with LLM
        ↓
graphWriter.ingestFinding() ──► Triggers EntityExtractionAtom
        ↓
New entities/relations created ──► Enriches future fingerprints
        ↓
[Loop continues]
```

---

## 7. MCP Tools (2025-12 v2 Enhancement)

Scout exposes two complementary MCP tools for external search:

### 7.1 Tool Comparison

| Tool | Purpose | Returns | keyLinks Source |
|------|---------|---------|-----------------|
| `prism_search` | Raw search results | Direct search results | N/A |
| `prism_scout` | Search + Profile synthesis | Structured Profile | **Real search URLs** |

### 7.2 `prism_scout` - Profile Generation

```typescript
prism_scout({
  name: "Simon Willison",           // Required: entity name
  context: "AI developer",          // Optional: help narrow search
  includeRawSources: true           // Optional: return raw search data
})
```

**Output Structure:**

```json
{
  "profile": {
    "name": "Simon Willison",
    "role": "The Open-Source Visionary",
    "bio": "...",
    "tags": ["Open Source", "Data"],
    "keyLinks": [
      {
        "title": "About Simon Willison",
        "url": "https://simonwillison.net/about/",
        "source": "search"  // ← Real URL, not LLM-generated!
      }
    ],
    "relatedEntities": [...],
    "assets": [...]
  },
  "searchMetadata": {
    "queries": ["Simon Willison bio...", "...projects github"],
    "totalResults": 6,
    "searchEngine": "tavily",
    "timestamp": "2025-12-21T02:08:10.231Z",
    "aiAnswers": ["..."]
  },
  "rawSources": [...]  // Only if includeRawSources=true
}
```

### 7.3 `prism_search` - Raw Search

```typescript
prism_search({
  query: "just-in-time context AI",  // Required
  maxResults: 5,                     // Optional (default: 5, max: 10)
  searchDepth: "basic",              // Optional: "basic" | "advanced"
  includeAnswer: true,               // Optional: AI summary
  topic: "general"                   // Optional: "general" | "news"
})
```

**Output Structure:**

```json
{
  "success": true,
  "query": "just-in-time context AI",
  "answer": "AI-generated summary...",
  "results": [
    {
      "title": "...",
      "url": "https://...",    // Real URL
      "snippet": "...",
      "score": 0.875
    }
  ],
  "totalCount": 5,
  "searchDepth": "basic"
}
```

### 7.4 v2 Key Improvements

| Problem (v1) | Solution (v2) |
|--------------|---------------|
| `keyLinks` were LLM-generated (potentially fake) | `keyLinks` now come from real Tavily search results |
| No visibility into search process | `searchMetadata` shows queries, timestamps, AI answers |
| Raw search results discarded | `rawSources` preserves full search data (opt-in) |
| No source attribution | Each `keyLink` marked with `source: "search" \| "llm"` |

### 7.5 Recommended Workflow

```
Research Mode:
  prism_search("topic")     → Get raw results, evaluate sources
         ↓
  User selects interesting URLs
         ↓
  prism_ingest(url)         → Add to knowledge graph

Profile Mode:
  prism_scout("person", { includeRawSources: true })
         ↓
  Review profile + verify keyLinks
         ↓
  Profile automatically stored in graph
```

---

## 8. MCP Client Configuration

### 8.1 API Key Management

Scout tools require API keys (Tavily for search, OpenAI for synthesis). Keys can be provided via:

| Method | Priority | Use Case |
|--------|----------|----------|
| Magpie Frontend | 1st | Desktop app users |
| Shared Config File | 2nd | MCP binary (Claude Desktop) |
| Environment Variables | 3rd | Development/CI |
| Proxy Mode | 4th | Users without own API keys |

**Shared Config File** (`~/.magpie/prism-config.json`):

```json
{
  "proxyToken": "...",
  "proxyUrl": "https://api-proxy-magpie.up.railway.app",
  "openaiKey": "sk-...",
  "tavilyKey": "tvly-...",
  "updatedBy": "magpie"
}
```

When you configure keys in Magpie Settings, they are automatically saved to this file for MCP binary access.

### 8.2 Cursor Configuration (HTTP Mode)

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "prism": {
      "url": "http://localhost:PORT/mcp"
    }
  }
}
```

✅ Uses Magpie's keys automatically (no extra config needed)

### 8.3 Claude Desktop Configuration (Binary Mode)

1. Install binary: Magpie Settings > MCP Integration > "Install prism-mcp binary"

2. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "prism": {
      "command": "~/.magpie/prism-mcp"
    }
  }
}
```

---

## 9. Testing MCP Tools

### HTTP Test Endpoint (JSON-RPC 2.0)

```bash
# List all tools
curl -s http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq

# Call prism_scout
curl -s http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"prism_scout",
      "arguments":{"name":"Simon Willison","includeRawSources":true}
    }
  }' | jq

# Call prism_search
curl -s http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{
      "name":"prism_search",
      "arguments":{"query":"just-in-time context AI","maxResults":5}
    }
  }' | jq
```

### Legacy Test Endpoint (dev mode only)

```bash
curl -X POST http://localhost:3006/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "prism_scout",
    "arguments": {
      "name": "Simon Willison",
      "includeRawSources": true
    }
  }'
```

---

## 10. Related Documentation

- [AI-CLIENTS.md](./AI-CLIENTS.md) - API key management and shared config
- [PRISM-MCP-SPEC.md](./PRISM-MCP-SPEC.md) - Full MCP specification
- [MODULE-BOUNDARIES.md](./MODULE-BOUNDARIES.md) - Scout vs DeepExplorer comparison
- [PRISM-ARCHITECTURE-MAP.md](./PRISM-ARCHITECTURE-MAP.md) - Overall architecture
- [RIPPLE-EFFECT-SPEC.md](./RIPPLE-EFFECT-SPEC.md) - How discoveries cascade through the graph

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v2.1 | 2025-12-21 | Shared config file for MCP binary, HTTP /mcp endpoint, Proxy Mode support |
| v2 | 2025-12-21 | Added `prism_search` tool, real keyLinks, searchMetadata, rawSources |
| v1 | 2025-12 | Initial Scout with LOD scheduling, Graph Link integration |
