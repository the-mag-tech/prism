# Prism Recall: 思维溯源系统架构

> **核心价值**: 让你的每一个决定都有迹可循
> **定位**: 经历/亲历的检索 — 帮你找到"当初为什么这么想"的线索
> **Status**: Implemented by **Deep Explorer** (v2) on top of **Graph Link Layer**.
> **Date**: 2025-11-29

---

## 1. 产品洞察

### 1.1 核心痛点

> "我记得我经历过什么，但想不起来了"

这不是"信息管理"问题，而是**记忆可检索性**问题：
- 你经历了很多（对话、邮件、会议、阅读、思考）
- 这些都存在你的记忆里
- 但大脑的"索引"很烂 — **你知道有，但找不到入口**

### 1.2 典型场景

> "我要向别人介绍这个项目，我想找到当初为什么做这个决定的原因"

用户需要的不是"检索信息"，而是**重建当时的思考脉络**。

### 1.3 核心价值主张

| 角度 | 表述 |
|-----|------|
| 功能 | 帮你找到当初为什么这么想 |
| 情感 | 让每一个决定都有迹可循 |
| 场景 | 当你需要解释一个决定时，帮你找到当初的思考线索 |

---

## 2. 系统架构

### 2.1 整体流程

```
用户输入 (自然语言问题)
    ↓
┌─────────────────────────────────────────────────────────┐
│  Stage 1: Fast Recall (初步召回)                        │
│  ─────────────────────────────────────                  │
│  基于用户原始输入，FTS5 快速搜索                          │
│  → 返回 Top-N 初步相关的记忆碎片                         │
│  延迟: < 50ms                                           │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│  Stage 2: Context-Aware Understanding (意图理解)        │
│  ─────────────────────────────────────                  │
│  输入: [用户原始问题] + [初步记忆碎片]                    │
│  AI 任务:                                               │
│    1. 理解用户真实意图                                   │
│    2. 提取新的搜索线索/关键词                            │
│    3. 判断需要探索的方向                                 │
│  → 输出: 理解后的意图 + 扩展搜索词列表                    │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│  Stage 3: Agentic Explore (深度探索)                    │
│  ─────────────────────────────────────                  │
│  Agent 带着新线索主动探索记忆空间:                        │
│    - 多轮召回，每轮用不同的搜索词                         │
│    - 基于找到的内容，发现新的关联                         │
│    - 直到覆盖足够的上下文                                │
│  → 输出: 完整的相关记忆碎片集合                          │
│  可配置: max_rounds, min_coverage, timeout              │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│  Stage 4: Response Synthesis (综合回答)                 │
│  ─────────────────────────────────────                  │
│  输入: [用户问题] + [理解的意图] + [所有相关碎片]          │
│  AI 任务:                                               │
│    1. 按时间线组织碎片                                   │
│    2. 提取关键信息点                                     │
│    3. 生成结构化回答                                     │
│  → 输出: 回答 + 引用的碎片 + 时间线                       │
└─────────────────────────────────────────────────────────┘
    ↓
用户进入 Block/Page 查看详情
    ↓
┌─────────────────────────────────────────────────────────┐
│  Stage 5: Feedback Learning (反馈学习)                  │
│  ─────────────────────────────────────                  │
│  观察用户行为:                                           │
│    - 点击/展开哪些碎片                                   │
│    - 停留时间                                           │
│    - 复制/引用                                          │
│    - 追问/重搜                                          │
│  后台学习:                                              │
│    - 调整碎片权重                                        │
│    - 强化概念关联                                        │
│    - 优化未来搜索                                        │
└─────────────────────────────────────────────────────────┘
```

### 2.2 设计原则

1. **先召回，后理解** — 记忆碎片是理解意图的前提，而非结果
2. **深度优于速度** — 宁可多探索几轮，也要找到完整上下文
3. **行为即反馈** — 用户的每次交互都是优化系统的信号
4. **本地优先** — 敏感数据不离开用户设备

---

## 3. 数据模型

### 3.1 核心表结构

