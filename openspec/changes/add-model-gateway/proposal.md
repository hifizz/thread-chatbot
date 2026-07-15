# 模型注册表 & AI 网关路由

## Why

聊天后端已经不止 MiniMax 一家：接入 DeepSeek、OpenAI 之后，模型 id 同时被三处消费——输入框的模型选择器、计费模块的定价表 key、服务端 provider 解析——若各自维护一份列表，新增/下线一个模型就要同步改三处，极易漂移出「选择器能选、计费查不到价、后端解析不出 provider」这类隐性 bug。同时，非 MiniMax 供应商需要一条既能省事（统一鉴权/计费/观测）又有退路（供应商直连）的调用路径，而 MiniMax 又完全不在任何网关的支持范围内，必须有单独的直连出口。

## What Changes

- 新增模型注册表 `constants/model.ts`：`CHAT_MODELS` 数组是全站唯一事实来源，`ChatModel.id` 同时驱动模型选择器展示、`constants/pricing.ts` 的定价 key、`lib/ai/provider.ts` 的 provider 解析；`DEFAULT_MODEL_ID`、`MAX_OUTPUT_TOKENS`、`getChatModel(id)`、`resolveModelId(id)`（未知 id 回退默认）随注册表一并提供。
- 新增 provider 解析层 `lib/ai/provider.ts`：非 MiniMax 模型按**三级优先级路由**——Vercel AI 网关（`gateway()`，回传 `generationId` 供计费对账）→ Cloudflare AI 网关 compat 端点（`createOpenAICompatible` 指向 `.../compat`）→ 供应商直连（DeepSeek/OpenAI 各自 `*_API_KEY`/`*_BASE_URL`），逐级按环境变量探测降级；`isModelConfigured(model)` 给出「该模型当前是否可用」的统一判断，供 chat route 转成友好报错而非让请求裸奔到 500。
- MiniMax **始终直连**（`lib/ai/minimax.ts`）：两家网关都不支持 MiniMax，注册表用 `gatewayModel` 字段为空来编码这一事实，provider 解析层对 `provider: "minimax"` 直接短路到 `minimaxChatModel`。
- reasoning 抽取：MiniMax（及未来的 DeepSeek reasoner 类模型）把思维链以字面 `<think>...</think>` 文本输出，用 `wrapLanguageModel + extractReasoningMiddleware({tagName:'think'})` 包裹，按注册表 `model.reasoning` 开关，渲染为可折叠推理块而非裸文本混入正文。
- chat route（`app/api/chat/route.ts`）接入：`resolveModelId(rawModelId)` 校验回退 → `getChatModel` 取模型定义 → `isModelConfigured` 不通过时返回 **400** 而非任由 `streamText` 抛出难懂的上游错误 → `resolveChatModel(modelId)` 交给 `streamText`。客户端每条消息把当前选中的 `modelId` 一并发送（`app/page.tsx` 的 transport 从 `useModelMode` store 读取）。
- 前端模型选择器（`components/examples/base.tsx`）选项从注册表派生，描述文案里带上对用户的售价（跨模块引用计费模块 `constants/pricing.ts` 的 `sellPricePerMillionYuan`）。

## Capabilities

### New Capabilities

- `model-gateway`：对话模型的注册、非 MiniMax 模型的网关优先级路由与逐级降级、MiniMax 直连、reasoning 抽取、未配置模型的友好报错、客户端选中模型的传递与展示。

### Modified Capabilities

（无——`openspec/specs/` 目前为空，本仓库尚无既有 spec；本变更不修改任何既有能力的需求级行为。）

## Impact

- **注册表**：`constants/model.ts`（新增，`ChatModel`/`CHAT_MODELS`/`DEFAULT_MODEL_ID`/`MAX_OUTPUT_TOKENS`/`getChatModel`/`resolveModelId`）。
- **服务端**：`lib/ai/provider.ts`（新增，`isGatewayConfigured`/`isModelConfigured`/`resolveChatModel`）、`lib/ai/minimax.ts`（既有，MiniMax 专用 provider 与 `isMinimaxConfigured`）、`app/api/chat/route.ts`（接入模型校验、报错、`resolveChatModel`）。
- **前端**：`components/examples/base.tsx`（模型选择器从注册表派生选项）、`lib/chat/model-mode.ts`（客户端选中模型 store，随请求体发送，未在本变更范围内改动其内部实现）。
- **交叉引用（不在本变更范围内实现，仅接口约定）**：`constants/pricing.ts` 的 `sellPricePerMillionYuan(modelId)`（计费模块 `add-billing-metering`）消费本注册表的 `id`；`lib/payments/vercel-gateway.ts` 的 `getGenerationCostUsd(generationId)`（同属计费模块）消费本模块经 Vercel 网关产生的 `generationId`；`MAX_OUTPUT_TOKENS` 同时服务「输出安全阀」与「计费敞口封顶」两个目的，封顶策略的完整讨论记在计费模块的 change 里。
- **运行前提**：非 MiniMax 模型至少需要以下之一才可用——`AI_GATEWAY_API_KEY`（Vercel 网关）、`CF_AI_GATEWAY_ACCOUNT_ID`+`CF_AI_GATEWAY_ID`（CF 网关，`CF_AI_GATEWAY_TOKEN` 视网关是否开启 Authenticated Gateway 而定）、或该供应商的直连 key（`DEEPSEEK_API_KEY`/`OPENAI_API_KEY`）。MiniMax 需要 `MINIMAX_API_KEY`（`MINIMAX_BASE_URL` 可覆盖）。
