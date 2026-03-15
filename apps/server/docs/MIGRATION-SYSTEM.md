# Prism Migration System

> 版本化、分布式、自维护的本地优先迁移系统

## 概述

本地优先产品面临独特的迁移挑战：用户数据分散在各自设备上，无法像云服务那样统一升级。Prism 的迁移系统借鉴业界最佳实践，实现了：

- **自动 Schema 迁移** - 启动时自动升级数据库结构
- **AI Pipeline 版本追踪** - 检测 prompt/模型变化，触发数据更新
- **健康检查与自愈** - 检测并修复数据损坏
- **懒迁移** - 按需 + 后台渐进式处理 stale 数据

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Server Startup Flow                       │
├─────────────────────────────────────────────────────────────┤
│  1. Open Database                                            │
│  2. Run Schema Migrations (blocking, ACID)                   │
│  3. Health Check (integrity, FTS sync, orphans)              │
│  4. Self-Heal (auto-fix issues)                              │
│  5. Pipeline Version Check (mark stale)                      │
│  6. Start HTTP Server                                        │
│  7. Start Background Worker                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Runtime Flow                              │
├─────────────────────────────────────────────────────────────┤
│  On Page Access:                                             │
│    → Check if blocks are stale                               │
│    → Return current data immediately (stale-while-revalidate)│
│    → Trigger async refresh in background                     │
│                                                              │
│  Background Worker (every 30s):                              │
│    → Pick up stale entities                                  │
│    → Process in small batches                                │
│    → Rate-limited to avoid API overload                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 数据分层策略

### Source of Truth（用户数据）
- `memories` - 用户导入的原始文档
- `entity_aliases` - 用户手动合并的实体
- `memory_interactions` - 用户行为记录
- `settings` - 用户配置

**迁移策略：严格迁移，绝不丢失**

### Derived Data（系统生成）
- `entities` - AI 提取的实体
- `page_blocks` - 页面布局
- `relations` - 实体关系

**迁移策略：懒迁移 + 可重建**

---

## 文件结构

```
apps/prism-server/
├── src/
│   ├── migrations/
│   │   ├── index.ts          # 迁移运行器（核心）
│   │   ├── v1_initial.ts     # V1: 初始 schema
│   │   ├── v2_ssot.ts        # V2: SSOT 颜色系统
│   │   ├── v3_pipeline.ts    # V3: Pipeline 版本追踪
│   │   ├── v4_fix_entity_types.ts   # V4: 分类修复
│   │   ├── v5_add_milestone_type.ts # V5: 新增 milestone
│   │   ├── v6_link_project_milestones.ts # V6: sibling 关联
│   │   ├── v7_fix_milestone_tags.ts # V7: Tag + 去重
│   │   ├── ...                      # V8-V19: Various fixes
│   │   ├── v20_entity_metadata.ts   # V20: Entity metadata table
│   │   ├── v21_trust_metrics.ts     # V21: Trust metrics
│   │   ├── v22_ensure_schema_integrity.ts # V22: Schema integrity
│   │   ├── v23_memories_discarded.ts # V23: Add discarded column to memories
│   │   ├── v24_entity_groups.ts     # V24: Entity equivalence groups (replaces aliases)
│   │   └── v28_backfill_memory_entities.ts # V28: Backfill entities for legacy memories
│   ├── pipeline-version.ts   # Pipeline 版本管理
│   ├── health-check.ts       # 健康检查 + 自愈
│   ├── background-worker.ts  # 后台 stale 处理
│   ├── db.ts                 # 数据库入口（调用迁移）
│   └── server.ts             # 启动序列
│
├── .claude/                  # 规则沉淀目录（迁移经验）
│   ├── CLAUDE.md             # 项目状态 + 决策记录
│   └── rules/
│       ├── extraction-rules.yaml  # 分类规则 (V4, V5, V7)
│       ├── dedup-rules.yaml       # 去重规则 (V7)
│       ├── linking-rules.yaml     # 关联规则 (V6)
│       └── ranking-rules.yaml     # 排序规则 (待积累)
│
└── docs/
    └── MIGRATION-SYSTEM.md   # 本文档
```