```sql
-- =============================================================================
-- 记忆碎片 (已实现)
-- =============================================================================

CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT UNIQUE,       -- 原文件路径
  source_type TEXT NOT NULL,     -- 'markdown' | 'txt' | 'chatgpt' | 'cursor' | ...
  content TEXT NOT NULL,         -- 原始内容
  title TEXT,                    -- 提取的标题
  created_at TEXT,               -- 文件创建/修改时间
  ingested_at TEXT DEFAULT (datetime('now'))
);

-- FTS5 全文索引
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, content, content='memories', content_rowid='id'
);

-- =============================================================================
-- 反馈学习 (待实现)
-- =============================================================================

-- 碎片交互记录
CREATE TABLE memory_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL,
  session_id TEXT,               -- 会话 ID (关联一次完整的问答)
  query TEXT,                    -- 用户原始问题
  action TEXT NOT NULL,          -- 交互类型
  -- action 可选值:
  --   'displayed'       - 碎片被展示给用户
  --   'clicked'         - 用户点击展开
  --   'copied'          - 用户复制了内容
  --   'dwelled'         - 用户停留 (需配合 duration_ms)
  --   'skipped'         - 用户快速跳过
  --   'feedback_useful' - 用户标记有用
  --   'feedback_not_relevant' - 用户标记不相关
  duration_ms INTEGER,           -- 停留时间 (用于 'dwelled')
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX idx_interactions_memory ON memory_interactions(memory_id);
CREATE INDEX idx_interactions_session ON memory_interactions(session_id);

-- 碎片权重 (基于历史反馈动态计算)
CREATE TABLE memory_weights (
  memory_id INTEGER PRIMARY KEY,
  base_weight REAL DEFAULT 1.0,        -- 基础权重
  interaction_score REAL DEFAULT 0.0,  -- 交互得分 (正反馈累积)
  recency_factor REAL DEFAULT 1.0,     -- 时效因子 (越新越高)
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- 概念关联 (从用户行为中学习)
CREATE TABLE learned_associations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_a TEXT NOT NULL,       -- 概念A (如 "Julian")
  concept_b TEXT NOT NULL,       -- 概念B (如 "Nebula")
  strength REAL DEFAULT 0.0,     -- 关联强度 (0.0 - 1.0)
  co_occurrence_count INTEGER DEFAULT 0,  -- 共现次数
  click_through_count INTEGER DEFAULT 0,  -- 点击穿透次数
  last_seen TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(concept_a, concept_b)
);

CREATE INDEX idx_associations_concept ON learned_associations(concept_a);

-- =============================================================================
-- 会话记录 (待实现)
-- =============================================================================

-- 问答会话
CREATE TABLE recall_sessions (
  id TEXT PRIMARY KEY,           -- UUID
  query TEXT NOT NULL,           -- 原始问题
  understood_intent TEXT,        -- AI 理解的意图
  expanded_queries TEXT,         -- JSON: 扩展的搜索词列表
  final_response TEXT,           -- 最终回答
  memories_used TEXT,            -- JSON: 使用的碎片 ID 列表
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
```

### 3.2 权重计算公式

```
最终权重 = base_weight 
         × (1 + interaction_score) 
         × recency_factor 
         × association_boost

其中:
- interaction_score = Σ(positive_actions × 0.1) - Σ(negative_actions × 0.05)
- recency_factor = exp(-days_since_last_interaction / 30)
- association_boost = 1 + (关联概念的平均强度 × 0.5)
```

---

## 4. API 设计

### 4.1 现有 API (已实现)

```
GET /recall?q=<query>&limit=<n>
  → RecallResponse { query, results, timeline, totalCount }

GET /memories?limit=<n>
  → { memories, count }
```

### 4.2 新增 API (待实现)

```
POST /ask
  Body: { query: string, session_id?: string }
  → AskResponse {
      session_id: string,
      answer: string,
      sources: MemoryReference[],
      timeline: string[],
      understood_intent: string,
      exploration_stats: {
        rounds: number,
        memories_scanned: number,
        memories_selected: number
      }
    }

POST /feedback
  Body: {
    session_id: string,
    memory_id: number,
    action: 'useful' | 'not_relevant' | 'clicked' | 'copied',
    duration_ms?: number
  }
  → { success: boolean }

GET /associations?concept=<term>
  → { associations: [{ concept, strength, evidence_count }] }
```

