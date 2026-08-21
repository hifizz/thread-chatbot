## Why

主线会话仍把首条用户消息截为固定长度后作为树标题，和 ForkedThread 已具备的完整语义标题行为不一致，也会让会话列表在英文或较长中文输入下失去主题信息。

需要让主线在首条用户消息提交后也能低成本地生成一次完整标题，并将 Thread 的领域角色显式化，使用统一术语维护标题能力。

## What Changes

- 为 MainThread 首条用户消息增加一次火山方舟轻量模型的语义标题生成。
- 标题生成结果保存在目标 Thread 状态；MainThread 成功生成的标题同时作为整棵树的机器标题。
- 在模型结果返回前或生成失败时，保留首条用户消息的现有截断标题作为回退。
- 用户手动重命名的 `custom_title` 继续优先于自动标题，不受自动标题写入影响。
- 将标题能力统一命名为 `title-generation`；删除旧标题端点、请求体和浏览器存储键的兼容代码。
- 标题生成覆盖 MainThread 和 ForkedThread，并保持任一 Thread 仅自动尝试一次、刷新不重试的保证。

## Capabilities

### New Capabilities

- `title-generation`: 为 MainThread 与 ForkedThread 生成一次完整语义标题，并定义回退、持久化、展示优先级与防重复调用行为。

### Modified Capabilities

- 无。

## Impact

- 受影响的客户端状态与标题请求逻辑：标题生成 hook、树标题派生与持久化。
- 受影响的服务端接口：使用统一标题请求支持 MainThread 与 ForkedThread 输入。
- 沿用火山方舟 Coding Plan 的 `doubao-seed-2.0-mini`，不新增依赖。
