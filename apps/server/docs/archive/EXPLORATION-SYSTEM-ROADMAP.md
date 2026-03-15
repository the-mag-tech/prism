# Prism Exploration System v2 - Roadmap

> **Date**: 2025-12-11
> **Status**: **COMPLETED** (2025-12-14)
> **Outcome**: Fully implemented in Architecture V3 (Graph Link Middleware). See `ARCHITECTURE.md`.
> **Origin**: Discussion on Scout/Deep Explorer/Gardener architecture unification.

---

## 🧭 0. Strategic Context

### Why This Matters

This roadmap is not just about code refactoring. It reflects a **strategic positioning** that differentiates Prism from cloud-first AI agents like Manus.

### Core Philosophy: Local-First KG

| Dimension | Manus (Cloud-First) | Prism (Local-First) |
|-----------|---------------------|---------------------|
| **KG Location** | ☁️ Cloud | 📱 Local (SQLite) |
| **Privacy Model** | Data leaves device | Data never leaves |
| **Offline Capability** | ❌ | ✅ |
| **Data Ownership** | Platform | **User** |
| **Trust Model** | Trust the platform | Trust the math |

**Strategic Insight**: For email (one of the most private data sources), local-first is not a technical choice — it's a **trust promise**.

### Academic Validation

Our architecture independently converged with cutting-edge research:

| Our Implementation | Academic Paper | Year |
|-------------------|----------------|------|
| Scout (Anchor + KG alignment) | **AnchorRAG** | 2024 |
| Gardener (layered deduplication) | **LLM-Align** (heuristic + LLM voting) | 2024 |
| Trust Metrics (adaptive threshold) | **DEG-RAG** (denoising KG) | 2025 |

This is validation, not redundancy. **We built it before we read about it.**

### 2025 Trends Alignment

| Trend | Our Response |
|-------|--------------|
| **Agentic AI** | Scout/Explorer/Gardener as autonomous agents |
| **In-Context Clustering** | Gardener's LLM-based diagnosis |
| **Multi-Agent RAG** | Graph Link Layer as shared substrate |
| **Edge Computing for KG** | Local SQLite, offline-first |

---

## 🎯 Executive Summary

Unify `Scout`, `Deep Explorer`, and `Gardener` around a shared **Graph Link Layer**, enabling:
- Bidirectional KG integration for all exploration agents
- Progressive automation with trust metrics
- Composable exploration strategies
- **Future**: Ecosystem distribution (端侧计算 → 生态分发)

---

## 📊 Current State Analysis

| Module | KG Read | KG Write | Strategy | Automation |
|--------|---------|----------|----------|------------|
| **Scout** | ✅ resolveEntities | ✅ saveToMemory | Single (Anchor+Profile) | N/A |
| **Deep Explorer** | ❌ | ❌ | Multi (Irony, Composite) | N/A |
| **Serendipity** | ❌ (Raw SQL) | ❌ (Raw SQL) | Detects Irony/Loop | N/A |
| **Gardener** | ✅ (dedup scan) | ✅ (merge) | N/A | V1 Conservative |

**Gap**: Deep Explorer lacks KG integration; Scout lacks multi-strategy; Gardener automation is conservative.

---

