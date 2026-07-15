# 设计：模型注册表 & AI 网关路由

## Context

- 聊天后端曾经只接 MiniMax 一家（`lib/ai/minimax.ts` 直连），模型 id 是写死的字符串常量。接入 DeepSeek、OpenAI 后，同一个模型 id 需要被三处消费：输入框的模型选择器（展示名/描述/售价）、计费模块的定价表（按 id 查单价）、服务端 provider 解析（按 id 决定走哪个供应商/网关）。三处各自维护列表是漂移的根源。
- `ai@^7` 内置 `gateway()`（Vercel AI 网关）与 `wrapLanguageModel`/`extractReasoningMiddleware`；`@ai-sdk/openai-compatible` 的 `createOpenAICompatible` 既用于 MiniMax 直连，也复用于 CF 网关 compat 端点与 DeepSeek/OpenAI 直连——三种接入方式统一走同一个 SDK 原语，只是 `baseURL`/`headers`/模型标识格式不同。
- MiniMax 是国内供应商，不在 Vercel AI 网关与 Cloudflare AI 网关的支持列表中，这是一个**外部事实**（非我方可控），必须在架构里显式建模，而不是指望某天两家网关会支持它。
- 计费模块（`add-billing-metering`，change 目录已建但本次不落笔）依赖本模块两处产出：`ChatModel.id`（作为定价表的 key）与 Vercel 网关响应里的 `providerMetadata.gateway.generationId`（真实成本对账的钥匙）。本设计明确这两个交叉点的契约，具体计费逻辑不在本变更范围内。

## Goals / Non-Goals

**Goals:**

- 模型 id 单一事实来源：新增/下线一个模型只改 `constants/model.ts` 一处，选择器、计费、provider 解析自动跟随。
- 非 MiniMax 模型有网关可用时优先用网关（统一鉴权/计费/观测），网关不可用时能降级到供应商直连，不因网关侧故障或未配置而完全不可用。
- MiniMax 始终直连，不因误配置尝试把它推给某个不支持它的网关。
- 未知模型 id、未配置的模型都不应该让请求裸奔到运行时报错或 500，而是在边界处给出可读提示。

**Non-Goals:**

- 计费定价表、余额扣费、成本对账的具体实现（`add-billing-metering` 的范围）。
- 模型选择器组件本身的交互/样式（`components/ui/` 已有 `ModelSelector`，本变更只提供数据源）。
- 流式/工具调用等 AI SDK 通用能力（与模型路由正交，不在本变更讨论）。
- 网关侧的账号开通、CF Authenticated Gateway 的配置流程（运维操作，不是代码设计）。

## Decisions

### D1：模型注册表为单一事实来源，id 驱动三处消费

**选择**：`constants/model.ts` 导出 `CHAT_MODELS: readonly ChatModel[]`，每个 `ChatModel` 携带 `id`/`name`/`description`/`provider`/`upstreamModel`/`gatewayModel?`/`reasoning?`。选择器（`components/examples/base.tsx`）、计费定价表（`constants/pricing.ts` 的 `sellPricePerMillionYuan(id)`）、provider 解析（`lib/ai/provider.ts` 的 `getChatModel(id)`）全部以这个 `id` 为 key 查询，不在各自模块内重新定义一份模型列表。

**理由**：模型 id 是跨越「前端展示 / 计费定价 / 后端路由」三个关注点的唯一粘合剂。三处各自维护列表的失败模式是渐进式的——今天选择器新增一个模型，明天才想起计费表没加价目，后端解析层又漏了 provider 分支，三次改动分散在三次提交里，中间任何一次遗漏都是线上故障。单一注册表把「新增一个模型」收敛成一次性、结构化、编译期可检查（TypeScript 字面量 + `find`）的操作。

**弃选**：每个模块各自维护模型枚举，用字符串字面量联合类型手工保持同步——三份定义的一致性完全依赖人工纪律，且没有编译期机制能保证「选择器有的模型计费表一定有」。

### D2：非 MiniMax 模型走三级优先级路由，逐级按环境变量探测降级

**选择**：`resolveChatModel(modelId)` 对非 MiniMax 模型按顺序尝试：① `isVercelGatewayConfigured()`（`AI_GATEWAY_API_KEY` 是否配置）为真则用 `gateway(model.gatewayModel ?? "provider/model")`；② 否则若 `isGatewayConfigured()`（`CF_AI_GATEWAY_ACCOUNT_ID`+`CF_AI_GATEWAY_ID` 均配置）为真，用 `createOpenAICompatible` 指向 CF compat 端点，模型标识用 `gatewayModel`；③ 都不满足则直连供应商官方端点（或 `*_BASE_URL` 覆盖的地址），用 `upstreamModel`。三级顺序在代码里是硬编码的 if/else 链，不做「策略可配置」的抽象。

