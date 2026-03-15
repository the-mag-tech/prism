# Qveris 评估

评估日期: 2025-12-25

## 文件说明

| 文件 | 说明 |
|------|------|
| `REPORT.md` | 正式评估报告（可发送给 Qveris 团队） |
| `test-qveris.ts` | 初步 API 测试脚本 |
| `test-qveris-client.ts` | QverisClient 封装测试 |
| `test-qveris-intent.ts` | Intent Router 能力测试 |
| `benchmark-search.ts` | 性能基准测试（Tavily vs Qveris） |

## 运行测试

```bash
cd apps/prism-server

# 初步测试
pnpm tsx evaluations/qveris/test-qveris.ts

# Client 测试
pnpm tsx evaluations/qveris/test-qveris-client.ts

# Intent Router 测试
pnpm tsx evaluations/qveris/test-qveris-intent.ts

# 基准测试
pnpm tsx evaluations/qveris/benchmark-search.ts
```

## 相关代码

- Client 封装: `src/lib/qveris-client.ts`

## 结论

详见 [REPORT.md](./REPORT.md)

