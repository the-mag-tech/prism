# AGENTS.md — Prism

## What is Prism

Knowledge Graph Engine: ingest Markdown/HTML/PDF → extract entities →
store in SQLite graph → full-text search + semantic retrieval.

Originally extracted from Fulmail monorepo (`apps/prism-server/`).
Now an independent monorepo serving as infrastructure for Skillet and other consumers.

## Mandatory Rules

1. **ADR governance**: Every architectural decision in `doc/adr/`.
2. **Auto-generated indexes**: Never hand-edit between `<!-- INDEX:START/END -->` markers.
3. **TDD**: Write failing tests first, then implement, then refactor.
4. **DRY**: Single authoritative representation for every piece of knowledge.
5. **Separation of concerns**: Prism is a pure engine. Business logic belongs in consumers.

## Monorepo Structure

```
prism/
├── apps/server/          # @prism/server — Fastify HTTP + MCP stdio
├── packages/contract/    # @prism/contract — Shared types and schemas
├── packages/client/      # @prism/client — HTTP/local client abstraction
├── doc/adr/              # Architecture Decision Records
├── doc/pitfall/          # Known issues
└── scripts/              # Tooling
```

## Key Systems

| System | Location | Purpose |
|--------|----------|---------|
| **Scout** | `apps/server/src/systems/ScoutSystem.ts` | Web search + skill discovery |
| **Ripple** | `apps/server/src/systems/RippleSystem.ts` | Related entity expansion |
| **Physics/Gravity** | `apps/server/src/systems/PhysicsSystem.ts` | Entity importance ranking |
| **Extraction** | `apps/server/src/extract.ts` | LLM entity extraction from documents |
| **Graph** | `apps/server/src/lib/` | Core graph read/write operations |
| **Migrations** | `apps/server/src/migrations/` | 48 SQLite migrations (v1–v52) |

## Database

- Runtime: `better-sqlite3` (bun:sqlite compatible)
- Dev DB: `apps/server/prism.db` (git-ignored)
- Migrations: sequential, all carried from Fulmail (zero compression)

## Bidirectional Contract with SkillRank

Prism participates in a feedback loop with SkillRank:
- **Output**: `GET /graph/hub-signals?hubId=X` — semantic density, citation graph
- **Input**: `POST /ingest { priorWeight, priorSource }` — hub quality as prior weight
- V1: store without using. V2: integrate into entity ranking.

@see [Skillet ADR-002](https://github.com/ERerGB/skillet/blob/main/doc/adr/002-bidirectional-feedback-contract.md)

## Build & Dev

```bash
pnpm install
pnpm dev                  # Start server (port 3006)
pnpm test                 # Run all tests
pnpm build                # TypeScript build
pnpm gen:index            # Regenerate doc indexes
```