## 🏗️ Target Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Knowledge Graph (Core)                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │  entities   │ │  relations  │ │  memories   │ │public_content│   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                 ↑↓
┌─────────────────────────────────────────────────────────────────────┐
│                    Graph Link Layer (Middleware)                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐ │
│  │   GraphReader    │  │   GraphWriter    │  │  Cognitive Atoms  │ │
│  │ - resolveEntity  │  │ - ingestFinding  │─▶│ - Serendipity     │ │
│  │ - enrichContext  │  │ - upsertEntity   │  │ - ConflictCheck   │ │
│  │ - getRelations   │  │ - addLoopEdge    │  │ - NoveltyCheck    │ │
│  └──────────────────┘  └──────────────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                 ↑↓                           
┌───────────────────┐     ┌───────────────────┐
│ ScoutSystem (LOD) │────▶│ Exploration Agents│
│ ("The Dreamer")   │     │ (Scout/DeepExp)   │
└───────────────────┘     └───────────────────┘
```

---

## 📅 Implementation Phases

### Phase 1: Graph Link Extraction (1-2 days)

**Goal**: Extract common KG operations into a shared layer.

#### Tasks

- [ ] **1.1** Create `src/lib/graph-link/reader.ts`
  - Extract `resolveEntity()` from `scout/agent.ts`
  - Extract `enrichContext()` from `scout/agent.ts`
  - Add `getRelations(entityId, depth)` for multi-hop exploration
  - Add `getRelatedEntities(topic, limit)` for topic-based lookup

- [ ] **1.2** Create `src/lib/graph-link/writer.ts`
  - Extract `ingestFinding()` from `scout/research/recursive.ts`
  - Add `upsertEntity()` wrapper
  - Extract `recordMergeCandidate()` from `gardener/deduplicator.ts`

- [ ] **1.3** Create `src/lib/graph-link/index.ts`
  - Export unified interface

- [ ] **1.4** Refactor Scout to use Graph Link
  - Replace direct DB calls with GraphReader/GraphWriter

#### Acceptance Criteria

```typescript
// Before
const row = db.query(`SELECT * FROM entities WHERE lower(title) = lower(?)`).get(name);

// After
const entity = graphReader.resolveEntity(name);
```

---

### Phase 2: Deep Explorer Integration (1 day)

**Goal**: Give Deep Explorer bidirectional KG access.

#### Tasks

- [ ] **2.1** Inject GraphReader into `deep-explorer/engine.ts`

- [ ] **2.2** Enhance Intent Extraction
  ```typescript
  // In extractIntent()
  const relatedEntities = this.graphReader.getRelatedEntities(topic, 5);
  const enrichedIntent = {
    ...intent,
    priorKnowledge: relatedEntities.map(e => e.title),
  };
  ```

- [ ] **2.3** Add optional ingest capability
  ```typescript
  interface ExploreOptions {
    // ... existing
    ingest?: boolean;  // NEW: Write high-quality findings to KG
    ingestThreshold?: number;  // Default: 0.8
  }
  ```

- [ ] **2.4** Implement ingest in explore()
  ```typescript
  if (options.ingest) {
    for (const finding of findings.filter(f => f.score > threshold)) {
      this.graphWriter.ingestFinding(finding, 'deep-explorer');
    }
  }
  ```

#### Acceptance Criteria

- Deep Explorer can enrich intent with existing KG entities
- High-quality findings can be written back to `public_content`

---

### Phase 3: Gardener Layered Automation (2-3 days)

**Goal**: Restore LLM-assisted automation with safety layers.

#### Tasks

- [ ] **3.1** Create `src/lib/gardener/trust-metrics.ts`
  ```typescript
  export class TrustMetrics {
    recordSuccess(pair: SimilarityPair, method: 'auto_high_conf' | 'auto_llm'): void;
    recordUndo(historyId: number): void;
    getRecentAccuracy(days?: number): number;
    getAdaptiveThreshold(): number;  // Dynamic based on recent accuracy
  }
  ```

- [ ] **3.2** Restore `diagnose()` in `agent.ts`
  - Bring back LLM-based merge diagnosis from initial commit (c7dc86d)
  - Add source domain context to prompt
  - Return `'MERGE' | 'KEEP' | 'UNCERTAIN'`

- [ ] **3.3** Implement layered decision logic
  ```typescript
  async run(): Promise<GardenerReport> {
    const candidates = await this.deduplicator.findAndRecordCandidates(0.90);
    
    for (const pair of candidates) {
      // Layer 1: Cross-source → Human only
      if (pair.sourceDomainA !== pair.sourceDomainB) {
        continue;
      }
      
      // Layer 2: High confidence + Same source → Auto merge
      if (pair.similarity >= 0.98) {
        await this.merger.merge(pair.entityA, pair.entityB, 'auto_high_conf');
        this.trustMetrics.recordSuccess(pair, 'auto_high_conf');
        continue;
      }
      
      // Layer 3: Medium confidence + Same source → LLM assist
      if (pair.similarity >= this.trustMetrics.getAdaptiveThreshold()) {
        const diagnosis = await this.diagnose(pair);
        if (diagnosis === 'MERGE') {
          await this.merger.merge(pair.entityA, pair.entityB, 'auto_llm');
          this.trustMetrics.recordSuccess(pair, 'auto_llm');
        } else if (diagnosis === 'KEEP') {
          this.deduplicator.rejectCandidate(pair.entityA, pair.entityB, 'LLM: KEEP');
        }
        // UNCERTAIN → Leave for human
      }
    }
  }
  ```

- [ ] **3.4** Add API endpoint for metrics
  - `GET /gardener/metrics` → Trust metrics dashboard data

- [ ] **3.5** Update merge_candidates table
  - Add `decided_by: 'user' | 'auto_high_conf' | 'auto_llm'` column

#### Acceptance Criteria

- Memory duplicates (exact hash) auto-merge (existing)
- Entity duplicates: Cross-source → Human only
- Entity duplicates: ≥0.98 similarity + same source → Auto merge
- Entity duplicates: ≥adaptive threshold + same source → LLM decides
- All auto-merges recorded in trust metrics
- Undo increments "failed" count, adjusts threshold

---

### Phase 4: Scout Enhancements (Optional, 2 days)

**Goal**: Expand Scout capabilities for multi-anchor and relation exploration.

#### Tasks

- [ ] **4.1** Multi-anchor parallel exploration
  ```typescript
  async scoutMultiple(entities: ScoutEntity[]): Promise<GroundedResult[]>### Phase 5: Serendipity as Cognitive Middleware (Atomic Integration, 2-3 days)

