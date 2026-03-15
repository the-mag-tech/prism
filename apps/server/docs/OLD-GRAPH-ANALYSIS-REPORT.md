# 旧图谱分析报告 (Phase 4 前)

> **日期**: 2025-01-08
> **目的**: 在 Phase 4 图谱重建前，逐层诊断现有图谱的问题，并提出数据源建议
> **状态**: 存档 (供对比参考)

---

## 第一部分：逐层 Review

---

### 1. 数据源层 (Source Layer)

#### 1.1 现状

| 类型 | 数量 | 来源 |
|------|------|------|
| user_memories | 62 | 用户主动导入 |
| - markdown | 28 | 文档文件 |
| - user_drop | 34 | 拖拽/粘贴 |
| scout_findings | 531 | 系统 Scout 发现 |

#### 1.2 诊断

**✅ 优点**:
- 用户导入的 62 条内容质量较高（多为项目文档、设计稿）
- Scout 发现的 531 条内容来源多样

**⚠️ 问题**:
- 用户导入与系统发现比例约 **1:8.5**，过度依赖自动发现
- 用户导入缺少个人化内容（邮件、笔记、聊天记录）
- Scout findings 多为公开网页，缺少深度专业资料

#### 1.3 理想数据源建议

| 数据源类型 | 潜在价值 | 实现难度 |
|------------|----------|----------|
| **个人邮件** | 真实人际关系、项目沟通历史 | 中 (需 OAuth) |
| **日历事件** | 时间线、会议参与者、地点 | 中 (需 OAuth) |
| **浏览历史** | 兴趣追踪、阅读偏好 | 低 (本地) |
| **笔记应用** | 思考过程、灵感记录 | 中 (Obsidian/Notion API) |
| **代码仓库** | 项目关系、协作者 | 低 (GitHub API) |
| **社交媒体** | 关注的人、互动对象 | 高 (API 限制) |
| **PDF/论文** | 学术知识、引用网络 | 中 (解析) |

---

### 2. 实体层 (Entity Layer)

#### 2.1 现状

| 指标 | 数量 |
|------|------|
| 总实体数 | 6,628 |
| 源实体 (memory/finding) | 913 (13.8%) |
| 提取实体 | 5,715 (86.2%) |

#### 2.2 按 Four Tribes 分布

| Tribe | 类型 | 数量 | 占比 | 评价 |
|-------|------|------|------|------|
| 🌱 **Source** | memory | 88 | 1.3% | ✅ 正常 |
|  | finding | 825 | 12.4% | ✅ 正常 |
| 💼 **Salesman** | person | 283 | 4.3% | ⚠️ 偏少 |
|  | company | 441 | 6.7% | ✅ 合理 |
|  | project | 578 | 8.7% | ✅ 合理 |
| 📚 **Archivist** | topic | 779 | 11.8% | ⚠️ 偏多 |
|  | concept | 1,350 | 20.4% | ❌ 过度膨胀 |
|  | problem | 688 | 10.4% | ⚠️ 偏多 |
|  | insight | 852 | 12.9% | ❌ 过度膨胀 |
| 📅 **Logger** | event | 318 | 4.8% | ✅ 合理 |
|  | milestone | 181 | 2.7% | ✅ 合理 |
|  | decision | 70 | 1.1% | ⚠️ 偏少 |
|  | news | 168 | 2.5% | ✅ 合理 |
| 🌿 **Gardener** | gift | 0 | 0% | ❌ 完全缺失 |
|  | hobby | 0 | 0% | ❌ 完全缺失 |
|  | location | 6 | 0.1% | ❌ 几乎缺失 |
|  | agenda | 0 | 0% | ❌ 完全缺失 |

#### 2.3 诊断

**❌ 核心问题：Tribe 分布严重失衡**

```
Archivist (知识抽象层): 3,669 实体 (55.3%)  ← 过度膨胀
Salesman (人脉关系层): 1,302 实体 (19.6%)  ← 相对健康
Logger (时间线层):       737 实体 (11.1%)  ← 合理
Gardener (个人关系层):     6 实体 (0.1%)  ← 几乎缺失
```

