## Why

分支标题生成仍调用 MiniMax；当其 Token Plan 配额耗尽时，AI SDK 的默认重试会让同一个可选请求连续失败。标题失败后没有持久化“已尝试”状态，页面刷新又会再次调用模型，造成不必要的请求和日志噪音。

同时，服务端把标题硬截为 8 个字符，无法保留自然的英文或较长中文短语；标题应完整保存，由各个前端容器按自身空间决定是否省略。

## What Changes

- 将分支标题生成模型切换为火山方舟 Coding Plan 的 `doubao-seed-2.0-mini`。
- 为标题调用设置单次输出 token 安全阀并禁用自动重试，避免可选功能在确定性失败时额外消耗请求。
- 移除服务端的标题字符长度限制，并让提示词按用户问题语言生成自然短语。
- 在分支树状态中持久化“标题生成已尝试”标记，并以标签页级标记覆盖状态尚未落库时的刷新窗口；无论成功或失败均不自动重试。
- 保留现有前端基于容器宽度的 CSS 省略展示，完整标题仍保存在树状态中。

## Capabilities

### New Capabilities

- `branch-title-generation`: 为完成首轮问答的分支生成一次可持久化、按布局展示的语义标题。

### Modified Capabilities

- 无。

## Impact

- 受影响的 API：`POST /api/branch-title`。
- 受影响的领域状态：`Thread` 增加可选的标题生成尝试标记；整树 JSONB 无需迁移。
- 受影响的配置：使用既有服务端 `ARK_CODING_API_KEY` 及 Coding Plan OpenAI-compatible 端点。
- 不新增依赖；继续使用 AI SDK 与既有模型调用日志包装器。
