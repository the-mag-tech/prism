# Fractal Prism: The Distributed Cognitive Architecture

> **Status**: **Canon** (Supersedes `FEDERATED-PRISM-DESIGN.md`)
> **Date**: 2025-12-13
> **Scope**: Architecture, Sync Protocol, and Extension Strategy.

---

## 1. The "Fractal" Vision

We are moving from a "Server-Client" model to a **"Fractal"** model.
In a fractal, every part resembles the whole.
In Prism, every device (Desktop, Browser, Mobile) runs a **self-contained Prism Instance**.

### 1.1 The Topology: Master-Edge

*   **Magpie Desktop (The Hub)**: The "Proximity Core". High compute, full storage, local LLM access.
*   **Browser Extension (The "Smart Lens")**: A passive sensor and active overlay. Runs **Prism Nano**.
*   **Mobile App (The "Lite" Node)**: Capture and quick recall. Runs **Prism Lite**.

### 1.2 The "Local-First" Guarantee

*   **Data lives on the device.**
*   Sync is an optional layer.
*   The system works perfectly even if the internet (and the sync server) vanishes.

---

## 2. Component Architecture

### 2.1 Prism Nano (WASM Sidecar)

The Browser Extension cannot connect to a Node.js server for every DOM change (latency/privacy).
It must have its own brain.

*   **Technology**: `wa-sqlite` (WASM SQLite) + `OpenAI/WebLLM` (Optional).
*   **Storage**: OPFS (Origin Private File System) ~500MB persistent.
*   **Function**:
    *   **Passive**: Logs browsing history locally (IndexedDB).
    *   **Active**: Calculates "Page Gravity" locally using cached Entities and rules.
    *   **Privacy**: Raw HTML text **never** leaves the browser tab unless "Snapshotted".

### 2.2 The Sync Protocol (Log-Based)

We do not sync database rows directly. We sync **Logs**.

```typescript
type SyncLogEntry = {
  op: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: 'Memory' | 'Entity' | 'Relation';
  data: EncryptedBlob;
  clock: LamportTimestamp;
  deviceId: string;
}
```

1.  **Extension** accumulates logs in `Outbox`.
2.  **Desktop** wakes up, connects via Local Network (or Relay).
3.  **Extension** flushes `Outbox` to Desktop.
4.  **Desktop** processes logs, updates the Master Graph, and pushes back a **"Context Digest"**.

### 2.3 The "Context Digest" (Return Trip)

Desktop doesn't send the whole DB to the Extension. It sends a **Digest**:
*   Top 100 Active Entities (IDs & Keywords).
*   Current "Gravity Field" configuration.
*   Recent search queries.

This allows Prism Nano to effectively "hallucinate" that it has the full database, while only matching against the most relevant subset.

---

## 3. Engineering Implementation

### 3.1 Package Structure (Monorepo)

```
fulmail/
├── packages/
│   ├── prism-core/           # 🧠 Shared Logic (WASM compatible)
│   │   ├── src/
│   │   │   ├── db/           # Abstract DB Interface
│   │   │   ├── algo/         # Gravity/Origin Algo
│   │   │   └── types/        # Schema definition
│   │
│   ├── prism-sync/           # 🔄 Sync Protocol
│   │   ├── src/
│   │   │   ├── protocol.ts   # Wire protocol
│   │   │   └── crdt/         # Conflict resolution
│   │
│   └── prism-client/         # 🔌 Universal Client
│       └── Supports: Local (WASM), HTTP (Remote), Native (IPC)
│
├── apps/
│   ├── magpie/               # 🖥️ Desktop (Node.js + Rust)
│   ├── prism-extension/      # 🧩 Browser (WASM Nano)
│   └── prism-server/         # ⚙️ Standalone Server (Legacy/Dev)
```

### 3.2 Database Strategy

*   **Node.js (Desktop)**: `better-sqlite3` or `bun:sqlite` (Fastest, OS access).
*   **Browser (Extension)**: `wa-sqlite` (WASM, OPFS backend).
*   **Schema**: Identical across all platforms. Migrations shared via `@prism/core`.

---

## 4. UX: The "Invisible" Extension

### 4.1 Mode 0: Ghost (Default)
*   **UI**: None.
*   **Action**: Records `VisitedPage` into local SQLite.
*   **Logic**: Checks URL/Title against "Context Digest". If match > 0.8, flags as "Implicit Interest".

### 4.2 Mode 1: Lens (Activated)
*   **Trigger**: User presses `Alt+M` or clicks the "Magpie Icon" which is glowing (because Ghost Mode found match).
*   **UI**: **Hologram Sidebar** injects into DOM (Shadow DOM).
*   **Content**:
    *   "This page mentions **Julian Benner**."
    *   "You have **3 notes** related to this topic."
    *   "**Spark**: Similar to a PDF you read last week."

### 4.3 Mode 2: Scout (Action)
*   **Trigger**: User selects text -> "Scout This".
*   **Action**: Extension calls Desktop to run a full `Deep Scout` agent.
*   **Feedback**: Desktop notifies Extension when ready. Extension shows notification.

---

## 5. Roadmap

### Phase 1: Separation of Concerns (Core Split)
- [ ] Refactor `prism-server` logic into `packages/prism-core`.
- [ ] Ensure `prism-core` is pure TypeScript (no Node.js native deps like `fs`).

### Phase 2: Prism Nano (Browser)
- [ ] Build `apps/prism-extension` with `wa-sqlite`.
- [ ] Implement `PrismNano` capable of ingesting `Context Digest`.

### Phase 3: The Link (Sync)
- [ ] Implement `prism-sync` package (Log-based).
- [ ] Establish `Extension <-> Desktop` communication (Native Messaging or Localhost WebSocket).
