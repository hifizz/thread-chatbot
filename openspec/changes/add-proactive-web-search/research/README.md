# Research：主动 Web Search

- 调研与实施验证日期：2026-08-02 至 2026-08-05
- 范围：业界 Web Search/RAG 做法、当前项目接入点、GLM-5.2 工具调用验证、Tavily 成本
- 性质：非规范性证据记录；最终行为以本 change 的 specs 为准

## 1. 调研方法与可信度

证据按以下优先级使用：

1. 官方产品/API 文档与论文。
2. 当前仓库源码与已安装依赖源码。
3. 使用项目现有环境变量执行的 GLM-5.2/Tavily 小样本实测。

实测只证明“当前配置在这些样例上可工作”，不代表总体准确率；因此 ADR 要求固定评测集和灰度门槛，而不是凭演示直接全量上线。

## 2. 业界资料：查到了什么

### 2.1 模型主动判断是否搜索是主流交互

- [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search) 区分快速 lookup、reasoning model 的 agentic search 和长时间 deep research，并说明当工具可用时，模型可根据输入选择是否搜索。
- [Gemini Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search?hl=en) 描述的工作流是：模型分析 prompt，判断搜索是否改善答案，必要时自动生成一个或多个查询，然后返回带 inline annotations 的 grounded response。
- [Claude Web Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) 提供 `max_uses`、域名过滤和结构化引用；官方说明简单事实问题通常会使用 1–3 次搜索，复杂比较可能更多。
- [Self-RAG](https://research.ibm.com/publications/self-rag-learning-to-retrieve-generate-and-critique-through-self-reflection) 指出无差别地固定检索若干 passage 可能降低回答质量，提出按需检索与反思。

**推导**：默认应是模型主动 `auto`，不是所有问题强制检索；但必须有用户 `always/off` 覆盖、硬调用上限和可重复评测。

### 2.2 Search、Fetch 与 Deep Research 应分层

- OpenAI 官方把 quick lookup、agentic search、deep research 视为不同成本/时延层级。
- Claude 将 Web Search 与 Web Fetch 分为独立工具，并展示先搜索定位、再 fetch 最相关页面、最后带引用综合的组合流程。

**推导**：Thread Chat 的默认能力先做轻量 Search；全文 Fetch 和浏览器属于后续 change，既有显式 Deep Research 不应直接成为默认路径。

### 2.3 引用必须是结构化、可回溯的产品能力

- Gemini 返回贴近文本位置的 inline annotations。
- Claude Web Search 返回 `url/title/cited_text` 等结构化 citation 字段，并要求面向终端用户展示原始来源。
- [ALCE](https://arxiv.org/abs/2305.14627) 将 fluency、correctness、citation quality 分开评估；其论文报告即使最佳模型也经常缺乏完整引用支持。

**推导**：MVP 至少必须限制回答只能引用本轮工具返回 URL；第二批再建立 message-owned source ledger 与 inline source tag。不能把“有链接”等同于“引用正确”。

## 3. 当前项目：查到了什么

### 3.1 已有搜索代码但不在 Thread Chat 默认路径

| 证据 | 当前事实 | 影响 |
|---|---|---|
| `app/api/chat/route.ts` | `deepResearch=true` 才挂载 `researchTools`；`isThreadChat = !research && threadChat != null` | Search 与 Thread Chat 当前互斥 |
| `lib/chat/research-tools.ts` | 已有 `webSearch` 与任意 `readUrl({url})` | Search 可复用；任意 URL 工具不可直接进入默认模式 |
| `lib/ai/search.ts` | Tavily `/search` 与 `/extract`；search 固定 advanced、5 results、`include_answer=true` | 默认调用太重，且 provider 抽象实际是 Tavily wire format |
| `app/thread-chat/net/prompt.ts` | 请求体只有 messages/modelId/threadChat | 需要增加受服务端校验的 search mode |
| `app/thread-chat/net/ui-stream.ts` | 除 Markdown Artifact 外的工具事件被忽略 | 必须增加窄类型 Search 状态解析 |
| `constants/thread-chat.ts` | system prompt 没有当前日期、搜索政策、来源和不可信文本规则 | 时效查询容易生成旧年份 |
| `lib/billing/credits.ts` | 只按模型 token 写 `usage_records` | Search provider 成本当前会漏收 |

### 3.2 AI SDK v7 的工具循环边界

本项目安装 `ai@^7.0.14`。本地源码 `node_modules/ai/src/generate-text/stream-text.ts` 和 `prepare-step.ts` 证明：

- `streamText` 支持 `tools`、`activeTools`、`toolChoice`、`prepareStep`、`stopWhen` 和 tool-call repair。
- `stopWhen` 限制的是模型 step，不等于 provider call 数；模型可能在一个 step 中并行发出多个工具调用。
- 当前 Thread Chat 的 `prepareStep.activeTools` 只允许 `createMarkdownArtifact`，因此单纯把 Search 放进 `allTools` 仍不会让它生效。

**推导**：必须重构工具组合，并在 tool execute 之前使用请求内原子预算；不能只依赖 `isStepCount`。

## 4. GLM-5.2 实测记录

### 4.1 环境

- 日期：2026-08-02
- 模型：项目 `glm-5.2`，经 Ark Coding Plan OpenAI-compatible endpoint
- SDK：AI SDK v7
- 搜索：项目已配置的 Tavily endpoint
- 凭据：只读取现有 `.env.local`，未记录或输出 secret

### 4.2 工具决策 A/B

- 英文：7 个 prompt × baseline/policy，共 14 次决策，14/14 符合预期。
- 中文/混合：6 个 prompt，6/6 符合预期。
- 没有注入当前日期时，部分查询生成 2024/2025；注入 `Current date: 2026-08-02` 后使用 2026。
- 一次 dry run 出现 `query:null`，在严格 schema + execute + 更明确工具描述后未复现；仍需把参数校验和错误修复写成正式测试。

限制：样本很小且由同一调研者标注，只能证明方案可行，不能作为生产准确率结论。

### 4.3 真实 Search→GLM 循环

问题：Next.js 16 的版本敏感编程问题。

- 3 次 GLM model step。
- 3 次 Tavily Advanced Search。
- 找到 Next.js 官方资料并产生正确引用。
- 总用量：input 8,927、output 808、total 9,735 tokens。
- 验证脚本设置 `maxOutputTokens=700`，最终 finish reason 为 `length`，说明现有参数和验证上限偏重。
- 某次结果仍包含 Medium/Reddit，即使实验请求传了域名倾向；因此 server 必须自行校验和排序，不能完全相信 provider filter。

**推导**：搜索确实改善时效性，但当前 `advanced + 3 calls` 不适合默认开启；MVP 改 Basic、3 results、无 provider answer、1 次为目标、2 次硬上限。

## 5. 成本与请求数

### 5.1 官方 Tavily 口径（访问于 2026-08-03）

[Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits)：

- Free：1,000 credits/月。
- PAYG：$0.008/credit；月付档约 $0.005–$0.0075/credit。
- Basic Search：1 credit；Advanced Search：2 credits。
- Basic Extract：每 5 个成功 URL 抽取 1 credit；失败不收费。

按项目 `USD_TO_CNY=7.3`：

- Basic Search 保守成本：$0.008 = ¥0.0584。
- 30% 利润率最低用户价：约 ¥0.0834/次。
- Advanced Search 保守成本：¥0.1168；最低用户价约 ¥0.1669/次。

### 5.2 项目 GLM 内部估值

`constants/pricing.ts` 对 Ark Coding Plan 使用内部保守估值 ¥10/百万输入 token、¥40/百万输出 token。这不是 Ark 官方逐 token 标价，而是订阅套餐缺少逐请求账单时的内部成本口径。

真实循环估算：

- 3 × Advanced Search = 6 credits = $0.048 = ¥0.3504。
- GLM 内部估值约 ¥0.1216。
- 合计经济成本约 ¥0.4720。
- 当前代码只会向用户收模型费用，Search 约 ¥0.3504 会成为漏收成本。

### 5.3 单轮上游请求数

| 路径 | 典型上游请求 |
|---|---:|
| 不搜索 | 1 次模型 |
| 1 次 Search | 2 次模型 step + 1 次 provider = 3 |
| 2 次并行 Search | 2 次模型 step + 2 次 provider = 4 |
| 2 次顺序 Search | 最多约 3 次模型 step + 2 次 provider = 5 |
| 本次现有重型实测 | 3 次模型 + 3 次 provider = 6 |

**推导**：MVP 的用户体验和成本目标必须同时约束 provider calls、model steps、input context 与 output token。

## 6. 决策追踪

| Research 结论 | ADR | Spec |
|---|---|---|
| 按需检索优于所有问题强制检索 | [ADR-0001](../adrs/0001-default-auto-search.md) | `proactive-web-search` |
| 默认路径应是轻量 Search，不是 Deep Research/Fetch | [ADR-0002](../adrs/0002-search-only-bounded-mvp.md) | `proactive-web-search` |
| Tavily 可作为现有基线但不是永久锁定 | [ADR-0003](../adrs/0003-tavily-baseline-provider.md) | `proactive-web-search` |
| 外部调用必须独立记账 | [ADR-0004](../adrs/0004-meter-external-usage.md) | `web-search-metering` |
| GLM-5.2 必须通过固定 gate 后灰度 | [ADR-0005](../adrs/0005-glm52-evaluation-gate.md) | `web-search-metering` |
| Ark GLM-5.2 不可靠执行 forced tool choice | [ADR-0006](../adrs/0006-server-force-always-and-serialize-search.md) | `proactive-web-search` |
| 模型生成 URL 不能作为可点击来源的信任边界 | [ADR-0007](../adrs/0007-enforce-source-url-provenance.md) | `web-search-transparency` |
| 内部多次 tool call 不能直接成为用户状态 | [ADR-0008](../adrs/0008-aggregate-search-activity.md) | `web-search-transparency` |
| 聚合卡不能固定在正文首尾，必须跟随 SSE 顺序 | [ADR-0009](../adrs/0009-anchor-aggregate-activity-to-stream-order.md) | `web-search-transparency` |

## 7. 实施期验证结果（2026-08-05）

### 7.1 64 条 GLM-5.2 路由集

报告：[eval-routing-glm52.json](eval-routing-glm52.json)

- 模型：`glm-5.2`；中英双语固定样本 64 条。
- must-search recall：100%；no-search precision：100%。
- 任一回答最多 1 次 provider call；Auto 中位数 1 次。
- 路由、模式语义和调用上限自动 gate 全部通过。

首轮实测同时发现 Ark OpenAI-compatible endpoint 会忽略 forced `tool_choice`，并且 GLM-5.2 会在同一步并行发出两个查询。这不是 prompt 层可以可靠修复的行为，因此形成 ADR-0006：`always` 改为服务端确定性首搜，Auto 增加每 step 最多一次 provider call。

### 7.2 20 条真实 Tavily Basic 编程集

报告：[eval-live-programming-glm52.json](eval-live-programming-glm52.json)

- 20 条版本敏感编程问题共消耗 20 Tavily credits，按 PAYG 上限估算 `$0.16`；每条恰好 1 次搜索。
- 端到端延迟 p50 `26.881s`，p95 `39.538s`。这明显高于普通对话，灰度时必须单独监控，不能把搜索延迟隐藏在模型延迟中。
- 原始模型回答中，自动来源有效率只有 80%：模型会缩写、改写或补造 URL。
- 将保存的原始回答和工具来源离线重放到服务端 URL guard 后，来源有效率与自动 gate 均为 100%。这次重放没有重新调用模型或 Tavily，报告保留了原始回答，不能被解读为一次新的模型质量评测。

来源 provenance 通过不代表答案正确。独立保守人工复核将 20 条原始回答分为：8 条改善、3 条不退化、7 条不确定、2 条退化。问题主要是模型在获得真实来源后仍对稳定性、实验状态或版本范围作出 snippet 未支持的推断。对 React 和 Next.js 两条失败样例增加条件式官方域名提示后，检索来源改善，但 React 样例仍出现未被证据支持的“experimental”判断，Next.js 样例仍需保守复核。

**结论：** 路由、调用上限、来源安全和成本记录达到 MVP 技术 gate；“版本敏感答案不得相对无搜索基线退化”的质量 gate 未通过。生产 feature flag 必须保持默认关闭，当前 change 不得进入比例灰度。

### 7.3 实测成本与请求数

- 正式 20-case 集：20 credits，约 `$0.16`。
- 包含中止、smoke、正式与定向复测在内，本轮开发验证约使用 29 credits，约 `$0.232`；另有 Ark Coding Plan/GLM 内部模型用量，无法从套餐得到逐请求官方账单。
- 单个 Auto 命中搜索的正常路径通常是 1 次 Tavily + 至少 2 个 model steps；`always` 是 1 次服务端 Tavily 首搜 + 后续模型生成。请求内最多 2 次 Tavily，但同一 model step 最多 1 次。
- 产品保守计费仍按每次 Basic Search 成本 ¥0.0584、用户价约 ¥0.083429 记录；模型 token 费用另计。

### 7.4 尚未完成的生产核对

- 本地 migration 文件和幂等外部流水已实现，但 `.env.local` 指向的本地 PostgreSQL 端口由 Docker Desktop 占用且连接被服务端关闭，无法应用 migration 或执行余额/流水联调。
- 本次没有 Tavily 控制台访问权限，因此 29 credits 是客户端请求/评测脚本口径，尚未与 provider 控制台账单对账。
- 没有生产灰度数据；触发率、线上 p95、错误率和真实用户成本只能在质量 gate 修复、数据库可用并经内部环境核对后回填。

这些限制分别对应 `tasks.md` 的 7.2/7.3，保持未完成状态，避免把“代码已实现”误报为“生产已验收”。

## 8. 资料清单

- [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Claude Web Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [Claude Web Fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)
- [Gemini Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search?hl=en)
- [Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits)
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Self-RAG](https://research.ibm.com/publications/self-rag-learning-to-retrieve-generate-and-critique-through-self-reflection)
- [ALCE](https://arxiv.org/abs/2305.14627)
