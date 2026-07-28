## Why

分叉聊天页当前不会向 `/api/chat` 发送模型选择，所有列都会静默使用默认的 MiniMax M2，无法验证不同模型在同一套分叉对话体验里的实际效果。MVP 需要接入火山方舟 Coding Plan 的 GLM-5.2 等模型，并先用“主线可选、分支继承且锁定”的保守策略降低跨模型上下文异常。

## What Changes

- 接入火山方舟 Coding Plan 的 OpenAI-compatible Chat 接口，并把文档列出的可用模型加入统一模型注册表。
- 在分叉聊天 prompt input 中展示模型选择器；主线允许切换，生成期间禁用。
- 为每个 Thread 持久化 `modelId`；新分支继承父 Thread 的模型，但分支选择器保持 disabled，MVP 不允许分支独立切换。
- 每次分叉聊天请求携带所属 Thread 的 `modelId`，由服务端严格校验并解析为对应 AI SDK 模型。
- 兼容没有 `modelId` 的既有树数据，加载时回填默认模型。
- 为 Ark 模型补齐内部计费估值，避免未知模型被按 0 元记账。

## Capabilities

### New Capabilities

- `ark-model-selection`: 火山方舟模型注册与调用、主线模型选择、分支模型继承与锁定、持久化兼容和请求路由。

### Modified Capabilities

（无——仓库当前没有已发布到 `openspec/specs/` 的基线 capability。）

## Impact

- 模型与路由：`constants/model.ts`、`constants/pricing.ts`、`lib/ai/provider.ts`、`app/api/chat/route.ts`
- 分叉树领域状态与持久化：`app/thread-chat/core/*`、`app/thread-chat/net/*`
- 输入框与列编排：`app/thread-chat/chat/chat-view.tsx`、`app/thread-chat/branching/branchable-chat.tsx`、`app/thread-chat/thread-chat-demo.tsx`
- 复用组件：`components/assistant-ui/model-selector.tsx`
- 配置：服务端使用 `ARK_CODING_API_KEY`；默认 Base URL 固定为 Coding Plan 专用的 `/api/coding/v3`
- 依赖：继续复用现有 `@ai-sdk/openai-compatible` 与 AI SDK 7，不新增 provider 包
