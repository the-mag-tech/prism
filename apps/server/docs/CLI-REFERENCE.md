# Prism Unified CLI Reference

> **Version**: 1.0 (Unified)
> **Entry Point**: `bun run src/cli/index.ts`
> **Alias**: `prism` (via alias or script wrapper)

The Unified CLI consolidates all Prism capabilities into a single entry point.

---

## 1. Core Commands

### `prism explore`
**Purpose**: The Active Brain. Triggers Deep Explorer (Recall) or Scout (Origin).

*   **Deep Research (Topic)**
    ```bash
    # Research a vague topic with multiple strategies
    prism explore "The future of PKM" --depth=3
    ```

*   **Multi-Anchor Grounding (Entities)**
    ```bash
    # Parallel scout for specific entities (Grounding)
    prism explore "EntityA, EntityB, EntityC" --multi
    ```

*   **Options**:
    *   `--depth=<n>`: Search depth (Default: 2).
    *   `--width=<n>`: Parallel search width (Default: 3).
    *   `--ingest`: Enable writing high-quality findings to the Graph (Default: false).
    *   `--multi`: Enable Multi-Anchor Scout mode. Input is treated as a comma-separated list of entities.

### `prism ingest`
**Purpose**: Manual Feeding. Ingests raw content into the Graph Link Layer.

*   **Ingest URL**
    ```bash
    prism ingest "https://example.com/article"
    ```
    *   *Effect*: Crawls URL -> Extracts Content -> Irony Check -> Ingests as 'memory' -> Triggers Sparks.

### `prism seed`
**Purpose**: Database Initialization.

*   **Run Seeder**
    ```bash
    prism seed
    ```
    *   *Effect*: Populates the database with initial/test data (defined in `src/cli/seed-db.ts`).

### `prism search`
**Purpose**: Unified Entity Search. Core atomic primitive for retrieving entities.

*   **Text Search**
    ```bash
    # Search for entities containing "knowledge graph"
    prism search "knowledge graph" --types=entity,finding --limit=10
    ```
    *   *Effect*: FTS query across specified entity types, returns gravity-ranked results.

*   **Browse by Type**
    ```bash
    # List all findings (Scout discoveries)
    prism search --types=finding --limit=20
    ```

*   **Options**:
    *   `--types=<list>`: Comma-separated types: `entity`, `finding`, `memory`, `public`. Default: all.
    *   `--limit=<n>`: Max results (Default: 20, Max: 100).
    *   `--sort=<field>`: Sort by `gravity`, `relevance`, `created_at`, `title`. Default: `relevance` if query provided.
    *   `--offset=<n>`: Pagination offset.

> **API Atom**: `GET /api/entities/search?q=<query>&types=<list>&limit=<n>&sort=<field>`

---

## 2. Maintenance Commands

### `prism garden`
**Purpose**: The Gardener. Manages data quality and deduplication.

*   **Find Duplicates**
    ```bash
    prism garden --scan
    ```
    *   *Effect*: Scans for similar entities using embeddings.

*   **Interactive Merge**
    ```bash
    prism garden --interactive
    ```
    *   *Effect*: Launches CLI UI to manually review and merge candidates.

*   **Show Metrics**
    ```bash
    prism garden --stats
    ```
    *   *Effect*: Displays Trust Metrics (Auto-merge accuracy, thresholds).

---

## 3. Developer / Debug Commands

These commands are for low-level debugging or specific component testing.

*   `bun run src/cli/retype-entity.ts`: Manually change entity type.
*   `bun run src/cli/delete-entity.ts`: Hard delete an entity.
*   `bun run src/cli/reset-db.ts`: **Wipe Database** (Use with caution).

---

## 4. Workflows

### The "Research & Ground" Loop
1.  **Explore**: `prism explore "Generative UI" --ingest`
    *   *Result*: System finds concepts like "Vercel v0", "Galileo AI".
2.  **Ground**: `prism explore "Vercel v0, Galileo AI" --multi`
    *   *Result*: Scout creates robust profiles for these specific entities.
3.  **Refine**: `prism garden --scan`
    *   *Result*: Gardener checks if "v0" and "Vercel v0" are duplicates.