**Goal**: Embed Serendipity as an **atomic capability** within the Graph Link Layer, serving as the foundational infrastructure for all future "Unknown Zone" features.

#### Concept: The Cognitive Atom
- **Not just an Observer**: Serendipity becomes a core processing step within the Graph Link Layer.
- **Cognitive Dye**: Every piece of information passing through the layer is "dyed" with cognitive attributes (Irony, Novelty, Conflict).
- **Foundation for Unknown Zone**: This atomic module validates whether a new finding creates a "Cognitive Loop" before it even reaches the database.

#### Tasks

- [ ] **5.1** Integrate into `src/lib/graph-link/atoms/`
  - Move Serendipity logic into `graph-link/atoms/serendipity.ts`
  - It becomes a standard "Middleware" in the `ingestFinding` pipeline

- [ ] **5.2** The "Cognitive Check" Pipeline
  - `GraphWriter.ingest()` -> `Deduplicator` -> `SerendipityAtom (Check Loop)` -> `Persist`
  - This ensures no data enters the graph without being evaluated for "Loop Potential"

- [ ] **5.3** Standardize "Loop Hints" as Graph Edges
  - Instead of JSON blobs, create explicit `COGNITIVE_LOOP` edges in the graph
  - `Entity A --[IRONIC_LINK]--> Entity B`

#### Acceptance Criteria
- Serendipity is indistinguishable from the Graph Link Layer itself
- Every ingest operation automatically triggers a cognitive check
- Future "Unknown Zone" features can simply plug in as new "Atoms" (e.g., ConflictAtom)

---

## 📂 Target Directory Structure

```
apps/prism-server/src/lib/
├── graph-link/                 # NEW
│   ├── index.ts
│   ├── reader.ts
│   └── writer.ts
│
├── scout/
│   ├── agent.ts               # Uses GraphReader/Writer
│   ├── patrol.ts
│   ├── snapshot.ts
│   └── research/
│       ├── recursive.ts       # Uses GraphWriter
│       ├── strategy.ts
│       ├── types.ts
│       └── strategies/
│           └── joke.ts
│
├── deep-explorer/
│   ├── engine.ts              # + GraphReader/Writer
│   ├── intent-extractor.ts    # + KG enrichment
│   ├── query-analyzer.ts
│   ├── types.ts
│   └── strategies/
│       ├── irony.ts
│       └── composite.ts
│
└── gardener/
    ├── agent.ts               # + Layered automation + diagnose()
    ├── deduplicator.ts
    ├── merger.ts
    ├── service.ts
    └── trust-metrics.ts       # NEW
```

---

## 🔬 Validation Plan

### Phase 1 Validation

```bash
# Existing scout tests should pass
pnpm test -- --grep "scout"

# Manual: Scout a known entity, verify GraphReader logs
```

