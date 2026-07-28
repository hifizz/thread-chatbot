## 1. Ark 模型与服务端路由

- [x] 1.1 在统一模型注册表中增加 `ark` provider 与 Ark Coding Plan 文档列出的模型，并集中定义 Coding endpoint
- [x] 1.2 新增 Ark OpenAI-compatible provider 工厂并接入 `isModelConfigured`/`resolveChatModel`
- [x] 1.3 为所有 Ark 模型补齐非零计费配置与环境变量示例
- [x] 1.4 `/api/chat` 对显式 `modelId` 做严格注册表校验，同时保留缺省模型兼容

## 2. Thread 模型领域状态

- [x] 2.1 为 `Thread` 增加 `modelId`，根 Thread 使用默认模型，新分支继承父 Thread 模型
- [x] 2.2 增加仅允许根 Thread 更新模型的 store action
- [x] 2.3 持久化加载时为缺失或失效的 Thread 模型回填默认值
- [x] 2.4 Thread Chat 每次请求携带当前 Thread 的 `modelId`

## 3. 模型选择器 UI

- [x] 3.1 为复用 `ModelSelector` 增加外部可控的 `disabled` 状态
- [x] 3.2 在 Thread Chat prompt input 中接入从统一注册表派生的模型选择器
- [x] 3.3 根 Thread 空闲时允许切换，生成期间禁用；所有分支显示继承模型并保持禁用

## 4. 验证

- [x] 4.1 增加或更新针对 Thread 默认模型、切换限制、分支继承和旧数据升级的测试
- [x] 4.2 使用 `ARK_CODING_API_KEY` 通过 AI SDK 7 验证 GLM-5.2 流式聊天与 tool call
- [x] 4.3 运行 typecheck、lint 与相关测试，并检查 OpenSpec change 状态
