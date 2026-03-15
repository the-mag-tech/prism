# Data Gap Detection System

> **Purpose**: 主动识别 KG 膨胀过程中"理想情况下应该补充什么数据"
> **Status**: Phase 4.5 (Pre-requisite for Graph Rebuild)
> **Date**: 2025-01-08

---

## 1. 核心问题

当前 KG 膨胀流程是**被动的**：

| 阶段 | 当前行为 | 问题 |
|------|---------|------|
| Extraction | 文档有什么提什么 | 不知道缺什么 |
| Ripple | surprise 高才 ingest | 盲目搜索 |
| Scout | gravity 高才 profile | 不知道 profile 缺什么 |

**缺失的能力**：主动识别数据缺口，告诉系统"接下来应该找什么"

---

## 2. 设计目标

```
┌─────────────────────────────────────────────────────────────────┐
│  Entity: person:simon_willison                                  │
│  ─────────────────────────────────────────────                  │
│  ✅ Known:                                                      │
│     - works_at: company:datasette                               │
│     - created: project:datasette                                │
│                                                                 │
│  ❓ Expected but Missing (Data Gaps):                           │
│     - education: ? (person 通常有教育背景)                       │
│     - worked_at: ? (之前在哪工作？)                              │
│     - collaborates_with: ? (有哪些合作者？)                      │
│                                                                 │
│  📋 Suggested Queries:                                          │
│     - "Simon Willison career history"                           │
│     - "Simon Willison collaborators open source"                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                    KG Expansion Quality System                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  user_memories ──► Extraction ──► entities/relations                │
│       │                │                                            │
│       │                ▼                                            │
│       │         extraction_logs ◄─── Data Gap Detection             │
│       │         • entities_count         │                          │
│       │         • new_type_candidates    │                          │
│       │         • missing_context ◄──────┘                          │
│       │                                                             │
│       └─────────────► Ripple ──► Scout ──► scout_findings           │
│                         │          │                                │
│                         ▼          ▼                                │
│                   ripple_logs   scout_logs                          │
│                   • data_gaps   • profile_completeness              │
│                   • suggested   • data_gaps                         │
│                     _queries    • suggested_queries                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     data_gaps (Central)                      │   │
│  │  entity_id | missing_relation | priority | suggested_queries │   │
│  │  ─────────────────────────────────────────────────────────── │   │
│  │  person:x  | educated_at      | medium   | ["x education"]   │   │
│  │  project:y | created_by       | high     | ["y founder"]     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Entity Schema Expectations

### 4.1 设计哲学

基于 Four Tribes 分类，每种实体类型有**预期的关系模式**：

| Tribe | 实体类型 | 核心预期关系 |
|-------|---------|-------------|
| **Salesman** | person | works_at, created, educated_at, collaborates_with |
| **Salesman** | company | founded_by, has_product, located_in |
| **Salesman** | project | created_by, owned_by, uses_technology |
| **Archivist** | topic | related_to, mentioned_in |
| **Archivist** | concept | derived_from, applied_to |
| **Logger** | event | involves, happened_at, caused_by |
| **Gardener** | gift | given_by, given_to, occasion |

### 4.2 Schema Definition

```typescript
// @ref:data-gap/schema-expectations
// packages/prism-contract/src/schema-expectations.ts

export interface ExpectedRelation {
  relation: string;           // 关系类型
  targetType: string;         // 目标实体类型 (可用 | 分隔多个)
  priority: 'critical' | 'high' | 'medium' | 'low';
  queryTemplate: string;      // 搜索查询模板
  description: string;        // 为什么需要这个关系
}