**根本原因**:
1. 旧 Extraction Prompt 倾向于生成抽象概念 (concept, insight, problem)
2. 数据源缺少个人化内容，导致 Gardener tribe 无法填充
3. Person 实体多为公众人物，缺少用户真实社交圈

#### 2.4 理想数据源建议

| Tribe 缺口 | 理想数据源 | 预期效果 |
|------------|------------|----------|
| **Gardener: gift** | 购物记录、礼品清单 | 建立送礼关系网络 |
| **Gardener: hobby** | 运动 App、音乐播放记录 | 了解用户兴趣 |
| **Gardener: agenda** | 日历、待办事项 | 捕获计划和承诺 |
| **Salesman: person** | 通讯录、邮件联系人 | 扩展真实人脉 |
| **Logger: decision** | 会议记录、聊天中的决策 | 捕获决策时刻 |

---

### 3. 关系层 (Relations)

#### 3.1 现状

| 指标 | 数量 |
|------|------|
| 总关系数 | 22,817 |
| 平均每实体关系数 | 3.4 |

#### 3.2 关系类型分布

| 类型 | 数量 | 占比 | 性质 | 评价 |
|------|------|------|------|------|
| `contains` | 7,121 | 31.2% | 结构性 | ⚠️ 无语义 |
| `containedIn` | 5,382 | 23.6% | 结构性 | ⚠️ 无语义 |
| `discoveredFrom` | 3,278 | 14.4% | Scout 生成 | ✅ 有用 |
| `discovered` | 3,278 | 14.4% | Scout 生成 | ✅ 有用 |
| `relatedTo` | 3,051 | 13.4% | 通用 | ⚠️ 过于模糊 |
| `mentions` | 707 | 3.1% | 引用 | ✅ 有用 |

#### 3.3 诊断

**❌ 核心问题：零语义化关系**

检查以下语义化关系类型：

| 关系类型 | 预期场景 | 实际数量 |
|----------|----------|----------|
| `works_at` | person → company | **0** |
| `created_by` | project → person | **0** |
| `founded_by` | company → person | **0** |
| `educated_at` | person → organization | **0** |
| `collaborates_with` | person → person | **0** |
| `owns` / `owned_by` | company ↔ project | **0** |
| `uses` | project → technology | **0** |
| `solves` | project → problem | **0** |

**结论**: 旧图谱**完全无法回答**以下问题：
- "Simon Willison 在哪工作？" → 无 `works_at` 关系
- "Datasette 是谁创建的？" → 无 `created_by` 关系
- "这个人和那个人什么关系？" → 只有 `relatedTo`，无具体关系

#### 3.4 理想状态

新图谱应该能表达：

```
person:simon_willison --works_at--> company:datasette_io
person:simon_willison --created--> project:datasette
person:simon_willison --educated_at--> organization:university_of_x
person:simon_willison --collaborates_with--> person:alex_garcia
project:datasette --uses--> concept:sqlite
project:datasette --solves--> problem:data_exploration
```

---

### 4. Gravity 分布

#### 4.1 现状

| 级别 | 范围 | 数量 | 占比 |
|------|------|------|------|
| 高 | ≥0.8 | 0 | 0% |
| 中 | 0.5-0.8 | 6,083 | 91.8% |
| 低 | 0.2-0.5 | 548 | 8.2% |
| 极低 | <0.2 | 0 | 0% |

#### 4.2 诊断

**❌ 核心问题：Gravity 无差异化**

- 91.8% 的实体 Gravity 在 0.5-0.8 范围
- **没有任何实体达到高 Gravity (≥0.8)**
- 无法区分"用户真正关心什么"

**根本原因**:
1. Gravity 计算缺少用户交互信号
2. 初始 Gravity 设置过于统一
3. 没有时间衰减机制

#### 4.3 理想状态