---

## 5. 用户行为反馈机制

### 5.1 行为信号分类

| 信号类型 | 行为 | 权重影响 | 关联影响 |
|---------|------|---------|---------|
| **强正向** | 复制内容 | +0.3 | 强化当前查询与碎片的关联 |
| **正向** | 点击展开 | +0.1 | 建立/强化关联 |
| **正向** | 停留 >10s | +0.05 | 轻微强化 |
| **显式正向** | 标记有用 | +0.5 | 强关联 |
| **负向** | 快速跳过 (<2s) | -0.02 | 无 |
| **显式负向** | 标记不相关 | -0.2 | 减弱关联 |
| **间接负向** | 重新搜索 | -0.05 (对展示未点击的) | 无 |

### 5.2 学习触发时机

```
┌─────────────────────────────────────────────────────────┐
│  实时更新 (同步)                                        │
│  ─────────────                                         │
│  - 显式反馈 (点击有用/不相关)                            │
│  - 复制操作                                            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  会话结束后 (异步)                                       │
│  ─────────────                                         │
│  - 批量计算停留时间                                      │
│  - 分析点击模式                                         │
│  - 更新概念关联                                         │
│  - 重算碎片权重                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  定期任务 (后台)                                        │
│  ─────────────                                         │
│  - 时效因子衰减                                         │
│  - 关联强度归一化                                        │
│  - 清理过期会话                                         │
│  - 生成学习报告                                         │
└─────────────────────────────────────────────────────────┘
```

### 5.3 关联学习示例

```
用户搜索 "Julian 那个项目"
    ↓
系统返回 5 个碎片: [A:Julian会议, B:Nebula合作, C:API设计, D:老项目, E:无关]
    ↓
用户行为:
  - 点击 A (Julian会议)
  - 点击 B (Nebula合作)
  - 复制 C (API设计) 中的一段
  - 跳过 D
  - 标记 E 不相关
    ↓
学习结果:
  1. 关联 "Julian" ↔ "Nebula" 强度 +0.2
  2. 关联 "Julian" ↔ "API" 强度 +0.3
  3. 关联 "项目" ↔ "Nebula" 强度 +0.1
  4. 碎片 A/B/C 权重提升
  5. 碎片 E 权重降低
    ↓
未来效果:
  搜索 "Julian" 时，Nebula/API 相关碎片自动提权
  搜索 "Nebula" 时，Julian 相关碎片也会被关联召回
```

---

## 6. 实现路线图

### Phase 1: MVP (当前已完成)
- [x] memories 表 + FTS5 索引
- [x] ingestMarkdownFile() 函数
- [x] CLI: `npm run ingest --type markdown`
- [x] CLI: `npm run recall "<query>"`
- [x] API: `GET /recall`, `GET /memories`

### Phase 2: Ask Pipeline (已完成 ✅)
- [x] POST /ask API 实现 (`src/app.ts`)
- [x] Stage 2: Context-Aware Understanding (OpenAI) (`src/ask.ts` - `understandIntent()`)
- [x] Stage 3: Agentic Explore (多轮召回) (`src/ask.ts` - `agenticExplore()`)
- [x] Stage 4: Response Synthesis (`src/ask.ts` - `synthesizeResponse()`)
- [x] Magpie 前端集成 (FeedBlock 调用 /ask) (`magpie/src/components/Grid.tsx`)

### Phase 3: Feedback Learning (手动挡完成 ✅)
- [x] memory_interactions 表
- [x] memory_weights 表
- [x] learned_associations 表
- [x] POST /feedback API
- [x] 后台权重更新逻辑 (`src/ask.ts` - `updateMemoryWeight()`)
- [x] **CLI: `npm run feedback-stats`** — 分析反馈数据，发现模式
- [ ] 前端行为追踪 (click, dwell, copy)
- [ ] 自动挡：基于 [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) 的智能维护

> **Navigation Context** 已移至 [ORIGIN-ALGORITHM.md](./ORIGIN-ALGORITHM.md) 作为动态首页推荐的核心支撑。

