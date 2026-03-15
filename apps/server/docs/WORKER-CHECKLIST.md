---
refs:
  - id: worker/checklist
    version: 2
    updated: 2026-01-08
  - id: infra/agent-logger
    code: src/lib/agent-logger.ts
  - id: infra/bun-queue
    code: src/lib/queue/bun-queue.ts
  - id: infra/memo-id
    code: src/lib/graph-link/writer.ts
---

# Worker/Agent 开发检查清单

<!-- @ref:worker/checklist -->

开发新的 Worker（如 Scout、Ripple、Explorer、Curator 等）时，使用此清单避免常见问题。

## 0. Worker 状态一览

| Worker | 位置 | AgentLogger | 队列持久化 | agent 类型 | action |
|--------|------|-------------|-----------|------------|--------|
| **Ripple** | `src/lib/agents/ripple/worker.ts` | ✅ | ✅ | `scout` | `ripple` |
| **Scout** | `src/lib/agents/scout/worker.ts` | ✅ | ✅ | `scout` | `patrol` |
| **Explorer** | `src/lib/agents/explorer/worker.ts` | ✅ | ✅ | `deep_explorer` | `explore` |
| **Curator** | `src/lib/agents/curator/worker.ts` | ✅ | ✅ | `curator` | `cycle` |

> **查询日志**: `SELECT * FROM agent_logs WHERE agent = 'scout' ORDER BY created_at DESC LIMIT 50;`

## 1. 日志与错误处理

### ✅ 使用正确的日志 API

```typescript
// ❌ 错误 - AgentLogger 没有 log 方法（已修复，但仍推荐下面的模式）
const logger = new AgentLogger('my_worker');
logger.log('message');  // 可能出错

// ✅ 正确 - 使用 start/success/error 模式
const logger = new AgentLogger('my_worker');
const handle = logger.start('action_name', { input: 'data' });
try {
  // ... 执行操作
  handle.success({ result: 'data' });
} catch (error) {
  handle.error(error);  // 错误会被持久化到 agent_logs 表
  throw error;  // 重新抛出，让上层处理
}

// ✅ 或使用简单日志
import { log, logError } from '../logger.js';
log('[MyWorker] Simple message');
logError('[MyWorker] Error occurred:', error);
```

### ✅ 不要吞掉异常

```typescript
// ❌ 错误 - 异常被吞掉，无法追踪
try {
  await riskyOperation();
} catch (error) {
  console.error('Failed:', error);
  // 没有重新抛出或标记状态
}

// ✅ 正确 - 记录并传播
try {
  await riskyOperation();
} catch (error) {
  logError('[Worker] Operation failed:', error);
  handle.error(error);  // 持久化错误
  throw error;  // 让上层决定如何处理
}
```

## 2. 数据库字段一致性

### ✅ 使用统一的字段名

| 用途 | 统一字段 | ❌ 避免使用 |
|------|----------|-------------|
| Memory 关联 | `memo_id` | `source_memo_id`, `source_memory_id` |
| 实体 ID | `entity_id` | `entityId`, `entity`, `id` (除非是主键) |
| 创建时间 | `created_at` | `createdAt`, `create_time` |

### ✅ 新增字段前检查

```bash
# 检查是否已有类似字段
sqlite3 prism.db "PRAGMA table_info(entities);" | grep -i "memo\|memory\|source"
```

## 3. 环境配置

### ✅ 所有配置都从 env 读取

```typescript
// ✅ 正确 - 支持环境变量覆盖
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'prism.db');

// ❌ 错误 - 硬编码路径
const dbPath = './prism.db';
```

### ✅ CLI 参数解析

```typescript
// ✅ 正确 - 完整解析所有预期参数
const memoryIdsArg = args.find(a => a.startsWith('--memory-ids='))?.split('=')[1];
const memoryIds = memoryIdsArg 
  ? memoryIdsArg.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id))
  : undefined;

// ❌ 错误 - 只部分解析
const strategy = args.find(a => a.startsWith('--strategy='));
// 忘记解析 --memory-ids
```

## 4. 管线完整性

### ✅ Ingest 后必须 Extract