Gravity 应该反映：
- 用户频繁查看/搜索的实体 → 高 Gravity
- 近期提及的实体 → 中高 Gravity
- 长期未触及的实体 → 低 Gravity
- 与多个重要实体关联的实体 → Gravity 传递

---

### 5. 数据缺口 (Gap Detection)

#### 5.1 现状

扫描 2,399 个实体，检测到 9,506 个数据缺口：

| 实体类型 | 缺口数 | 平均缺口/实体 |
|----------|--------|---------------|
| topic | 2,337 | 3.0 |
| project | 2,312 | 4.0 |
| company | 2,205 | 5.0 |
| person | 1,698 | 6.0 |
| event | 954 | 3.0 |

#### 5.2 诊断

**缺口率 100%** — 由于旧图谱完全没有语义化关系，所有实体都被判定为"缺失预期关系"。

#### 5.3 理想状态

在新图谱中，Gap Detection 应该：
- 初始缺口率高（新提取的实体缺少深度信息）
- 随着 Scout/Ripple 执行，缺口逐渐填充
- 稳态下，高 Gravity 实体缺口率 < 30%

---

## 第二部分：问题汇总

---

### 汇总表

| 维度 | 核心问题 | 严重程度 | 根本原因 |
|------|----------|----------|----------|
| **数据源** | 过度依赖自动发现，缺少个人化内容 | ⚠️ 中 | 未接入邮件/日历/笔记 |
| **实体分布** | Archivist 过度膨胀 (55%)，Gardener 缺失 (0.1%) | ❌ 高 | Extraction Prompt 偏向抽象概念 |
| **关系类型** | 零语义化关系，全是结构性关系 | ❌ 严重 | Extraction 未生成语义关系 |
| **Gravity** | 无差异化，91.8% 在 0.5-0.8 | ⚠️ 中 | 缺少用户交互信号 |
| **数据缺口** | 100% 缺口率 | ❌ 严重 | 关系类型问题的直接后果 |

### 优先级排序

```
P0 (必须解决): 关系类型问题 → 修改 Extraction Prompt
P1 (重要):     实体分布问题 → 调整 Type Definitions
P2 (改进):     数据源问题   → 接入更多个人化数据源
P3 (优化):     Gravity 问题 → 增加用户交互追踪
```

---

## 第三部分：理想数据源清单

---

### 按价值/可行性矩阵

```
                    高价值
                       │
      ┌────────────────┼────────────────┐
      │                │                │
      │  📧 邮件       │  📅 日历       │
      │  📝 笔记       │  💬 IM 记录    │
      │                │                │
低难度 ├────────────────┼────────────────┤ 高难度
      │                │                │
      │  🌐 浏览历史   │  📱 社交媒体   │
      │  💻 GitHub     │  📞 通话记录   │
      │                │                │
      └────────────────┼────────────────┘
                       │
                    低价值
```

---

### 详细数据源清单

#### 📧 邮件 (Email)

| Provider | Domain | API/Protocol | Auth | 备注 |
|----------|--------|--------------|------|------|
| **Gmail** | gmail.com | Gmail API | OAuth 2.0 | 最常用，API 成熟 |
| **Outlook** | outlook.com, hotmail.com | Microsoft Graph | OAuth 2.0 | 企业用户多 |
| **Apple Mail** | icloud.com | IMAP | App Password | 需要本地客户端 |
| **ProtonMail** | proton.me | Bridge + IMAP | 本地 | 隐私优先用户 |
| **Fastmail** | fastmail.com | JMAP | API Key | 技术用户 |

**可提取**: 联系人关系、项目讨论、工作邮件 → `collaborates_with`, `works_at`, `discussed`

---

#### 📅 日历 (Calendar)

| Provider | Domain | API | Auth | 备注 |
|----------|--------|-----|------|------|
| **Google Calendar** | calendar.google.com | Calendar API | OAuth 2.0 | 最广泛 |
| **Outlook Calendar** | outlook.office.com | Microsoft Graph | OAuth 2.0 | 企业主流 |
| **Apple Calendar** | icloud.com | CalDAV | iCloud | 需 Apple 设备 |
| **Calendly** | calendly.com | REST API | API Key | 约会/会议 |

