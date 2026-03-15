# Prism

Knowledge Graph Engine — ingest, extract, store, search.

## What it does

```
Markdown / HTML / PDF
        │
        ▼
   ┌─────────┐     ┌───────────┐     ┌──────────┐
   │ Ingest  │────▶│ Extract   │────▶│  Graph   │
   │ (parse) │     │ (LLM/NLP) │     │ (SQLite) │
   └─────────┘     └───────────┘     └──────────┘
                                          │
                                     ┌────┴────┐
                                     │ Search  │
                                     │ (FTS5)  │
                                     └─────────┘
```

Prism ingests documents, extracts entities and relations via LLM,
stores them in a SQLite graph, and provides full-text + semantic search.

## Packages

| Package | Description |
|---------|-------------|
| `@prism/server` | Fastify HTTP server + MCP stdio binary |
| `@prism/contract` | Shared TypeScript types and schemas |
| `@prism/client` | HTTP and local client abstraction |

## Agent Systems

| Agent | Purpose |
|-------|---------|
| **Scout** | Discover and ingest skills from external hubs |
| **Ripple** | Expand related entities from seed nodes |
| **Curator** | Quality assessment and content curation |
| **Physics** | Entity importance ranking (Gravity algorithm) |
| **Extraction** | LLM-powered entity extraction from documents |
| **Explorer** | Graph traversal and discovery |

## Quick Start

```bash
pnpm install
pnpm dev        # HTTP server on port 3006
pnpm test       # Run tests
```

## Documentation

- [AGENTS.md](AGENTS.md) — Mandatory rules
- [Architecture](apps/server/docs/ARCHITECTURE.md)
- [ADRs](doc/adr/) — Architectural decisions

## Origin

Extracted from the [Fulmail](https://github.com/ERerGB/fulmail) monorepo
(`apps/prism-server/`, `packages/prism-contract/`, `packages/prism-client/`).
See `doc/adr/` for extraction rationale.

## License

MIT
