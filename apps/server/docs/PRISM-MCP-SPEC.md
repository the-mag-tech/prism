# Prism MCP Server Specification

> **Status**: ✅ Implemented (v2)
> **Goal**: 将 Prism 的核心能力 (Graph/Scout/Recall) 暴露为 MCP Server，供 Claude Desktop / Cursor 等 AI 客户端调用
> **Version**: v2 (2025-12) - HTTP + Stdio dual mode, shared config support

---

## 1. 背景与动机

### 1.1 战略定位

Prism MCP Server 是 [Agentic UX 验证](../../magpie/docs/specs/AGENTIC-UX.md#0-战略评估-2025-12-06) 的核心组件。

**核心假设**：
> 用户需要一个跨 AI 工具的 "Personal Context Layer"，能够在 Claude/Cursor/ChatGPT 之间保持一致的上下文。

**验证方式**：
- 将 Prism 封装为被动 MCP Server
- 观察 Claude Desktop 用户是否主动调用

### 1.2 与现有 MCP Server 的关系

项目中已有 `scripts/mcp-server/`（Fulmail MCP），可复用其模式：

| 组件 | Fulmail MCP | Prism MCP (新) |
|------|-------------|----------------|
| 数据源 | `messages.json` | `prism.db` (SQLite) |
| 协议 | MCP Stdio | MCP Stdio |
| Tools | `search`, `graph_query` | `prism_*` 系列 |

---

## 2. 架构设计

### 2.1 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Desktop / Cursor                                        │
│    ↓                                                            │
│  MCP Client                                                     │
└────────────────────────┬────────────────────────────────────────┘
                         │ stdio
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Prism MCP Server (新增)                                        │
│    apps/prism-server/src/mcp/                                   │
│    ├── index.ts          # 入口                                 │
│    ├── tools/            # MCP Tools                            │
│    └── resources/        # MCP Resources (可选)                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Prism Core (现有)                                              │
│    ├── db.ts             # SQLite 连接                          │
│    ├── recommend.ts      # Gravity 算法                         │
│    ├── lib/scout/        # Scout 搜索+Profile                   │
│    └── recall.ts         # 记忆检索                             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
apps/prism-server/
├── src/
│   ├── mcp/                    # 新增
│   │   ├── index.ts            # MCP Server 入口
│   │   ├── tools/
│   │   │   ├── index.ts        # Tool 注册
│   │   │   ├── get-context.ts  # prism_get_context
│   │   │   ├── scout.ts        # prism_scout
│   │   │   └── recall.ts       # prism_recall
│   │   └── resources/
│   │       └── index.ts        # Resource 注册 (可选)
│   └── ... (现有代码)
├── package.json                # 新增 mcp 脚本
└── docs/
    └── PRISM-MCP-SPEC.md       # 本文件
```

---

## 3. MCP Tools 定义

### 3.1 `prism_get_context`

**用途**：获取某个实体的累积 context（Profile + 相关实体 + 历史交互）

```typescript
{
  name: "prism_get_context",
  description: "获取用户知识图谱中某个实体的完整上下文，包括 Profile、相关实体和历史交互",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: {
        type: "string",
        description: "实体 ID，如 'person:julian' 或 'project:naughty_labs'"
      },
      include_related: {
        type: "boolean",
        description: "是否包含相关实体（默认 true）"
      }
    },
    required: ["entity_id"]
  }
}
```

**响应示例**：
```json
{
  "entity": {
    "id": "person:julian",
    "title": "Julian Benner",
    "subtitle": "Generative UI Pioneer",
    "bio": "...",
    "tags": ["design", "ai", "generative-ui"]
  },
  "related_entities": [
    { "id": "project:vercel", "relation": "works_at" },
    { "id": "topic:generative_ui", "relation": "expert_in" }
  ],
  "recent_memories": [
    { "id": 123, "title": "Meeting notes with Julian", "date": "2025-12-01" }
  ]
}
```

---

### 3.2 `prism_scout`

**用途**：对某个主题/人物进行外部搜索，生成 Profile

```typescript
{
  name: "prism_scout",
  description: "搜索外部资料并生成结构化 Profile，可用于了解新人物或话题",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "要搜索的人物或话题名称"
      },
      context: {
        type: "string",
        description: "提供额外的上下文帮助精准搜索"
      }
    },
    required: ["name"]
  }
}
```

**响应示例**：
```json
{
  "profile": {
    "name": "Linear",
    "role": "The Craftsman",
    "bio": "Issue tracking tool known for its quality-first approach...",
    "tags": ["productivity", "design", "engineering"],
    "assets": [
      "Principle: Quality is the marketing",
      "Tone: Minimal, precise, engineering-focused"
    ]
  }
}
```

---

### 3.3 `prism_recall`

**用途**：从用户的记忆库中检索相关信息

```typescript
{
  name: "prism_recall",
  description: "从用户的个人记忆库中检索相关信息，帮助回答'我之前想过什么'的问题",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "自然语言查询"
      },
      limit: {
        type: "number",
        description: "返回结果数量（默认 10）"
      }
    },
    required: ["query"]
  }
}
```

---

### 3.4 `prism_gravity_top`

**用途**：获取当前 Gravity 最高的实体列表

```typescript
{
  name: "prism_gravity_top",
  description: "获取用户当前最关注的实体（基于 Gravity 算法）",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "返回数量（默认 5）"
      },
      entity_type: {
        type: "string",
        description: "过滤实体类型（person/project/topic）"
      }
    }
  }
}
```

---

## 4. 实现计划

### Phase 1: 基础框架 (3-4 天)

- [ ] 创建 `src/mcp/` 目录结构
- [ ] 实现 MCP Server 入口 (`index.ts`)
- [ ] 配置 Stdio transport
- [ ] 添加 npm 脚本 (`npm run mcp`)

### Phase 2: 核心 Tools (4-5 天)

- [ ] 实现 `prism_get_context`
- [ ] 实现 `prism_scout`（复用现有 Scout Agent）
- [ ] 实现 `prism_recall`（复用现有 Recall 逻辑）
- [ ] 实现 `prism_gravity_top`

### Phase 3: 集成测试 (2-3 天)

- [ ] Claude Desktop 配置测试
- [ ] 编写使用文档
- [ ] 记录调用统计（用于验证）

---

## 5. Client Configuration

### 5.1 Cursor (Recommended - HTTP Mode)

Cursor supports HTTP MCP endpoints directly. Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "prism": {
      "url": "http://localhost:PORT/mcp"
    }
  }
}
```

