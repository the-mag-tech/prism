# Magpie Protocol: The Gardener

> **Status**: V1 Implementation (Conservative Mode)
> **Role**: The "Graph Hygiene" Engine (Internal Governance)
> **Implementation**: `apps/prism-server/src/lib/gardener/*`
> **Last Updated**: 2024-12

---

## 1. The Philosophy: Tending the Wild Garden

Magpie's ingestion is "Zero-Friction", which inevitably leads to a "Wild Garden". Without maintenance, the graph becomes overgrown with duplicates, stale nodes, and broken links.

**The Gardener** is an autonomous agent responsible for the **internal health** of the Knowledge Graph. Unlike the Scout (who looks outward), the Gardener looks inward.

**Core Principles**:
1.  **Safety First**: Never delete user data without explicit permission or 100% certainty.
2.  **Consolidation over Deletion**: Prefer merging entities over deleting them.
3.  **Transparency**: Every action must be logged and reversible (Audit Trail).

---

## 2. The Entity Disambiguation Problem

> **Critical Insight**: Same name ≠ Same entity.

### 2.1 The Problem

```
"Simon" in your email    →  Your friend Simon Chen
"Simon" in tech article  →  Simon Willison (Django creator)
"Simon" in Marvel wiki   →  Simon Williams (Wonder Man)
```

**A string match is not an identity match.** Naively merging entities with similar names leads to **semantic pollution** — mixing unrelated concepts into a single node.

### 2.2 Source Context Matters

In a **personal knowledge graph**, the source of information is a strong signal:

| Source Type | Trust Level | Meaning |
|-------------|-------------|---------|
| `email` | High | People you actually interact with |
| `note` | High | Things you deliberately recorded |
| `bookmark` | Medium | Content you found valuable |
| `scout_web` | Low | Auto-fetched public content |

**Implication**: Two entities with the same name but from **different source domains** are likely **different entities**.

### 2.3 V1 Strategy: Conservative by Default

```
┌─────────────────────────────────────────────────────────┐
│                    V1 MERGE POLICY                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ❌ NO automatic merging                               │
│   ✅ Detect and record candidates                       │
│   ✅ User decides via UI/CLI                            │
│   ✅ Full audit trail                                   │
│                                                         │
│   Principle: "Better to have duplicates than pollution" │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 3. The Gardener Loop (V1: Advisor Mode Only)

The agent operates on a low-frequency maintenance loop (e.g., nightly or weekly).

### Phase 1: Detect (The Scan)

Scan the graph for structural anomalies and hygiene issues.

*   **Entity Duplicates**: Entities with high vector similarity (e.g., "Simon Willison" vs "Simon W.").
*   **Memory Duplicates**: Identical or near-identical content ingested from different paths.
*   **Islands**: Nodes with 0 relations (Orphans).
*   **Fragmentation**: A single topic split across multiple IDs.

### Phase 2: Record (NOT Act)

**V1 does NOT auto-merge.** Instead, it records all candidates to `merge_candidates` table.

```sql
-- Schema: merge_candidates
CREATE TABLE merge_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_a TEXT NOT NULL,
    entity_b TEXT NOT NULL,
    similarity REAL,
    
    -- Source context (for smarter V2 strategies)
    source_domain_a TEXT,  -- 'email', 'web', 'manual'
    source_domain_b TEXT,
    
    -- Status
    status TEXT DEFAULT 'pending',  -- pending | merged | rejected | deferred
    
    -- Decision record
    decided_by TEXT,      -- 'user' | 'auto_v2' | null
    decided_at TEXT,
    decision_reason TEXT,
    
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(entity_a, entity_b)
);
```

### Phase 3: Present (User Decides)

The UI/CLI presents candidates for user decision:

```
┌─────────────────────────────────────────────────────┐
│ 🔍 Potential Duplicates (3)                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ person:simon#a3f2  ←──→  person:simon#b8c1      │ │
│ │ Similarity: 94%                                 │ │
│ │ Source: 📧 Email      Source: 🌐 Web            │ │
│ │                                                 │ │
│ │ [Merge] [Not Same] [Decide Later]               │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**User Options**:
- **Merge**: Execute merge, record `decided_by = 'user'`
- **Not Same**: Mark `status = 'rejected'`, never suggest again
- **Decide Later**: Keep `status = 'pending'`

---

## 4. Capabilities & Tools

### A. The Deduplicator (Entity & Memory)

*   **Role**: Vector-based similarity search & Hash comparison.
*   **V1 Behavior**: Writes to `merge_candidates`, does NOT execute.