---

## Schema 迁移

### 版本追踪机制

使用 SQLite 的 `PRAGMA user_version` 追踪数据库版本：

```typescript
// 获取当前版本
const version = db.pragma('user_version', { simple: true });

// 设置版本
db.pragma(`user_version = ${newVersion}`);
```

### 迁移文件格式

```typescript
// src/migrations/v{N}_{name}.ts
export const v2_ssot: Migration = {
  version: 2,
  name: 'schema_v2_ssot',
  description: 'Add is_header, is_source columns for SSOT',
  
  up: (db: Database.Database) => {
    // 检查列是否存在
    if (!columnExists(db, 'page_blocks', 'is_header')) {
      db.exec('ALTER TABLE page_blocks ADD COLUMN is_header INTEGER DEFAULT 0');
    }
    // ...
  },
};
```

### 迁移规则

1. **永不删除或重排迁移** - 只追加新迁移
2. **幂等设计** - 使用 `IF NOT EXISTS`，检查列是否存在
3. **事务保护** - 每个迁移在独立事务中执行
4. **向后兼容** - 处理旧数据库的遗留结构

---

## Pipeline 版本管理

### 版本计算

```typescript
// src/pipeline-version.ts
export const PIPELINE_VERSION = {
  extraction: {
    version: '1.1.0',  // 语义版本
    promptHash: computePromptHash(EXTRACTION_PROMPT),  // MD5 前 8 位
    model: 'gpt-4o-mini',
  },
};

// 组合版本字符串
export function getExtractionVersion(): string {
  return `v${version}_${promptHash}`;  // e.g., "v1.1.0_60edb9d8"
}
```

### Stale 检测

```typescript
export function isEntityStale(entityId: string): boolean {
  const entity = db.prepare('SELECT is_stale, pipeline_version FROM entities WHERE id = ?').get(entityId);
  
  if (entity.is_stale === 1) return true;
  if (entity.pipeline_version !== getExtractionVersion()) return true;
  
  return false;
}
```

### 何时触发重提取

| 场景 | 触发方式 |
|------|----------|
| Prompt 修改 | 启动时自动检测 hash 变化，标记 stale |
| 模型更换 | 更新 version，触发全量标记 |
| 手动修复 | CLI: `npm run extract --idempotent` |
| 用户访问 | On-access 触发后台刷新 |

---

## 健康检查

### 检查项

| 检查 | 说明 | 自动修复 |
|------|------|----------|
| `PRAGMA integrity_check` | SQLite 完整性 | ❌ |
| FTS 同步 | memories_fts 与 memories 行数一致 | ✅ 重建索引 |
| 孤立 page_blocks | 引用不存在的 entity | ✅ 删除孤立记录 |
| Pipeline 版本 | 检测过期实体 | ✅ 标记 stale |

### 自愈流程

```typescript
// src/health-check.ts
export function selfHeal(db: Database, report: HealthReport) {
  for (const issue of report.issues) {
    if (!issue.autoFixable) continue;
    
    switch (issue.code) {
      case 'FTS_MEMORIES_DESYNC':
        rebuildMemoriesFTS(db);  // 重建 FTS 索引
        break;
      case 'ORPHANED_PAGE_BLOCKS':
        removeOrphanedPageBlocks(db);  // 删除孤立记录
        break;
      case 'PIPELINE_VERSION_MISMATCH':
        markOutdatedEntitiesStale();  // 标记 stale
        break;
    }
  }
}
```

---

## 懒迁移

### On-Access 刷新