**可提取**: 会议参与者、地点、事件时间线 → `involves`, `at_location`, `scheduled`

---

#### 📝 笔记 (Notes)

| App/Provider | 存储位置 | API/访问 | 备注 |
|--------------|----------|----------|------|
| **Obsidian** | 本地 Markdown | 直接读取 | 开源，本地优先 |
| **Notion** | notion.so | REST API | OAuth 2.0 | 功能丰富 |
| **Roam Research** | roamresearch.com | JSON Export | 手动 | 双向链接 |
| **Logseq** | 本地 Markdown | 直接读取 | 开源，本地优先 |
| **Apple Notes** | iCloud | CloudKit | 需 macOS | 系统级集成 |
| **Evernote** | evernote.com | REST API | OAuth | 老牌笔记 |
| **Bear** | 本地 SQLite | 直接读取 | macOS/iOS |

**可提取**: 思考过程、知识关联、项目笔记 → `derived_from`, `relates_to`, `notes_about`

---

#### 💻 代码仓库 (Code Repositories)

| Provider | Domain | API | Auth | 备注 |
|----------|--------|-----|------|------|
| **GitHub** | github.com | REST/GraphQL | OAuth/PAT | 最大开源社区 |
| **GitLab** | gitlab.com | REST API | OAuth/PAT | 企业自托管 |
| **Bitbucket** | bitbucket.org | REST API | OAuth | Atlassian 生态 |
| **Gitea/Forgejo** | 自托管 | REST API | Token | 开源自托管 |

**可提取**: 项目、协作者、贡献历史 → `created_by`, `collaborates_with`, `contributes_to`

---

#### 🌐 浏览历史 (Browser History)

| Browser | 存储位置 | 访问方式 | 备注 |
|---------|----------|----------|------|
| **Chrome** | `~/Library/Application Support/Google/Chrome/Default/History` | SQLite | 需关闭 Chrome |
| **Firefox** | `~/Library/Application Support/Firefox/Profiles/*/places.sqlite` | SQLite | 需关闭 Firefox |
| **Safari** | `~/Library/Safari/History.db` | SQLite | macOS |
| **Arc** | `~/Library/Application Support/Arc/User Data/Default/History` | SQLite | 同 Chrome |
| **Edge** | 类似 Chrome | SQLite | Chromium 内核 |

**可提取**: 兴趣追踪、阅读偏好、常访问站点 → `interested_in`, `frequently_visits`

---

#### 💬 即时通讯 (IM)

| Provider | Domain | API | Auth | 备注 |
|----------|--------|-----|------|------|
| **Slack** | slack.com | Web API | OAuth 2.0 | 工作沟通主流 |
| **Microsoft Teams** | teams.microsoft.com | Graph API | OAuth 2.0 | 企业协作 |
| **Discord** | discord.com | REST API | Bot Token | 社区/游戏 |
| **Telegram** | telegram.org | MTProto/Bot API | Bot Token | 隐私用户 |
| **WeChat** | weixin.qq.com | 无公开 API | N/A | 国内主流，API 封闭 |

**可提取**: 工作讨论、决策记录、联系人 → `discussed_with`, `decided`, `collaborates_with`

---

#### 📱 社交媒体 (Social Media)

| Provider | Domain | API | Auth | 限制 |
|----------|--------|-----|------|------|
| **Twitter/X** | x.com | API v2 | OAuth 2.0 | 付费 API |
| **LinkedIn** | linkedin.com | REST API | OAuth 2.0 | 严格审批 |
| **Facebook** | facebook.com | Graph API | OAuth 2.0 | 限制多 |
| **Instagram** | instagram.com | Graph API | OAuth 2.0 | 仅商业账户 |
| **微博** | weibo.com | REST API | OAuth 2.0 | 需审核 |
| **小红书** | xiaohongshu.com | 无公开 API | N/A | 封闭 |