```typescript
// deduplicator.ts - V1 behavior
async findCandidates(threshold: number = 0.92): Promise<SimilarityPair[]> {
  const pairs = await this.computeSimilarPairs(threshold);
  
  // V1: Record only, no auto-merge
  for (const pair of pairs) {
    db.query(`
      INSERT OR IGNORE INTO merge_candidates 
      (entity_a, entity_b, similarity, source_domain_a, source_domain_b, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(pair.entityA, pair.entityB, pair.similarity, 
           pair.sourceA, pair.sourceB);
  }
  
  return pairs;
}
```

### B. The Merger (Equivalence Group Model)

*   **Role**: The surgical instrument for consolidation.
*   **V1 Behavior**: Only executes when `decided_by = 'user'`.

> **Architecture Change (2024-12)**: Replaced unidirectional `entity_aliases` with bidirectional **Equivalence Groups**.

**Why Equivalence Groups?**

The original alias approach (`entity_aliases: canonical_id → alias_id`) had problems:
1. **UNIQUE constraint violations** when merging entities with shared relations
2. **Relation data loss** when redirecting edges
3. **Unidirectional** - couldn't query "all equivalents" efficiently

**New Model: Query-Time Resolution**

```sql
-- Schema: entity_groups (replaces entity_aliases)
CREATE TABLE entity_groups (
    entity_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,       -- Canonical representative
    joined_at TEXT DEFAULT (datetime('now')),
    joined_by TEXT               -- 'user' | 'auto_high_conf' | 'auto_llm'
);
CREATE INDEX idx_entity_groups_group ON entity_groups(group_id);
```

**Key Insight**: Relations stay **unchanged** during merge. Equivalence is resolved at **query time**.

```typescript
// GraphReader.getRelations() now includes all equivalent entities
const equivalentIds = getEquivalentEntities(entityId); // ['A', 'B', 'C']
const relations = db.query(`
  SELECT * FROM relations 
  WHERE source IN (${placeholders}) OR target IN (${placeholders})
`).all(...equivalentIds, ...equivalentIds);
```

**Entity Merge (Updated Flow)**:
1. **Group**: Add source entity to target's equivalence group
2. **Relations**: **NO CHANGE** - relations stay pointing to original IDs
3. **PageBlocks**: Update `block_id` references (optional)
4. **Audit**: Record to `merge_history` table

### C. Equivalence Utilities

```typescript
// lib/graph-link/equivalence.ts
getEquivalentEntities(entityId)  // → All entities in same group
getCanonicalId(entityId)         // → Group representative
areEquivalent(entityA, entityB)  // → Boolean
addToEquivalenceGroup(entity, representative, joinedBy)
```

### D. The Audit Trail

All merge operations are fully reversible:

```sql
-- Schema: merge_history
CREATE TABLE merge_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    decided_by TEXT NOT NULL,  -- 'user' | 'auto'
    decision_reason TEXT,
    merged_at TEXT DEFAULT (datetime('now')),
    
    -- Snapshot for undo
    source_snapshot TEXT  -- JSON of original entity data
);
```

---

## 5. Safety Rails (The "Do No Harm" Policy)

### 5.1 V1 Safety Rules

| Rule | Implementation |
|------|----------------|
| No auto-merge | `findCandidates()` only records, never executes |
| Source domain check | Different domains → higher caution |
| Full audit trail | Every merge → `merge_history` entry |
| Reversibility | `entity_aliases` preserves mapping |

### 5.2 Protected Entities

Users can mark entities as "Protected" (Locked), preventing even user-initiated merges without confirmation:

```sql
ALTER TABLE entities ADD COLUMN is_protected INTEGER DEFAULT 0;
```

### 5.3 Rejection Memory

Once a pair is marked "Not Same", it should never be suggested again:

```sql
-- When user clicks "Not Same"
UPDATE merge_candidates 
SET status = 'rejected', decided_by = 'user', decided_at = datetime('now')
WHERE entity_a = ? AND entity_b = ?;

-- findCandidates() excludes rejected pairs
WHERE status NOT IN ('rejected', 'merged')
```

---

## 6. Data Foundation for V2

V1's conservative approach collects valuable data for smarter V2 strategies:

```sql
-- Analyze user decisions to train V2 heuristics
SELECT 
    similarity,
    source_domain_a = source_domain_b AS same_domain,
    status,
    decided_by
FROM merge_candidates
WHERE decided_by = 'user';

-- Example insights:
-- "When source domains differ, users reject 80% of candidates"
-- → V2 heuristic: Cross-domain requires similarity > 0.98
```

---

## 7. Implementation Roadmap

### V1: The Advisor (Current)

- [x] `DeduplicatorService` - Vector similarity detection
- [x] `MergerService` - Manual merge execution
- [ ] `merge_candidates` table schema
- [ ] `merge_history` table schema
- [ ] API: `GET /api/merge-candidates`
- [ ] API: `POST /api/merge` (user-triggered)
- [ ] API: `POST /api/merge-reject`
- [ ] UI: Merge candidates list in Magpie

### V2: The Smart Advisor (Future)

- [ ] Source domain weighting
- [ ] User decision pattern learning
- [ ] LLM-assisted disambiguation ("Are these the same person?")
- [ ] Confidence-based auto-suggestions (but still user-approved)

### V3: The Autonomous Gardener (Far Future)

- [ ] Auto-merge for extremely high confidence (>99%) + same domain
- [ ] Periodic health reports
- [ ] Proactive fragmentation detection

---

## 8. Comparison with LightRAG

| Aspect | LightRAG | Prism Gardener (V1) |
|--------|----------|---------------------|
| Detection | Name string match | Embedding similarity |
| Timing | During extraction | Post-extraction batch |
| Auto-merge | Yes (same name) | No (user decides) |
| Source context | None | Tracked per entity |
| Reversibility | No alias table | Full audit trail |
| Disambiguation | None | Source domain heuristics |

**Key Advantage**: Prism's conservative approach prevents semantic pollution while collecting data for smarter future strategies.

---

## 9. Key Insight

> **"Your Simon" is not "The Internet's Simon".**

In a personal knowledge graph, entities exist within **your cognitive context**. The Gardener's job is not to build a canonical ontology of the world — it's to maintain **your** mental model without corruption.

**V1 Motto**: *"Record everything, decide nothing. Let the human be the final arbiter."*
