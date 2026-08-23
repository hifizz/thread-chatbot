## Why

规范表和 Generation 生命周期只能保证持久化层内部正确；如果网页、未来 CLI 或 MCP 仍能分别写 Thread、Message、Fork 或整包快照，重复关系和竞态会从接口重新进入系统。需要一套与传输无关的应用命令和统一 HTTP 适配器，把权限、幂等、版本冲突和事务边界集中为唯一写入入口。

## What Changes

- 新增 Conversation 查询与命令应用层，覆盖 Conversation 创建/列表/读取/重命名/归档/删除，以及 Thread Fork、发送、编辑、重新生成和变体选择。
- `forkThread` 在一个服务端事务中创建下游 Thread、ThreadFork、上下文边界、Conversation 版本和事务事件；客户端不得分步拼装关系。
- 发送、编辑与重新生成通过命令原子创建 Turn/Message/Generation，并复用规范 Generation 生命周期；任何付费调用发生在命令事务提交之后。
- 所有命令使用统一 envelope，包含命令 ID、幂等键、目标 ID、预期版本和载荷；服务端返回规范实体增量与最新版本，而非可回写整树。
- 新增统一身份认证、所有者/成员授权、稳定领域错误和 HTTP 状态映射；冲突只在预期版本、幂等载荷或当前状态真实冲突时返回。
- 新增首次加载 `ConversationSnapshot`、增量查询以及 Generation 查询/Stop 端点，供网页与未来公开适配器共用同一应用服务。
- **BREAKING**：目标接口不再提供整棵 `ThreadTreeState` 的权威 PUT、客户端关系写入或浏览器先存盘屏障；旧路由仅在最终切换前暂存，不能成为新命令的第二权威。

## Capabilities

### New Capabilities

- `conversation-command-api`：定义 Conversation 查询、原子领域命令、权限、幂等、并发、实体增量和稳定传输结果。

### Modified Capabilities

- 无。遗留路由的删除由 `retire-thread-tree-authority` 负责，本变更建立替代契约。

## Impact

- 应用层：新增 Conversation commands/queries、事务端口、授权策略、事件箱事件和统一结果类型。
- 接口层：新增 `/api/projects/.../conversations`、`/api/conversations/...`、Thread/Turn/Generation 子资源路由及传输 schema。
- 持久化：复用规范仓储、Conversation/Thread/Turn revision、Generation 生命周期和事务事件箱。
- 客户端：后续改用快照初始化和实体增量；本变更只提供接口，不迁移 Store。
- 前置依赖：`define-conversation-domain-model`、`normalize-conversation-persistence`、`migrate-generation-lifecycle`。
- 后续依赖：`normalize-conversation-client-state`、`retire-thread-tree-authority`，以及未来 CLI/MCP/分享适配器。