**理由**：网关的价值是集中鉴权、计费观测、限流这些横切关注点，能省去逐家申请/管理供应商 key 的运维负担；但网关本身是新增的外部依赖，可能未开通、临时故障或所在地区不可达。三级降级链让「有网关用网关、没网关用直连」成为自动行为而非手工切换，本地开发（通常没有网关账号）与生产环境（可能配置了网关）用同一份代码路径，靠环境变量自然分流，不需要 feature flag。三级而非两级（多一层 CF 网关）是因为两家网关的能力/覆盖范围不同（见 D3），都保留能覆盖更多环境组合。

**弃选**：策略可配置（环境变量显式指定「用哪一级」）——徒增一个新的配置项去表达「本来靠已有配置的有无就能推断」的信息，是不必要的间接层；固定只用一种网关——放弃了另一种网关在覆盖范围或成本上的差异化价值。

### D3：三级中优先 Vercel 网关，关键动机是 `generationId`

**选择**：当 Vercel 网关与 CF 网关同时配置时，优先选 Vercel 网关。

**理由**：Vercel 网关的响应携带 `providerMetadata.gateway.generationId`，这是计费模块做「真实成本对账」的钥匙——`lib/payments/vercel-gateway.ts` 的 `getGenerationCostUsd(generationId)` 凭它反查该次生成的真实美元成本，用来校验/修正基于价目表估算的即时扣费（价目表估算与真实成本之间存在供应商定价变动、批量折扣等误差，对账用真实数据兜底）。CF 网关 compat 端点不回传任何成本相关的元数据，也**不支持 MiniMax**（进一步印证 D4 里「MiniMax 只能直连」不是我方设计选择，而是两家网关共同的外部限制）。这是本模块与计费模块最重要的一个交叉契约点，具体对账逻辑在 `add-billing-metering` 里落地，本变更只负责把 `generationId` 采集出来交给 `onFinish` 回调（`app/api/chat/route.ts`）。

**弃选**：优先 CF 网关——CF 网关 compat 端点在两家里更早接入、地理延迟可能更低，但换不来对账能力，计费准确性优先级更高；两者按某种业务规则动态选择——徒增复杂度，当前没有业务场景要求「同一请求可能需要两种网关中的某一种」的精细控制。

### D4：MiniMax 始终直连，用 `gatewayModel` 为空编码「不走网关」

**选择**：MiniMax 模型（`provider: "minimax"`）在 `resolveChatModel` 里直接短路，不进入 D2 的三级路由链，调用 `lib/ai/minimax.ts` 的 `minimaxChatModel(upstreamModel)`（`createOpenAICompatible` 指向 `MINIMAX_BASE_URL`，默认 `https://api.minimaxi.com/v1`）。注册表里 MiniMax 模型的 `gatewayModel` 字段留空（`undefined`），用这个「空」本身作为「该模型不支持网关路由」的编码，而不是另开一个 `supportsGateway: boolean` 字段。

**理由**：两家网关都不支持 MiniMax，这是外部事实，不是可以通过重试或降级修复的临时故障，代码应该直接反映这个事实而不是让 MiniMax 模型徒劳地尝试进入路由链再失败。复用已存在的 `gatewayModel?: string` 做「有值=走网关时用这个标识，无值=不走网关」的双重语义，比新增一个专门的布尔字段更紧凑——两者在数据上是等价的（`gatewayModel` 未定义时网关路径本就无法构造出正确的模型标识），没有必要用两个字段表达同一件事。

**弃选**：给 MiniMax 也接入某种「伪网关」路径以保持代码路径统一——没有实际网关支持，伪造这条路径只是自欺欺人的一致性，不产生任何价值。

### D5：`<think>` 推理用 `extractReasoningMiddleware` 抽取，按 `model.reasoning` 开关

**选择**：MiniMax 及未来标记 `reasoning: true` 的模型，在拿到 SDK 的 `LanguageModel` 之后统一用 `wrapLanguageModel({ model, middleware: extractReasoningMiddleware({ tagName: "think" }) })` 包裹一层；不带该标记的模型（如当前的 DeepSeek chat、GPT-4o mini 注册项）不包裹，直接返回原始 model。

**理由**：MiniMax 把思维链输出成字面 `<think>...</think>` 纯文本而不是独立的 reasoning 流部分，这是该模型的输出格式特性；`extractReasoningMiddleware` 是 AI SDK 提供的标准中间件，专门解决「模型把推理和正文混在同一段文本里」这个问题，把它切分成独立的 reasoning part，前端才能渲染成可折叠块而不是让 `<think>` 标签原样露出在气泡里。用注册表字段而非「按 provider 字符串判断」来决定是否包裹，是因为「是否输出 `<think>`」是模型级别的行为特征（同一 provider 下不同型号可能不同，例如 DeepSeek 的 reasoner 系列会输出但普通 chat 系列不会），跟着模型走比跟着 provider 走更准确。