### Phase 2 Validation

```bash
# Run Deep Explorer with ingest=true
pnpm run cli:deep-explore "AI humor" --ingest

# Verify entries in public_content table
sqlite3 data/prism.db "SELECT * FROM public_content WHERE source_type='deep-explorer'"
```

### Phase 3 Validation

```bash
# Run Gardener
pnpm run cli:gardener

# Check merge_candidates for auto decisions
sqlite3 data/prism.db "SELECT * FROM merge_candidates WHERE decided_by LIKE 'auto%'"

# Test undo adjusts threshold
pnpm run cli:gardener undo --history-id 123
# Verify threshold increased
```

---

## 📊 Success Metrics

| Metric | Current | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|--------|---------|---------|---------|---------|---------|
| KG Integration | Scout only | All via GraphLink | Deep Explorer | - | - |
| Auto-merge rate | ~0% (memory only) | - | - | ~30% (est.) | - |
| Trust accuracy | N/A | - | - | Tracked | - |
| Scout parallelism | 1 | - | - | - | N |

---

## ⚠️ Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Auto-merge errors | Undo capability + Trust Metrics + Adaptive threshold |
| LLM cost increase | Only use LLM for medium-confidence cases |
| Breaking existing Scout | Keep existing API, add new methods |
| Deep Explorer performance | Optional ingest, configurable threshold |

---

## 📝 Notes

- **AnchorRAG Reference**: Our Scout independently implemented similar principles (Anchor + KG alignment + Verification). Phase 4 makes this explicit.
- **V1 Conservative Strategy**: Gardener V1 was intentionally conservative. Phase 3 restores LLM capability with better safety layers.
- **Graph Link Philosophy**: Single source of truth for KG operations. All agents use same patterns.

---

## 🗓️ Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | 1-2 days | None |
| Phase 2 | 1 day | Phase 1 |
| Phase 3 | 2-3 days | Phase 1 |
| Phase 4 | 2 days | Phase 1, optional |

**Total**: 6-8 days (Phase 4 optional)

---

## 🔮 Long-Term Vision: Ecosystem Distribution

> **Philosophy**: 端侧计算 → 生态分发

### The Opportunity

Local-first doesn't mean isolated. With proper privacy layers, user contributions can create network effects:

