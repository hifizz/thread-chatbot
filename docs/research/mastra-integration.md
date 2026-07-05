# Mastra.ai 集成可行性调研

> 调研日期：2026-07-05。基于 Mastra 1.0（2026 年 1 月发布）及其后至 2026 年 3 月的官方 changelog、assistant-ui 官方 Mastra 集成文档，以及本仓库当前代码（`ai@^7`、`@assistant-ui/react@^0.14`、Next.js 16、Drizzle + Postgres）。

## TL;DR

- **技术上可以集成，官方甚至有 assistant-ui + Mastra 的集成文档**，MiniMax 也是 Mastra 模型路由的原生支持商（含 minimaxi.com 国内端点）。
- **最大的硬性障碍是 AI SDK 版本**：Mastra 1.0 的流转换层（`@mastra/ai-sdk` 的 `toAISdkStream`）目前只支持 AI SDK **v5（默认）和 v6**，而本项目已经在 **AI SDK v7**（`ai@^7.0.14`）。v7 对流协议和消息持久化模型有实质性变更（app messages 取代 UIMessage 作为持久化层、system message 处理变化等），不是"大概率兼容"的小版本差。
- **第二个摩擦点是持久化双轨**：本项目已用 Drizzle 自建 `threads`/`messages` 表并通过 assistant-ui 的 `RemoteThreadListAdapter` 打通；Mastra Memory 会在 Postgres 里维护自己的一套 threads/messages 表。二者只能选一个作为事实源，选 Mastra 就要重写 `lib/chat/thread-list-adapter.ts` 这一层。
- **建议**：短期不整体迁移；把 Mastra 当作"当我们需要 Memory / RAG / 多 Agent / 人工审批工作流时"的候选后端，先做一个隔离的 spike 验证流协议兼容性。同时注意 AI SDK 7 自带的 `@ai-sdk/workflow` + `WorkflowAgent` 已经覆盖了 Mastra 的一部分卖点（可持久化、可恢复的 agent 执行），零新依赖。

---

## 1. Mastra 是什么（2026 年年中状态）

Mastra 是 TypeScript 的 AI 应用/Agent 框架，2024 年 10 月发布，**2026 年 1 月发布 1.0**（官方宣称 API 锁定），npm 周下载 30 万+，Replit、PayPal、Sanity 等在生产使用。核心能力：

| 模块 | 内容 |
| --- | --- |
| **Agents** | 带工具调用循环的自治 agent，支持停止条件、结构化输出、版本固定（experiment 复现） |
| **Workflows** | 图式工作流引擎：`.then()` / `.branch()` / `.parallel()`，**suspend/resume**（挂起等待人工输入/审批，状态落库，进程重启后可恢复） |
| **Memory** | 会话历史（threads/resources 模型）、**working memory**（跨会话的用户画像/状态）、**semantic recall**（pgvector 语义召回历史消息）、observational memory（2026 年新增，支持按 token 量自动路由到便宜/强力模型） |
| **RAG** | `@mastra/rag`：文档切分、embedding、向量检索（pgvector 等） |
| **模型路由** | 截至 2026-03 约 **3300+ 模型 / 94 提供商**，字符串即用（`"minimax/MiniMax-M2"` 风格），也支持自定义 OpenAI 兼容 baseURL |
| **MCP** | MCPClient（接入第三方 MCP 工具生态）与 MCPServer（把自己的 agent/工具暴露出去） |
| **多 Agent** | 一等公民的 supervisor 模式：委派、迭代跟踪、完成度评估、per-agent 记忆隔离 |
| **Evals / Scorers** | 自动化评测、dataset 驱动的 experiments（2026-03 新增 MongoDB 数据集存储、agent 版本固定） |
| **可观测性** | AI tracing、logs/scores/feedback/metrics API |
| **Studio / Playground** | 本地可视化调试台（agent 对话、工作流单步、trace 查看） |
| **部署** | 内嵌进 Next.js，或独立 Mastra server（Hono），或云平台 |

## 2. 与本项目技术栈的逐项兼容性

### 2.1 AI SDK 版本 —— ⚠️ 核心风险

