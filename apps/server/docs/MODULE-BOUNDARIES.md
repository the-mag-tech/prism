# Module Boundaries Architecture

> **Status**: Active  
> **Date**: 2026-01-08 (Updated)  
> **Authors**: Magpie Team

---

## 1. Overview

本文档定义 prism-server 中各模块的职责边界、依赖关系和协作模式。

### 1.1 模块职责总表

| 模块 | 隐喻 | 职责 | 输入 | 输出 | 触发方式 |
|------|------|------|------|------|----------|
| **Scout** | 情报员 | 从外部采集、验证、快照 | 实体名/URL | grounded entity | 用户/系统触发 |
| **DeepExplorer** | 探险家 | 多轮深度挖掘 | topic string | structured insights | 用户触发 |
| **Ripple** | 涟漪 | 知识传播，Profile 生成 | 实体事件 | 新关系/内容 | 事件驱动 |
| **Serendipity** | 观察者 | 监听探索，检测认知闭环 | 探索事件流 | cognitive loops | 被动监听 |
| **Curator** | 园丁 | 清理重复、修复关系 | 整个图谱 | 更干净的图谱 | 后台定时 |
| **PhysicsSystem** | 引擎 | 计算 Gravity (SSOT) | entity + context | gravity_score | API/tick |

### 1.2 Agent Workers (All use AgentLogger)

| Agent | 文件位置 | AgentLogger 类型 | 队列持久化 |
|-------|---------|-----------------|-----------|
| **Ripple** | `lib/agents/ripple/worker.ts` | `scout` / `ripple` | ✅ |
| **Scout** | `lib/agents/scout/worker.ts` | `scout` / `patrol` | ✅ |
| **Explorer** | `lib/agents/explorer/worker.ts` | `deep_explorer` / `explore` | ✅ |
| **Curator** | `lib/agents/curator/worker.ts` | `curator` / `cycle` | ✅ |

---

## 2. 模块详解

### 2.1 Scout (lib/scout/)

**职责**：实体导向的情报采集

```
"Simon 是谁？" → 搜索 → 验证 → 快照 → 写入图谱
```

**核心能力**：
- `extract()` - 从文本提取实体
- `scout()` - 搜索验证实体
- `profile()` - 生成实体画像
- `onboard()` - 将实体写入图谱（触发 Ripple Effect）

**关键特点**：
- 收敛性搜索：找到唯一正确答案
- 一致性验证：防止实体混淆（Simon Willison vs Simon Cowell）
- 写入图谱：memories, public_content, entities

### 2.2 DeepExplorer (lib/deep-explorer/)

**职责**：主题导向的深度探索

```
"为什么下雨场景这么震撼？" → 多方向探索 → 对抗评估 → 深度挖掘
```

**核心能力**：
- `exploreAuto()` - 自动分析查询，配置策略
- `explore()` - 手动指定策略的探索
- 策略模式：`IDepthStrategy` (Irony, Evidence, ...)

**关键特点**：
- 发散性搜索：多头并行探索不同方向
- 深度评估：达到 targetLevel 才停止
- 可插拔策略：不同产品可以用不同的"深度"定义

### 2.3 Ripple (lib/agents/ripple/ + lib/ripple/)

**职责**：事件驱动的知识传播

```
ENTITY_CREATED → RippleSystem.emit() → enqueueRipple() → worker handles → agent.propagate()
```

**核心能力**：
- `propagate()` - 知识传播（Profile 生成 + 内容引入）
- `profile()` - 基于 TRIBE_PROFILE_STRATEGIES 生成搜索查询
- `onboard()` - 高价值内容引入（Serendipity 过滤）
- `evaluateCandidates()` - 基于图谱的惊喜度计算

**关键特点**：
- 持久化队列：使用 `bun-queue.ts` 存储任务到 SQLite
- 崩溃恢复：启动时自动恢复 `processing` 状态任务
- SSOT 驱动：`PROFILEABLE_TYPES` 决定哪些类型需要 Profile
- Serendipity 过滤：只引入"惊喜度"超过阈值的内容

