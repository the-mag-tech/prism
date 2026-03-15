# Depth Strategy Pattern Design

> **Status**: RFC / Design Phase  
> **Author**: Magpie Team  
> **Date**: 2025-12-08  
> **Related**: [SERENDIPITY-EXPERIMENT.md](./SERENDIPITY-EXPERIMENT.md)

---

## 1. Overview

将"深度挖掘"从硬编码的讽刺链抽象为**可插拔的深度策略**，使同一个引擎能服务不同的产品场景。

### 核心洞察

```
"深度"是一个可配置的概念：
- 证据深度 (Evidence)  → "有多少可靠来源支撑？"
- 讽刺深度 (Irony)     → "有多深的反直觉？"
- 情感深度 (Emotional) → "有多强的共鸣？"
- 因果深度 (Causal)    → "机制有多清晰？"
```

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THREE-LAYER ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Product Layer (产品选择策略)                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │ Cognitive Arena    → IronyStrategy      → "给我惊喜"                │  │
│   │ Magpie Research    → EvidenceStrategy   → "给我答案"                │  │
│   │ Story Generator    → EmotionalStrategy  → "给我故事"                │  │
│   │ Business Analyst   → CausalStrategy     → "给我分析"                │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│   Strategy Layer (定义"什么是深")                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │ IDepthStrategy                                                      │  │
│   │   ├── evaluate()    评估当前深度得分                                 │  │
│   │   ├── isComplete()  判断是否够深                                    │  │
│   │   ├── getNext()     决定下一步挖掘方向                               │  │
│   │   └── format()      格式化输出                                      │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│   Engine Layer (通用挖掘机制)                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │ DeepExplorer                                                        │  │
│   │   ├── multiHeadExplore()   广度探索                                 │  │
│   │   ├── deepDiveLoop()       深度循环                                 │  │
│   │   └── reflect()            强制反思                                 │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Interface Definition

### 3.1 Core Interface

```typescript
// src/lib/deep-explorer/types.ts

/**
 * 深度得分 - 由策略定义具体维度
 */
export interface DepthScore {
  dimensions: Record<string, number>;  // 各维度得分
  total: number;                       // 总分
  level: number;                       // 当前层级 (1-4)
  reason: string;                      // 评估理由
}

/**
 * 深度配置
 */
export interface DepthConfig {
  targetLevel: number;      // 目标层级 (1-4)
  maxRounds: number;        // 最大挖掘轮数
  width: number;            // 广度（多头探索方向数）
}

/**
 * 探索上下文
 */
export interface ExplorationContext {
  topic: string;
  findings: Finding[];
  currentLevel: number;
  round: number;
}

/**
 * 深度策略接口
 */
export interface IDepthStrategy {
  /** 策略名称 */
  readonly name: string;
  
  /** 策略描述 */
  readonly description: string;
  
  /** 评估维度定义 */
  readonly dimensions: DimensionDef[];
  
  /**
   * 评估当前发现的深度得分
   */
  evaluate(findings: Finding[]): Promise<DepthScore>;
  
  /**
   * 判断是否达到目标深度
   */
  isComplete(score: DepthScore, config: DepthConfig): boolean;
  
  /**
   * 决定下一步挖掘方向
   */
  getNextDirections(context: ExplorationContext): Promise<string[]>;
  
  /**
   * 格式化最终输出
   */
  format(findings: Finding[], score: DepthScore): Promise<StrategyOutput>;
}

/**
 * 维度定义
 */
export interface DimensionDef {
  name: string;
  description: string;
  weight: number;  // 权重 0-1
}

/**
 * 策略输出（由具体策略定义结构）
 */
export type StrategyOutput = 
  | IronyOutput 
  | EvidenceOutput 
  | EmotionalOutput 
  | CausalOutput;
```

### 3.2 Irony Strategy (讽刺深度)

