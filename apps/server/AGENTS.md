# Prism Server Agent Guide

## Core Philosophy
Prism is the "Brain". It manages the Graph, the Logic, and the Truth. It must be resilient, consistent, and clean.

## Development Workflow

### Dev Mode (Recommended for daily development)

```bash
cd apps/prism-server
pnpm dev
# Runs on port 3006 with hot reload
# DEV_MODE=true enables fixed port + watch mode
```

### Production Mode (Testing Tauri integration)

```bash
# Rebuild binary
pnpm build:tauri
cp prism-server-bin ../magpie/src-tauri/binaries/prism-server-aarch64-apple-darwin

# Then run Tauri
cd ../magpie && pnpm tauri dev
```

### Key Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Dev mode: port 3006, hot reload |
| `pnpm build:tauri` | HTTP server binary for Tauri sidecar |
| `pnpm build:mcp` | MCP stdio binary for Cursor/Claude Desktop |
| `pnpm scout` | CLI for Scout/Research pipeline |
| `pnpm extract` | Run entity extraction |

## MCP Integration Modes (IMPORTANT)

⚠️ **Two different MCP modes exist!**

| Mode | Entry Point | Protocol | When to Use |
|------|-------------|----------|-------------|
| `prism-dev` | `pnpm dev` → `:3006/mcp` | HTTP Streamable | Development, live reload |
| `prism-mcp` | `~/.magpie/prism-mcp` binary | stdio JSON-RPC | Production, Cursor/Claude |

### Code Update Workflow

After modifying MCP tool code:

```bash
# For prism-dev (HTTP mode) - restart server:
lsof -ti:3006 | xargs kill -9 && pnpm dev

# For prism-mcp (binary mode) - rebuild binary:
pnpm build:mcp
cp prism-mcp-bin ~/.magpie/prism-mcp
# Then reload Cursor window (Cmd+Shift+P > "Reload Window")
```

### Cursor MCP Config (~/.cursor/mcp.json)

```json
{
  "mcpServers": {
    "prism-dev": {
      "type": "http",
      "url": "http://127.0.0.1:3006/mcp"
    }
  }
}
```

**Common Mistake**: Editing code but forgetting to restart `prism-dev` or rebuild `prism-mcp` binary.

## Database Locations (IMPORTANT)

⚠️ **Different modes use different databases!**

| Mode | Database Location | When Used |
|------|-------------------|-----------|
| `pnpm dev` (Backend only) | `apps/prism-server/prism.db` | Pure backend development |
| Tauri Desktop App | `~/Library/Application Support/com.magpie.desktop/prism.db` | Tauri app (dev or release) |

**Common Mistake**: Looking at `apps/prism-server/prism.db` when debugging Tauri app issues.

**Quick Check**:
```bash
# For Tauri app data:
sqlite3 ~/Library/Application\ Support/com.magpie.desktop/prism.db "SELECT * FROM user_memories ORDER BY ingested_at DESC LIMIT 5;"

# For backend dev data:
sqlite3 apps/prism-server/prism.db "SELECT * FROM user_memories ORDER BY ingested_at DESC LIMIT 5;"
```

## Architecture Constraints

1.  **Single Source of Truth (SSOT)**:
    -   `prism.db` (SQLite) is the only source of truth.
    -   Do not cache state in memory variables outside of request scope.

2.  **ID Convention**:
    -   All Entity IDs MUST follow: `type:snake_case_name`.
    -   Example: `person:simon_willison`, `project:magpie_mvp`.
    -   Forbidden: `simon`, `Simon`, `random-uuid-123` (unless `scout:` or `memory:`).

3.  **Atomic Graph Operations**:
    -   Entities, Relations, and Page Blocks are interconnected.
    -   Any operation that modifies one MUST consider the others.
    -   Use `db.transaction()` for all multi-table updates.

4.  **Directory Structure Convention**:

    ```
    src/
    ├── systems/           # Top-level orchestration (System classes)
    │   ├── ScoutSystem.ts    - Gravity-based scouting scheduler
    │   ├── RippleSystem.ts   - Event-driven knowledge propagation
    │   └── PhysicsSystem.ts  - Entity gravity/mass computation
    │
    ├── lib/               # Core logic modules (Agent classes + helpers)
    │   ├── scout/            - Scout execution logic (agent.ts)
    │   ├── ripple/           - Ripple execution logic (agent.ts, types.ts)
    │   ├── deep-explorer/    - Deep exploration strategies
    │   ├── graph-link/       - Graph middleware atoms
    │   └── ...               - Other shared utilities
    │
    ├── mcp/               # MCP tool definitions
    └── migrations/        # Database migrations
    ```

    **Rule**: `*System` classes belong in `src/systems/`. Execution logic (`*Agent`) stays in `src/lib/`.

## Data Hygiene & Depollution

1.  **No Test Pollution**:
    -   Never hardcode test data in production code paths.
    -   Use `source_type='test'` for ephemeral data.

2.  **Document Safety**:
    -   When ingesting documentation, verify it does not contain "live" examples that will pollute the graph.
    -   Follow `DOCUMENTATION-GUIDE.md`.

## Workflow: Adding New Intelligence

When adding a new feature (e.g., "Sentiment Analysis"):
1.  **Schema**: Create a Migration (`src/migrations/`).
2.  **Logic**: Implement in `src/lib/`.
3.  **Expose**: Add route in `src/app.ts`.
4.  **Verify**: Run `npm run extract` to test impact on existing graph.

## Workflow: Adding New Worker/Agent

When adding a new background worker (like Scout, Gardener, Ripple):

1.  **Read**: [Worker Checklist](docs/WORKER-CHECKLIST.md) first!
2.  **Logging**: Use `AgentLogger.start()` for operation tracking
3.  **Errors**: Always persist errors via `handle.error()`
4.  **Pipeline**: If ingesting content, ensure extraction follows
5.  **Config**: Support `DB_PATH` and other env vars
6.  **Test**: Add integration test for the full pipeline

### Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| `logger.log is not a function` | Use `AgentLogger.start().success()/error()` or `import { log } from '../logger.js'` |
| Extraction not triggered after ingest | Always call `extractEntities({ memoryIds: [id] })` after `ingestFinding()` |
| CLI ignoring parameters | Explicitly parse all `--param=value` args in `runXxx(args)` |
| Wrong database in CLI | Support `DB_PATH` env var: `process.env.DB_PATH \|\| defaultPath` |
| MCP tool changes not taking effect | Restart `prism-dev` or rebuild `prism-mcp` binary |

### Field Naming SSOT

| Purpose | Use This | ❌ Don't Use |
|---------|----------|--------------|
| Memory link | `memo_id` | `source_memo_id`, `source_memory_id` |
| Entity reference | `entity_id` | `entityId`, `eid` |
| Timestamps | `created_at` | `createdAt`, `timestamp` |