**可提取**: 关注/粉丝关系、互动对象 → `follows`, `interacts_with`

---

#### 🎵 音乐/娱乐 (Entertainment)

| Provider | Domain | API | Auth | 备注 |
|----------|--------|-----|------|------|
| **Spotify** | spotify.com | Web API | OAuth 2.0 | 全球最大 |
| **Apple Music** | music.apple.com | MusicKit | Developer Token | Apple 生态 |
| **YouTube Music** | music.youtube.com | YouTube API | OAuth 2.0 | Google 生态 |
| **网易云音乐** | music.163.com | 非官方 API | Cookie | 国内主流 |
| **Netflix** | netflix.com | 无公开 API | N/A | 无 API |

**可提取**: 音乐偏好、收听历史 → `hobby`, `prefers`

---

#### 🏃 健康/运动 (Health & Fitness)

| Provider | Domain | API | Auth | 备注 |
|----------|--------|-----|------|------|
| **Apple Health** | 本地 HealthKit | HealthKit | 系统权限 | iOS/watchOS |
| **Strava** | strava.com | REST API | OAuth 2.0 | 跑步/骑行 |
| **Garmin** | connect.garmin.com | REST API | OAuth 1.0a | 专业运动 |
| **Fitbit** | fitbit.com | Web API | OAuth 2.0 | Google 收购 |
| **Nike Run Club** | nike.com | 无公开 API | N/A | 封闭 |
| **Keep** | gotokeep.com | 无公开 API | N/A | 国内健身 |

**可提取**: 运动习惯、健身地点 → `hobby`, `exercises_at`

---

#### 📚 学术/阅读 (Academic & Reading)

| Provider | Domain | API | Auth | 备注 |
|----------|--------|-----|------|------|
| **Zotero** | zotero.org | Web API | API Key | 学术引用管理 |
| **Mendeley** | mendeley.com | REST API | OAuth 2.0 | Elsevier 旗下 |
| **Readwise** | readwise.io | REST API | API Key | 高亮/笔记聚合 |
| **Pocket** | getpocket.com | REST API | OAuth 2.0 | 稍后阅读 |
| **Instapaper** | instapaper.com | REST API | OAuth 1.0a | 稍后阅读 |
| **Kindle** | amazon.com | 非官方 | 手动导出 | 笔记/高亮 |
| **微信读书** | weread.qq.com | 非官方 | Cookie | 国内阅读 |

**可提取**: 引用网络、阅读历史、高亮笔记 → `cites`, `authored_by`, `read`, `highlighted`

---

#### 🛒 购物/电商 (Shopping)

| Provider | Domain | API | Auth | 备注 |
|----------|--------|-----|------|------|
| **Amazon** | amazon.com | 无公开 API | 手动导出 | 订单历史 |
| **淘宝/天猫** | taobao.com | 无公开 API | 手动导出 | 国内主流 |
| **京东** | jd.com | 无公开 API | 手动导出 | 国内主流 |
| **拼多多** | pinduoduo.com | 无公开 API | 手动导出 | 下沉市场 |

**可提取**: 购买偏好、送礼记录 → `purchased`, `gift`, `preference`

---

### 推荐接入顺序

| 阶段 | 数据源 | 难度 | 优先理由 |
|------|--------|------|---------|
| **Phase 1** | GitHub, Obsidian/Logseq, 浏览历史 | ⭐ 低 | 本地/开放 API，立即可用 |
| **Phase 2** | Gmail, Google Calendar | ⭐⭐ 中 | OAuth 成熟，价值高 |
| **Phase 3** | Slack, Notion, Zotero | ⭐⭐ 中 | 深度集成，丰富知识图谱 |
| **Phase 4** | Spotify, Strava, 购物记录 | ⭐⭐⭐ 高 | 个人化，填充 Gardener tribe |

---

### Qveris 工具能力对比