- 本项目：`ai@^7.0.14` + `@ai-sdk/react@^4` + `@assistant-ui/react-ai-sdk`（走 AI SDK v7 的 UIMessage 流协议）。
- Mastra 1.0：模型层支持到 AI SDK v6 的 `LanguageModelV3`（向后兼容 V1/V2）；流转换层 `toAISdkStream()` / `toAISdkMessages()` 支持 `version: 'v5'`（默认）和 `'v6'`。**官方文档和 2026 年 1~3 月所有 changelog 均未提及 v7 支持**，且官方明确提示 "`@mastra/ai-sdk` tracks the AI SDK v6 contract"，升级 `ai` 包需自行验证。
- AI SDK v7 的变更不是表面的：引入 app messages + data parts 作为新的持久化层（UIMessage 退居纯 UI 用途）、默认拒绝 messages 里的 system 消息（改用顶层 `instructions`）、要求 Node.js 22+、新增 realtime/timeout/工具 context 类型等。**v6 形状的流未经验证不能假设可被 v7 前端消费。**
- 连带影响：本项目的 provider `@ai-sdk/openai-compatible@^3` 是 v7 系的（更高版本的 LanguageModel 规范），**很可能不能直接作为模型实例传给 Mastra Agent**——要么改用 Mastra 模型路由字符串，要么并行安装 v6 系 provider 包（依赖树里出现两套 AI SDK，类型和运行时都容易踩坑）。

**可行的绕法**（都各有代价）：
1. 等 Mastra 官方跟进 v7（1.0 后节奏很快，值得盯 changelog / GitHub issue）；
2. 项目降回 AI SDK v6 —— 需要同时确认 assistant-ui 各包对 v6 的兼容矩阵，逆版本升级，属于为框架削足适履，**不建议**；
3. spike 验证 `toAISdkStream({ version: 'v6' })` 输出能否被当前 `useChatRuntime` 正常消费（文本流大概率可以，**reasoning part、工具调用 part、`frontendTools` 转发这几个我们重度依赖的部分最可能出问题**）。

### 2.2 assistant-ui 集成路径 —— ✅ 有官方方案

assistant-ui 没有 `@assistant-ui/react-mastra` 专用包，官方推荐仍走 AI SDK runtime：API route 里 `mastra.getAgent(...)` → `agent.stream(messages)` → `toAISdkStream(stream, { from: "agent" })` → `createUIMessageStream` / `createUIMessageStreamResponse` 返回。前端 `useChatRuntime` 无需改动（版本兼容前提下）。两种部署模式：

- **Full-stack**：Mastra 实例直接住在 Next.js 里（需 `next.config.ts` 加 `serverExternalPackages: ["@mastra/*"]`）。适合本项目当前规模。
- **Separate server**：Mastra 独立部署，Next.js 只做前端。适合 AI 后端需要独立伸缩/长任务的阶段。

本项目现有的 `useRemoteThreadListRuntime` + history adapter 组合不受 route 内部实现影响——**Mastra 只替换 route.ts 里 `streamText` 那一段，前端运行时结构可以原样保留**。

### 2.3 MiniMax —— ✅ 原生支持

Mastra 模型路由直接列有 MiniMax（minimax.io 和 minimaxi.com 国内端点都有专页），`MINIMAX_API_KEY` 环境变量自动识别；也可以用自定义 OpenAI 兼容 baseURL 配置。**待验证点**：MiniMax 以 `<think>...</think>` 文本形式输出思维链，本项目靠 `extractReasoningMiddleware` 转成 reasoning part。走 Mastra 模型路由后这个 middleware 挂不挂得上（Mastra 有自己的模型包装机制）需要实测；挂不上的话 reasoning 折叠块会退化成正文里的原始标签。

### 2.4 线程持久化 —— ⚠️ 双轨冲突

Mastra Memory 使用自己的存储适配器（`@mastra/pg` 的 `PostgresStore`），在库里建自己的 threads/messages 表，并且是 semantic recall / working memory 的地基。与本项目的 Drizzle `threads`/`messages` + `RemoteThreadListAdapter` 是两套平行的事实源。集成时二选一：

- **A. 不用 Mastra Memory**：agent 无状态运行，历史仍由 assistant-ui adapter 管。改动最小，但放弃了 Mastra 最有价值的记忆能力，只剩工具循环和工作流。
- **B. 迁移到 Mastra Memory**：`lib/chat/thread-list-adapter.ts` 和 `use-thread-history-adapter.ts` 改为调 Mastra 的 threads/messages API，Drizzle 表退役或只留业务扩展字段。一次性重构成本中等，换来 semantic recall / working memory 全家桶。
- （同一个 Postgres 实例可以共用，`PostgresStore` 表名有前缀，不会打架，但注意这个库是多项目共享的 Docker 容器，要建在 `thread-chat` 库内。）