```typescript
// src/pages.ts
export function getPageFromDB(pageId: string): PrismPage | null {
  const blockRows = getPageBlocks(pageId);
  const blocks = blockRows.map(rowToBlock);
  
  // 检测 stale blocks
  const staleBlockIds = blocks.filter(b => isEntityStale(b.id)).map(b => b.id);
  
  if (staleBlockIds.length > 0) {
    // 触发异步刷新（不阻塞当前请求）
    triggerEntityRefresh(staleBlockIds);
  }
  
  // 立即返回当前数据（stale-while-revalidate）
  return { id: pageId, blocks };
}
```

### Background Worker

```typescript
// src/background-worker.ts
const WORKER_CONFIG = {
  pollInterval: 30000,   // 30 秒轮询
  batchSize: 5,          // 每批处理 5 个
  entityDelay: 1000,     // 实体间延迟 1 秒
  maxRetries: 3,         // 最大重试次数
};

export function startBackgroundWorker() {
  setInterval(async () => {
    const staleEntities = getStaleEntities(WORKER_CONFIG.batchSize);
    for (const entity of staleEntities) {
      await refreshEntity(entity.id);
      await sleep(WORKER_CONFIG.entityDelay);
    }
  }, WORKER_CONFIG.pollInterval);
}
```

---

## CLI 命令

```bash
# 查看数据库状态
npm run db-status        # 显示版本、表统计、stale 数量

# 手动迁移（通常不需要）
npm run migrate          # 运行 pending 迁移

# 重提取（幂等）
npm run extract --idempotent  # 更新现有实体，添加缺失关系

# 健康检查
npm run health-check     # 显示报告 + 自动修复
```

---

## Migration Lifecycle (迁移生命周期)

每次迁移应遵循完整的 5 步闭环：

```
DISCOVER → ANALYZE → MIGRATE → SEDIMENT → VERIFY
  发现       分析      迁移       沉淀       验证
```

### Step 1: DISCOVER (发现问题)

来源：
- UI 截图反馈
- `npm run find-duplicates` 发现的重复
- `npm run health-check` 报告的问题
- 用户反馈

### Step 2: ANALYZE (分析归类)

将问题归类到规则文件：

| 问题类型 | 规则文件 | 示例 |
|---------|---------|------|
| 分类错误 | `extraction-rules.yaml` | event → milestone |
| 重复实体 | `dedup-rules.yaml` | 同名不同 ID |
| 关系缺失 | `linking-rules.yaml` | 同 project 的 milestones |
| Tag 错误 | `extraction-rules.yaml` | tag=EVENT 应为 MILESTONE |

### Step 3: MIGRATE (创建并执行迁移)

见下方 "添加新迁移" 部分。

### Step 4: SEDIMENT (沉淀规则) ⚠️ 关键步骤

**必须** 将迁移中发现的模式沉淀到 `.claude/rules/`：

| 迁移类型 | 规则文件 | 字段 |
|---------|---------|------|
| 分类修复 | `extraction-rules.yaml` | `product.classification_rules` |
| 去重规则 | `dedup-rules.yaml` | `product.auto_merge_patterns` |
| 关联规则 | `linking-rules.yaml` | `product.sibling_linking` |

**示例：V7 迁移后的沉淀**

```yaml
# .claude/rules/dedup-rules.yaml
product:
  auto_merge_patterns:
    - id: "same_title_diff_id"
      description: "同类型 + 完全相同的 title"
      action: "自动合并，保留第一个"
      migration: "V7"  # 关联迁移版本
```

**同时更新 `.claude/CLAUDE.md`**:
- 决策记录（为什么做这个迁移）
- 模块状态表（当前版本）

> 💡 **为什么沉淀很重要？**
> 
> 规则文件是迁移经验的"知识库"。未来可用于：
> 1. 指导 AI 提取时避免同类错误
> 2. 自动化 `find-duplicates` 的合并建议
> 3. Claude Agent 自动维护时的参考

### Step 5: VERIFY (验证)

```bash
npm run dev                    # 重启服务
npm run health-check           # 检查健康
# 前端验证 UI 是否正确
```

---

## 添加新迁移

### Step 1: 创建迁移文件