```
┌─────────────────────────────────────────────────────────────────┐
│  L0: Raw Data (NEVER leaves device)                             │
│  - Email content, contact details, private relationships        │
└─────────────────────────────────────────────────────────────────┘
                              ↓ Anonymize / Aggregate
┌─────────────────────────────────────────────────────────────────┐
│  L1: Pattern Data (Opt-in Distribution)                         │
│  - "This person is an investor type"                            │
│  - "This email pattern = sales follow-up"                       │
│  - Topic trends (without specific content)                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓ Abstract
┌─────────────────────────────────────────────────────────────────┐
│  L2: Collective Insights (Ecosystem Value)                      │
│  - "Communication patterns of 1000 founders"                    │
│  - "Contact type distribution in [industry]"                    │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 5+ (Future): Ecosystem Features

| Feature | Description | Privacy Layer |
|---------|-------------|---------------|
| **Scout Profile Sharing** | Reuse others' public profile lookups | L1 (public data only) |
| **Disambiguation Rules** | Share entity merge patterns | L1 (pattern, no names) |
| **Relationship Patterns** | Share gravity/relationship insights | L2 (anonymized stats) |

### Phase 6: CLI & Interface Unification (Refactoring)

**Goal**: Organize the chaotic `npm run` scripts into a coherent CLI structure reflecting the new architecture.

| New Command | Legacy Equivalent | Description |
|-------------|-------------------|-------------|
| `prism ingest` | `ingest`, `snapshot` | Unified entry point for GraphWriter |
| `prism explore` | `scout`, `deep-explore`, `adversarial` | Unified agent runner (Scout/DeepExp) |
| `prism garden` | `gardener`, `find-duplicates` | Maintenance & Quality Control |
| `prism graph` | `recall`, `extract` | Direct GraphReader access |

#### Tasks
- [ ] **6.1** Create unified `src/cli/index.ts` (Entry point)
- [ ] **6.2** Deprecate individual script files in `package.json`
- [ ] **6.3** Implement sub-commands (`prism explore --mode=adversarial`)

---

## 🐶 Dogfooding Vision: Expanding the Unknown

> **Future Experiment**: Once Phase 1-5 are complete, we will use Prism to design the next version of Prism.

We will use the **Adversarial Atom** to challenge our own architectural assumptions. The "Unknown Zone" features shouldn't just be predefined (Serendipity/Conflict/Novelty). We should use the system to discover **"The Fourth Atom"** that we haven't thought of yet.

**Methodology**:
1. Ingest all Roadmap & Architecture docs.
2. Run `prism explore --mode=adversarial --intent="Find architectural blind spots"`.
3. Look for "Structural Irony" in our own code (e.g., where we advocate for modularity but use raw SQL).

---

### Potential Business Models

| Model | Description |
|-------|-------------|
| **Freemium + Contribution** | Free users receive; paid users contribute & receive priority |
| **Token Economy** | Contribute patterns → earn tokens → consume others' patterns |
| **B2B Data Products** | Aggregated, anonymized insights for enterprises (strict opt-in) |

### Privacy Technology Requirements

| Technology | Purpose |
|------------|---------|
| **Differential Privacy** | Aggregated data cannot be traced to individuals |
| **Federated Learning** | Model parameters shared, raw data stays local |
| **K-Anonymity** | Ensure contributed data cannot identify individuals |
| **Zero-Knowledge Proofs** | Prove "I have pattern X" without revealing content |

---

## 🔗 Connection to Magpie (Cognitive Infusion)

> See also: [ANTIGRAVITY-SPEC.md Section 8](../../magpie/docs/ANTIGRAVITY-SPEC.md)

### The Parallel

| LLM Knowledge Infusion | Prism Relationship Infusion |
|------------------------|------------------------------|
| Academic papers → Your code decisions | KG relations → Your relationship awareness |
| "I thought of this myself" | "I noticed this myself" |
| Carrier: Chat / Code completion | Carrier: **Gravity Field (Magpie)** |

### How Exploration System Enables Magpie

```
Scout discovers → KG enriched → Origin calculates Gravity → Magpie visualizes
                                                              ↓
                                                     User "perceives"
                                                              ↓
                                                     Natural action
```

**SPARK Block** = Scout findings surfaced as serendipity = Purest form of cognitive infusion.

---

## 📊 Competitive Analysis

### vs Manus (Monica.im)

| Dimension | Manus | Prism |
|-----------|-------|-------|
| **Architecture** | Cloud-first, sandbox execution | Local-first, edge computation |
| **KG Storage** | Cloud (inferred) | Local SQLite |
| **Execution Model** | Cloud sandbox (runs while you sleep) | Local (user device) |
| **Privacy** | Trust platform | Trust math (data never leaves) |
| **Offline** | ❌ | ✅ |
| **Target User** | General AI Agent users | Privacy-conscious professionals |
| **Data Moat** | Platform accumulates data | User owns data, ecosystem shares patterns |

### Our Differentiation

1. **Privacy as Feature**: Email is intimate. "Your data never leaves" is a selling point.
2. **Offline Capability**: Works on planes, in secure environments.
3. **User Data Ownership**: Your KG is yours. Export anytime.
4. **Ecosystem Potential**: Network effects without data centralization.

### If Manus Goes Hybrid

Even if Manus adds local storage:
- Their core value prop is "cloud execution" (tasks run while you sleep)
- Local would be cache, not primary
- For email-specific use case, we remain differentiated

---

## 🧠 Design Principles (Summary)

| Principle | Implementation |
|-----------|----------------|
| **KG as Core** | Graph Link Layer as single source of truth |
| **Orthogonal Composition** | GraphLink × DepthStrategy × AutoLevel |
| **Progressive Automation** | Conservative V1 → Trust Metrics → Gradual expansion |
| **Undo Always** | All auto operations reversible |
| **Academic Validation** | Our intuition matches research (AnchorRAG, LLM-Align) |
| **Local-First** | Privacy promise, not just technical choice |

---

> **Next Action**: Start Phase 1 — Create `src/lib/graph-link/` and extract from Scout.
