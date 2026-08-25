# Domain cleanup evidence

- 旧 `branch_trees`、`branch_generations`、conversation/workspace Schema 和整树写入路径已删除；源码检索未发现旧权威入口。
- 本地 `thread-chat` 与隔离 `thread-chat-test` 均从空 `thread_chat` schema 执行 `db:push`；当前领域表仅为 `projects`、`threads`、`messages`、`message_runs`、`artifacts`、`message_feedback`。
- 领域、Repository、Application、Fake AI Runtime、API 与客户端自动测试共 87 项通过。
- `pnpm typecheck`、lint、production build 与 OpenSpec strict validation 通过。
- Ego Browser 已验证服务端 Project ID 跳转、SSE 完成、Artifact Summary 与 Artifact-by-ID Drawer；完整交互与 UI parity 证据见 Client/API change 的 `e2e-evidence.md`。
