# Prism Protocol: The Ripple Effect (L3)

> **Status**: Partially Implemented (Entity Lifecycle Hooks ✅, Reactive Ripple 📋 Planned)
> **Last Updated**: 2026-01-08
> **Role**: The "Consistency" Engine (Self-Healing Graph)
> **Philosophy**: A change in the Center must reshape the Field.

## Implementation Status

| Feature | Status | Code Location |
|---------|--------|---------------|
| **Entity Lifecycle Hooks** | ✅ Live (v3.1) | `src/lib/graph-link/hooks.ts` |
| **Hook-Triggered Ripple** | ✅ Live | `src/systems/RippleSystem.ts` |
| **Proactive Ripple** (Entity Discovery) | ✅ Live | `src/lib/agents/ripple/` |
| **Profile Generation** | ✅ Live | `src/lib/agents/ripple/agent.ts` |
| **Serendipity Filtering** | ✅ Live | `agent.evaluateCandidates()` |
| **Queue Persistence** | ✅ Live | `src/lib/queue/index.ts` |
| **AgentLogger Integration** | ✅ Live | `src/lib/agents/ripple/worker.ts` |
| **Reactive Ripple** (Damage Assessment) | 📋 Planned | - |
| **RefactorAgent** (Re-contextualization) | 📋 Planned | - |
| **User Correction Trigger** | 📋 Planned | - |

---

## 1. The Core Problem: The "Stale History" Paradox

In an incremental extraction system, we face a core contradiction:
**"Current Truth often conflicts with Historical Record."**

*   **Scenario**: A note from 2023 states "`[Person]` works at `[Company A]`". In 2025, you manually update the `[Person]` entity to "Founder of `[Company B]`".
*   **Conflict**: The system now holds two sets of facts. Recall might retrieve outdated info, and Origin might calculate incorrect Gravity based on the old company.
*   **Solution**: We cannot re-run everything (O(N) is too slow), nor can we ignore it. We need a **"Ripple"** mechanism—**propagating correction waves from the point of change.**

---

## 2. The Ripple Mechanism

**The Ripple Effect** is an event-driven, localized batch refresh mechanism.

### 2.1 The Physics (Model)

$$ Impact = \frac{Magnitude}{(Distance + 1)^Decay} $$

*   **Epicenter**: The Entity where the change occurred ($E_{target}$).
*   **Blast Radius**: Memories and 1st-degree Entities directly connected to the Epicenter.
*   **Magnitude**: The severity of the change (Rename > Property Update > Tag Change).

### 2.2 Trigger Sources

Ripples are triggered by **High-Confidence** operations:

1.  **User Correction (God Mode)**:
    *   User merges two entities (e.g., "`mock:person_a`" + "`mock:person_b`").
    *   User renames an entity ("`mock:project_x`" -> "`mock:project_y`").
    *   *Magnitude*: **Critical (Mandatory Rewrite)**.

2.  **Scout Confirmation (External Truth)**:
    *   `SCOUT-ANYTHING` finds definitive proof of a property change (e.g., Funding Round A -> B).
    *   *Magnitude*: **High**.

3.  **Deduplication (Graph Hygiene)**:
    *   System logic determines two nodes are the same.
    *   *Magnitude*: **Critical**.

---

## 3. Propagation Stages

When the Epicenter $E_{target}$ undergoes a significant change, the system initiates:

### Stage 1: Identification (Damage Assessment)
Identify all affected nodes:
*   **Affected Memories**: All memories that mention the entity.
*   **Affected Relations**: All relations where the entity is Source or Target.

### Stage 2: Re-Contextualization (Refactoring)
This is the critical step. We don't just "find and replace"; we **re-understand old memories with new knowledge**.

*   **Agent**: `RefactorAgent`
*   **Prompt Strategy**:
    > "You are reviewing an old memory `mock:memory_123`.
    > The entity `[Person]` has been CONFIRMED to be `[Full Title / Role]`.
    > In this memory, the text mentions 'Meeting with `[Person]`'.
    > Task: Update the relationship. Confirm if this refers to the new confirmed context."

### Stage 3: Gravity Recalculation
Invoke `ORIGIN-ALGORITHM`:
*   Changes in relations (e.g., increased strength or connection to a new high-weight node) can drastically shift $E_{target}$'s Gravity.
*   This shifts its rendering in the Frontend Grid (e.g., from Spark to Anchor).

---

## 4. Architecture & Implementation

### 4.1 Entity Lifecycle Hooks (v3.1)

In v3.1, we shifted from **Event-Driven** to **Entity Lifecycle-Driven** architecture.
Ripple and Scout are now triggered directly by the `GraphWriter` via hooks.

```typescript
// src/lib/graph-link/hooks.ts - The Hook System

interface EntityChangeContext {
  entityId: string;
  entityType: string;
  entityTitle: string;
  trigger: 'user' | 'system' | 'scout' | 'ripple';
  inheritedGravity?: number;  // For decay control
  depth?: number;             // Propagation depth
}

// Singleton hook manager
export const entityHooks = new EntityHookManager();

// Systems register as subscribers
entityHooks.onEntityCreate((ctx) => rippleSystem.onEntityCreated(ctx));
entityHooks.onEntityCreate((ctx) => scoutSystem.onEntityCreated(ctx));
```

### 4.2 Hook Integration in GraphWriter