### 2.5 前端工具（`writeNote` 模式）—— ⚠️ 需改造

本项目的浏览器端工具靠 `@assistant-ui/react-ai-sdk` 的 `frontendTools()` 把 JSON Schema 转发进 `streamText`。Mastra 的等价机制是 `clientTools`（`createTool()` 定义、`.stream()` 时传入），但那是 Mastra 自己的客户端 SDK 语义，与 assistant-ui 的 `useAssistantTool` 工具 UI 注册是两套体系。混合方案（Mastra agent 的服务端工具 + route 层继续把 frontendTools 拼进去）理论上可行——Mastra agent 支持请求级动态 toolsets——但属于文档没覆盖的组合，spike 里必须验证。

### 2.6 Next.js 16 / 运行时

- 需要 `serverExternalPackages: ["@mastra/*"]`，防打包错误；
- Mastra 面向 Node 运行时（本项目 route 未用 edge，无冲突）；
- AI SDK 7 已要求 Node 22+，Mastra 无额外要求；
- 引入 `@mastra/core`（+ 可选 `@mastra/pg`、`@mastra/rag`、`@mastra/ai-sdk`）依赖树明显变重，冷启动和构建时间会有感知。

## 3. 好处：基于 Mastra 能把这个 chatbot 做到什么程度

按"解锁的产品能力"排序：

1. **有长期记忆的助手**（最大增量）
   - working memory：跨会话记住用户偏好、称呼、正在进行的事项（不是靠把历史全塞 context）；
   - semantic recall：pgvector 语义召回几千条历史消息中相关的几条（官方 2026-03 优化后 7000+ 消息线程召回 <500ms）；
   - 这两样纯手写 AI SDK 也能做，但等于自己重新发明 Mastra Memory。
2. **可靠的多步任务**：图式 workflow 把"搜索 → 汇总 → 生成表格 → 落库"这类流程从"祈祷模型自觉多轮调工具"变成确定性编排；**suspend/resume + human-in-the-loop** 让"AI 起草、用户确认、继续执行"成为一等公民（配合 assistant-ui 的工具 UI 做审批卡片，体验可以做得很完整）。
3. **文档问答 / 知识库（RAG）**：`@mastra/rag` + pgvector，在现有 Postgres 上即可加"上传文档并针对其对话"。
4. **MCP 工具生态**：MCPClient 一次接入即可用海量现成工具（本项目已装 `@assistant-ui/react-mcp`，两边对 MCP 的投入方向一致）。
5. **多 Agent 分工**：supervisor 模式做"路由 agent + 专家 agent"（闲聊/查数据/写作各一个），每个 agent 独立记忆与工具集。
6. **质量与可观测性**：scorers 自动评测回答质量、AI tracing 看每次调用的完整轨迹、dataset 驱动回归实验——从 demo 走向"可维护的产品"需要的基建。
7. **模型灵活性**：3300+ 模型字符串即换，做模型对比、按任务路由（便宜模型干杂活、强模型干难活，observational memory 已内置此模式）都容易。

## 4. 坏处与风险

1. **AI SDK v7 尚未官方支持**（见 2.1）——当下集成要么承担未验证的协议兼容风险，要么降级版本。这是唯一的"现在就会流血"的问题。
2. **抽象叠抽象**：现有 `route.ts` 不到 90 行、链路透明（assistant-ui → AI SDK → MiniMax）。加入 Mastra 后变成 assistant-ui → AI SDK 协议 ← 转换层 ← Mastra → 模型路由 → MiniMax，多一层就多一处排错面，尤其 reasoning 提取、frontendTools 这些定制点。
3. **框架锁定**：agent 定义、workflow、memory 语义都是 Mastra 私有 API；1.0 前它有频繁 breaking change 的历史（1.0 本身就带了一批：`createTool` 签名、导入路径、`RuntimeContext`→`RequestContext` 改名等）。1.0 后声称锁定，但生态仍在快跑（几乎每周一篇 changelog）。
4. **持久化重构成本**：迁到 Mastra Memory 要重写两个 adapter 文件并做数据迁移；不迁则 Mastra 价值大打折扣——这是"半吊子集成最难受"的典型。
5. **依赖与构建体积**：多个 `@mastra/*` 包 + 配置项，对一个目前主打轻快的项目是可感知的负担。
6. **收益重叠**：AI SDK 7 自身已提供 `@ai-sdk/workflow` / `WorkflowAgent`（持久、可恢复、支持延迟审批的 agent 执行）和 agent 抽象——Mastra 的差异化集中在 Memory、RAG、评测、Studio，而非"能不能编排"。

