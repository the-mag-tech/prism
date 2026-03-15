# Feature Flags

> **Status**: Active
> **Last Updated**: 2026-01-08

Centralized feature toggle management for Prism Server.

## Overview

All feature toggles are managed through a single source of truth: `src/feature-flags.ts`.

### Design Principles

1. **Local-First**: All flags stored in SQLite (no external dependencies)
2. **Single Source of Truth**: One file defines all feature flags
3. **Runtime Toggleable**: Flags can be changed without restart
4. **Backward Compatible**: Old `/settings` API still works

---

## Flag Categories

### 1. SYSTEMS (Core functionality)

| Flag | Default | Description | Safe to Disable |
|------|---------|-------------|-----------------|
| `rippleEnabled` | `true` | Event-driven knowledge propagation | ✅ Yes |
| `scoutEnabled` | `true` | External discovery via Tavily | ✅ Yes |
| `curatorEnabled` | `true` | Graph hygiene and deduplication | ✅ Yes |
| `physicsTickEnabled` | `true` | Automatic gravity calculation | ✅ Yes |

### 2. EXTRACTION (Entity pipeline)

| Flag | Default | Description | Safe to Disable |
|------|---------|-------------|-----------------|
| `autoExtractEnabled` | `true` | Auto-extraction after ingest | ❌ No |
| `rippleTriggerOnExtract` | `true` | Trigger ripple after extraction | ✅ Yes |

### 3. LEARNING (User behavior)

| Flag | Default | Description | Safe to Disable |
|------|---------|-------------|-----------------|
| `navigationTracking` | `true` | Navigation path tracking | ✅ Yes |
| `feedbackTracking` | `true` | User feedback tracking | ✅ Yes |
| `embeddingEnabled` | `true` | Path embedding (uses OpenAI) | ✅ Yes |
| `associationLearning` | `true` | Entity association learning | ✅ Yes |

### 4. EXPERIMENTAL (Unstable)

| Flag | Default | Description | Status |
|------|---------|-------------|--------|
| `serendipityEnabled` | `false` | Cognitive loop detection | Experimental |
| `reactiveRippleEnabled` | `false` | Re-contextualize old memories | Not Implemented |
| `typeGraduationEnabled` | `false` | AI discovers new entity types | Planned |

---

## API Reference

### Get All Flags

```http
GET /flags
```

**Response:**
```json
{
  "rippleEnabled": true,
  "scoutEnabled": true,
  "curatorEnabled": true,
  ...
}
```

### Get Flag Metadata

```http
GET /flags/metadata
```

**Response:**
```json
[
  {
    "key": "rippleEnabled",
    "value": true,
    "default": true,
    "category": "systems",
    "description": "Event-driven knowledge propagation",
    "safe": true
  },
  ...
]
```

### Update Multiple Flags

```http
PATCH /flags
Content-Type: application/json

{
  "rippleEnabled": false,
  "navigationTracking": false
}
```

### Set Single Flag

```http
PUT /flags/rippleEnabled
Content-Type: application/json

{ "value": false }
```

### Reset All Flags

```http
POST /flags/reset
```

---

## Code Usage

### Check a Flag

```typescript
import { isRippleEnabled, isScoutEnabled, getFlag } from './feature-flags.js';

// Convenience function
if (isRippleEnabled()) {
  // ... ripple logic
}

// Generic getter
if (getFlag('serendipityEnabled')) {
  // ... experimental feature
}
```

### Set a Flag Programmatically

```typescript
import { setFlag, setFlags } from './feature-flags.js';

// Single flag
setFlag('rippleEnabled', false, 'my-module');

// Multiple flags
setFlags({
  rippleEnabled: false,
  scoutEnabled: false,
}, 'shutdown');
```

---

## MCP Tool

Feature flags can also be managed via MCP:

```typescript
// In Cursor/Claude Desktop
prism_feature_flags({
  action: 'get'
})

prism_feature_flags({
  action: 'set',
  key: 'rippleEnabled',
  value: false
})
```

---

## Database Schema

```sql
CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT 'system'
);
```

---

## Migration from settings.ts

The old `settings.ts` learning settings have been consolidated into feature flags:

| Old Setting | New Flag |
|-------------|----------|
| `navigationTracking` | `navigationTracking` |
| `feedbackTracking` | `feedbackTracking` |
| `embeddingEnabled` | `embeddingEnabled` |
| `associationLearning` | `associationLearning` |

The `/settings` API endpoints remain for backward compatibility but are deprecated.

---

## Future: FeatBit Integration

For enterprise/multi-user scenarios, the system is designed to support [FeatBit](https://github.com/featbit/featbit) integration:

```typescript
// src/feature-flags.ts

export interface FeatureFlagProvider {
  init(): Promise<void>;
  getFlag(key: string, defaultValue: boolean): boolean;
  setFlag(key: string, value: boolean): Promise<void>;
  close(): Promise<void>;
}

// Current: LocalFeatureFlagProvider (SQLite)
// Future: FeatBitProvider (external service)
```

When to consider FeatBit:
- Multi-user deployment
- A/B testing requirements
- Complex targeting rules
- Audit trail needs
- Remote flag management

---

## @ref Tags

| Ref ID | Code | Description |
|--------|------|-------------|
| `feature-flags/system` | `src/feature-flags.ts` | Main feature flag module |
| `feature-flags/api` | `src/app.ts#/flags` | HTTP API endpoints |
| `feature-flags/provider` | `src/feature-flags.ts#FeatureFlagProvider` | Provider interface |