**Note**: `PORT` is the dynamic port used by Magpie desktop app. Check Magpie Settings > MCP Integration for the current port.

**Advantages**:
- ✅ Uses Magpie's configured API keys automatically
- ✅ No binary installation needed
- ✅ Hot-reload support during development

### 5.2 Claude Desktop (Stdio Binary Mode)

Claude Desktop requires a stdio binary. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "prism": {
      "command": "~/.magpie/prism-mcp"
    }
  }
}
```

**Installation**:
1. Open Magpie desktop app
2. Go to Settings > MCP Integration
3. Click "Install prism-mcp binary"

**API Keys**: The binary reads from `~/.magpie/prism-config.json`, which is automatically written by Magpie when you configure API keys.

### 5.3 Key Configuration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Magpie Desktop App                                  │
│                                                                             │
│  User configures keys → POST /api/config/keys → prism-server               │
│                                   │                                         │
│                                   ├──► In-memory (configureKeys)            │
│                                   └──► Shared file (~/.magpie/prism-config.json)
│                                                       │                     │
└───────────────────────────────────────────────────────┼─────────────────────┘
                                                        │
                     ┌──────────────────────────────────┼──────────────────────┐
                     │                                  │                      │
                     ▼                                  ▼                      │
         ┌─────────────────────┐          ┌─────────────────────┐             │
         │     Cursor          │          │   Claude Desktop    │             │
         │  (HTTP /mcp)        │          │   (stdio binary)    │             │
         │                     │          │                     │             │
         │  Uses prism-server  │          │  Reads shared       │             │
         │  (already has keys) │          │  config file        │             │
         └─────────────────────┘          └─────────────────────┘             │
                                                                               │
                           ~/.magpie/prism-config.json                        │
                           {                                                   │
                             "proxyToken": "...",                              │
                             "proxyUrl": "https://...",                        │
                             "openaiKey": "sk-...",                            │
                             "tavilyKey": "tvly-...",                          │
                             "updatedBy": "magpie"                             │
                           }                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Available Tools

| Tool | Description | API Key Required |
|------|-------------|------------------|
| `prism_get_context` | Get entity context from knowledge graph | ❌ |
| `prism_scout` | Search web + generate profile | ✅ (Tavily + OpenAI) |
| `prism_search` | Raw web search results | ✅ (Tavily) |
| `prism_recall` | Query personal memories | ❌ |
| `prism_gravity_top` | Get highest gravity entities | ❌ |
| `prism_ingest` | Import content to memory | ❌ (OpenAI optional) |
| `prism_explore` | Deep topic exploration | ✅ (Tavily + OpenAI) |
| `prism_scout_tick` | Trigger scout cycle | ✅ (Tavily + OpenAI) |

---

## 7. Testing

### HTTP Test Endpoint (dev mode)

```bash
# List tools
curl -s http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq

# Call tool
curl -s http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"prism_recall",
      "arguments":{"query":"recent projects","limit":5}
    }
  }' | jq
```

### Stdio Binary Test

```bash
# Build MCP binary
cd apps/prism-server && pnpm build:mcp

# Test with echo
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ./prism-mcp-bin
```

---

## 8. Changelog

| Version | Date | Changes |
|---------|------|---------|
| v2 | 2025-12-21 | HTTP /mcp endpoint, shared config file, Cursor support |
| v1.1 | 2025-12-21 | prism_search tool, real keyLinks, rawSources |
| v1 | 2025-12-06 | Initial implementation with stdio transport |

---

*Updated: 2025-12-21*
