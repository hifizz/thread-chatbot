# model-gateway 模型注册表 & AI 网关路由

## ADDED Requirements

### Requirement: 模型注册表与全站 id 一致性

系统 SHALL 以 `constants/model.ts` 的 `CHAT_MODELS` 数组作为对话模型的单一事实来源，每个模型的 `id` SHALL 在全站唯一，并同时驱动模型选择器展示、计费定价表查找、服务端 provider 解析三处消费，不在其它模块内重新定义模型列表。客户端请求体传入的 `modelId` SHALL 经 `resolveModelId` 校验；未命中注册表的未知 id SHALL 回退到 `DEFAULT_MODEL_ID`，不得将脏值传播到下游解析逻辑。

#### Scenario: 已注册模型正常解析

- **WHEN** 客户端请求体携带一个存在于 `CHAT_MODELS` 中的 `modelId`
- **THEN** 系统 SHALL 用该 id 精确解析出对应的 `ChatModel` 定义，用于后续 provider 解析与计费

#### Scenario: 未知模型 id 回退默认

- **WHEN** 客户端请求体携带一个不存在于 `CHAT_MODELS` 中的 `modelId`（如拼写错误或已下线的旧 id）
- **THEN** 系统 SHALL 回退使用 `DEFAULT_MODEL_ID` 继续处理请求，不得报错中断

### Requirement: 非 MiniMax 模型的三级网关优先级路由

对于 `provider` 不为 `minimax` 的模型，系统 SHALL 按以下优先级顺序探测并选用可用路径：① Vercel AI 网关（`AI_GATEWAY_API_KEY` 已配置）；② Cloudflare AI 网关 compat 端点（`CF_AI_GATEWAY_ACCOUNT_ID` 与 `CF_AI_GATEWAY_ID` 均已配置）；③ 供应商直连（对应 `*_API_KEY` 已配置）。探测 SHALL 基于环境变量是否配置逐级判断，命中较高优先级时不再降级到更低优先级。

#### Scenario: Vercel 网关已配置

- **WHEN** 请求一个非 MiniMax 模型，且 `AI_GATEWAY_API_KEY` 已配置
- **THEN** 系统 SHALL 经 Vercel AI 网关（`gateway()`）发起调用，模型标识使用该模型的 `gatewayModel`（缺省时回退 `"{provider}/{upstreamModel}"`）

#### Scenario: 仅 CF 网关已配置

- **WHEN** 请求一个非 MiniMax 模型，`AI_GATEWAY_API_KEY` 未配置，但 `CF_AI_GATEWAY_ACCOUNT_ID` 与 `CF_AI_GATEWAY_ID` 均已配置
- **THEN** 系统 SHALL 经 Cloudflare AI 网关 compat 端点（`https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/compat`）发起调用，模型标识使用该模型的 `gatewayModel`；若额外配置了 `CF_AI_GATEWAY_TOKEN`，请求 SHALL 携带 `cf-aig-authorization` 头

#### Scenario: 两家网关均未配置，降级直连

- **WHEN** 请求一个非 MiniMax 模型，且两家网关的环境变量均未配置，但该 provider 的直连 key（如 `DEEPSEEK_API_KEY`）已配置
- **THEN** 系统 SHALL 直连该供应商官方端点（或 `*_BASE_URL` 覆盖的地址），模型标识使用该模型的 `upstreamModel`

### Requirement: MiniMax 始终直连

MiniMax 模型（`provider: "minimax"`）SHALL 不进入网关路由链，始终通过直连（`MINIMAX_BASE_URL`，默认为 `https://api.minimaxi.com/v1`）调用。注册表 SHALL 用 MiniMax 模型项的 `gatewayModel` 字段留空（`undefined`）来编码「该模型不支持网关路由」这一事实。

#### Scenario: MiniMax 模型请求不尝试网关

- **WHEN** 请求 `provider` 为 `minimax` 的模型，且环境中已配置 Vercel 网关与 CF 网关
- **THEN** 系统 SHALL 仍然直连 MiniMax 端点，不经过任何网关

