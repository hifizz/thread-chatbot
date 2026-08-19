# Web Search Demo 阶段说明

更新日期：2026-08-19

本文记录第一阶段联网 Demo 的实际能力边界。它用于验证“聊天模型通过 AnySearch 搜索和读取网页，再把结果用于回答”的主链路，不代表最终的智能研究架构。

## 当前已完成

### 1. 统一的 Web Search 与 Web Fetch

- 服务端通过 AnySearch REST Search 与 MCP Extract 接入联网能力；`ANYSEARCH_API_KEY` 可选，留空时使用匿名额度。
- `webSearch` 单次最多向模型返回 8 个结果，每条结果只注入轻量摘要。
- `readUrl` 使用 AnySearch Extract 抽取 HTML 网页并返回 Markdown，单页最多向模型注入 8,000 字符。
- 普通聊天和深度研究都可以获得联网工具，不再只依赖单独的 Deep Research 开关。
- 单轮最多允许 20 个模型/工具步骤，用于优先验证效果；该上限只是异常循环熔断，不是最终成本策略。

### 2. 明确联网请求的首步触发

当用户明确要求访问网页、GitHub、官方文档、社区文章、最新信息等内容时，服务端会强制首步调用 `webSearch`，避免模型错误回答“无法联网”。后续步骤由模型决定是否继续搜索或调用 `readUrl`。

### 3. 联网活动展示与持久化

- Thread Chat 可以消费 `webSearch`、`readUrl` 的流式工具事件。
- 多次联网调用聚合在同一个研究活动面板中，按真实调用顺序展示查询、阅读动作和来源。
- 搜索词使用 Text Shimmer 表示运行状态，图标不再闪烁。
- 来源链接使用可截断的胶囊样式，避免长标题撑破容器。
- 已完成的联网活动随消息保存，刷新页面后仍可看到。
- 面板和正文来源使用同一批工具结果，内部重试或参数错误不作为主要用户状态展示。

### 4. UMAPIS Claude 工具调用兼容

- UMAPIS Claude 凭据组改用官方 `@ai-sdk/anthropic` 适配器。
- UMAPIS GPT 凭据组继续使用 OpenAI-compatible 适配器。
- 该拆分用于解决 Claude 兼容端点在工具调用流中出现的响应管道错误。

### 5. Markdown 产物工具降噪

- 普通长回答不再自动暴露 Markdown Artifact 工具。
- 只有用户明确要求文章、报告、文档、文件、Markdown 或独立产物时才挂载并强制调用。
- “什么是 Markdown”“如何写文档”等概念或方法问题不会被误判成产物请求。

## 使用方式

匿名额度无需配置即可使用；如需更高配额与限流，在服务端配置：

```dotenv
ANYSEARCH_API_KEY=as_sk_...
```

测试 UMAPIS Claude 时还需要：

```dotenv
UMAPIS_BASE_URL=https://www.umapis.com
UMAPIS_API_KEY_CLAUDE=...
```

启动应用后，可以用以下类型的问题验证：

- `请搜索 Claude Code 官方 sandboxing 文档并总结。`
- `访问 GitHub 和官方工程博客，核验 Codex/Claude Code 的 Sandbox 方案。`
- `当前 Node.js 最新版本是什么？`

预期结果是：模型先出现联网活动，随后基于搜索或网页抽取结果回答，并给出可点击来源。

## 当前限制

1. 这一阶段还没有独立的智能路由器。是否联网主要由正则规则和模型自行决策，模糊问题可能过度搜索或漏搜。
2. 用户直接提供 URL 时，当前基线仍可能先搜索，再决定是否读取页面；尚未建立专门的 Direct Fetch 路径。
3. 没有结构化 Research Planner，也没有可审计的子问题和退出条件。
4. 没有按任务类型设置不同的推理强度；稳定知识问答与复杂研究共用相近的执行方式。
5. 20 步、每次 8 个结果是效果验证参数，可能产生很高的延迟和 Token 消耗，暂不适合作为默认生产预算。
6. 当前只验证了搜索和网页正文抽取，不等同于浏览器自动化、登录态网页访问或 Git 仓库克隆。

下一阶段将在此基线上加入 `answer / fetch / search / research` 四态路由、结构化 Planner、分级 reasoning、工具最小暴露和研究计划 UI。
