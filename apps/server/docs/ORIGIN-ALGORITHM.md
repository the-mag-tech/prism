# Origin Algorithm: The Gravity Engine (L2)

> **Purpose**: Calculates the "Gravity" of every node to generate the dynamic "Field".
> **Philosophy**: Physics over Logic. Gravity over Priority.
> **Status**: Implemented by **Scout System** (Wake Phase) and **Physics System**. Use `ScoutAgent` for Spark signal generation.
> **Architecture**: Implemented via `PhysicsSystem` in the ECS Pipeline.

---

## 1. Concept: The Field Generator

The **Origin Algorithm** is the L2 Reasoning Engine.
It does not ask "What is due?" (L3).
It asks "Where is the Gravity?" (L2).

It outputs a **Physics State**: A dynamic set of properties (`mass`, `velocity`, `temperature`) that describe the entity's behavior in the field.

---

## 2. Gravity Signals (The Forces)

The system listens to 3 primary frequencies to calculate Gravity:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Convergence Signal (Time/Event)                                         │
│  "聚合信号"                                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Events are "Mass". When they approach, they warp the field.                │
│  • Today's Convergence (Events) → High Mass                                 │
│  • Approaching Convergence (Tomorrow) → Medium Mass                         │
│  • Formula: convergence_g = mass / (time_delta + 1)                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  2. Path Signal (Context/History)                                           │
│  "路径信号"                                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Source: Navigation History (L1 Graph traversal).                           │
│  If you visit Simon -> Ponder, then Ponder gains gravity when you see Simon.│
│  • Stored as: `Physics.temperature` (Decays over time).                     │
│  • Recent Path Nodes → High Temperature (Heat)                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  3. Spark Signal (Anomaly/Newness)                                          │
│  "火花信号"                                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Source: Ingestion Pipeline (Scout).                                        │
│  New information creates a "Flash".                                         │
│  • Freshly added/updated nodes → Spike in Gravity                           │
│  • Decays exponentially (Half-life: 24h).                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Gravity Equation

For every **Active Entity** (Awake), we calculate Total Gravity ($G$):

$$ G(E) = \alpha \cdot G_{convergence} + \beta \cdot G_{path} + \gamma \cdot G_{spark} + G_{base} $$

Where:
*   $\alpha$ (0.4): Mass matters most. Real-world events anchor the day.
*   $\beta$ (0.3): Context matters. Where you've been predicts where you go.
*   $\gamma$ (0.2): Novelty matters. New info needs to shine.
*   $G_{base}$: The entity's resting mass (from `entity_physics_state.mass`).

---

## 4. The Pipeline (System Loop)

The calculation is not a single function call, but a **Pipeline**:

1.  **Wake Phase**: `ScoutSystem` identifies "Dirty" entities (new data) and wakes them up.
2.  **Physics Phase**: `PhysicsSystem` iterates over all **Awake** entities and applies the Gravity Equation.
    *   Updates `entity_physics_state` (Temperature decay).
3.  **Render Phase**: `RenderSystem` sorts candidates by $G$, culls low-gravity nodes, and maps them to `render_frame_buffer`.

---

## 5. Data Model (ECS)

### Persistent (Truth)
*   `entity_profiles`: Who is this? (Title, Bio)

### Dynamic (Simulation)
*   `entity_physics_state`:
    *   `mass`: Resting weight (0.1 - 1.0)
    *   `temperature`: Current heat from interaction (0.0 - 1.0)
    *   `velocity`: Rate of change in gravity (Momentum)

---

## 6. Learning & Feedback

The system learns "Mass" from your actions (Insight Loop).
*   If you *Pivot* (Click) on a Spark, its `temperature` increases.
*   If you *Ignore* an Anchor repeatedly, its `mass` can decay (Gravity Decay).

> *Gravity is information. Use it to navigate.*