**触发链**：
```
MCP Ingest → ingestFinding() → MEMORY_INGESTED
                                    ↓
                               extractEntities()
                                    ↓
                               ENTITY_CREATED
                                    ↓
                           rippleSystem.emit()
                                    ↓
                           enqueueRipple(task)  ← 持久化到 prism_jobs
                                    ↓
                            Worker 处理
                                    ↓
                          agent.propagate(entityId)
```

详见 [RIPPLE-EFFECT-SPEC.md](./RIPPLE-EFFECT-SPEC.md)

### 2.4 Serendipity (lib/serendipity/)

**职责**：认知闭环检测（观察者模式）

```
startJourney() → afterScout()/afterExplore() → detectLoops() → embedLoops()
```

**核心能力**：
- `startJourney()` - 开始监听探索旅程
- `afterScout()` - 记录 Scout 发现
- `onEntityView()` - 检测闭环触发
- `endJourney()` - 结束旅程，返回检测到的闭环

**关键特点**：
- 不主动触发探索
- 只监听和记录
- 埋入"过程笑话"等待用户发现

### 2.5 Curator (lib/agents/curator/)

> **更名说明**: 原名 "Gardener"，现统一为 "Curator"

**职责**：图谱维护和治理

```
findCandidates() → record() → [user decides] → merge()
```

**核心能力**：
- `findCandidates()` - 发现潜在重复（Embedding 相似度）
- `recordCandidate()` - 写入 `merge_candidates` 表
- `merge()` - 执行合并（仅用户触发）

**V1 策略（保守模式）**：
- ❌ 不自动合并
- ✅ 只检测和记录候选
- ✅ 用户通过 UI/CLI 决定
- ✅ 完整审计追踪

**关键洞察**：
> "同名不同实体" — 你的 Simon ≠ 网上的 Simon
> 来源域（email/web）是消歧的重要信号

详见 [GARDENER-PROTOCOL.md](./GARDENER-PROTOCOL.md)

### 2.5 ~~FieldSensors~~ (已移除)

> **Status**: 已在 2025-12-17 清理中移除
> **原因**: 功能尚未完整实现，与 Serendipity 检测机制重叠
> **未来计划**: 如需内容检测，应通过 Graph Link Atoms 实现

---

## 3. Scout vs DeepExplorer 本质区别

| 维度 | Scout | DeepExplorer |
|------|-------|--------------|
| **核心问题** | "这是谁/什么？" | "这背后是什么？" |
| **输入类型** | 实体（模糊引用） | 主题（开放问题） |
| **目标** | 验证 — 把模糊变具体 | 探索 — 把表面变深刻 |
| **搜索策略** | 收敛 — 找到最匹配的一个 | 发散 — 多头并行探索 |
| **终止条件** | 找到即停（验证通过） | 深度够了才停（达到 targetLevel） |
| **核心算法** | 一致性验证 | 深度评估（策略模式） |
| **输出** | grounded entity | structured insights |
| **Graph 读取** | `getFingerprint()` 构建搜索指纹 | `getFingerprint()` + `resolveEntity()` 丰富意图 |
| **Graph 写入** | `ingestFinding()` 写入发现 | `ingestFinding()` 写入发现 |

---

## 3.1 Graph Link 层统一接口

> **重构日期**: 2025-12-17

Scout 和 DeepExplorer 都通过 `graph-link/` 层与图谱交互，实现了**双向互动**。

### GraphReader 增强 API

```typescript
// 返回包含关系的完整指纹（推荐）
graphReader.getFingerprint(entityId, options?) → EntityFingerprint | null

interface EntityFingerprint {
  entityId: string;
  title: string;
  subtitle?: string;
  bodyExcerpt?: string;
  relatedTerms: string[];  // 关系实体名列表
  fingerprint: string;     // 用于搜索的完整字符串
}

// 向后兼容的字符串接口
graphReader.enrichContext(entityId, options?) → string | null
```