```typescript
// src/lib/deep-explorer/strategies/irony.ts

export interface IronyOutput {
  type: 'irony';
  ironyPyramid: IronyLayer[];
  explosivePoint: string;
  oneLiner: string;
  story?: string;
}

export class IronyDepthStrategy implements IDepthStrategy {
  readonly name = 'irony';
  readonly description = '挖掘讽刺深度，寻找反直觉的洞察';
  
  readonly dimensions: DimensionDef[] = [
    { name: 'surprise', description: '惊喜度：普通人会说"哇"吗？', weight: 0.2 },
    { name: 'storytelling', description: '故事性：有人物/冲突/转折吗？', weight: 0.2 },
    { name: 'ironyDepth', description: '讽刺深度：有反直觉的点吗？', weight: 0.25 },
    { name: 'accessibility', description: '易懂性：不懂技术能理解吗？', weight: 0.15 },
    { name: 'emotionalResonance', description: '情感共鸣：能引起笑/惊/叹吗？', weight: 0.2 },
  ];
  
  async evaluate(findings: Finding[]): Promise<DepthScore> {
    // 使用 LLM 评估五维度
    const prompt = this.buildEvaluationPrompt(findings);
    const result = await this.llm.evaluate(prompt);
    
    return {
      dimensions: {
        surprise: result.surprise,
        storytelling: result.storytelling,
        ironyDepth: result.ironyDepth,
        accessibility: result.accessibility,
        emotionalResonance: result.emotionalResonance,
      },
      total: this.weightedSum(result),
      level: this.inferLevel(result),
      reason: result.reason,
    };
  }
  
  isComplete(score: DepthScore, config: DepthConfig): boolean {
    return score.level >= config.targetLevel;
  }
  
  async getNextDirections(context: ExplorationContext): Promise<string[]> {
    const { topic, currentLevel } = context;
    
    // 根据当前层级生成更深的挖掘方向
    const directionsByLevel: Record<number, string[]> = {
      1: [`${topic} origin story`, `${topic} early failure`],
      2: [`${topic} controversy backfire`, `${topic} critic perspective`],
      3: [`${topic} unexpected consequence`, `${topic} ironic outcome`],
      4: [`${topic} meta irony`, `${topic} absurd truth`],
    };
    
    return directionsByLevel[currentLevel + 1] || [];
  }
  
  async format(findings: Finding[], score: DepthScore): Promise<IronyOutput> {
    // 构建讽刺金字塔
    const pyramid = await this.buildIronyPyramid(findings, score);
    const explosive = await this.extractExplosivePoint(findings);
    const oneLiner = await this.generateOneLiner(findings, explosive);
    
    return {
      type: 'irony',
      ironyPyramid: pyramid,
      explosivePoint: explosive,
      oneLiner: oneLiner,
    };
  }
  
  private inferLevel(result: any): number {
    // 层级 1: 表面讽刺 (总分 < 20)
    // 层级 2: 结构讽刺 (总分 20-30)
    // 层级 3: 命运讽刺 (总分 30-40)
    // 层级 4: 宇宙讽刺 (总分 > 40)
    const total = this.weightedSum(result);
    if (total < 20) return 1;
    if (total < 30) return 2;
    if (total < 40) return 3;
    return 4;
  }
}
```

### 3.3 Evidence Strategy (证据深度)

```typescript
// src/lib/deep-explorer/strategies/evidence.ts

export interface EvidenceOutput {
  type: 'evidence';
  sections: ReportSection[];
  citations: Citation[];
  confidence: number;
}

export class EvidenceDepthStrategy implements IDepthStrategy {
  readonly name = 'evidence';
  readonly description = '挖掘证据深度，寻找可靠的支撑';
  
  readonly dimensions: DimensionDef[] = [
    { name: 'sourceCount', description: '来源数量', weight: 0.2 },
    { name: 'authoritative', description: '权威性：来源是否可信', weight: 0.3 },
    { name: 'dataPoints', description: '数据点：有具体数字吗', weight: 0.2 },
    { name: 'crossValidation', description: '交叉验证：多源一致吗', weight: 0.3 },
  ];
  
  async evaluate(findings: Finding[]): Promise<DepthScore> {
    const sourceCount = findings.length;
    const authoritative = this.countAuthoritative(findings);
    const dataPoints = this.extractDataPoints(findings);
    const crossValidated = this.checkCrossValidation(findings);
    
    return {
      dimensions: { sourceCount, authoritative, dataPoints, crossValidated },
      total: this.weightedSum({ sourceCount, authoritative, dataPoints, crossValidated }),
      level: this.inferLevel({ authoritative, crossValidated }),
      reason: `${authoritative} authoritative sources, ${dataPoints} data points`,
    };
  }
  
  isComplete(score: DepthScore, config: DepthConfig): boolean {
    // 足够多的权威来源 + 交叉验证
    return score.dimensions.authoritative >= 3 && 
           score.dimensions.crossValidated >= 2;
  }
  
  async format(findings: Finding[], score: DepthScore): Promise<EvidenceOutput> {
    return {
      type: 'evidence',
      sections: await this.organizeIntoSections(findings),
      citations: this.extractCitations(findings),
      confidence: score.total / 40,  // Normalize to 0-1
    };
  }
}
```

---

## 4. Deep Explorer Engine