## 5. 可拓展性评估

- **横向（加能力）**：好。Memory / RAG / MCP / 多 Agent / Evals 都是官方模块，按需装包，不用换架构。
- **纵向（规模化）**：好。full-stack 起步 → 需要时拆成独立 Mastra server，前端代码基本不动；storage 支持 per-domain 组合（如消息在 PG、评测数据在别处）。
- **迁出成本**：中高。工具定义（zod schema + execute）迁移容易，workflow / memory 语义是私有的，深度使用后迁出等于重写后端编排层。
- **社区与存续**：健康。22k+ stars、YC 背书、大厂生产使用、1.0 已发；作为依赖的存续风险低于绝大多数 agent 框架。

## 6. 建议

**现在（不动架构）**
- 保持 AI SDK v7 + assistant-ui 直连的现状；需要"多步骤任务"时优先评估 AI SDK 7 原生的 `@ai-sdk/workflow` / `WorkflowAgent`（零新依赖，无版本冲突）。
- 盯 Mastra 的 AI SDK v7 支持进展（changelog / GitHub issues）。它落地之日，本文档 2.1 的主要风险即消失。

**当出现真实需求（长期记忆 / RAG / 多 Agent / 人工审批流）时**
- 先做一个 1~2 天的 spike 分支：`@mastra/core` + 模型路由接 MiniMax + `toAISdkStream` 接现有前端，重点验证四件事：
  1. v6 流格式能否被 `ai@7` 的 `useChatRuntime` 消费（文本、reasoning、工具调用三种 part 都要测）；
  2. MiniMax `<think>` 思维链在 Mastra 路径下能否仍渲染为 reasoning 折叠块；
  3. `frontendTools` / `writeNote` 链路是否存活；
  4. `PostgresStore` 与现有 Drizzle 表在 `thread-chat` 库中共存无冲突。
- spike 通过再决定 Memory 迁移（重写两个 adapter）；不通过则等 v7 支持或继续自建。

**结论一句话**：Mastra 与本项目的方向（assistant-ui + Postgres + MCP）高度合拍，"能做到的上限"显著更高（记忆、RAG、多 Agent、审批流、评测全家桶），但**此刻**集成卡在 AI SDK v7 兼容这一个硬点上；在需求真正出现、且 v7 支持落地（或 spike 验证通过）之前，维持现有轻量架构是更优解。

## 参考资料

- Mastra 1.0 发布公告：https://mastra.ai/blog/announcing-mastra-1
- Mastra GitHub：https://github.com/mastra-ai/mastra
- Mastra × AI SDK UI 指南（版本兼容说明）：https://mastra.ai/guides/build-your-ui/ai-sdk-ui
- assistant-ui 官方 Mastra 集成（full-stack / separate-server）：https://www.assistant-ui.com/docs/integrations/frameworks/mastra/full-stack 、 https://www.assistant-ui.com/docs/integrations/frameworks/mastra/overview
- Mastra × Next.js 集成：https://mastra.ai/docs/frameworks/web-frameworks/next-js 、 https://mastra.ai/blog/nextjs-integration-guide
- Mastra 模型路由 / MiniMax：https://mastra.ai/models 、 https://mastra.ai/models/providers/minimax-cn
- Mastra Memory / Postgres 存储：https://mastra.ai/docs/memory/storage 、 https://mastra.ai/reference/storage/postgresql 、 https://mastra.ai/docs/memory/semantic-recall
- Mastra 客户端工具：https://mastra.ai/docs/agents/using-tools
- AI SDK 7 发布说明与迁移指南：https://vercel.com/blog/ai-sdk-7 、 https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0
- Mastra changelog（2026-01 ~ 2026-03）：https://mastra.ai/blog/category/changelogs
