# Deep Explorer Strategies

> **Status**: Active  
> **Type**: Architecture Reference  
> **Implemented**: v2 (2025-12)

The **Deep Explorer** engine uses a "Pluggable Strategy" architecture. This allows the same underlying exploration mechanism (Intent Extraction -> Multi-Head Search -> Recursive Digging) to serve different product goals by swapping the **Evaluation Strategy**.

## 1. Supported Strategies

You can select a strategy via the CLI:
`prism explore "Topic" --strategy=[name]`

### 1.1 Irony Strategy (Default)
**Flag**: `--strategy=irony`  
**Goal**: "Surprise me." Finds counter-intuitive insights and builds a "Serendipity Engine".

| Dimension | Description |
| :--- | :--- |
| **Surprise** | Would a normal person say "wow"? |
| **Storytelling** | Are there characters, conflicts, twists? |
| **IronyDepth** | Is there a structural contradiction or cosmic joke? |
| **Accessibility** | Can non-experts understand? |
| **Resonance** | Does it evoke laughter/shock/awe? |

**Digging Pattern**:
*   L1: Origin Story
*   L2: Controversy/Failure
*   L3: Unexpected Consequence
*   L4: Cosmic Irony

---

### 1.2 Evidence Strategy
**Flag**: `--strategy=evidence`  
**Goal**: "Convince me." Builds a solid research report supported by citations.

| Dimension | Description |
| :--- | :--- |
| **SourceCount** | Quantity of distinct sources. |
| **Authoritative** | Quality of sources (Academic/News vs Blog). |
| **DataPoints** | Presence of concrete numbers/dates/stats. |
| **CrossValidation** | Do multiple sources agree? |

**Digging Pattern**:
*   L1: Overview Facts
*   L2: Expert Analysis
*   L3: Statistics/Data
*   L4: Primary Sources

---

### 1.3 Emotional Strategy
**Flag**: `--strategy=emotional`  
**Goal**: "Move me." Finds the human story behind the facts.

| Dimension | Description |
| :--- | :--- |
| **CharacterArc** | Protagonist growth/change. |
| **Conflict** | Struggle against obstacles. |
| **Empathy** | Ability to generate emotional connection. |
| **Resonance** | Universal human themes (Love, Ambition, Hubris). |

**Digging Pattern**:
*   L1: Personal Story
*   L2: Struggle/Hard Times
*   L3: Turning Point
*   L4: Legacy/Meaning

---

### 1.4 Causal Strategy
**Flag**: `--strategy=causal`  
**Goal**: "Explain to me." Uncovers the system dynamics and root causes.

| Dimension | Description |
| :--- | :--- |
| **Mechanism** | How it works (internals). |
| **RootCause** | Why it happens (5 Why). |
| **ImpactChain** | Downstream consequences. |
| **EvidenceLink** | Proof of causality. |

**Digging Pattern**:
*   L1: How it works
*   L2: Underlying Causes
*   L3: Chain Reaction
*   L4: System Dynamics

## 2. Architecture

All strategies implement the `IDepthStrategy` interface:

```typescript
interface IDepthStrategy {
  evaluate(findings: Finding[]): Promise<DepthScore>;
  getNextDirections(context: Context): Promise<string[]>;
  format(findings: Finding[]): Promise<Output>;
}
```

The **Deep Explorer Engine** (`engine.ts`) is agnostic to the strategy; it simply optimizes for the `DepthScore`.

---

## 3. Graph Integration (2025-12 Enhancement)

Deep Explorer now has **bidirectional integration** with the Prism Graph, enabling context-aware exploration.

### 3.1 Graph → DeepExplorer (Reading)

| Phase | Method | Purpose |
|-------|--------|---------|
| **Intent Extraction** | `graphReader.resolveEntity()` | Check if topic matches a known entity |
| **Intent Extraction** | `graphReader.getFingerprint()` | Enrich intent with existing context + relations |
| **Direction Generation** | `graphReader.getFingerprint()` | Use existing relations to suggest exploration directions |

**Example Flow:**
```
User: "Simon 的技术哲学"
  ↓
IntentExtractor:
  - resolveEntity("Simon") → "person:simon_willison"
  - getFingerprint("person:simon_willison")
    → { relatedTerms: ["datasette", "llm", "sqlite_utils"], ... }
  ↓
generateDirections():
  - Prompt includes: "KNOWN FROM GRAPH: Related concepts: datasette, llm, sqlite_utils"
  - LLM generates more precise directions based on existing knowledge
```

### 3.2 DeepExplorer → Graph (Writing)

| Phase | Method | Purpose |
|-------|--------|---------|
| **Multi-Head Search** | `graphWriter.ingestFinding()` | Store each search result |
| **Deep Dive Loop** | `graphWriter.ingestFinding()` | Store deeper findings |

**Ripple Effect:**
New findings are processed by the Atom middleware chain (EntityExtraction, Irony, Causal, etc.), which:
1. Extracts new entities and relations
2. Enriches future searches with more context
3. Creates a **feedback loop** for continuous knowledge growth

### 3.3 Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│                      DeepExplorer Engine                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [1] Intent Extraction ──► graphReader.resolveEntity()         │
│            │                graphReader.getFingerprint()        │
│            ▼                                                    │
│   [2] Direction Generation ──► graphReader.getFingerprint()     │
│            │                   (injects KNOWN FROM GRAPH)       │
│            ▼                                                    │
│   [3] Multi-Head Search ──► graphWriter.ingestFinding()         │
│            │                (每个发现都写入图谱)                  │
│            ▼                                                    │
│   [4] Strategy Evaluation                                       │
│            │                                                    │
│            ▼                                                    │
│   [5] Deep Dive Loop ──► graphWriter.ingestFinding()            │
│            │                                                    │
│            ▼                                                    │
│   [6] Format Output                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Related Documentation

- [MODULE-BOUNDARIES.md](./MODULE-BOUNDARIES.md) - Scout vs DeepExplorer comparison
- [PRISM-ARCHITECTURE-MAP.md](./PRISM-ARCHITECTURE-MAP.md) - Overall architecture
- [SCOUT-ANYTHING.md](./SCOUT-ANYTHING.md) - Scout Agent design