### Phase 4: Entity Deduplication (V1 保守模式)

> **核心原则**：宁可重复，不可误合并。同名不同实体是常态。
> 详见 [GARDENER-PROTOCOL.md](./GARDENER-PROTOCOL.md)

- [x] **数据库表**
  - [x] entity_similarities 表：存储语义相似的 entity 对
  - [x] entity_aliases 表：用户确认的合并关系
  - [ ] merge_candidates 表：候选对 + 来源域 + 状态
  - [ ] merge_history 表：合并历史（可回滚）
- [x] **CLI 工具 (手动挡)**
  - [x] `npm run find-duplicates` — 用 embedding 找重复实体
  - [x] `npm run find-duplicates --interactive` — 交互式审核合并
  - [x] `npm run merge-entities --list` — 查看已合并实体
  - [x] `npm run merge-entities --file <csv>` — 批量执行合并
  - [x] `npm run merge-entities --undo <id>` — 撤销合并
- [ ] **API (V1)**
  - [ ] `GET /api/merge-candidates` — 获取候选列表
  - [ ] `POST /api/merge` — 用户触发合并
  - [ ] `POST /api/merge-reject` — 标记"不是同一实体"
- [ ] **前端交互 (V1)**
  - [ ] 显示合并候选列表
  - [ ] [合并] [不是同一个] [稍后决定] 按钮
  - [ ] 显示来源域标签（📧 Email / 🌐 Web）
- [ ] **V2 智能策略** (待数据积累后)
  - [ ] 来源域权重：异源域 → 更高阈值
  - [ ] 用户决策模式学习
  - [ ] LLM 辅助消歧

### Phase 5: Advanced Features
- [ ] Agentic Search 模式 (Agent 自主探索)
- [ ] 碎片合并/拆分建议
- [ ] 学习报告 / 洞察
- [ ] 多数据源支持 (ChatGPT导出, Cursor, 录音转录)

---

## 7. 冷启动策略 (Batch0)

为了产品化时的冷启动体验，我们采用 **Batch 分层策略**：

```
batch0 (production seed)
  ├─ 手工设计的"黄金示例" entities
  ├─ 精心设计的 page_blocks 关联
  └─ 用于新用户的冷启动展示

batch1+ (user extraction)
  ├─ AI 从用户 memories 中提取
  ├─ 自动生成的 page_blocks
  └─ 可 rollback，不影响 batch0
```

**关键设计：**
- batch0 的 `is_auto_extracted = 0`，标记为手工数据
- extraction rollback 不会影响 batch0
- 产品化时可以替换 batch0 内容，或保留作为示例

---

## 8. 参考项目

- [Acontext](https://github.com/memodb-io/Acontext) — Context Data Platform for Self-learning Agents
  - 借鉴: Agentic Search, SOP 结构化存储, Background Learning

---

## 9. 开放问题

1. **Agentic Explore 的终止条件**
   - 固定轮数？覆盖率阈值？超时？AI 自己决定？

2. **隐私边界**
   - AI 处理在哪里进行？Server-side vs Client-side OpenAI 调用

3. **性能权衡**
   - 深度探索 vs 响应速度，如何平衡？Streaming？

4. **冷启动**
   - ~~新用户没有反馈数据，如何初始化权重？~~
   - 已解决：batch0 提供黄金示例，新用户有初始内容可探索

5. **多语言去重阈值**
   - ~~Embedding 相似度多高才算"同一个概念"？~~
   - 当前策略：手动挡 + 人工审核，默认阈值 0.8
   - 用 `npm run find-duplicates --threshold 0.85` 调整

6. **路径语境的权重**
   - 近期路径 vs 历史路径，如何加权？
   - 路径长度对语境推断的影响？

7. **自动挡时机**
   - 何时从手动挡切换到自动挡？
   - 参考：积累 1000+ 交互记录、100+ 人工合并对后考虑

---

*文档版本: v0.2*  
*创建日期: 2025-11-29*  
*最后更新: 2025-11-29*
*Phase 3/4 手动挡工具完成*