### 双向互动架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                           PRISM GRAPH                                │
│   entities | relations | memories | public_content                   │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
              ┌─────▼─────┐               ┌─────▼─────┐
              │GraphReader│               │GraphWriter│
              │           │               │           │
              │• getFingerprint()         │• ingestFinding()
              │• resolveEntity()          │• recordActivity()
              │• getRelations()           │• boostGravity()
              │                           │• setGravity()
              └─────┬─────┘               └─────▲─────┘
                    │                           │
      ┌─────────────┼─────────────┬─────────────┤
      │             │             │             │
      ▼             ▼             ▼             │
┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  Scout   │  │  Intent  │  │ DeepExplorer │   │
│  Agent   │  │ Extractor│  │   Engine     │   │
│          │  │          │  │              │   │
│ patrol() │  │extract() │  │generateDir() │   │
│ profile()│  │          │  │multiHeadExp()│───┘ (writes findings)
└──────────┘  └──────────┘  └──────────────┘
```

### 调用点总结

| 模块 | GraphReader 使用 | GraphWriter 使用 |
|------|------------------|------------------|
| `scout/agent.ts` | `getFingerprint()` 构建搜索指纹 | `ingestFinding()` 写入发现 |
| `deep-explorer/engine.ts` | `getFingerprint()` 丰富方向生成 | `ingestFinding()` 写入发现 |
| `deep-explorer/intent-extractor.ts` | `resolveEntity()` + `getFingerprint()` 丰富意图 | - |

---

## 4. Systems 层 (ECS 调度)

Systems 是 ECS 架构的调度层，把 lib/ 模块编排成持续运行的模拟引擎。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Game Loop (模拟循环)                          │
│                                                                 │
│   PhysicsSystem.tick()  →  RenderSystem.render()  →  ScoutSystem.tick()
│         │                         │                       │
│         ▼                         ▼                       ▼
│   计算 Gravity              映射视觉权重             调度 Scout 任务
│   (Convergence+Path+Spark)   (Anchor/Spark)          (LOD-based)
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 PhysicsSystem (Single Source of Truth)

**职责**：计算实体的"重力" - 所有 Gravity 计算的唯一来源

**位置**：`src/systems/PhysicsSystem.ts`

**API**：
```typescript
// 静态方法 - 按需计算单个实体
calculateEntityGravity(entity: GravityCandidate, context?: PhysicsContext): GravityResult

// 实例方法 - 批量 tick 更新
new PhysicsSystem().tick(context): Promise<Entity[]>

// HTTP 端点
POST /api/field/tick  { lens?: string, userPath?: string[] }
```

**Gravity 公式**：
```
G = 0.4×Convergence + 0.3×Path + 0.2×Spark + 0.1×Base

