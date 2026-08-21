# ADR：Issue #34 本地切换数据处置

- 状态：本地演练已接受；生产决策待定
- 日期：2026-08-22
- 范围：`localhost/thread-chat` 的 `thread_chat` schema

## 决策

本地演练采用**确定性导入**，不采用数据重置。原因是只读审计的 19 棵树中没有拒绝级结构、所有权或引用污染；5 条异常都只是早期终态 Generation 缺少来源 intent。

缺失 intent 的 5 条记录允许在本地演练中使用 `missing-generation-intent-as-send` 修复：它只把历史执行来源归为最弱的 `send`，不改变 Message 内容、计费终态或 active variant，也不会重新执行模型。正式环境若出现同类记录，仍需在自己的审批文件中逐项批准。

## 数据与回滚边界

```mermaid
flowchart LR
  A[只读审计] --> B[冻结 legacy 写入]
  B --> C[drain = 0]
  C --> D[已验证备份]
  D --> E[逐 Conversation 事务导入]
  E --> F[计数 / FK / 映射摘要校验]
  F --> G[切换 canonical epoch]
```

本地自动演练使用 `--test-rollback`：在同一事务中导入 19 个 Conversation、执行 post-import verifier、重复导入验证幂等，再强制回滚。该模式的 `backupId=rollback-test-does-not-commit` 不是生产备份凭证。正式 `--execute` 必须同时满足：

1. `legacy + read-only` authority；
2. 审批文件的数据库 host/name 与当前连接一致；
3. 环境中的 approval ID 与审批文件一致；
4. 真实备份 ID、批准人、时间、scope 和允许 repair 均非空；
5. drain 门禁为 0。

生产环境不能复用本 ADR 的批准身份或测试备份标识，必须在真实审计后另建 ADR。
