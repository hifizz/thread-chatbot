## Why

`normalize-conversation-persistence` 将 Thread、Turn 与 Message 变成可由数据库约束的真实实体，但当前 `branch_generations` 仍把 Generation 作为整树 JSON 的辅助记录运行。Stop、断线续跑、僵尸任务收敛、部分内容、联网活动和计费完整度因此分散在多条路径中，已经出现“部分 usage 被当作完整结算”“失败恢复覆盖已保存内容”等语义错误。必须先把 Generation 收回规范领域模型，后续命令 API 和客户端迁移才能依赖一套可证明的生命周期。

## What Changes

- 新增以真实 Conversation、Thread、Turn、输入 Message 与输出 Message 外键为身份的规范 Generation 记录，明确请求意图、尝试次数、当前变体和幂等键。
- 定义 `running → stop_requested → stopped`、`running → completed/failed` 与 `superseded` 的合法转换；Generation 必须在任何付费模型调用前以事务方式开始。
- 将流式执行改为服务端拥有，浏览器断线不得取消后台消费；正文、Artifact、研究活动和 usage 通过有版本的服务端 checkpoint 持久化。
- 把 Message 内容状态与 Generation 终态分离：有部分输出的 Stop/失败可保存为 `incomplete`，不得统一伪装成 `error` 或清空已有 checkpoint。
- 明确 usage 完整度与计费状态是两个正交维度；只知道部分 step usage 时必须保留已知值并标记 `usage_unavailable`，不得结算为完整账单。
- 保留现有服务端 AbortController 注册表、数据库 Stop 观察、心跳和幂等扣费中正确的机制，但以规范实体和单一终结事务重新实现。
- 本变更不开放新的公共 Conversation HTTP 命令，也不切换生产客户端；规范生命周期默认关闭，供下一步 `add-conversation-command-api` 接入。

## Capabilities

### New Capabilities

- `conversation-generation-lifecycle`：定义规范 Generation 的身份、状态机、服务端执行、部分 checkpoint、Stop/恢复与计费真实性。

### Modified Capabilities

- 无。遗留 `persist-thread-chat-generations` 的最终替换和归档由切换 change 处理，本变更先建立新的独立契约。

## Impact

- 数据库：新增规范 Generation 表、checkpoint/usage 字段、状态约束、索引及 `usage_records` 的幂等关联。
- 服务端：聊天流生命周期、Generation 仓储、Stop 注册表、心跳、僵尸任务收敛、结果投影和终结事务。
- 客户端语义：后续可按 Generation 和 Message 内容状态恢复，但本变更不迁移现有 Store 或路由。
- 测试：增加状态转换、部分输出、联网活动、断线续跑、Stop、stale recovery、usage 完整度与 exactly-once 计费覆盖。
- 前置依赖：`define-conversation-domain-model`、`normalize-conversation-persistence`。
- 后续依赖：`add-conversation-command-api`、`normalize-conversation-client-state`、`retire-thread-tree-authority`。
