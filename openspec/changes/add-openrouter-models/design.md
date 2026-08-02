# 设计：OpenRouter 模型接入

## Context

项目已经通过 `constants/model.ts` 统一模型注册表、通过 `lib/ai/provider.ts` 解析 `LanguageModel`，并在 Thread 领域持久化 `modelId`。现有非 MiniMax 模型按 Vercel AI Gateway → Cloudflare AI Gateway → 供应商直连路由，Ark Coding Plan 则通过独立 provider 固定路由；这两项能力已经完成，本 change 不重新设计它们。

OpenRouter 是新的调用提供方而不是新的模型创建者：本次模型分别来自 OpenAI、Moonshot AI 与 DeepSeek，但必须共同使用 `OPENROUTER_API_KEY`。此外 OpenRouter 专属 AI SDK provider 能返回原生 reasoning parts、每一步的 token 细分及 `providerMetadata.openrouter.usage.cost`；项目当前的通用 OpenAI-compatible provider 和扁平 `MODEL_COST` 无法完整表达这些能力，尤其无法正确覆盖 GPT 系列超过 272K 输入后的阶梯价。

本设计的详细类型、接口参数、模型映射和边界矩阵见同目录 `plan.md`。

## Goals / Non-Goals

**Goals:**

- 通过 OpenRouter 专属 provider 接入用户指定的 10 个固定模型，并纳入 Thread Chat 选择、持久化与严格服务端校验。
- 让“模型创建者”和“调用 provider”不再混淆，保证 OpenRouter 模型不会进入现有网关/直连降级链。
- 保留 AI SDK 标准流、工具调用和 OpenRouter 原生 reasoning。
- 对多 step 生成聚合完整真实成本，并沿用现有汇率、利润率、余额和流水事务。
- 对缺 key、脏模型 id、成本元数据缺失、模型下线和旧树数据提供确定行为。

**Non-Goals:**

- 不开放任意 OpenRouter 模型、动态模型目录同步或自动价格同步。
- 不接入 OpenRouter 路由策略、插件、BYOK、provider fallback 或供应商筛选参数。
- 不新增 reasoning-effort UI/请求参数，也不把 Pro 建模为 effort。
- 不开放新增模型的图片/PDF原生输入能力。
- 不改变 Thread 分支继承/锁定、现有 provider 优先级或失败请求的计费语义。

## Decisions

### D1：OpenRouter 是独立调用 provider，外部 slug 不作为内部模型 id

`ChatModelProvider` 增加 `openrouter`。10 个注册项使用带 `openrouter-` 前缀的内部 id，`upstreamModel` 保存经过核对的 OpenRouter slug，并用仅供展示的 `creator` 区分 OpenAI、Moonshot AI 与 DeepSeek。

这样既符合现有 `ark` 字段代表“调用适配器”而非模型创建者的现实，也避免 `deepseek-v4-flash-0731` 与现有 Ark `deepseek-v4-flash` 混淆。持久化层只保存稳定的产品内部 id，客户端不能绕过注册表提交任意 OpenRouter slug。

弃选直接使用 `openai/gpt-5.6-luna` 等外部 slug 作为全站 id：这会把外部目录命名直接固化进产品持久化、计费 key 和 API 信任边界，也不利于以后并存同模型的其他路由来源。

### D2：使用 `@openrouter/ai-sdk-provider`，不复用通用 OpenAI-compatible provider

新增 `lib/ai/openrouter.ts`，集中创建 OpenRouter provider、读取服务端环境变量、开启 usage accounting、解析成本元数据。`lib/ai/provider.ts` 在发现 `provider === "openrouter"` 后直接短路到该适配器。

专属 provider 当前明确支持项目使用的 AI SDK v7，并能把 OpenRouter 原生 reasoning 和 usage/cost metadata 映射到 AI SDK；通用 compat provider只适合基础聊天协议，会丢失本 change 需要的专属计费契约。

弃选让 OpenRouter 进入 Vercel/CF/直连三级链：用户要求的是明确经 OpenRouter 调用，静默走其它路由会让密钥、价格、可观测性和实际模型来源与用户选择不一致。

### D3：显式区分 `<think>` 标签推理与 provider-native reasoning

将注册表中含义模糊的 `reasoning?: boolean` 收敛为 `reasoningTransport?: "think-tags" | "native"`。MiniMax M2 使用 `think-tags` 并继续包装 `extractReasoningMiddleware`；10 个 OpenRouter 模型使用 `native`，直接消费 provider 产生的 reasoning parts。

弃选把 OpenRouter 模型标为现有 `reasoning: true`：当前布尔值实际意味着“输出里存在 `<think>` 标签”，对原生 reasoning 使用同一开关会错误包装或丢失内容。

### D4：产品可见面不由 provider 推导

推荐给 `ChatModel` 增加 `surfaces: readonly ("linear" | "thread")[]`，由它派生 `THREAD_CHAT_MODELS`。最低实现不能再维持“只有 minimax/ark 可见”的硬编码过滤。