```typescript
// src/migrations/v4_new_feature.ts
import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const v4_new_feature: Migration = {
  version: 4,
  name: 'new_feature',
  description: 'Add support for new feature X',
  
  up: (db: Database.Database) => {
    // 添加新列
    db.exec('ALTER TABLE entities ADD COLUMN new_field TEXT');
    
    // 迁移现有数据
    db.prepare('UPDATE entities SET new_field = ? WHERE new_field IS NULL').run('default');
  },
};
```

### Step 2: 注册迁移

```typescript
// src/migrations/index.ts
import { v4_new_feature } from './v4_new_feature.js';

const MIGRATIONS: Migration[] = [
  v1_initial,
  v2_ssot,
  v3_pipeline,
  v4_new_feature,  // 添加到末尾
];
```

### Step 3: 测试

```bash
# 备份数据库
cp prism.db prism.db.backup

# 重启服务器（自动运行迁移）
npm run dev
```

---

## 实际案例：V4 实体类型修复

### 问题

AI 提取时错误地将设计概念和产品阶段分类为 `event` 类型：

```
event:demo_drop_to_feed   → 红色 🔴 (错误)
event:mvp_phase           → 红色 🔴 (错误)
event:phase_1_mvp         → 红色 🔴 (错误)
```

### 解决方案

创建 V4 迁移 `v4_fix_entity_types.ts`：

```typescript
const RECLASSIFY_RULES = [
  { pattern: 'event:demo_%', oldPrefix: 'event:', newPrefix: 'concept:' },
  { pattern: 'event:mvp_%',  oldPrefix: 'event:', newPrefix: 'concept:' },
  { pattern: 'event:phase_%', oldPrefix: 'event:', newPrefix: 'concept:' },
];

// 迁移逻辑
for (const entity of matchingEntities) {
  const newId = oldId.replace(rule.oldPrefix, rule.newPrefix);
  
  // 原子更新所有引用
  db.prepare('UPDATE entities SET id = ? WHERE id = ?').run(newId, oldId);
  db.prepare('UPDATE page_blocks SET block_id = ? WHERE block_id = ?').run(newId, oldId);
  db.prepare('UPDATE relations SET source = ? WHERE source = ?').run(newId, oldId);
}
```

### 结果

```
concept:demo_drop_to_feed   → 黄色 🟡 (正确)
concept:mvp_phase           → 黄色 🟡 (正确)
concept:phase_1_mvp         → 黄色 🟡 (正确)
```

### 学到的经验

1. **迁移可以修复数据** - 不只是 schema 变更
2. **跨表更新需要原子性** - entity ID 变化影响多个表
3. **模式匹配要精确** - 使用 SQL LIKE 模式避免误伤

---

## 实际案例：V5 新增实体类型

### 问题

`concept` 类型语义过宽，同时包含：
- 抽象概念（设计模式、想法）
- 项目阶段（MVP Phase, Phase 1）

这导致不同性质的实体有相同的颜色，用户难以区分。

### 解决方案

引入新的 `milestone` 类型，需要修改多个层次：

#### 1. 类型定义层（SSOT）

```typescript
// entity-semantics.ts
ENTITY_TYPE_TO_ROLE = {
  milestone: 'intel',  // 🔵 蓝色 - 项目进度信息
  concept: 'spark',    // 🟡 黄色 - 抽象概念
};
```

#### 2. Contract 层

```typescript
// prism-contract/types.ts
type EntityCategory = 
  | 'concept'    // Ideas, frameworks, design patterns
  | 'milestone'  // Project phases, stages, progress markers
  | ...
```

#### 3. Prompt 层

```
EXTRACTION_PROMPT 更新：
- concept: Abstract ideas, frameworks, design patterns
- milestone: Project phases, stages, progress markers (MVP, Phase 1, Beta)
```

#### 4. 数据迁移层

```typescript
// v5_add_milestone_type.ts
const RECLASSIFY_RULES = [
  { pattern: 'concept:phase_%' },
  { pattern: 'concept:mvp_%' },
  { pattern: 'concept:%_release' },
];
// concept:phase_1 → milestone:phase_1
```