export const ENTITY_SCHEMA_EXPECTATIONS: Record<string, ExpectedRelation[]> = {
  person: [
    {
      relation: 'works_at',
      targetType: 'company|organization',
      priority: 'high',
      queryTemplate: '{name} current company employer',
      description: '了解职业背景'
    },
    {
      relation: 'created',
      targetType: 'project',
      priority: 'high',
      queryTemplate: '{name} projects created founded',
      description: '了解创作/创业经历'
    },
    {
      relation: 'educated_at',
      targetType: 'organization',
      priority: 'medium',
      queryTemplate: '{name} education university degree',
      description: '了解教育背景'
    },
    {
      relation: 'collaborates_with',
      targetType: 'person',
      priority: 'medium',
      queryTemplate: '{name} collaborators co-founders teammates',
      description: '了解人际网络'
    },
    {
      relation: 'influenced_by',
      targetType: 'person|concept',
      priority: 'low',
      queryTemplate: '{name} influences mentors inspiration',
      description: '了解思想来源'
    }
  ],

  company: [
    {
      relation: 'founded_by',
      targetType: 'person',
      priority: 'critical',
      queryTemplate: '{name} founder CEO leadership',
      description: '了解创始团队'
    },
    {
      relation: 'has_product',
      targetType: 'project',
      priority: 'high',
      queryTemplate: '{name} products services offerings',
      description: '了解产品矩阵'
    },
    {
      relation: 'located_in',
      targetType: 'location',
      priority: 'medium',
      queryTemplate: '{name} headquarters location offices',
      description: '了解地理分布'
    },
    {
      relation: 'competes_with',
      targetType: 'company',
      priority: 'low',
      queryTemplate: '{name} competitors alternatives',
      description: '了解竞争格局'
    }
  ],

  project: [
    {
      relation: 'created_by',
      targetType: 'person',
      priority: 'critical',
      queryTemplate: '{name} author creator maintainer',
      description: '了解创作者'
    },
    {
      relation: 'owned_by',
      targetType: 'company|person',
      priority: 'high',
      queryTemplate: '{name} organization company owner',
      description: '了解归属'
    },
    {
      relation: 'uses',
      targetType: 'technology',
      priority: 'medium',
      queryTemplate: '{name} tech stack built with',
      description: '了解技术栈'
    }
  ],

  topic: [
    {
      relation: 'related_to',
      targetType: 'topic|concept',
      priority: 'medium',
      queryTemplate: '{name} related concepts fields',
      description: '了解知识关联'
    },
    {
      relation: 'pioneered_by',
      targetType: 'person',
      priority: 'medium',
      queryTemplate: '{name} pioneers experts thought leaders',
      description: '了解领域专家'
    }
  ],

  event: [
    {
      relation: 'involves',
      targetType: 'person|company|project',
      priority: 'high',
      queryTemplate: '{name} participants involved parties',
      description: '了解参与者'
    },
    {
      relation: 'happened_at',
      targetType: 'location',
      priority: 'medium',
      queryTemplate: '{name} location venue where',
      description: '了解发生地点'
    },
    {
      relation: 'caused_by',
      targetType: 'event|decision',
      priority: 'low',
      queryTemplate: '{name} cause reason why',
      description: '了解因果链'
    }
  ]
};
```

---

## 5. Database Schema

### 5.1 Core Tables

```sql
-- @ref:data-gap/tables
-- Migration: v52_data_gap_detection.ts

-- 5.1.1 Data Gaps (Central)
CREATE TABLE data_gaps (
  id INTEGER PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  
  -- Gap 描述
  missing_relation TEXT NOT NULL,    -- 'educated_at', 'created_by'
  expected_target_type TEXT,         -- 'organization', 'person'
  priority TEXT DEFAULT 'medium',    -- 'critical', 'high', 'medium', 'low'
  
  -- 建议的补充方式
  suggested_queries TEXT,            -- JSON: ["query1", "query2"]
  reasoning TEXT,                    -- 为什么需要这个信息
  
  -- 状态追踪
  status TEXT DEFAULT 'open',        -- 'open', 'searching', 'filled', 'unfillable'
  search_attempts INTEGER DEFAULT 0, -- 已尝试搜索次数
  filled_at TEXT,
  filled_by TEXT,                    -- 'scout:xxx' 或 'user_ingest' 或 'extraction:memo_id'
  
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  
  UNIQUE(entity_id, missing_relation)
);

CREATE INDEX idx_data_gaps_entity ON data_gaps(entity_id);
CREATE INDEX idx_data_gaps_priority ON data_gaps(priority, status);
CREATE INDEX idx_data_gaps_status ON data_gaps(status);