> **背景**: Qveris 是我们已集成的 Tool OS，提供统一的工具执行层。以下分析其对个人数据源的覆盖情况。

#### Qveris 实际提供的工具

| 类别 | 工具 | 状态 | 鉴权模式 |
|------|------|------|----------|
| **Web 搜索** | Linkup Search | ✅ 可用 | Qveris 托管 |
| | Google Search (ScrapingBee) | ✅ 可用 | Qveris 托管 |
| | DuckDuckGo (SerpAPI) | ✅ 可用 | Qveris 托管 |
| **公开数据** | GBIF, UNESCO, WorldBank | ✅ 可用 | 无需鉴权 |
| **SaaS 工具** | Apify (部分) | ✅ 可用 | Qveris 托管 |
| | HubSpot (Tracking Pixel) | ⚠️ 仅写入 | 公开端点 |

#### Qveris 不支持的数据源

| 数据源 | 原因 | 我们的方案 |
|--------|------|-----------|
| Gmail | 需 OAuth 用户授权 | MCP Server (OAuth) |
| Google Calendar | 需 OAuth 用户授权 | MCP Server (OAuth) |
| Notion | 需 OAuth/API Key | MCP Server (OAuth/API Key) |
| GitHub (私有) | 需 OAuth/PAT | MCP Server (OAuth/PAT) |
| Slack | 需 OAuth | MCP Server (OAuth) |
| Spotify | 需 OAuth | MCP Server (OAuth) |
| Twitter/X | 需 OAuth + 付费 API | MCP Server (受限) |
| LinkedIn | 需 OAuth + 严格审批 | 优先级低 |
| Obsidian | 本地文件 | 直接读取 |

#### Qveris 鉴权模式解析

```
┌─────────────────────────────────────────────────────────────────┐
│                        API 鉴权需求金字塔                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   OAuth 用户授权                          ← Qveris ❌           │
│   (Gmail, Notion, Slack, GitHub Private)    不支持              │
│                                                                 │
│   ─────────────────────────────────────                         │
│                                                                 │
│   API Key (用户自带)                      ← Qveris ⚠️           │
│   (OpenAI, Anthropic, 某些 SaaS)           参数传入              │
│                                                                 │
│   ─────────────────────────────────────                         │
│                                                                 │
│   API Key (Qveris 托管)                   ← Qveris ✅           │
│   (Linkup, ScrapingBee, SerpAPI)           透明使用              │
│                                                                 │
│   ─────────────────────────────────────                         │
│                                                                 │
│   公开 API (无需鉴权)                     ← Qveris ✅           │
│   (GBIF, UNESCO, WorldBank)                直接调用              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**结论**: Qveris 是优秀的 **Tool OS / 搜索聚合层**，但不是个人数据源的替代品。个人化数据接入需要独立的 OAuth 集成或 MCP Server。

---

### MCP Server 生态参考

已有开源 MCP Server 可复用：

| 数据源 | MCP Server | 仓库/来源 | 状态 |
|--------|------------|-----------|------|
| GitHub | mcp-github | `modelcontextprotocol/servers` | ✅ 官方 |
| Google Workspace | mcp-google-workspace | 社区/自建 | ✅ 可用 |
| Filesystem | mcp-filesystem | `modelcontextprotocol/servers` | ✅ 官方 |
| Slack | mcp-slack | 社区开发中 | 🚧 WIP |
| Notion | mcp-notion | 社区开发中 | 🚧 WIP |

---

## 附录：Phase 4 重建后的对比基线

| 指标 | 旧图谱 | 目标 (新图谱) |
|------|--------|--------------|
| 语义化关系占比 | 0% | > 50% |
| Archivist tribe 占比 | 55% | < 30% |
| Gardener tribe 占比 | 0.1% | > 5% |
| 高 Gravity 实体 | 0 | > 10% |
| Gap 填充率 (高 Gravity) | 0% | > 70% |

---

*此报告作为 Phase 4 重建的基线参考。重建完成后应生成新报告进行对比。*