### Requirement: Vercel 网关采集 generationId 供计费对账

经 Vercel AI 网关发起的生成请求，系统 SHALL 从响应的 `providerMetadata.gateway.generationId` 采集该字段（非字符串类型时视为不存在），并在生成结束的回调中把它与本次用量一并交给计费模块用于真实成本对账；非经 Vercel 网关的请求（MiniMax 直连、CF 网关、其它直连）SHALL 不产出该字段（视为 `null`）。

#### Scenario: 经 Vercel 网关的请求采集到 generationId

- **WHEN** 一次对话请求经由 Vercel AI 网关完成
- **THEN** 系统 SHALL 在生成结束回调中取得非空的 `generationId` 字符串并随用量数据一并向下游传递

#### Scenario: 非 Vercel 网关路径不产出 generationId

- **WHEN** 一次对话请求经由 MiniMax 直连、CF 网关或其它直连完成
- **THEN** 系统 SHALL 将 `generationId` 记为 `null`，不影响该次请求的正常完成

### Requirement: reasoning 模型的 `<think>` 抽取中间件

对于注册表中标记 `reasoning: true` 的模型，系统 SHALL 用 `wrapLanguageModel` 搭配 `extractReasoningMiddleware({ tagName: "think" })` 包裹其 `LanguageModel`，将模型输出中字面的 `<think>...</think>` 内容抽取为独立的 reasoning 流部分；未标记 `reasoning` 的模型 SHALL 不做该包裹，其输出原样作为正文处理。

#### Scenario: reasoning 模型的思维链被抽取

- **WHEN** 一个 `reasoning: true` 的模型（如 MiniMax）在输出中包含 `<think>...</think>` 片段
- **THEN** 系统 SHALL 将该片段抽取为独立的 reasoning 流部分，正文流中不再包含裸露的 `<think>` 标签

#### Scenario: 非 reasoning 模型不做抽取

- **WHEN** 一个未标记 `reasoning` 的模型完成输出
- **THEN** 系统 SHALL 不对其应用推理抽取中间件，输出原样作为正文

### Requirement: 未配置模型的友好报错

请求一个 id 合法但当前环境不具备可用配置的模型时（`isModelConfigured` 判定为否——MiniMax 缺 `MINIMAX_API_KEY`，或非 MiniMax 模型既未配置任一网关也未配置对应供应商直连 key），系统 SHALL 在进入生成流程之前返回 HTTP 400 与中文可读错误提示，不得让请求进入 `streamText` 后以未处理异常或 500 失败。

#### Scenario: 模型未配置返回 400

- **WHEN** 请求一个当前环境未配置任何可用凭据/网关的模型
- **THEN** 系统 SHALL 返回 400 状态码，响应体包含指明该模型名称的中文错误提示，且不触发计费扣款

#### Scenario: 模型已配置正常放行

- **WHEN** 请求一个当前环境具备可用配置的模型
- **THEN** 系统 SHALL 正常进入生成流程，不返回配置类错误

### Requirement: 客户端选中模型随请求传递并在选择器展示售价

客户端 SHALL 在每次发送消息时，将当前选中的 `modelId`（来自全局模型选择状态）附带在请求体中一并发送给 `/api/chat`。模型选择器的选项列表 SHALL 从 `CHAT_MODELS` 派生，且每个选项的展示文案 SHALL 包含对用户的售价信息（入/出单价，来自计费模块的定价查询）。

#### Scenario: 切换模型后下一条消息生效

- **WHEN** 用户在选择器中切换到另一个模型后发送新消息
- **THEN** 该请求的请求体 SHALL 携带切换后的 `modelId`，服务端按该模型处理本次请求

#### Scenario: 选择器展示售价

- **WHEN** 用户打开模型选择器
- **THEN** 每个模型选项的描述文案 SHALL 展示其对用户的入/出单价（元/百万 token）
