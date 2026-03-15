# Prism Server Tests

## Directory Structure

```
tests/
├── queue/                   # 队列模块测试 (bun:test)
│   ├── bun-queue.test.ts    # 核心队列实现
│   ├── types.test.ts        # Zod schema 验证
│   ├── runner.test.ts       # Worker/Runner 测试
│   └── integration.test.ts  # 集成测试
│
├── migrations/              # 数据库迁移测试 (bun:test)
│   ├── v16_test.ts
│   └── v40_test.ts
│
├── mocked/                  # 需要模块 mock 的测试 (vitest)
│   ├── scout-enhancements.test.ts
│   ├── gardener-automation.test.ts
│   ├── atoms.test.ts
│   └── deep-explorer-graph.test.ts
│
├── fixtures/                # 测试数据
│   ├── meeting-notes.md
│   └── test-decision.md
│
└── *.test.ts                # 其他测试 (bun:test)
    ├── api.test.ts          # API 端点
    ├── db.test.ts           # 数据库初始化
    ├── ecs.test.ts          # ECS 架构
    ├── graph.test.ts        # 图操作
    ├── graph-link.test.ts   # GraphReader/Writer
    ├── ingest.test.ts       # 数据入库
    ├── pages.test.ts        # 页面查询
    ├── pipeline-integrity.test.ts
    └── server.test.ts       # 服务器配置
```

## Test Frameworks

### 主框架: `bun:test` (推荐)

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
```

**优点:**
- Prism Server 已全面使用 Bun 运行时
- 原生支持，更快
- 减少依赖

### 辅助框架: `vitest` (模块 mock)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => ({ ... }));
```

**使用场景:** 需要 `vi.mock()` 进行模块级别 mock 的测试

## Running Tests

```bash
# === 推荐: 只运行 bun:test 测试 ===
pnpm test              # 全部 bun:test 测试
pnpm test:queue        # 队列模块测试
pnpm test:migrations   # 迁移测试
pnpm test:watch        # 监听模式

# === Vitest 测试 (需要模块 mock) ===
pnpm test:vitest       # 运行 vitest 测试

# === 单个文件 ===
bun test tests/queue/types.test.ts
```

## Writing Tests

### 1. 选择测试框架

| 场景 | 框架 | 原因 |
|------|------|------|
| 普通单元测试 | `bun:test` | 更快，原生支持 |
| 需要模块 mock | `vitest` | `vi.mock()` 更强大 |
| 数据库测试 | `bun:test` | 直接使用 `bun:sqlite` |
| API 测试 | `bun:test` | 可以直接调用 Fastify |

### 2. 测试隔离

```typescript
const TEST_DB_PATH = path.join(process.cwd(), 'test-{module}.db');

beforeEach(() => {
  cleanup();  // 清理旧数据
  db = createTestDB();
});

afterEach(() => {
  db.close();
  cleanup();  // 清理 WAL 文件 (-wal, -shm)
});
```

### 3. SQLite DateTime 格式

```typescript
// SQLite datetime: 'YYYY-MM-DD HH:mm:ss'
// JavaScript ISO: '2026-01-07T08:00:00.000Z'

const toSqliteDateTime = (date: Date) =>
  date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

// 示例: '2026-01-07 08:00:00'
```

### 4. Mock 函数

```typescript
// bun:test
import { mock } from 'bun:test';
const mockFn = mock(() => 'value');

// vitest
import { vi } from 'vitest';
const mockFn = vi.fn(() => 'value');
```

## CI Integration

```yaml
# .github/workflows/ci.yml
test:
  runs-on: ubuntu-latest
  steps:
    - name: Run Prism Server Tests
      run: |
        cd apps/prism-server
        bun test --timeout 60000
```

Tests run automatically on:
- Push to `main`
- Pull requests to `main`

## Migration Guide: Vitest → Bun

如果要将 vitest 测试迁移到 bun:test:

1. **简单替换** (无模块 mock):
   ```diff
   - import { describe, it, expect, vi } from 'vitest';
   + import { describe, it, expect, mock } from 'bun:test';
   
   - const fn = vi.fn();
   + const fn = mock(() => {});
   ```

2. **模块 mock** (保留 vitest):
   - `vi.mock()` 在 bun:test 中需要 `mock.module()`
   - 语法差异较大，建议保留 vitest
