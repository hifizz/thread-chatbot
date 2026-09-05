## Why

Thread Chat 会在续聊、重新生成和 Fork 中重复发送大量相同上下文，但当前动态 System、Child 专属历史截断和未分层的模型线路策略会破坏可复用前缀。现在需要建立不改变 Prompt 语义和生成行为的缓存基础，并用真实 Provider 用量持续验证命中效果。

## What Changes

- 将 `(researchMode, artifactRequested)` 的合法组合定义为固定生成模式，并固定每个模式的 System、工具集合与顺序、首步工具规则、推理设置和最大步骤。
- 依赖 Quote/Fork MVP 把具体 Quote 留在所属 User Message，并移除 Child 专属 6000 字符截断，使共同历史保持完整原序。
- 建立单一 Provider 缓存能力策略；首批只为真实实验通过的 UMAPIS Claude Opus 5 与 Sonnet 5 启用显式 Prompt 缓存。
- 在当前 User Message 之前的稳定共同历史末尾设置缓存断点；缓存参数不得改变模型可见内容或生成配置。
- 将缓存读取、写入、未缓存输入 Token 及其完整性状态接入现有生成用量、Langfuse 和服务端日志。
- 不支持或未验证的线路不发送猜测性的显式缓存参数，但可以记录上游自动返回的缓存用量。
- 缓存未命中、缓存字段缺失或观测上报失败不得改变回答结果、模型线路或消息终态。
- 本 change 不处理 PDF 上下文冻结、长上下文压缩检查点、研究计划后移、缓存预热或最终回答缓存。

## Capabilities

### New Capabilities

- `thread-chat-prompt-cache`: 定义固定生成模式、缓存线路资格、共同历史缓存断点、缓存行为不变性和持续缓存观测合同。

### Modified Capabilities

无。

## Impact

- 影响 Thread Chat 的 Prompt 编译、生成计划、模型 Provider 解析和生成用量观测。
- 复用 AI SDK v7 的 `providerOptions` 与 `LanguageModelUsage.inputTokenDetails`，不引入新的缓存服务或运行时依赖。
- 首批显式缓存范围限定为 UMAPIS Claude Opus 5 与 Sonnet 5；其他模型线路保持当前调用行为。
- 不新增数据库表；如需持久化新的标准化观测字段，应扩展现有 generation/usage 数据而不是建立缓存状态机。
