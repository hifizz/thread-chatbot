# 任务拆解：模型注册表 & AI 网关路由（已实现，回填记录）

## 1. 模型注册表

- [x] 1.1 新增 `constants/model.ts`：`ChatModelProvider`（`'minimax'|'deepseek'|'openai'`）、`ChatModel` 类型（`id`/`name`/`description?`/`provider`/`upstreamModel`/`gatewayModel?`/`reasoning?`），文件头注释说明「id 全站统一」的单一事实来源定位
- [x] 1.2 `CHAT_MODELS` 落三个模型项：`minimax-m2`（reasoning:true，无 `gatewayModel`）、`deepseek-chat`（`gatewayModel: "deepseek/deepseek-chat"`）、`gpt-4o-mini`（`gatewayModel: "openai/gpt-4o-mini"`）
- [x] 1.3 `DEFAULT_MODEL_ID = "minimax-m2"`；`MAX_OUTPUT_TOKENS = 8192` 带注释说明双重作用（输出安全阀 + 计费敞口封顶，交叉引用计费模块）
- [x] 1.4 `getChatModel(id)`（按 id 查找，未命中返回 `undefined`）、`resolveModelId(id)`（未知 id 回退 `DEFAULT_MODEL_ID`）

## 2. Provider 解析层

- [x] 2.1 `lib/ai/minimax.ts`：`minimaxProvider`（`createOpenAICompatible`，`MINIMAX_BASE_URL` 可覆盖默认 `https://api.minimaxi.com/v1`）、`minimaxChatModel(id)`（带 `extractReasoningMiddleware({tagName:'think'})` 包裹）、`minimaxModel(id)`（裸模型，非对话场景用）、`isMinimaxConfigured()`
- [x] 2.2 新增 `lib/ai/provider.ts`：`isGatewayConfigured()`（CF 网关，`CF_AI_GATEWAY_ACCOUNT_ID`+`CF_AI_GATEWAY_ID`）、`gatewayCompatBaseURL()`（拼 `https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/compat`）
- [x] 2.3 `PROVIDER_ENV` 映射表：`deepseek`/`openai` 各自的 `key`（`*_API_KEY`）与 `directBaseURL`（`*_BASE_URL` 可覆盖，默认官方端点）
- [x] 2.4 `isModelConfigured(model)`：MiniMax 走 `isMinimaxConfigured()`；其余先看 `isVercelGatewayConfigured()`（Vercel 网关配了即视为可用，它自带各家凭据），否则看该 provider 是否有直连/CF key
- [x] 2.5 `resolveChatModel(modelId)`：未知 id 抛错；MiniMax 短路走 `minimaxChatModel`；非 MiniMax 按三级优先级（Vercel 网关 `gateway(gatewayModel ?? provider/upstreamModel)` → CF 网关 compat `createOpenAICompatible` → 直连）逐级探测，命中一级即返回；`reasoning` 为真时用 `wrapLanguageModel + extractReasoningMiddleware({tagName:'think'})` 包裹
- [x] 2.6 CF 网关分支可选携带 `cf-aig-authorization` 头（`CF_AI_GATEWAY_TOKEN`，网关开启 Authenticated Gateway 时必需）
- [x] 2.7 `lib/payments/vercel-gateway.ts`：`isVercelGatewayConfigured()`（`AI_GATEWAY_API_KEY`）、`gatewayClient()`（`AI_GATEWAY_BASE_URL` 可选覆盖）、`getGenerationCostUsd(generationId)`（供计费模块对账消费，本变更只负责契约不负责实现细节）

## 3. chat route 接入

- [x] 3.1 `app/api/chat/route.ts` 请求体新增 `modelId?: string` 字段解析
- [x] 3.2 `resolveModelId(rawModelId)` 校验回退 → `getChatModel(modelId)!` 取模型定义
- [x] 3.3 `isModelConfigured(model)` 不通过时返回 400 + 中文可读错误（「模型「{name}」未配置，请联系管理员在服务端配置对应 API Key 或 CF AI 网关。」），不进入 `streamText`
- [x] 3.4 `streamText({ model: resolveChatModel(modelId), ... })` 接入；`maxOutputTokens: MAX_OUTPUT_TOKENS` 生效
- [x] 3.5 `onFinish` 回调从 `providerMetadata?.gateway?.generationId` 采集 Vercel 网关的 generationId（类型收窄为 `string`，非网关路径下为 `null`），随 usage 一并交给计费模块的 `chargeUsage`（本变更只负责采集，不负责计费逻辑）

## 4. 前端接入

- [x] 4.1 `lib/chat/model-mode.ts`：客户端选中模型的全局 store（`modelId`/`setModel`），供 transport 与选择器共享
- [x] 4.2 `app/page.tsx` 的 transport `prepareSendMessagesRequest` 读取 `useModelMode.getState().modelId` 随请求体一并发送
- [x] 4.3 `components/examples/base.tsx`：`models` 选项从 `CHAT_MODELS` 派生，描述文案拼接 `sellPricePerMillionYuan(m.id)` 的入/出单价（跨模块引用计费模块 `constants/pricing.ts`）；`ModelPicker` 组件受控于 `useModelMode`，`defaultValue={DEFAULT_MODEL_ID}`

## 5. 验收

- [x] 5.1 `pnpm typecheck` 0 错误
- [x] 5.2 三个已注册模型分别验证：MiniMax（直连，`<think>` 正确抽取为可折叠推理块）、DeepSeek（经已配置的网关路由成功）、GPT-4o mini（经已配置的网关路由成功）
- [x] 5.3 未配置模型验证：临时清空对应 provider 的 key/网关环境变量，请求该模型返回 400 + 可读中文提示，不产生 500
- [x] 5.4 未知模型 id 验证：请求体传入不存在的 `modelId`，服务端回退到 `DEFAULT_MODEL_ID` 正常应答
- [x] 5.5 Vercel 网关路径下确认 `providerMetadata.gateway.generationId` 被正确采集并传给 `chargeUsage`（人工核对计费流水记录里 `generationId` 非空）