```typescript
// ✅ 正确 - ingest 后立即 extract
const memoryId = await graphWriter.ingestFinding(url, title, content, relatedEntities);

// 立即触发 extraction
try {
  const extractResult = await extractEntities({
    memoryIds: [memoryId],
    description: `Auto-Ingest: ${title}`
  });
  log(`Extracted ${extractResult.entitiesCreated} entities`);
} catch (error) {
  logError('Extraction failed:', error);
  // TODO: 标记为需要重试
}
```

### ✅ 失败重试机制

```typescript
// 建议：在 entity 上添加 extraction_status 字段
// 'pending' | 'completed' | 'failed'

// Worker 可以定期检查并重试失败的
const pendingFindings = db.query(`
  SELECT id, memo_id FROM entities 
  WHERE id LIKE 'finding:%' 
  AND extraction_status = 'pending'
`).all();
```

## 5. 测试要求

### ✅ 关键路径必须有集成测试

```typescript
// tests/scout-pipeline.test.ts
test('Scout ingest → extract pipeline', async () => {
  const memoryId = await graphWriter.ingestFinding(
    'https://example.com',
    'Test Title',
    'Test content',
    []
  );
  
  const result = await extractEntities({ memoryIds: [memoryId] });
  
  expect(result.memoriesProcessed).toBe(1);
  expect(result.entitiesCreated).toBeGreaterThan(0);
  
  // 验证关联正确建立
  const relations = db.query(
    `SELECT * FROM relations WHERE source = ?`
  ).all(`finding:${memoryId}`);
  expect(relations.length).toBeGreaterThan(0);
});
```

## 6. 队列系统集成

### ✅ 使用持久化队列

所有长时间运行的任务必须通过 `src/lib/queue/` 队列系统执行：

```typescript
// ✅ 正确 - 使用持久化队列
import { enqueueRipple, enqueueScout, enqueueExtraction } from '../queue/client.js';

// 入队任务（即使进程崩溃也会恢复）
await enqueueRipple({
  eventType: 'ENTITY_CREATED',
  entityId: 'person:john_doe',
  entityType: 'person',
  entityTitle: 'John Doe',
  trigger: 'system',
});

// ❌ 错误 - 直接调用，崩溃时丢失
await rippleSystem.emit({ ... }); // 内存中，不持久
```

### ✅ Worker 文件结构

新 Worker 应放在 `src/lib/agents/{agent_name}/worker.ts`：

```typescript
// src/lib/agents/my-agent/worker.ts
import { AgentLogger } from '../../agent-logger.js';
import type { Job } from '../../queue/bun-queue.js';
import type { MyTask } from '../../queue/types.js';

const logger = new AgentLogger('my_agent');

export async function handleMyTask(job: Job<MyTask>): Promise<void> {
  const handle = logger.start('action_name', job.data, job.id);
  
  try {
    // ... 执行操作
    handle.success({ result: 'data' });
  } catch (error) {
    handle.error(error);
    throw error; // 让队列系统处理重试
  }
}
```

---

## 7. 代码审查 Checklist

新增 Worker 时，审查以下内容：

- [ ] Worker 位于 `src/lib/agents/{name}/worker.ts`
- [ ] 使用 `AgentLogger.start()` 追踪操作（持久化到 `agent_logs` 表）
- [ ] 异常有持久化日志（`handle.error()`）
- [ ] 任务通过 `src/lib/queue/` 入队（崩溃恢复）
- [ ] 数据库字段使用统一命名（参考 SSOT 表）
- [ ] 配置支持环境变量覆盖
- [ ] CLI 参数全部被解析
- [ ] Ingest 后有 Extract 调用
- [ ] 有对应的集成测试
- [ ] 失败场景由队列系统自动重试（指数退避）

---

## 8. 查询诊断

```sql
-- 查看所有 agent 操作汇总
SELECT agent, action, status, COUNT(*) as count, ROUND(AVG(duration_ms)) as avg_ms
FROM agent_logs 
GROUP BY agent, action, status
ORDER BY agent, action;

-- 查看最近错误
SELECT * FROM agent_logs WHERE status = 'error' ORDER BY created_at DESC LIMIT 20;

-- 查看队列状态
SELECT queue, status, COUNT(*) as count FROM prism_jobs GROUP BY queue, status;

-- 查看卡住的任务（processing 超过 10 分钟）
SELECT * FROM prism_jobs 
WHERE status = 'processing' 
AND julianday('now') - julianday(updated_at) > 0.007; -- ~10 minutes
```