```typescript
// src/lib/graph-link/writer.ts

async addEntityFromSource(options: { entity, memoId, hookContext? }) {
  const isNewEntity = !existingEntity;
  
  // ... DB transaction ...
  
  // POST-TRANSACTION: Trigger Entity Lifecycle Hooks
  const ctx: EntityChangeContext = {
    entityId: entity.id,
    entityType: entity.type,
    entityTitle: entity.title,
    trigger: hookContext?.trigger ?? 'system',
    inheritedGravity: hookContext?.inheritedGravity ?? 1.0,
    depth: hookContext?.depth ?? 0,
  };

  if (shouldContinuePropagation(ctx)) {
    if (isNewEntity) {
      entityHooks.triggerEntityCreate(ctx);  // Parallel: Scout + Ripple
    } else {
      entityHooks.triggerEntityUpdate(ctx);
    }
  }
}
```

### 4.3 RippleSystem as Hook Subscriber

```typescript
// src/systems/RippleSystem.ts

registerHooks(): void {
  entityHooks.onEntityCreate((ctx) => this.onEntityCreated(ctx));
  entityHooks.onEntityUpdate((ctx) => this.onEntityUpdated(ctx));
}

private async onEntityCreated(ctx: EntityChangeContext): Promise<void> {
  // Skip non-scoutable types
  if (!scoutableTypes.includes(ctx.entityType)) return;
  
  // Propagate with decay control
  const result = await this.agent.propagate(ctx.entityId);
  // ...
}
```

### 4.4 Legacy Event System (Fallback)

The `emit()` method is still available for manual triggering or external events:

```typescript
// src/systems/RippleSystem.ts - Legacy event emission (still works)

emit(event: Omit<RippleEvent, 'timestamp'>): void {
  if (!isQueueInitialized()) {
    // Fallback: process directly
    this.handleEventDirect(task);
    return;
  }
  enqueueRipple(task);  // Persisted to prism_jobs table
}
```

### 4.5 The Propagate Flow (Live)

```typescript
// src/lib/agents/ripple/agent.ts

async propagate(entityId: string, depth: number = 0): Promise<RippleResult> {
  // 1. Check if profileable (uses SSOT from prism-contract)
  if (!PROFILEABLE_TYPES.includes(entity.type)) return result;
  
  // 2. Generate profile via web search
  const profile = await this.profile(entity.title, context, entity.type);
  
  // 3. Onboard high-value content (serendipity filtering)
  const onboarded = await this.onboard(profile, entityId);
  
  // 4. Create relations to discovered entities
  await this.createRelations(entityId, profile.relatedEntities);
  
  return result;
}
```

### 4.6 Serendipity Filtering (Live)

```typescript
// src/lib/agents/ripple/agent.ts - evaluateCandidates()

async evaluateCandidates(candidates: ContentCandidate[], contextEntityId: string) {
  for (const candidate of candidates) {
    // Calculate surprise score using graph reader
    const surprise = await graphReader.calculateSurprise(candidate.url, contextEntityId);
    
    // Only ingest if surprise exceeds threshold
    candidate.shouldIngest = surprise >= this.config.minSurpriseThreshold;
  }
}
```

### 4.7 Planned: Reactive Ripple (RefactorAgent)

```typescript
// 📋 PLANNED: src/lib/agents/ripple/refactor-agent.ts

async function refactorMemories(memoryIds: number[], context: EntityState) {
  // Lazy Implementation:
  // Mark these Memories as "Dirty" / "Needs Re-extract"
  // Process during next Lazy Migration or Idle Patrol
  
  // Eager Implementation (High Priority):
  // Immediately call LLM to correct the Relations table
  await Promise.all(memoryIds.map(id => reEvaluateRelations(id, context)));
}
```

---

## 5. Scenarios (User Journey)

### Scenario A: The "Alias" Fix (User Triggered)
1.  **Before**: System has `mock:person_a` (context: Company A) and `mock:person_b` (context: Company B). Relations are split.
2.  **Action**: User selects "Merge `mock:person_a` into `mock:person_b`" in the UI.
3.  **Ripple**:
    *   All memories linked to `mock:person_a` now point to `mock:person_b`.
    *   **Intelligent Fix**: For ambiguous notes (e.g., "Meeting with `[Name]`"), AI re-scores relevance based on `mock:person_b`'s full profile.
4.  **Result**: The timeline for the consolidated person is instantly complete.

### Scenario B: The "Scout" Discovery (Scout Triggered)
1.  **Before**: User follows `mock:project_alpha`, but the system lacks context.
2.  **Scout**: `SCOUT-ANYTHING` runs and discovers "`[Project Alpha]` was acquired by `[Big Corp]`". Entity description updates.
3.  **Ripple**:
    *   System reviews old notes mentioning "Reviewing `[Big Corp]` integration".
    *   `RefactorAgent` identifies the connection: "Integration with `[Big Corp]` is now relevant to `mock:project_alpha`."
    *   **New Link**: `mock:project_alpha` <--> `mock:big_corp` (Derived from old memory).
4.  **Result**: Old notes are revitalized and connected to the new network topology.

---

## 6. Safety Valves (Damping)

To prevent "Butterfly Effects" (infinite update loops), damping is required:

1.  **Depth Limit**: Ripples propagate max 1 hop (Direct Neighbors).
2.  **Idempotency**: If new facts don't substantially change Relations, stop propagation.
3.  **Human in the Loop**: For massive changes (impacting > 1000 Memories), generate a "Suggestion" instead of auto-executing.

---

## 7. Integration Summary

| System | Role in Ripple |
| :--- | :--- |
| **User / Scout** | **Trigger**. The source of the disruption. |
| **Prism DB** | **Medium**. Stores the state and locks transactions. |
| **LLM (Refactor)** | **Agent**. Performs the semantic surgery. |
| **Origin Algo** | **Output**. Reflects the new reality in the UI Field. |