### 结果

```
concept:demo_drop_to_feed   → 🟡 黄色 (设计模式，保留 concept)
milestone:mvp_phase         → 🔵 蓝色 (项目阶段，新类型)
milestone:phase_1_mvp       → 🔵 蓝色 (里程碑，新类型)
```

### 学到的经验

1. **Destructive 修改需要多层联动**
   - SSOT (entity-semantics.ts)
   - Contract (types.ts)
   - Prompt (pipeline-version.ts)
   - Migration (数据迁移)

2. **Prompt 变化会触发 stale 标记**
   - Hash 自动检测变化
   - 64 个实体被标记为需要重提取

3. **新类型引入是 additive 的**
   - 不破坏现有数据
   - 通过迁移渐进式重分类

---

## 规则沉淀 (.claude/)

`.claude/` 目录是迁移系统的"知识库"，记录从迁移中学到的模式。

### 目录结构

```
.claude/
├── CLAUDE.md                    # 项目状态 + 决策记录
└── rules/
    ├── extraction-rules.yaml    # 分类规则
    ├── dedup-rules.yaml         # 去重规则
    ├── linking-rules.yaml       # 关联规则
    └── ranking-rules.yaml       # 排序规则
```

### 规则文件格式

每个规则文件分为两层：

```yaml
# product: 产品级规则（可复用到其他项目）
product:
  classification_rules:
    - id: "phase_is_milestone"
      pattern: "*_phase, phase_*"
      correct_type: "milestone"
      wrong_type: "event"
      migration: "V5"  # 关联迁移

# user: 用户级规则（私有数据相关）
user:
  custom_rules:
    - pattern: "某用户特有的实体模式"
```

### 迁移 → 规则对照表

| 迁移 | 规则文件 | 规则 ID | 说明 |
|-----|---------|--------|------|
| V4 | extraction-rules.yaml | `interaction_is_concept` | 设计模式 ≠ event |
| V5 | extraction-rules.yaml | `phase_is_milestone` | 阶段是 milestone |
| V6 | linking-rules.yaml | `project_milestones` | 同 project 的 milestone 互联 |
| V7 | dedup-rules.yaml | `same_title_diff_id` | 同名实体自动合并 |

### 规则用途

1. **Prompt 工程**: 规则可直接嵌入 EXTRACTION_PROMPT，指导 AI 避免同类错误
2. **自动化建议**: `find-duplicates` 可读取 `dedup-rules.yaml` 自动推荐合并
3. **Agent 维护**: Claude Agent 可参考规则文件进行自主维护

---

## 设计决策

### 为什么用 `PRAGMA user_version`？

- ✅ 原子性：SQLite 内置，事务安全
- ✅ 轻量：单个整数，无额外表
- ✅ 标准：业界常用实践
- ❌ 不支持回滚（SQLite 限制）

### 为什么用 Hash 追踪 Prompt？

- ✅ 自动检测：不需要手动更新版本号
- ✅ 精确：任何字符变化都会触发
- ❌ 无法区分"有意义"的变化

### 为什么用懒迁移？

- ✅ 非阻塞：用户不感知迁移过程
- ✅ 渐进式：高优先级页面先更新
- ✅ API 友好：避免瞬时大量请求
- ❌ 短期内数据可能不一致

---

## 未来扩展

- [ ] **Migration Manager CLI** - 交互式迁移管理
- [ ] **Feature Flags** - 灰度发布新算法
- [ ] **Checkpoint/Restore** - 迁移失败回滚
- [ ] **Distributed Sync** - 多设备数据同步

---

## 参考

- [SQLite PRAGMA user_version](https://www.sqlite.org/pragma.html#pragma_user_version)
- [Flyway Migration Patterns](https://flywaydb.org/documentation/concepts/migrations)
- [Stale-While-Revalidate](https://web.dev/stale-while-revalidate/)

