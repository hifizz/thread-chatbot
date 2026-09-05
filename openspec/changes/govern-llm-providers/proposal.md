## Why

当前聊天模型注册、真实上游模型、provider 路由、网关回退、凭据组和客户端展示混在一起，导致 UMAPIS/Aiberm 等旧中转站难以彻底移除，也会把内部路由信息带入客户端。现在正处于 MVP 阶段且没有兼容用户，适合一次性收敛模型身份与调用渠道，建立可替换的服务端 LLM 路由边界。

## What Changes

- **BREAKING** 将客户端安全的模型目录按 provider 拆到 `constants/models/`，并与服务端密钥、地址和 SDK 创建逻辑分离。
- **BREAKING** 用稳定的公开 `modelId` 作为请求、持久化和产品准入标识；客户端不接收网关地址、API Key、凭据组或路由优先级。
- 在 `lib/ai/llm/` 为每个 provider 保留服务端配置，由 `createModels.ts` 生成路由并确保 provider 实例只创建一次。
- 用 `ModelRoute.createModel()` 和单一 `resolveChatModel(modelId)` 将公开模型解析为 AI SDK `LanguageModel`。
- 支持 OpenRouter、Vercel AI Gateway、Cloudflare AI Gateway 和私有 Relay；每个公开模型明确绑定服务端调用渠道，不使用隐式全局回退。
- **BREAKING** 全局移除 UMAPIS/Aiberm 的模型、代码、环境变量、默认值、CI、文档和测试引用。
- 保留人工审核的模型 allowlist；不在聊天请求路径中动态拉取 `/models`，不引入运行时 JSON snapshot 或通用 capability registry。
- 仅保留当前业务实际需要的展示入口、计费和 reasoning 传输策略；能力发现留作未来独立运维检查。

## Capabilities

### New Capabilities

- `llm-provider-routing`: 定义公开模型目录、服务端私有路由、provider 创建和模型解析行为。

### Modified Capabilities

- 无。

## Impact

- 主要影响 `constants/model.ts`、`lib/ai/provider.ts`、`lib/ai/*`、Thread Chat 模型选择器、线性聊天与 Thread Chat 的模型校验，以及价格、观测、CI 和环境变量文档。
- 需要删除 UMAPIS/Aiberm 专用实现和相关配置，并更新 Thread Chat 默认模型。
- 不新增运行时依赖；继续使用当前 AI SDK v7、OpenRouter provider 和 OpenAI-compatible provider。
- 客户端请求契约仍传模型 ID，但模型 ID 集合和部分历史值会在无兼容用户前提下直接调整。
