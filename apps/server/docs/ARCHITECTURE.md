# Prism Server Architecture: The Graph Link Middleware

> **Version**: 3.1 (Entity Lifecycle Hooks)
> **Date**: 2026-01-08
> **Evolution**: V1 (MVP) -> V2 (ECS Physics) -> V3 (Unified Middleware) -> V3.1 (Entity Lifecycle Hooks)

---

## 1. High-Level Overview

Prism has evolved from a disparate collection of scripts into a unified **Local-First Knowledge Graph System**.
The architecture is defined by the **Graph Link Layer**, a middleware that standardizes all interactions with the underlying graph.

### The "Sandwich" Model

```mermaid
graph TD
    CLI[Unified CLI] -->|Command| Logic
    API[REST API] -->|Request| Logic
    
    subgraph "Logic Layer (The Brains)"
        DeepExp[Deep Explorer (Recall)]
        Scout[Scout System (Origin)]
        Gardener[Gardener (Maintenance)]
        Ripple[Ripple System (Propagation)]
    end

    subgraph "Graph Link Layer (The Spine)"
        Reader[Graph Reader]
        Writer[Graph Writer]
        Atoms[Cognitive Atoms]
        Hooks[Entity Lifecycle Hooks]
    end

    subgraph "Storage Layer (The Memory)"
        DB[(SQLite Prism DB)]
    end

    Logic -->|Read| Reader
    Logic -->|Write| Writer
    Writer -->|Trigger| Atoms
    Writer -->|afterEntityCreate| Hooks
    Hooks -->|Notify| Scout
    Hooks -->|Notify| Ripple
    Reader -->|Query| DB
    Writer -->|Persist| DB
```

### Entity Lifecycle Hooks (v3.1)

In v3.1, we introduced **Entity Lifecycle Hooks** to replace event-driven ripple/scout triggers.
This follows the **Passive Sensing** pattern: systems react to data changes rather than polling.

```
GraphWriter.addEntityFromSource()
    ↓ (after commit)
entityHooks.triggerEntityCreate(ctx)
    ↓ (parallel, non-blocking)
    ├── ScoutSystem.onEntityCreated() → enqueue scout task
    └── RippleSystem.onEntityCreated() → semantic propagation
```

**Benefits**:
- **Decoupled**: Writer doesn't know about Scout/Ripple internals
- **Parallel**: Scout and Ripple run concurrently
- **Decay Control**: Propagation depth/gravity thresholds prevent infinite loops

---

## 1.5 Data Access Layer: Current Status & Technical Debt

> **Status**: ⚠️ Technical Debt  
> **Updated**: 2026-01-08