```typescript
// src/lib/deep-explorer/engine.ts

export interface ExploreOptions {
  strategy: IDepthStrategy;
  config: DepthConfig;
  onProgress?: (status: ExploreStatus) => void;
}

export class DeepExplorer {
  constructor(
    private searchProvider: ISearchProvider,
    private llm: ILLMProvider,
  ) {}
  
  /**
   * 主入口：深度探索
   */
  async explore(topic: string, options: ExploreOptions): Promise<ExploreResult> {
    const { strategy, config, onProgress } = options;
    
    // Phase 1: 广度探索
    onProgress?.({ phase: 'explore', message: '多头探索中...' });
    const directions = await this.multiHeadExplore(topic, config.width);
    
    // Phase 2: 选择最有潜力的方向
    const bestDirection = await this.selectBestDirection(directions, strategy);
    
    // Phase 3: 深度挖掘循环
    let findings = bestDirection.findings;
    let score: DepthScore;
    
    for (let round = 0; round < config.maxRounds; round++) {
      // 3.1 评估当前深度
      score = await strategy.evaluate(findings);
      
      // 3.2 强制反思
      this.reflect(score, strategy, round);
      
      // 3.3 检查是否完成
      if (strategy.isComplete(score, config)) {
        onProgress?.({ phase: 'complete', message: `达到目标深度 (Level ${score.level})` });
        break;
      }
      
      // 3.4 获取下一步方向
      const nextQueries = await strategy.getNextDirections({
        topic,
        findings,
        currentLevel: score.level,
        round,
      });
      
      // 3.5 执行搜索
      onProgress?.({ phase: 'deepen', message: `深度挖掘 Round ${round + 1}` });
      const newFindings = await this.search(nextQueries);
      findings = [...findings, ...newFindings];
    }
    
    // Phase 4: 格式化输出
    const output = await strategy.format(findings, score!);
    
    return {
      topic,
      strategy: strategy.name,
      score: score!,
      output,
      findings,
    };
  }
  
  /**
   * 多头探索（广度）
   */
  private async multiHeadExplore(topic: string, width: number): Promise<DirectionResult[]> {
    const directions = await this.generateDirections(topic, width);
    
    return Promise.all(
      directions.map(async (dir) => ({
        name: dir.name,
        findings: await this.search(dir.queries),
      }))
    );
  }
  
  /**
   * 强制反思（借鉴 DeepWideResearch）
   */
  private reflect(score: DepthScore, strategy: IDepthStrategy, round: number): void {
    console.log(`\n[Reflect] Round ${round + 1}`);
    console.log(`  Strategy: ${strategy.name}`);
    console.log(`  Current Level: ${score.level}`);
    console.log(`  Dimensions:`);
    for (const [key, value] of Object.entries(score.dimensions)) {
      console.log(`    - ${key}: ${value}`);
    }
    console.log(`  Total: ${score.total}`);
    console.log(`  Reason: ${score.reason}`);
  }
}
```

---

## 5. API Integration

```typescript
// src/app.ts - /explore endpoint

app.post('/explore', async (request, reply) => {
  const { 
    word, 
    strategy = 'irony',  // 默认讽刺策略
    targetLevel = 3,     // 默认目标层级
    width = 5,           // 默认广度
  } = request.body;
  
  // 选择策略
  const depthStrategy = getStrategy(strategy);  // irony | evidence | emotional | causal
  
  // 配置
  const config: DepthConfig = {
    targetLevel,
    maxRounds: targetLevel * 2,  // 层级越高，允许更多轮次
    width,
  };
  
  // 执行探索
  const result = await deepExplorer.explore(word, {
    strategy: depthStrategy,
    config,
  });
  
  return result;
});
```

---

## 6. Migration Plan

### Phase 1: Extract Interface (1 day)
- [ ] 创建 `src/lib/deep-explorer/` 目录
- [ ] 定义 `IDepthStrategy` 接口
- [ ] 从现有 `adversarial.ts` 提取 `IronyDepthStrategy`

### Phase 2: Implement Engine (2 days)
- [ ] 实现 `DeepExplorer` 类
- [ ] 集成强制反思机制
- [ ] 添加进度回调

### Phase 3: Add Strategies (1 week)
- [ ] `EvidenceDepthStrategy` (证据深度)
- [ ] `EmotionalDepthStrategy` (情感深度)
- [ ] `CausalDepthStrategy` (因果深度)

### Phase 4: API Migration (1 day)
- [ ] 更新 `/explore` API 支持策略选择
- [ ] 向后兼容：默认使用 `irony` 策略

---

## 7. Future Extensions

### 7.1 Strategy Composition

```typescript
// 组合策略：先证据，后讽刺
const compositeStrategy = new CompositeStrategy([
  { strategy: new EvidenceDepthStrategy(), weight: 0.6 },
  { strategy: new IronyDepthStrategy(), weight: 0.4 },
]);
```

### 7.2 User-Defined Strategies

```typescript
// 用户自定义评估维度
const customStrategy = new CustomDepthStrategy({
  dimensions: [
    { name: 'novelty', prompt: '这个发现有多新颖？', weight: 0.3 },
    { name: 'actionable', prompt: '这个发现能指导行动吗？', weight: 0.4 },
    { name: 'memorable', prompt: '这个发现容易记住吗？', weight: 0.3 },
  ],
});
```

### 7.3 A/B Testing

```typescript
// 不同策略的效果对比
const abTest = new ABTestRunner({
  strategies: ['irony', 'evidence', 'emotional'],
  metrics: ['userEngagement', 'shareRate', 'returnRate'],
});
```

---

## 8. References

- [DeepWideResearch](../../DeepWideResearch/) - Deep/Wide 参数化设计
- [Strategy Pattern](https://refactoring.guru/design-patterns/strategy) - 设计模式
- [SERENDIPITY-EXPERIMENT.md](./SERENDIPITY-EXPERIMENT.md) - 原始讽刺引擎

---

> **Philosophy**: 深度是一个可配置的概念。引擎提供挖掘机制，策略定义什么是"深"。


