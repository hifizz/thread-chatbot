# Issue #34 后续迁移输入清单

本清单固定 `define-conversation-domain-model` 输出给后续 change 的边界。后续 change 可以细化实现，但不得重新引入整树写入权威或第二套 Fork 事实。

## 1. normalize-conversation-persistence

- 逻辑实体：projects、conversations、conversation_threads、thread_forks、turns、messages、generations，以及 Artifact 来源关系。
- 数据库约束：所有 owner/project/conversation 归属、复合外键、根 Thread、非根单一入向 Fork、来源 Message 属于父 Thread、Message/Turn/Generation 同 Thread。
- 真实数据审计：魔法 `main`、悬空 parent/source、重复 Fork、环、跨 Thread 变体、孤儿 Generation、无效 Artifact 来源。
- 在审计结果可见后明确选择一次性迁移或开发期重置，不以双写掩盖未知数据。
- 规范实体组装 `ConversationSnapshot`；快照只读，不接受整包 PUT。
- 回滚边界：启用规范写入后保留规范数据库，通过兼容读取、只读或前滚修复回滚应用，不反向恢复整树权威。

## 2. migrate-generation-lifecycle

- 把 Generation 改为真实 Thread、Turn、输入 Message、输出 Message 外键。
- 覆盖启动、持久化屏障、心跳、停止请求、终态、过期恢复与部分输出。
- `usage_unavailable` 是显式终态；计费按 Generation 幂等结算，不能依赖浏览器是否仍连接。
- 对照 PR #30 逐项关闭刷新恢复、停止、CAS、终态协调合并等剩余语义缺口；不再以 JSON 内部节点作为身份保证。

## 3. add-conversation-command-api

- 命令：`forkThread`、`createTurn`、`regenerateAssistant`、`editUserMessage`、`selectVariant`、`archiveConversation`、`archiveThread`、`stopGeneration`。
- 每个命令包含 owner 校验、幂等键、预期 revision、稳定错误码和最小实体增量。
- `forkThread` 在同一服务端事务创建子 Thread 与 ThreadFork、记录来源 Message、初始化上下文、推进 Conversation revision，并写事务事件箱。
- API 不接受客户端提交完整 Conversation 快照；通知事件只在提交成功后发布。

## 4. normalize-conversation-client-state

- 客户端缓存规范实体及可重建索引，所有选择器按稳定 ID 定位。
- 领域状态与 `ConversationUiWorkspace` 分离；列顺序、折叠、画布视口和临时 selection 不上传成实体。
- 乐观命令保存幂等键和预期 revision，冲突时用服务端实体增量协调。
- 依次迁移列、画布、Message 操作、标题和 Artifact 来源消费，不再从 `parentId/children/Message.forks` 推断权威事实。

## 5. retire-thread-tree-authority

- 切换前完成数据一致性审计，并排空或安全接管运行中 Generation。
- 禁用整树 PUT、删除整树协调合并和防抖保存，移除重复 Fork 字段的写路径。
- 所有读写、恢复、列表和标题功能只访问规范实体；之后删除遗留允许列表和单向适配器。
- 删除旧表或字段前保留可验证备份，并用服务端 API 与 UI 回归证明不存在旧权威读路径。

## 6. 基础迁移后的独立提案

以下能力依赖稳定身份，但不阻塞 Issue #34 当前迁移链：Project Memory、Project File、Project Instruction、公开数据 API、访问令牌、CLI、MCP，以及 Issue #39 的 Conversation 发散后收敛机制。它们必须分别提出权限、版本、生命周期和审计设计，不能提前塞进本次领域迁移。