### 1.5.1 Current Reality

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Data Access Layer - Current State                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Entry Layer (API / MCP / CLI)                      │   │
│  │  app.ts    mcp/tools/*    cli/*.ts                                   │   │
│  └────────┬───────────────────┬───────────────────┬─────────────────────┘   │
│           │                   │                   │                          │
│           │    ❌ Direct SQL  │    ❌ Direct SQL  │                          │
│           ▼                   ▼                   ▼                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Business Logic (Services)                          │   │
│  │  recall.ts    recommend.ts    ingest.ts    extract.ts    pages.ts    │   │
│  └───────┬────────────────┬───────────────┬────────────────┬────────────┘   │
│          │                │               │                │                 │
│          │  ❌ Direct SQL │ ❌ Direct SQL │  ✅ GraphLink  │                 │
│          ▼                ▼               ▼                ▼                 │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Systems (Scout / Ripple / Physics)                 │   │
│  └───────┬────────────────┬───────────────┬─────────────────────────────┘   │
│          │                │               │                                  │
│          │  ✅ GraphLink  │ ✅ GraphLink  │                                  │
│          ▼                ▼               ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │              Graph Link Layer (GraphReader / GraphWriter)             │   │
│  │                    ⭐ The INTENDED abstraction layer                  │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                            │
│                                 ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │              db.ts (getDB() → bun:sqlite)                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.5.2 Statistics (2026-01-08)

| Metric | Count | Percentage |
|--------|-------|------------|
| Direct `getDB()` / `db.query` calls | 877 | 94.3% |
| Via `graphReader` / `graphWriter` | 50 | 5.7% |
| Total DB access points | 927 | 100% |

**Files with most direct SQL:**
- `app.ts` (30 calls) - REST API endpoints
- `extract.ts` (21 calls) - Entity extraction
- `lib/source-manager.ts` (35 calls) - Source layer
- `lib/graph-link/writer.ts` (49 calls) - Expected (internal)

### 1.5.3 Consequences

1. **Schema changes are painful**: Changing `memories` → `user_memories` required editing 100+ locations
2. **Testing is hard**: Business logic mixed with SQL makes mocking difficult
3. **Inconsistent behavior**: Same query implemented differently in multiple places

### 1.5.4 Migration Strategy

**Phase 1 (Done)**: Fix critical paths
- ✅ `recall.ts` - Uses `recall()` function (encapsulated)
- ⚠️ `recommend.ts` - Direct SQL, needs refactor
- ✅ `mcp/tools/get-context.ts` - Refactored to use GraphReader
- ✅ `mcp/tools/gravity-top.ts` - Refactored to use GraphReader

**Phase 2 (Done)**: Expand GraphReader
- ✅ `getRelatedEntities(entityId, limit)` - Returns related entities with relation types
- ✅ `getTopByGravity(limit, entityType)` - Returns top entities by gravity
- ✅ `searchMemories(query, limit)` - FTS search with LIKE fallback

**Phase 3 (Next)**: Refactor REST API endpoints
- `app.ts` has 30 direct SQL calls, needs migration to GraphReader

**Phase 4 (Future)**: Enforce boundaries
- Lint rule: No `getDB()` outside `lib/graph-link/`
- All new code must use GraphReader/Writer

### 1.5.5 Magpie → Prism REST API Analysis

Magpie frontend calls these REST API endpoints (from `lib/api.ts` and `lib/data-layer.ts`):

| Endpoint | Magpie Caller | `app.ts` Implementation | Status |
|----------|---------------|------------------------|--------|
| `GET /pages` | `data-layer.ts` | `listPagesFromDB()` | ✅ Encapsulated |
| `GET /pages/:id` | `data-layer.ts` | `getPageFromDB()` | ✅ Encapsulated |
| `GET /entities/search` | `api.ts`, `page-builder.ts` | ❌ Direct SQL (2 queries) | ⚠️ Needs refactor |
| `POST /entities/:id/gravity` | `api.ts` | ❌ Direct SQL (3 queries) | ⚠️ Needs refactor |
| `POST /ask` | `api.ts` | `askPipeline()` → `recall()` | ✅ Encapsulated |
| `POST /api/scout/profile` | `api.ts` | `scoutAgent.profile()` | ✅ Encapsulated |
| `POST /api/explore` | `api.ts` | `deepExplorer.exploreAuto()` | ✅ Encapsulated |
| `GET /config/entity-semantics` | `entity-semantics-api.ts` | ❌ Direct SQL | ⚠️ Needs refactor |
| `POST /api/config/keys` | `data-layer.ts` | File I/O (no SQL) | ✅ N/A |
| `GET /scout/enabled` | `data-layer.ts` | `getFlags()` | ✅ Encapsulated |
| `GET /scout/quota` | `data-layer.ts` | ❌ Direct SQL | ⚠️ Needs refactor |
| `POST /scout/quota` | `data-layer.ts` | ❌ Direct SQL | ⚠️ Needs refactor |
| `GET /api/field/snapshot` | `GodModeScene.tsx` | ❌ Direct SQL (debug only) | 🔧 Low priority |

**Summary**: 7/12 Magpie-called endpoints are encapsulated, 5 need refactoring.

---

## 2. Layers Detail

### 2.1 L0: Storage Layer (SQLite)
The foundation. A local set of relational tables representing the Knowledge Graph.
- **Entities**: The nodes (`entities`, `entity_profiles`).
- **Relations**: The edges (`relations`, `entity_similarities`).
- **Memories**: The raw content (`memories`).
- **Physics**: Simulation state (`entity_physics_state`).

### 2.2 L1: Graph Link Layer (Middleware)
The unified interface. No business logic touches the DB directly anymore.
- **GraphReader**: Standardized retrieval. (`resolveEntity`, `enrichContext`, `getRelations`).
- **GraphWriter**: Standardized ingestion with hook triggers. (`ingestFinding`, `addEntityFromSource`).
- **Entity Lifecycle Hooks** (v3.1): Observer pattern for entity state changes.
    - *afterEntityCreate*: Triggers Scout and Ripple in parallel.
    - *afterEntityUpdate*: Reserved for re-scout on significant changes.
    - *afterRelationCreate*: Reserved for relation-triggered propagation.
- **Cognitive Atoms**: Middleware running inside the Writer.
    - *IronyAtom*: Detects irony in ingested content.
    - *SerendipityAtom*: Detects "Cognitive Loops".

### 2.3 L2: Logic Layer (The Engines)
The intelligent agents that use L1.

#### A. Deep Explorer (The Active Brain / Recall)
*Originally "Recall Architecture"*
- **Role**: Intent-driven deep research.
- **Flow**: User Query -> Intent Extraction -> Graph Enrichment -> Multi-strategy Search -> Synthesis.
- **Key Capability**: Bi-directional interaction (Reads KG for context, Writes findings back).

#### B. Scout System (The Passive Brain / Origin)
*Originally "Origin Algorithm"*
- **Role**: Autonomous discovery & "Wake Up" signal.
- **Flow**: Physics System (Gravity) -> LOD Scheduler -> Scout Agent -> Graph Link.
- **Feature**: Multi-Anchor Parallel Scouting (`--multi`).

#### C. Gardener (The Immune System)
- **Role**: Data quality and deduplication.
- **Flow**: Embedding Scan -> Trust Metrics -> Layered Decision (Safe/LLM/Human).
- **Key Capability**: "Trust Metrics" (Adaptive confidence thresholds).

### 2.4 L3: Interface Layer
Unified access points.
- **CLI**: `prism explore`, `prism ingest`, `prism garden`.
- **API**: MCP Server endpoints & REST API for frontend (Magpie).

---

## 3. Key Architectural Decisions

### 3.1 Local-First Graph
We use SQLite (`bun:sqlite`) not just as a store, but as a graph engine.
- **Why?** Privacy (email data), Offline capability, Speed.
- **Graph Link**: Abstracts the SQL complexity into semantic Graph operations.

### 3.2 Cognitive Middleware ("Atoms")
Instead of building monolithic "Analysers", we implement analysis as **Middleware** in the write pipeline.
- data -> `ingest` -> `[IronyAtom]` -> `[ConflictAtom]` -> DB.
- This ensures every piece of data entering the graph is automatically "dyed" with cognitive attributes.

### 3.3 Physics-Driven Scheduling (LOD)
Scout doesn't run on a loop; it runs on **Gravity**.
- High Gravity entities (Anchors) get frequent updates.
- Low Gravity entities (Sparks) get rare updates.
- This optimizes API costs and system resources.

---

## 4. Directory Structure

```
apps/prism-server/src/
├── lib/
│   ├── graph-link/        # L1: Middleware (Reader, Writer, Atoms, Hooks)
│   │   ├── reader.ts         # Graph query interface
│   │   ├── writer.ts         # Graph mutation interface (triggers hooks)
│   │   ├── hooks.ts          # Entity Lifecycle Hooks (v3.1)
│   │   └── atoms/            # Cognitive middleware
│   ├── queue/             # L1.5: Durable Task Queue (liteque-based)
│   │   ├── index.ts          # Queue initialization & recovery
│   │   ├── types.ts          # Zod schemas for task payloads
│   │   └── workers.ts        # Worker handlers (extraction, scout, ripple)
│   ├── agents/            # L2: Intelligence Agents
│   │   ├── ripple/           # Hook-driven knowledge propagation (v3.1)
│   │   ├── scout/            # External discovery
│   │   ├── explorer/         # Deep research
│   │   └── curator/          # Graph hygiene (deduplication)
│   └── deep-explorer/     # L2: Deep Research Engine (legacy path)
├── systems/               # ECS Logic
│   ├── PhysicsSystem.ts      # Gravity calculation
│   ├── ScoutSystem.ts        # LOD scheduler + Hook subscriber (v3.1)
│   └── RippleSystem.ts       # Propagation orchestrator + Hook subscriber (v3.1)
├── cli/                   # L3: Unified CLI
├── mcp/                   # L3: MCP Server
└── db.ts                  # L0: Database Connection
```

### Agent Logging
All agents persist logs to the `agent_logs` table via `AgentLogger`:

```sql
SELECT agent, action, status, COUNT(*) as count 
FROM agent_logs GROUP BY agent, action, status;
```

---

## 5. Future Roadmap (Beyond V3)

> See `EXPLORATION-SYSTEM-ROADMAP.md` for the completed V3 journey.

1.  **Ecosystem Distribution**: Sharing anonymized "Pattern Data" (L1/L2 data) without sharing raw content (L0).
2.  **God Mode Visualizer**: Visualizing the Physics Field in real-time.
3.  **The Fourth Atom**: Using Adversarial Exploration to discover missing cognitive primitives.


> **Version**: 2.0 (The ECS Shift)
> **Date**: 2025-12-08
> **Philosophy**: We are building a **Simulation**, not a Database.

---

## 1. Top-Down View: Reimagined Recommendation System

Prism is not just a "Knowledge Graph". It is a local-first, agent-powered Recommendation System that inverts the traditional cloud model.

| Component | Traditional RecSys | Prism Architecture |
| :--- | :--- | :--- |
| **Recall Tower** | Collaborative Filtering (Database) | **Agentic Recall** (Tavily/LLM) - Open World |
| **Ranking Tower** | Deep Learning (Black Box) | **Physics Engine** (Gravity) - Transparent & Local |
| **Objective** | Engagement (Click-Through) | **Awareness** (Serendipity & Insight) |

### The Flow
1.  **Open-World Recall**: User Intent (Lens) or Entity Context triggers `ScoutSystem` to fetch fresh data from the web (Tavily).
2.  **Physics Ranking**: `PhysicsSystem` simulates the "Gravity" of entities based on Time, Path, and Spark.
3.  **LOD Rendering**: `RenderSystem` maps Gravity to Visual Weight (Anchor/Spark) for the frontend.

---

## 2. Core Pattern: Entity-Component-System (ECS)

We reject the monolithic "Entity" class. Data is decoupled into components to ensure **TOSS (Single Source of Truth)** and high-performance simulation.

### 2.1 The Components (Data)

| Component | Storage | Role | Example Data |
| :--- | :--- | :--- | :--- |
| **Profile** | `entity_profiles` (SQLite) | **The Truth**. Immutable identity. | `title`, `bio`, `type` |
| **Topology** | `relations` (SQLite) | **The Graph**. Structural links. | `source`, `target` |
| **Physics** | `entity_physics_state` (SQLite) | **The Sim**. Dynamic properties. | `mass`, `temperature`, `velocity` |
| **Render** | `render_frame_buffer` (SQLite) | **The View**. Per-frame snapshot. | `visual_weight` ('HEAVY') |

### 2.2 The Systems (Logic)

Systems run in a Loop/Pipeline. They are stateless function pipelines.

| System | Location | Status | Role |
| :--- | :--- | :--- | :--- |
| `ScoutSystem` | Prism | ✅ Active | LOD-based patrol scheduling |
| `PhysicsSystem` | Prism | ✅ Active | **Single Source of Truth** for Gravity calculation |
| `RenderSystem` | **Magpie** | 📍 Frontend | Layout & visual mapping (not in Prism) |

#### 1. `ScoutSystem` (Recall) — Prism Server
*   Monitors `Physics.Temperature` and `Profile.last_scouted_at`.
*   Triggers external search to "Wake Up" dormant entities.
*   **LOD Policy**: G>0.8 → 10min, G>0.5 → 6h, G>0.1 → 24h.

#### 2. `PhysicsSystem` (Simulation) — Prism Server
*   **Single Source of Truth** for all Gravity calculations.
*   Input: `Profile` + `Topology`.
*   Process: Applies forces (Convergence, Path, Spark).
*   Output: Returns entities with `gravity_score`.
*   **API**: 
    *   `calculateEntityGravity(entity, context)` - Static function for on-demand calculation
    *   `PhysicsSystem.tick(context)` - Batch simulation tick
    *   `POST /api/field/tick` - HTTP endpoint to trigger tick

#### 3. `RenderSystem` (Presentation) — **Magpie (Frontend)**

> ⚠️ **Architecture Decision**: RenderSystem belongs to Magpie, not Prism.

*   **Why Frontend?** Layout is a visual concern requiring:
    *   Responsive design (screen size adaptation)
    *   Smooth animations
    *   Local viewport culling
*   **Prism's Role**: Only provides `gravity_score`.
*   **Magpie's Role**: Maps gravity → visual_weight → Block Size → CSS Grid.

```
Prism API Output:        Magpie RenderSystem:
{ gravity: 0.92 }   →    { size: 'ANCHOR', cols: 2, rows: 2 }
{ gravity: 0.65 }   →    { size: 'BANNER', cols: 2, rows: 1 }
{ gravity: 0.30 }   →    { size: 'SPARK',  cols: 1, rows: 1 }
```

> *Gravity is physics; Layout is rendering. Physics engine in backend, render engine in frontend.*

---

## 3. The "Sleep/Wake" Mechanism (Optimization)

To handle thousands of entities without simulating the whole universe every frame, we use a **Sleep/Wake** mechanism inspired by Game Engines.

### 3.1 The "Active Set"
The Physics Engine ONLY simulates entities that are **Awake**.

*   **Awake**: High `Temperature` (recently visited) OR High `Mass` (Anchor) OR `New` (Fresh Scout).
*   **Asleep**: Low Mass + Low Temperature.

### 3.2 Wake Triggers (Dirty Flags)
An entity is "Woken Up" (added to Active Set) by:
1.  **Scout Wake**: New information found (Spark).
2.  **Interaction Wake**: User clicks/hovers (Path).
3.  **Ripple Wake**: A neighbor is woken up (Propagation).

---

## 4. Data Consistency (TOSS)

*   **Write Separation**:
    *   User/Scout writes to **Profile** (Truth).
    *   Physics Engine writes to **Physics/Render** (Derived).
    *   *Never write calculated Gravity back to the Profile table.*
*   **Derived State**:
    *   Gravity is transient. If the server restarts, Gravity is re-calculated from Truth.

---

## 5. Directory Structure

```
apps/prism-server/src/
├── systems/           # The Logic Engines
│   ├── PhysicsSystem.ts  # Single Source of Truth for Gravity
│   └── ScoutSystem.ts    # LOD-based patrol scheduling
├── migrations/        # Schema Versioning
├── lib/               # Shared Utilities (LLM, DB)
└── app.ts             # API Entry Point (The Loop)
```

> **Note**: `RenderSystem` is implemented in Magpie (frontend), not Prism.

---

## 6. Phase 4 Vision: God Mode Visualizer (The "Little Tail")

To truly debug and understand this physics simulation, we need to **see** it.
Phase 4 introduces a dedicated **Visualizer Tool** (God Mode).

### 6.1 The "Field View" (UI)
A real-time, force-directed graph rendering of the `PhysicsSystem` state.

*   **Tech Stack**: `react-force-graph` + `simpleheat` (Canvas Overlay).
*   **Visual Semantics**:
    *   **Node Size**: Proportional to `Physics.Mass`.
    *   **Node Color**: `Entity.Type`.
    *   **Heatmap Background**: Represents the `Gravity Field` potential.
    *   **Pulse Animation**: Indicates `ScoutSystem` activity (Waking Up).

### 6.2 Interactive Debugging ("God Tools")
*   **Poke**: Manually "Wake Up" an entity (Interaction Wake).
*   **Gravity Well**: Drag an entity to see how it distorts the field.
*   **Time Travel**: Replay the `render_frame_buffer` history to see how a "Spark" evolved into an "Anchor".

> *The God Mode is not just a debugger; it is the first step towards a fully spatial interface for personal knowledge.*
