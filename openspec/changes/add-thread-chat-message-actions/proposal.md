> **决策更新（2026-08-19）**：身份与反馈边界见 [`message-and-generation-identity-decision.md`](./message-and-generation-identity-decision.md)。产品反馈绑定 `messageId`，`generationId` 仅用于后台执行；内测阶段清空 thread-chat 会话域数据，不保留旧消息兼容。

## Why

`thread-chat` 的生成可靠性已经能够在刷新后恢复服务端终态，但仍存在一种会让会话永久失去操作入口的存量与竞态状态：用户消息已保存，assistant 占位或 generation 却不存在；当前加载清洗会删除无权威 generation 的空占位，而 Retry 只挂在 assistant error 消息上。与此同时，用户与 assistant 消息缺少复制、编辑、重新生成和反馈等基础操作，失败后的自助恢复能力不足。

## What Changes

- 将 generation 真相与消息结构一起协调为明确的轮次恢复状态：运行中继续显示后台生成，终态合并结果，未完成 assistant 无 generation 时保留部分输出并转为可重试错误，末尾 user 无 assistant/generation 时标记为可恢复孤儿轮次。
- 树加载 API 返回服务端判定的 recoverable turn 摘要；UI 不再仅凭 `last.role === "user"` 猜测错误，也不把单轮恢复问题升级为整树 HTTP 错误。
- 为用户消息增加 hover/focus 操作层：复制原始 Markdown、重新编辑；最后一轮 user 可编辑并发送，发送后创建 sibling user/assistant 消息分支并启动新的 generation，不覆盖已经提交的原消息节点。
- 让已存在但缺失 assistant 的存量孤儿消息可以直接重试原问题，或编辑后重新生成；原始未持久化的旧模型输出不声称可恢复。
- 为 assistant 消息增加复制 Markdown、重新生成、点赞、点踩操作；重新生成在同一 user 下创建 sibling assistant，而不是复用 message identity 覆盖原回复。
- 将同一 Thread 内的消息序列扩展为“不可变消息节点 + active leaf”的轻量 DAG：最新轮次编辑/重新生成产生可切换的版本；划选产生的子 Thread 永久绑定到准确的 source message 节点，切换版本不会让既有右侧分栏失去父节点。
- Artifact 绑定产生它的 assistant message 节点。旧版本 Artifact 不自动删除；当前路径默认展示当前版本资产，旧资产在切回该版本、打开其派生分支或查看历史资产时仍可访问。
- 点赞/点踩绑定具体 assistant `messageId`，服务端独立持久化并支持覆盖或清除选择，刷新后恢复；generation 只负责后台执行，重新生成的新 message 不继承旧 message 的反馈。
- 只接受严格的 schema-v2 消息图、revision 和显式 generation intent；不迁移旧线性树、不接受旧客户端降写。系统生成且完成的 assistant message 必须能由服务端 generation 记录通过 `assistantMessageId` 关联。
- 列模式与画布模式使用同一套 headless 行为接口和共享消息操作/编辑组件，保留现有 `.tc` DOM、划选锚点和手稿风样式契约。
- P0 仅允许对当前 Thread active path 的最后一轮创建消息版本分支：编辑最后一条 user、重新生成其相邻 assistant；更早历史消息的分支式编辑/重生成、任意历史路径重接和后续消息截断不在本变更范围。

## Capabilities

### New Capabilities

- `thread-chat-message-actions`: thread-chat 消息操作、孤儿轮次恢复、最后一轮编辑后重新生成、message 级反馈及跨列/画布一致交互契约。

### Modified Capabilities

（无。generation persistence capability 仍处于未归档 change；本变更依赖其 generation sidecar、持久化屏障、终态合并与 Retry/Stop 契约，但以新的用户可见 capability 描述消息操作与恢复行为。）

## Impact

- 客户端领域层：扩展 `Message`/`Thread`/`Artifact`、generation summary/recovery 类型，引入 message parent、active leaf、active-path/variant selectors，并增加加载协调、消息操作和 edit-and-regenerate 行为接口。
- 客户端 UI：`ChatView`、`CanvasExpand` 及 `.tc` 消息样式增加共享 toolbar、inline editor、操作反馈和孤儿轮次恢复条。
- 服务端 API：树 GET 增加 recoverable turn 与 message feedback 摘要；message feedback 接口按 tree/thread/message 做 owner 校验；`/api/chat` 明确验证显式 intent、严格消息图以及编辑后重新生成与孤儿轮次新建 assistant 的合法 turn。
- 数据库：反馈使用独立 message feedback 记录，不写入 generation，也不写整树 JSON；`branch_trees` 使用单调 revision，整树 PUT、生成事务和 active-leaf 切换使用 CAS，避免旧标签页覆盖消息图或版本选择。
- 测试：覆盖空占位、孤儿 user、运行中/终态 generation、完成消息与 generation 关联、刷新恢复、复制状态、编辑发送、Retry attempt、消息版本切换、旧版本派生分栏和 Artifact 可达性、message feedback 持久化、越权访问，以及列/画布一致性。
- 依赖：以 `persist-thread-chat-generations` 已实现的服务端 generation 身份、owner 校验和持久化屏障为前置，不引入新的第三方运行时或外部服务。
