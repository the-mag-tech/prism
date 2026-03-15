# Origin-Relative Embedding: 动态语义场设计

> **Version**: 0.1 (Draft)
> **Status**: Design Phase
> **Prerequisite**: [ORIGIN-ALGORITHM.md](file:///Users/j.z/code/fulmail/apps/prism-server/docs/ORIGIN-ALGORITHM.md)

---

## 1. 核心问题

### 当前架构假设

```
Embedding Space (绝对坐标系)
┌──────────────────────────────────────────────┐
│                                              │
│    A ●────────────● B                        │
│         sim = 0.8                            │
│                                              │
│    这个距离是 "永恒" 的                       │
└──────────────────────────────────────────────┘
```

### 问题

1. **信息茧房演化**: 用户的持续行为会改变 Field 的结构
2. **原点漂移**: 高 Gravity 实体会成为新的 "语义中心"
3. **静态 Embedding 过时**: 缓存的向量无法反映 Field 的演化

---

## 2. 提议：Origin-Relative Coordinate System

### 核心思想

> Similarity 不是**绝对距离**，而是**相对于当前原点的偏移**。

```
Origin-Relative System (相对坐标系)
┌──────────────────────────────────────────────┐
│                                              │
│    t=0:  O ← 原点                            │
│          ↓                                   │
│         A ●────────────● B                   │
│              sim = 0.8                       │
│                                              │
│    t=1:  原点漂移到 C                         │
│                    O ← 新原点                │
│                    ↓                         │
│         A ●────────────● B                   │
│              sim = 0.5  ← 相对距离改变！      │
│                                              │
└──────────────────────────────────────────────┘
```

---

## 3. Origin 的定义

### 3.1 Origin 是什么？

Origin 是用户当前 **语义注意力中心** 的 Embedding 表示。

### 3.2 Origin 的合成公式

$$O(t) = \alpha \cdot E_{path} + \beta \cdot E_{gravity} + \gamma \cdot E_{event} + \delta \cdot E_{lens}$$

| 分量 | 权重 | 来源 | 描述 |
|------|------|------|------|
| $E_{path}$ | 0.4 | `path_associations` | 最近 N 个访问实体的 Embedding 平均 |
| $E_{gravity}$ | 0.3 | `entity_physics_state` | Top-5 高 Gravity 实体的 Embedding 平均 |
| $E_{event}$ | 0.2 | `entity_profiles` (type=event) | 今天/即将发生事件的 Embedding 平均 |
| $E_{lens}$ | 0.1 | 用户选择 (Tech/Design/Biz) | Lens 的 Seed Embedding |

### 3.3 Origin 的缓存策略

| 场景 | 缓存 TTL | 原因 |
|------|----------|------|
| 用户 Session 内 | 5 分钟 | 避免频繁重算 |
| 跨 Session | 不缓存 | 原点应该反映当前状态 |
| PhysicsSystem Tick | 每 Tick 重算 | 原点是 Tick 的输入 |

---

## 4. Relative Similarity 计算

### 4.1 当前做法 (Absolute)

```typescript
const sim = cosineSimilarity(embedA, embedB);
```

### 4.2 提议做法 (Origin-Relative)

```typescript
const origin = await computeOrigin(context);
const relativeA = subtract(embedA, origin);
const relativeB = subtract(embedB, origin);
const sim = cosineSimilarity(relativeA, relativeB);
```

### 4.3 向量减法的意义

```
原始: A = [0.8, 0.2, 0.5]
原点: O = [0.3, 0.1, 0.4]
相对: A' = A - O = [0.5, 0.1, 0.1]
```

这意味着：**A 相对于当前原点的方向** 才是它的 "意义"。

---

## 5. 对现有模块的影响

### 5.1 EntityExtractionAtom (Ingest)

| 现在 | 改后 |
|------|------|
| `findRelevantEntities(content)` | `findRelevantEntities(content, origin)` |
| 用绝对 Embedding 比较 | 用相对 Embedding 比较 |

### 5.2 Gardener (Deduplication)

| 现在 | 改后 |
|------|------|
| 只看 Embedding 相似度 | 同时看绝对相似度 + 相对相似度 |

### 5.3 PhysicsSystem

| 现在 | 改后 |
|------|------|
| 不计算原点 | 计算并输出 Origin |

---

## 6. 开放问题 (待讨论)

### Q1: 原点漂移速度
原点应该 **平滑漂移** 还是 **跳跃**？

### Q2: 历史原点的价值
过去的原点是否有价值？是否需要 "原点轨迹" 来理解用户的兴趣演化？

### Q3: Absolute vs Relative 的平衡
完全使用 Relative Similarity 会导致 **全局结构丢失**。应该如何平衡？

### Q4: Origin 是否应该持久化？
如果原点持久化，可以追踪用户的 "语义轨迹"。但这也可能加剧信息茧房。

---

## 7. 外部参考：DeepSeek Lightning Indexer

> **来源**: DeepSeek-V3.2-Exp 的 Sparse Attention 机制

### 7.1 Lightning Indexer 是什么？

DeepSeek 的 Lightning Indexer 是一个**两阶段稀疏注意力系统**：

| 阶段 | 功能 | 成本 |
|-----|------|-----|
| **阶段1**: Lightning Indexer | 快速计算所有 token 的相关性分数，选出 Top-K | 轻量 (线性) |
| **阶段2**: Full Attention | 只对选中的 Top-K token 做全量注意力 | 精确但昂贵 |

这使得 DeepSeek-V3.2-Exp 的长上下文推理成本降低了 **6-7 倍**。

### 7.2 对 Origin-Relative 的启发

#### (a) 两阶段架构 → EntityExtractionAtom 优化

```typescript
// 借鉴: Lightning-style 两阶段筛选
async function findRelevantEntities(content: string, origin: Vector) {
  // Phase 1: 快速预筛选 (用 Origin 的简化距离)
  const candidates = await quickFilter(allEntities, origin, { topK: 256 });
  
  // Phase 2: 精细计算 (用完整的 Origin-Relative similarity)
  const relevant = await preciseMatch(candidates, origin, content);
  return relevant;
}
```

#### (b) 独立优化 → 验证权重可配置设计

Lightning Indexer 可以**与主模型分开训练**，使用不同的损失函数。

这验证了我们的设计决策：
- 各分量权重 (α, β, γ, δ) 保持可配置
- 每个分量可以有独立的评估指标：
  - `E_path` → 用户点击命中率
  - `E_gravity` → 高 Gravity 实体的后续互动率

#### (c) ReLU vs Softmax → 回答 Q1 (原点漂移策略)

Lightning Indexer 使用 **ReLU** 而非 Softmax，意味着：
- 低于阈值的 token 直接忽略 (硬边界)
- 高于阈值的 token 保留原始分数 (软排序)

**启发**: Origin 漂移可以采用**混合策略**：
```
if (触发事件, 如 Lens 切换) → 跳跃
else → 指数平滑漂移
```

#### (d) 全局结构保留 → 回答 Q3 (Absolute vs Relative 平衡)

Lightning Indexer 保留了对**所有 token 的全局索引**，只在查询时做稀疏选择。

**建议公式**:
```typescript
const finalScore = 
  λ * absoluteSimilarity(embedA, embedB) +     // 防止全局结构丢失
  (1-λ) * relativeSimilarity(embedA, embedB, origin); // 当前视角

// 建议: λ = 0.3 (保留 30% 绝对权重)
```

### 7.3 核心共识

| DeepSeek 的洞察 | 我们的 Origin-Relative |
|----------------|----------------------|
| "动态注意力范围" | "动态语义坐标系" |
| 静态全局计算太昂贵 | 绝对 Embedding 无法反映用户演化 |
| 用焦点缩小计算范围 | 用 Origin 定义语义中心 |

> **验证**: 工业界已经在朝着"动态焦点"方向演进，Origin-Relative 设计符合这一趋势。

### 7.4 进一步优化方向 (Scout Explore 发现)

通过 `prism explore` 深度探索 DeepSeek V3.2 技术栈后，发现以下可借鉴的技术：

#### (a) Multi-head Latent Attention (MLA) → Origin 多头计算

DeepSeek 使用 MLA 让不同的"注意力头"关注不同的语义维度。

**应用到 Origin**:
```typescript
// Origin 按多个维度分别计算，再融合
interface MultiHeadOrigin {
  temporal: Vector;   // 时间维度 (最近访问)
  social: Vector;     // 社交维度 (高 Gravity 实体)
  event: Vector;      // 事件维度 (即将发生)
  lens: Vector;       // 用户选择维度
}

function fuseOrigin(heads: MultiHeadOrigin): Vector {
  // 可学习的融合权重，而非固定的 α, β, γ, δ
  return learnedFusion(heads);
}
```

#### (b) Mixture of Experts (MoE) Router → 动态权重选择

DeepSeekMoE 的核心是 **Router**：根据输入动态选择激活哪些专家。

**应用到 Origin**:
```typescript
// 根据查询类型动态调整权重
function routeOriginWeights(query: string): Weights {
  const queryType = classifyQuery(query);
  
  switch (queryType) {
    case 'meeting_prep':
      return { α: 0.2, β: 0.5, γ: 0.3, δ: 0.0 }; // 重社交+事件
    case 'research':
      return { α: 0.5, β: 0.2, γ: 0.1, δ: 0.2 }; // 重路径+镜头
    case 'daily_catch_up':
      return { α: 0.3, β: 0.3, γ: 0.4, δ: 0.0 }; // 平衡+事件
  }
}
```

#### (c) FP8 Mixed-Precision → Embedding 量化优化

DeepSeek 使用 FP8 低精度训练来加速计算。

**应用到 Origin**:
| 存储层 | 精度 | 目的 |
|-------|------|-----|
| 原始 Embedding | FP32 | 保持精度 |
| Origin 缓存 | FP16 | 减少内存 |
| 快速筛选用 | INT8 | 极速预筛选 |

```typescript
// 三层精度策略
interface EmbeddingStore {
  full: Float32Array;     // 持久化存储
  cached: Float16Array;   // 5分钟缓存
  quantized: Int8Array;   // Lightning-style 预筛选
}
```

#### (d) 优化路线图总结

| Phase | 优化点 | 来源 | 预期收益 |
|-------|-------|------|---------|
| P1 | 两阶段筛选 | Lightning Indexer | 查询性能 ↑ 3-5x |
| P2 | 动态权重 Router | MoE | 场景适应性 ↑ |
| P3 | 多头 Origin | MLA | 语义覆盖度 ↑ |
| P4 | 量化存储 | FP8 | 内存占用 ↓ 50% |

---

## 8. 实施计划

| Phase | 内容 | 依赖 |
|-------|------|------|
| Phase 1 | 实现 `OriginService.computeOrigin()` | - |
| Phase 2 | 改造 `EntityExtractionAtom` 使用相对距离 | Phase 1 |
| Phase 3 | 改造 `Gardener` 使用双重检查 | Phase 1 |
| Phase 4 | 在 `PhysicsSystem.tick()` 中输出 Origin | Phase 1 |

> **注意**: 公式中的权重 (α, β, γ, δ) 应保持**可配置**，以便未来调优。

---

## 9. 哲学思考：工程设计 vs 模型能力

### 9.1 模型变聪明后，这些工程会白做吗？

| 模型能做 | 模型不能做 |
|---------|-----------|
| 文本理解、推理、生成 | **持久化状态** (记住你上周在做什么) |
| 实时计算语义相似度 | **累积学习** (从你的行为中演化) |
| 理解 Origin 概念 | **实时感知场的状态** (当前 Gravity 是多少) |

**结论**: 模型是 **无状态的推理引擎**。工程设计的核心价值是 **状态管理和演化**。

### 9.2 哪些设计可能被淘汰？

| 设计 | 被淘汰概率 | 原因 |
|------|-----------|------|
| Entity Extraction Prompt | 高 | 模型越来越懂 NER |
| Similarity Threshold | 高 | 模型能直接判断 "是否是同一人" |
| Origin/Gravity 概念 | **低** | 这是我们定义的业务逻辑 |
| 状态持久化/演化系统 | **很低** | 模型无法替代数据库 |

### 9.3 正确的心态

> **我们不是在和模型竞争，而是在为模型构建 "记忆" 和 "感知"。**

---

## 10. 用户心智的不可逆性

### 10.1 核心洞察

一旦用户接受了某种认知模式，**它就变成了产品的一部分**。

```
t=0: 用户学会了 "这个人最近很重要"
     ↓
t=1: 我们换了更好的模型
     ↓
t=2: 用户: "为什么这个人不出现了？"
```

### 10.2 工程设计的真正价值

不是 **技术实现**，而是 **定义用户心智**。

| 工程设计 | 技术价值 | 心智价值 |
|---------|---------|---------|
| Gravity 算法 | 可被 LLM 替代 | "重要性" 概念一旦被接受，就是护城河 |
| Origin 漂移 | 可被 LLM 替代 | "我的关注点在移动" — 用户自我觉察 |
| Irony Atom | 可被 LLM 替代 | "AI 能感知讽刺" — 用户信任 |

### 10.3 从黑话到故事

"Gravity"、"Origin"、"Field" 是内部语言。用户需要的是 **故事**，不是物理公式。

| 内部黑话 | 用户的问题 | 故事化回答 |
|---------|-----------|-----------|
| "Gravity 高" | "为什么这个人出现？" | *"因为你们最近有交集"* |
| "Origin 漂移" | "为什么今天不一样？" | *"因为你的关注点变了"* |
| "Path Association" | "为什么看到 A 就想起 B？" | *"因为你总是一起看他们"* |

详见: [USER-STORYTELLING.md](file:///Users/j.z/code/fulmail/apps/prism-server/docs/USER-STORYTELLING.md)