Convergence: 时间收敛（事件越近分数越高）
Path:        路径历史（用户最近访问分数越高）
Spark:       新鲜度（最近 scout 过分数越高）
Base:        基础质量（实体固有权重）
```

> **注意**：`recommend.ts` 已重构为委托给 PhysicsSystem，不再包含独立的计算逻辑。

### 4.2 RenderSystem (Magpie 前端)

**职责**：将 Gravity 映射为视觉权重

> **注意**：RenderSystem 在 Magpie 前端实现，不在 Prism 后端。
> 参见 `apps/magpie/src/lib/data-layer.ts`

| Rank | Visual Weight |
|------|---------------|
| 1 | HEAVY (Anchor) |
| 2-3 | MEDIUM (Banner) |
| 4+ | LIGHT (Spark) |

### 4.3 ScoutSystem (LOD 调度)

**职责**：根据 Gravity 调度 Scout 任务

| LOD 等级 | Gravity 阈值 | 检查间隔 | 含义 |
|----------|-------------|---------|------|
| **LOD 0** | G > 0.8 | 10 分钟 | 高热度，实时追踪 |
| **LOD 1** | G > 0.5 | 6 小时 | 中等热度，日常关注 |
| **LOD 2** | G > 0.1 | 24 小时 | 低热度，背景更新 |
| **(Sleep)** | G ≤ 0.1 | 不检查 | 休眠，等待唤醒 |

**反馈循环**：
```
Scout 发现新内容 → Spark ↑ → Gravity ↑ → LOD 升级 → 更频繁 Scout
```

---

## 5. 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      产品层（Magpie / Arena）                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SYSTEMS 层（ECS 调度）                       │
│                                                                 │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐       │
│   │PhysicsSystem │ → │RenderSystem  │ → │ ScoutSystem  │       │
│   └──────────────┘   └──────────────┘   └──────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LIB 层（能力模块）                           │
│                                                                 │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐       │
│   │    Scout     │   │DeepExplorer  │   │ Serendipity  │       │
│   │  (情报采集)   │   │ (深度探索)    │   │  (闭环检测)   │       │
│   └──────────────┘   └──────────────┘   └──────────────┘       │
│                                                                 │
│   ┌──────────────┐   ┌──────────────┐                          │
│   │   Gardener   │   │  Graph-Link  │                          │
│   │  (图谱维护)   │   │  (中间件)     │                          │
│   └──────────────┘   └──────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA 层（图谱存储）                          │
│                                                                 │
│   entity_profiles | relations | entity_physics_state            │
│   memories | public_content | render_frame_buffer               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 产品分发策略

### 6.1 Magpie

- **定位**：认知雷达（被动发现）
- **DeepExplorer 入口**：`/explore` 轻量版
- **核心价值**：帮用户发现"不知道自己想知道的事"

### 6.2 Cognitive Arena

- **定位**：灵感竞技场（主动深挖）
- **DeepExplorer 入口**：主页完整体验
- **核心价值**：把深度探索变成"表演"

### 6.3 共享 API

两者共享 `POST /explore` 端点，由 prism-server 提供。

---

## 7. 代码整合说明

### 7.1 整合历史

> **Date**: 2025-12-17

原 `serendipity/adversarial.ts` 与 `deep-explorer/engine.ts` 功能高度重复，已完成整合清理。

### 7.2 整合决策

- **已删除**：`serendipity/adversarial.ts`（功能迁移到 deep-explorer）
- **已删除**：`field-sensors/`（功能未完整实现）
- **保留**：`deep-explorer/` 作为唯一探索引擎
- **保留**：`serendipity/` 核心闭环检测功能

### 7.3 当前模块结构

```
lib/
├── agents/              - Worker 实现（带 AgentLogger）
│   ├── ripple/             - 事件驱动知识传播
│   ├── scout/              - 外部发现
│   ├── explorer/           - 深度探索
│   └── curator/            - 图谱维护（原 gardener）
├── queue/               - 持久化任务队列
│   ├── bun-queue.ts        - SQLite-backed 队列
│   ├── client.ts           - 类型安全的入队 API
│   ├── types.ts            - Zod schemas
│   └── workers/            - Worker 注册和启动
├── ripple/              - Ripple 核心逻辑
│   ├── agent.ts            - RippleAgent (propagate/profile/onboard)
│   └── types.ts            - EntityProfile, RippleConfig
├── deep-explorer/       - 唯一探索引擎
│   └── strategies/         - 深度评估策略
├── serendipity/         - 闭环检测（Cognitive Loop Detection）
│   └── index.ts            - 核心导出
└── graph-link/          - 图谱中间件层
    ├── reader.ts           - GraphReader
    ├── writer.ts           - GraphWriter
    └── atoms/              - Cognitive Atoms
```

### 7.4 日志与诊断

所有 Agent 操作日志持久化到 `agent_logs` 表：

```sql
-- 查看所有 agent 操作汇总
SELECT agent, action, status, COUNT(*) as count
FROM agent_logs GROUP BY agent, action, status;

-- 查看最近错误
SELECT * FROM agent_logs WHERE status = 'error' ORDER BY created_at DESC LIMIT 20;
```

---

## 8. 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 整体架构（Physics Engine）
- [DEPTH-STRATEGY-DESIGN.md](./DEPTH-STRATEGY-DESIGN.md) - 深度策略设计
- [SERENDIPITY-EXPERIMENT.md](./SERENDIPITY-EXPERIMENT.md) - Serendipity 设计
- [SCOUT-ANYTHING.md](./SCOUT-ANYTHING.md) - Scout 设计
