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

## 临时数据库备份恢复演练（2026-08-22）

执行：

```bash
pnpm rehearse:conversation-cutover-local -- --approve-local-ephemeral-databases
```

演练只允许 loopback 数据库，并使用受限前缀创建两个临时数据库。流程完成后会终止临时连接、删除临时数据库和 dump/审批文件；不会修改源开发库。

本次结果：

- legacy dump SHA-256：`ca7424263d885d579414422a561121e191a6f86125e5df53c450090504a7af7e`；恢复后的 13 张 cutover 表合并指纹与源库一致：`565c2b20a6cb47e838756df1ed8793c80e16b929a72f00a1adc68c86a799b2e0`。
- 恢复库在 `legacy + read-only` 下通过 drain（五项为 0）和 19 棵 legacy 树审计；使用带真实 dump hash、精确临时库名和获批 repair 的临时 ADR 执行确定性导入两次，第二次保持幂等。
- 导入后共有 20 个 canonical Conversation（源库已有 1 个隔离浏览器夹具，新增 19 个 legacy Conversation）和 186 条持久映射。
- canonical dump SHA-256：`ac92a9ff818e8c15e02d9b4007a73f8539a014f292392ee8ce21d904210ed6d8`；再次恢复后的 cutover 表合并指纹与导入库一致：`9b2d3fb89eac3aecc92bf03acbc374e789d1c3b09bde37f1d4efceba709e7bd2`。
- 总耗时约 8.4 秒；两个临时数据库和所有临时文件均已删除。

这证明本地 PostgreSQL 的备份、恢复、drain、正式导入、幂等和 canonical 再恢复路径可执行；它仍不替代目标环境的基础设施等价演练、真实备份保留、负责人批准和切换观察窗口。
