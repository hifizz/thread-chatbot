# Apply 阻塞记录

## 2026-08-10

### 阻塞任务

- 任务 1.1：确认 UMAPIS Base URL、聊天路径、鉴权、模型 id、逐模型 Effort 矩阵、reasoning 与 usage 协议。
- 任务 1.2、5.3：用真实凭据完成 Claude/GPT 最小请求与四模型 smoke。

### 已验证事实

- 访问 UMAPIS pricing 页面时，当前环境网络代理返回 HTTP 401/403，无法取得可作为实现依据的官方协议内容。
- 当时当前进程、.env 与 .env.local 均没有可用的 UMAPIS_API_KEY。
- proposal/design 明确规定：无法验证协议时必须停止，不能根据 OpenAI 或 Anthropic 的通用经验猜测 Effort 参数。

### 继续条件

以下任一方式可解除协议阻塞：

1. 提供可读取的 UMAPIS 官方 API 文档（不仅是定价页），其中包含上述协议字段；或
2. 在服务端环境提供 UMAPIS_API_KEY 与官方 Base URL，以便执行脱敏最小请求（不得提交密钥）。

在条件满足前，不实现 UMAPIS adapter、Effort 枚举或上游 provider options，以免固化未经验证的协议。任务复选框保持未完成。

## 2026-08-11 复核

### 当前验证结果

- `.env.local` 现在已有 UMAPIS_API_KEY 与 UMAPIS_BASE_URL，鉴权可用。
- `GET /v1/models` 返回 200，但模型目录为空。
- `POST /v1/chat/completions` 的聊天路径已确认；目标 `claude-opus-4-6`、`gpt-5.6-sol` 以及通用探测模型均返回 503 `model_not_found`，提示当前账号没有可用 channel。
- 未取得四个目标模型的真实成功响应，因此仍无法确认逐模型 Effort 参数名、允许值、默认值、reasoning 形态或 usage 字段。

### 无 Effort 默认请求复核

- 不携带任何 Effort 字段，对 `claude-opus-4-6`、`claude-sonnet-5`、`gpt-5.6-sol`、`gpt-5.6-terra` 逐一发送流式请求。
- 四个请求均返回 HTTP 503，均无 SSE 数据、文本增量或 usage；响应原因仍为目标模型没有可用 channel。
- 因此当前确实不需要先依赖 `/v1/models` 列表，但仍需要目标模型请求成功或官方协议文档，才能继续实现 UMAPIS。

## 2026-08-11 后台 channel 复测

### 无 Effort 默认流结果

- `claude-opus-4-6`：HTTP 200，6 个 JSON chunk，包含文本增量、usage，结束原因为 `stop`。
- `claude-sonnet-5`：HTTP 200，6 个 JSON chunk，包含文本增量、usage，结束原因为 `stop`。
- `gpt-5.6-sol`：HTTP 503 `model_not_found`，没有 SSE 数据。
- `gpt-5.6-terra`：HTTP 503 `model_not_found`，没有 SSE 数据。

Claude 的默认流式协议已可验证；GPT 两个目标模型仍未开通，因此任务 1.1/1.2 以及后续实现继续保持未完成。

## 2026-08-11 分组 key 复测

### 无 Effort 默认流结果

- `claude-opus-4-6` 使用 `UMAPIS_API_KEY_CLAUDE`：HTTP 200，6 个 JSON chunk，文本增量、usage、`stop` 均正常。
- `claude-sonnet-5` 使用 `UMAPIS_API_KEY_CLAUDE`：HTTP 200，6 个 JSON chunk，文本增量、usage、`stop` 均正常。
- `gpt-5.6-sol` 使用 `UMAPIS_API_KEY_GPT`：HTTP 200，4 个 JSON chunk，文本增量、usage、`stop` 均正常。
- `gpt-5.6-terra` 使用 `UMAPIS_API_KEY_GPT`：HTTP 200，4 个 JSON chunk，文本增量、usage、`stop` 均正常。

四个目标模型的默认流式调用和分组鉴权已通过。任务 1.1/1.2 仍需确认每个模型的 Effort 参数名、允许值、默认值及上游映射，确认前不实现 UMAPIS adapter。

### 继续条件

需要 UMAPIS 管理端为当前 key 开通至少一个目标模型 channel，或提供包含 Effort 协议的官方 API 文档；在此之前任务 1.1/1.2 仍未完成，不实现 UMAPIS provider 或 Effort 枚举。

## 2026-08-12 默认调用接入验收

本节以当前产品决定（只接入默认调用，不实现 Effort）为准，并取代上文关于默认调用继续阻塞的历史结论。

### Adapter 实测

- 新 adapter 使用 `UMAPIS_API_KEY_CLAUDE` 调用 `claude-opus-4-6`、`claude-sonnet-5`，使用 `UMAPIS_API_KEY_GPT` 调用 `gpt-5.6-sol`、`gpt-5.6-terra`。
- `UMAPIS_BASE_URL` 可以是站点根路径或 `/v1` API 根；adapter 统一请求 `/v1/chat/completions`，使用 Bearer 鉴权和流式 usage。
- 四个模型均以不含 Effort 的最小流式请求返回非空文本与正 token usage：Claude 两个模型各为 270 input / 45 output，GPT Sol 与 Terra 各为 4389 input / 5 output。
- `gpt-5.6-sol` 通过 adapter 完成一次强制 `ping` 工具调用，收到一个对应的 tool call。
- adapter 未安装标签抽取中间件；OpenAI-compatible adapter 直接处理上游标准 text、reasoning、tool call 与 usage 字段。默认 smoke 未依赖或发送任何 Effort 参数。
- Markdown Artifact 的共享契约、状态机和结算测试均通过，现有 Thread Chat 工具与终止链路没有改动。

### 预览与后续输入

- 四个 UMAPIS 模型在 Thread Chat Prompt 输入关联的选择器中可用，按模型所属 Claude/GPT 组检查 Key；缺少某组 Key 时仅该组模型在调用前返回既有可读配置错误。
- 这些模型明确为未计费预览：跳过正余额拦截、不扣额度、不写扣费流水；流中仍保留 token usage，且不展示未经验证的单价。
- 后续 billing/Effort change 需要确认：UMAPIS 官方价格、各 Effort 参数/取值/默认值及其计费影响、汇率与利润、额度策略、并发敞口和真实成本对账方式。
- 本次不实现上述后续项。
