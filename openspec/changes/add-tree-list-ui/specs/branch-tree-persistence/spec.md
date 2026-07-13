# branch-tree-persistence 分支对话树持久化（delta）

## MODIFIED Requirements

### Requirement: 分支树整树存储

系统 SHALL 以「一棵树一行」的形式将完整 `ThreadTreeState`（含全部 thread、消息、划选锚点 TextAnchor、Artifact 登记、footnoteCounter/seq 等计数器）作为 JSON 持久化到 Postgres 表 `branch_trees`，并与主聊天页的 `threads`/`messages` 表保持完全独立（不建立外键、不复用行）。表含可空列 `custom_title`（用户自定义标题，仅由重命名 API 写入）；整树 upsert SHALL 只更新 `state`/派生 `title`/`updatedAt`，**不触碰 `custom_title`**。对外展示标题一律取 `coalesce(custom_title, title)`。

#### Scenario: 首次保存创建新行

- **WHEN** 客户端以一个此前不存在的 treeId 发起保存
- **THEN** 系统 SHALL 插入一行（id=treeId、state=整树 JSON、title=派生标题、custom_title 为空），createdAt/updatedAt 为当前时间

#### Scenario: 再次保存更新同一行

- **WHEN** 客户端以已存在的 treeId 再次保存
- **THEN** 系统 SHALL 原地更新该行的 state/派生 title/updatedAt（upsert），不产生新行、不改动 custom_title