“在哪个入口展示”是产品属性，不是供应商能力。显式可见面能避免以后每新增 provider 都修改 selector 过滤逻辑，也让隐藏但仍可解析的历史模型保持兼容。

弃选只在 `thread-model-selector.tsx` 手写新增 id：会产生第二份模型列表，违背现有单一事实来源。

### D5：真实成本必须汇总全部 step，缺一步则整次回退

Thread Chat 的工具循环会产生多个独立上游调用。`streamText` 的结束事件提供 `steps`，每个 step 有自己的 `providerMetadata`；OpenRouter 成本解析函数仅在每个 step 都存在合法 `usage.cost` 时返回总和。合法值要求为有限且非负的 number，`0` 不能因 falsy 判断被当成缺失。

任一步缺失或非法时，整次使用静态保守价格，而不是把已解析 step 的部分成本作为真实总成本。这样会在元数据故障时偏保守，但不会低估和形成零价漏洞。

弃选只读取 `finalStep.providerMetadata`：会漏计前序工具调用；弃选“有多少加多少”：无法知道缺失 step 的真实成本，仍然可能低估。

### D6：计费层接收判别式成本证据

`chargeUsage` 接收 `estimate`、`vercel-gateway` 或 `openrouter` 三类 `UsageCostEvidence`。OpenRouter 真实美元成本当场转换为微元并用 `priceFromCost` 计算售价，流水直接标为 `openrouter`；Vercel 仍先记 `estimate` 并保存 generation id，之后 reconcile 为 `gateway`；缺省保持 estimate 兼容。

`cost_source` 的数据库列本来就是 `text`，新增 TypeScript 字面值 `openrouter` 无需 DDL。OpenRouter 行没有 Vercel generation id，也不会被 Vercel reconcile 扫描。

弃选在 chat route 直接算售价或改余额：这会绕过计费事务和利润率单一实现。弃选复用 `gateway` 来源：两者的成本证据、对账时机和 generation id 完全不同，会污染审计语义。

### D7：静态价格使用最高阶梯作为故障回退

10 个模型仍须在 `MODEL_COST` 有非零价格，满足现有一致性检查并覆盖 provider metadata 缺失。GPT 系列采用当前超过 272K 输入时的最高已知阶梯价；Kimi K3 与 DeepSeek V4 Flash 0731 使用当前公开价。

正常请求依赖逐请求真实成本，因此不会按最高阶梯多收；只有元数据不完整时才使用保守回退。动态拉取价格不进入请求路径，避免外部目录波动或不可用影响聊天可用性。

### D8：API 保持只接收内部 `modelId`

`POST /api/chat` 请求结构不增加 `openRouterModelId`、provider、reasoning、plugins 或 cost 字段。缺失 `modelId` 沿用默认；显式非字符串、未知内部 id或直接提交 OpenRouter slug均返回 400。合法 OpenRouter 内部 id 但缺 `OPENROUTER_API_KEY` 时在生成前返回 400，不扣费。

这保持了现有 API 边界并阻止客户端选择未定价模型或注入会改变成本/路由的 OpenRouter 专属参数。

## Risks / Trade-offs

- **[OpenRouter 模型或价格变化]** → 正常计费使用逐请求真实成本；模型 slug 和保守回退价由显式 change 更新，不在运行时自动漂移。
- **[专属 provider 是新增依赖]** → 固定使用支持 `ai@^7` 的稳定版本，保持唯一 import 边界，并通过 typecheck、build 与真实流式 smoke 验证。
- **[多 step 某一步缺成本导致保守计费]** → 整次回退最高阶梯价并记录 `estimate`，保证不低估；日志记录元数据异常以便排查。
- **[OpenRouter 故障时没有自动 fallback]** → 返回现有掩码错误并保留服务端日志；接受明确路由的一致性优先于偷偷更换供应商。
- **[失败生成可能已产生上游成本但不向用户收费]** → 延续现有只有完整结束才 `chargeUsage` 的语义；部分失败计费需要独立产品与账务设计。
- **[模型具有图片/文件能力但当前被文本化]** → 本 change 不改变附件管道；后续以独立 capability 协商 change 开放多模态。
- **[最高阶梯 fallback 可能高于短请求实际成本]** → 只在真实成本元数据缺失时启用；这是维持利润率的故障安全取舍。

## Migration Plan

1. 增加依赖、类型、注册表、保守价格和纯函数测试，暂不把模型暴露到 Thread selector。
2. 部署代码与 `OPENROUTER_API_KEY`（可选配置归因 headers），验证服务端专属 provider。
3. 接通 route、真实成本证据和账本来源，再开放 Thread 可见面。
4. 用低成本模型完成流式、工具、多 step、刷新与分支继承 smoke；高价 GPT-5.5 Pro 仅做受控手工验证。
5. 回滚时移除 OpenRouter 可见项和调用分支；保存了新增内部 id 的旧树会由既有 sanitize 回退默认模型，历史 usage 行保留。

## Open Questions

（无阻塞问题。Reasoning effort、多模态、动态目录和 OpenRouter 路由策略均明确留待独立 change。）