**弃选**：在 system prompt 里要求模型不要输出思维链——不可靠（模型不一定服从指令），且放弃了展示推理过程本身的产品价值；前端直接裸展示 `<think>` 文本——用户会看到原始标签或未分离的推理与正文混排，体验差。

### D6：未知/未配置模型的处理——边界处兜底，不让错误裸奔到运行时

**选择**：两层兜底。① `resolveModelId(rawId)`：`getChatModel(rawId)` 查不到就回退 `DEFAULT_MODEL_ID`，保证进入后续逻辑的 id 一定合法，不会有「客户端传了个乱七八糟的字符串」污染下游。② `isModelConfigured(model)`：在真正调用 `resolveChatModel` 之前判断该模型当前环境是否具备可用配置（MiniMax 看 `isMinimaxConfigured()`；其它 provider 看 Vercel 网关是否配置，或该 provider 自己的直连 key 是否存在），不满足则 `app/api/chat/route.ts` 直接返回 **400** 加中文可读提示，不进入 `streamText`。

**理由**：`resolveModelId` 的回退发生在「客户端传参」这个信任边界上——请求体里的 `modelId` 是不受信任输入，脏值不该传播到 provider 解析层引发内部报错。`isModelConfigured` 的检查发生在「配置」这个更晚的信任边界上——id 合法但对应的 API key/网关未配置是运维范畴的问题，不该表现为 `streamText` 内部因缺 key 抛出的、对用户不友好的上游错误（甚至可能是 500）。两层检查分别对应两类不同性质的问题（脏输入 vs 缺配置），分开处理让错误信息各自精准。

**弃选**：只做一层校验（例如只查 id 合法性，不查配置可用性）——缺配置时请求仍会打到 `streamText`，失败模式变成难以定位的上游 SDK 报错；把 `isModelConfigured` 的判断也做成「回退默认模型」而非报错——缺配置是运维该修的问题，静默换成另一个模型会让用户以为选中了 A 模型实际却在跟 B 模型对话，是更糟的体验。

### D7：直连 baseURL 用 `*_BASE_URL` 环境变量可覆盖

**选择**：每个走直连的 provider 都有一对环境变量：固定的 `*_API_KEY`（必需）与可选的 `*_BASE_URL`（未设置时回退官方端点）。当前落地：`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）、`MINIMAX_BASE_URL`（默认 `https://api.minimaxi.com/v1`）。

**理由**：直连地址并不总是官方公网端点——自建反向代理、区域加速节点、测试环境的 mock 端点都需要能覆盖 baseURL 而不改代码。这是一个低成本的逃生舱：多数时间用默认值，需要时改一个环境变量。与 D2/D3 的网关 baseURL（`gatewayCompatBaseURL()` 由 `CF_AI_GATEWAY_ACCOUNT_ID`+`CF_AI_GATEWAY_ID` 拼出，Vercel 网关用 `AI_GATEWAY_BASE_URL` 可选覆盖）是同一套「有默认值、可覆盖」的模式，跨直连/网关两种接入方式保持一致。

**弃选**：把 baseURL 写死在代码里——完全丧失自建代理/测试环境的灵活性，每次都要改代码重新部署。

## Risks / Trade-offs

- **[网关探测顺序在运行时靠环境变量隐式决定]** → 同一份代码在不同环境（本地 vs 生产）可能真实走不同的路由分支，调试时容易忽略「我这台机器没配网关所以走了直连」。缓解：`isVercelGatewayConfigured`/`isGatewayConfigured`/`isModelConfigured` 都是可独立调用的纯函数，排查时可以直接在 REPL/日志里打印三者结果确认当前实际路径。
- **[三级降级链埋着「网关配置了但实际不可达」的盲区]** → 当前只检查环境变量是否**配置**，不检查网关是否**可达**；网关侧真实故障时请求会在 `streamText` 内部失败而不是提前降级到直连。接受该风险：网关不可达属于低频运维故障，实时探测可达性会引入额外延迟与复杂度，不值得为这个小概率场景增加请求路径上的往返。
- **[`gatewayModel` 用「空值」编码「不支持网关」是隐式约定]** → 后续贡献者新增模型时若忘记理解这层含义，可能给 MiniMax 类模型误填 `gatewayModel`（不会报错，只是该字段永远不会被读取，因为 MiniMax 分支在 D4 里短路跳过了网关路径）。缓解：`constants/model.ts` 文件头注释与 `gatewayModel` 字段的 JSDoc 已明确写出这层语义。

## Migration Plan

（无迁移——本模块是新增的注册表与 provider 解析层，不涉及既有数据结构变更；`app/api/chat/route.ts` 对模型解析逻辑的接入是纯代码路径切换，无数据库/存储变更。）

## Open Questions

（无——范围内的决策已全部定案；计费定价表、成本对账的具体实现留给 `add-billing-metering`。）