-- 5.1.2 Extraction Logs
CREATE TABLE extraction_logs (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,        -- 'memory' | 'finding'
  
  -- 产出统计
  entities_extracted INTEGER DEFAULT 0,
  relations_extracted INTEGER DEFAULT 0,
  new_type_candidates TEXT,         -- JSON: ["event:product_launch", ...]
  
  -- 质量评估
  confidence_avg REAL,
  ambiguous_items TEXT,             -- JSON: [{entity, reason}]
  
  -- LLM 反馈
  data_gaps_detected TEXT,          -- JSON: [{entity_id, relation, reason}]
  missing_context TEXT,             -- LLM 认为缺失的信息
  suggested_queries TEXT,           -- JSON: 建议的搜索查询
  
  -- 元数据
  model TEXT,
  latency_ms INTEGER,
  pipeline_version TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_extraction_logs_source ON extraction_logs(source_type, source_id);

-- 5.1.3 Scout Logs
CREATE TABLE scout_logs (
  id INTEGER PRIMARY KEY,
  entity_id TEXT NOT NULL,
  trigger TEXT,                     -- 'gravity' | 'ripple' | 'data_gap' | 'manual'
  
  -- Profile 质量评估
  profile_completeness REAL,        -- 0-1: 信息完整度
  sources_count INTEGER,
  sources_diversity REAL,           -- 0-1: 来源多样性
  
  -- 数据缺口
  gaps_before INTEGER,              -- Scout 前有多少 gaps
  gaps_filled INTEGER,              -- Scout 填补了多少
  gaps_remaining TEXT,              -- JSON: 剩余的 gaps
  suggested_queries TEXT,           -- JSON: 建议的后续查询
  
  -- 发现统计
  findings_count INTEGER,
  avg_surprise REAL,
  
  -- 元数据
  search_provider TEXT,
  latency_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_scout_logs_entity ON scout_logs(entity_id);

-- 5.1.4 Ripple Logs
CREATE TABLE ripple_logs (
  id INTEGER PRIMARY KEY,
  trigger_entity_id TEXT NOT NULL,
  trigger_type TEXT,                -- 'ingest' | 'scout_complete' | 'gravity_tick'
  
  -- 传播统计
  candidates_evaluated INTEGER,
  candidates_ingested INTEGER,
  candidates_skipped INTEGER,
  
  -- 质量评估
  avg_surprise REAL,
  diversity_score REAL,
  
  -- 数据缺口相关
  gaps_detected INTEGER,            -- 本次发现了多少新 gaps
  gap_driven_searches INTEGER,      -- 多少搜索是为了填补 gaps
  
  -- 跳过原因统计
  skip_reasons TEXT,                -- JSON: {"low_surprise": 5, "duplicate": 3, ...}
  
  latency_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_ripple_logs_trigger ON ripple_logs(trigger_entity_id);
```

---

## 6. Core Algorithm

### 6.1 Gap Detection Flow

```typescript
// @ref:data-gap/detect-gaps
// src/lib/data-gap/detector.ts

import { ENTITY_SCHEMA_EXPECTATIONS } from '@prism/contract';

export async function detectGaps(entityId: string): Promise<DataGap[]> {
  const db = getDB();
  const entityType = entityId.split(':')[0];
  
  // 1. Get expectations for this entity type
  const expectations = ENTITY_SCHEMA_EXPECTATIONS[entityType] || [];
  if (expectations.length === 0) return [];
  
  // 2. Get existing relations
  const existingRelations = db.query(`
    SELECT DISTINCT type FROM relations 
    WHERE source = ? OR target = ?
  `).all(entityId, entityId) as { type: string }[];
  
  const existingTypes = new Set(existingRelations.map(r => r.type));
  
  // 3. Identify gaps
  const gaps: DataGap[] = [];
  const entityTitle = getEntityTitle(entityId);
  
  for (const exp of expectations) {
    if (!existingTypes.has(exp.relation)) {
      // Generate search query from template
      const query = exp.queryTemplate.replace('{name}', entityTitle);
      
      gaps.push({
        entityId,
        entityType,
        missingRelation: exp.relation,
        expectedTargetType: exp.targetType,
        priority: exp.priority,
        suggestedQueries: [query],
        reasoning: exp.description
      });
    }
  }
  
  return gaps;
}

export async function detectGapsForNewEntities(
  entityIds: string[]
): Promise<DataGap[]> {
  const allGaps: DataGap[] = [];
  
  for (const entityId of entityIds) {
    const gaps = await detectGaps(entityId);
    allGaps.push(...gaps);
  }
  
  // Deduplicate and prioritize
  return prioritizeGaps(allGaps);
}
```

### 6.2 Integration Points

```typescript
// @ref:data-gap/integration

// 1. After Extraction
// src/lib/graph-link/atoms/entity-extraction.ts
async function afterExtraction(entities: ExtractedEntity[], sourceId: number) {
  // ... existing extraction logic ...
  
  // NEW: Detect gaps for newly extracted entities
  const entityIds = entities.map(e => e.id);
  const gaps = await detectGapsForNewEntities(entityIds);
  
  // Store gaps
  for (const gap of gaps) {
    await insertDataGap(gap);
  }
  
  // Log to extraction_logs
  await logExtraction({
    sourceId,
    sourceType: 'memory',
    entitiesExtracted: entities.length,
    dataGapsDetected: gaps
  });
}

// 2. After Scout Profile
// src/lib/agents/scout/agent.ts
async function afterProfile(entityId: string, profile: EntityProfile) {
  // Check which gaps were filled
  const gapsBefore = await getOpenGaps(entityId);
  const gapsAfter = await detectGaps(entityId);
  
  const filled = gapsBefore.filter(
    g => !gapsAfter.find(a => a.missingRelation === g.missingRelation)
  );
  
  // Mark filled gaps
  for (const gap of filled) {
    await markGapFilled(gap.id, `scout:${entityId}`);
  }
  
  // Log to scout_logs
  await logScout({
    entityId,
    gapsBefore: gapsBefore.length,
    gapsFilled: filled.length,
    gapsRemaining: gapsAfter
  });
}

// 3. Ripple Gap-Driven Search
// src/lib/ripple/agent.ts
async function generateSearchQueries(entityId: string): Promise<string[]> {
  // Get open high-priority gaps
  const gaps = await getOpenGaps(entityId, { priority: ['critical', 'high'] });
  
  // Use gap-suggested queries
  const gapQueries = gaps.flatMap(g => g.suggestedQueries);
  
  // Combine with serendipity queries
  const serendipityQueries = await generateSerendipityQueries(entityId);
  
  return [...gapQueries, ...serendipityQueries];
}
```

---

## 7. LLM-Assisted Gap Detection

### 7.1 Extraction-Time Gap Detection

在 extraction 时，让 LLM 同时输出它认为"缺失但重要"的信息：

```typescript
// @ref:data-gap/llm-prompt
const EXTRACTION_PROMPT_WITH_GAP_DETECTION = `
...existing extraction prompt...

ADDITIONAL OUTPUT: For each extracted entity, also identify what important 
information is MISSING from the source document that would typically be 
known about this type of entity.

Output format:
{
  "entities": [...],
  "relations": [...],
  "data_gaps": [
    {
      "entity_id": "person:simon_willison",
      "missing": "educational background",
      "reason": "Important for understanding expertise origins",
      "suggested_query": "Simon Willison education university"
    }
  ]
}
`;
```

### 7.2 Profile Completeness Assessment

Scout 完成后，让 LLM 评估 profile 完整度：

```typescript
// @ref:data-gap/profile-assessment
const PROFILE_ASSESSMENT_PROMPT = `
Given this entity profile:
${JSON.stringify(profile)}

Assess completeness on a 0-1 scale for:
1. factual_accuracy: Are stated facts verifiable?
2. context_richness: Is there enough context to understand this entity?
3. relationship_coverage: Are key relationships captured?
4. temporal_coverage: Is the timeline clear?

Also identify what's STILL MISSING that would be valuable:

Output:
{
  "completeness": 0.75,
  "scores": {
    "factual_accuracy": 0.9,
    "context_richness": 0.7,
    "relationship_coverage": 0.6,
    "temporal_coverage": 0.8
  },
  "still_missing": [
    {"aspect": "early career", "query": "..."},
    {"aspect": "recent projects", "query": "..."}
  ]
}
`;
```

---

## 8. CLI Tools

### 8.1 Gap Analysis

```bash
# 查看所有 open gaps
pnpm gap-stats

# 查看特定实体的 gaps
pnpm gap-stats --entity person:simon_willison

# 按优先级统计
pnpm gap-stats --by-priority

# 触发 gap-driven scout
pnpm gap-fill --priority critical --limit 10
```

### 8.2 Quality Dashboard

```bash
# 提取质量总览
pnpm quality-dashboard

# 输出:
# ┌─────────────────────────────────────────────────────┐
# │  KG Quality Dashboard                               │
# ├─────────────────────────────────────────────────────┤
# │  Entities: 1,234                                    │
# │  Relations: 5,678                                   │
# │                                                     │
# │  Data Gaps:                                         │
# │    Critical: 12 (3 searching, 9 open)              │
# │    High: 45 (10 searching, 35 open)                │
# │    Medium: 234 (20 filled today)                   │
# │                                                     │
# │  Extraction Quality (last 7 days):                 │
# │    Avg entities/source: 4.2                        │
# │    New type candidates: 8                          │
# │    Avg confidence: 0.82                            │
# │                                                     │
# │  Scout Quality (last 7 days):                      │
# │    Avg completeness: 0.71                          │
# │    Gaps filled: 156                                │
# │    Sources diversity: 0.68                         │
# └─────────────────────────────────────────────────────┘
```

---

## 9. Implementation Roadmap

### Phase 4.5a: Schema & Tables (Day 1)

- [ ] Create `packages/prism-contract/src/schema-expectations.ts`
- [ ] Create migration `v52_data_gap_detection.ts`
- [ ] Run migration

### Phase 4.5b: Core Detection Logic (Day 1-2)

- [ ] Implement `src/lib/data-gap/detector.ts`
- [ ] Implement `src/lib/data-gap/logger.ts`
- [ ] Add integration hooks to extraction

### Phase 4.5c: Agent Integration (Day 2-3)

- [ ] Integrate with extraction pipeline
- [ ] Integrate with scout agent
- [ ] Integrate with ripple agent

### Phase 4.5d: CLI & Dashboard (Day 3)

- [ ] `gap-stats` CLI
- [ ] `gap-fill` CLI
- [ ] `quality-dashboard` CLI

---

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Gap Detection Rate | >80% of high-priority gaps | `gaps_detected / expected_gaps` |
| Gap Fill Rate | >50% within 7 days | `gaps_filled / gaps_detected` |
| Profile Completeness | Avg >0.7 | From `scout_logs.profile_completeness` |
| False Positive Rate | <10% | Manual sampling review |

---

## 11. @ref Tags

| Ref ID | Code | Description |
|--------|------|-------------|
| `data-gap/schema-expectations` | `prism-contract/schema-expectations.ts` | Entity type expectations |
| `data-gap/tables` | `migrations/v52_data_gap_detection.ts` | Database schema |
| `data-gap/detect-gaps` | `lib/data-gap/detector.ts` | Core detection logic |
| `data-gap/integration` | Multiple files | Integration points |
| `data-gap/llm-prompt` | `lib/data-gap/llm-assistant.ts` | LLM prompts |
| `data-gap/profile-assessment` | `lib/agents/scout/agent.ts` | Profile completeness |
| `data-gap/cli` | `cli/gap-stats.ts`, `cli/gap-fill.ts` | CLI tools |

---

## Related Documents

- [Entity Definitions](../packages/prism-contract/src/entity-definitions.ts) - Four Tribes classification
- [Ripple Effect Spec](./RIPPLE-EFFECT-SPEC.md) - How ripple uses gaps
- [Scout Anything](./SCOUT-ANYTHING.md) - Scout integration
- [Search Quality Logs](./search_logs table) - Phase 0.5 search logging
