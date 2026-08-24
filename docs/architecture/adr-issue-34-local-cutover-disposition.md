# ADR：Issue #34 本地切换数据处置

- 状态：本地开发库 reset 已批准，等待执行
- 日期：2026-08-24
- 范围：`localhost/thread-chat` 的 `thread_chat` schema

## 决策

本地临时恢复演练仍采用**确定性导入**，用于证明导入器可用；当前本地开发库的正式 cutover 改为采用**受批准重置**，不导入 19 棵 legacy Tree。

理由是这 19 棵树均为测试数据，没有数据保留义务。仓库负责人在 2026-08-24 明确批准：完整备份并实际恢复验证后，可以不导入这批数据。重置只覆盖全部 legacy Tree 及由持久映射可证明来源于它们的 canonical 实体；现有独立 canonical 浏览器夹具和 `usage_records` 财务流水不在删除范围内。

缺失 intent 的 5 条记录只影响导入路径；本次选择 reset，因此不推断、不修复也不导入这些测试记录。完整 dump 是它们的唯一保留副本。

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

本地自动演练使用 `--test-rollback` 验证导入与 reset 事务。当前本地开发库的 `--execute` 必须同时满足：

1. `legacy + read-only` authority；
2. 审批文件的数据库 host/name 与当前连接一致；
3. 环境中的 approval ID 与审批文件一致；
4. 真实备份 ID、批准人、时间和 scope 均非空；
5. drain 门禁为 0。

本 ADR 只批准 `localhost/thread-chat`。任何共享、预发布或生产数据库都不能复用其批准身份、manifest 或备份标识，必须在对应环境重新审计并另建 ADR。

## 本地开发库执行输入

- 处置：`approved-reset`
- scope：全部 19 棵 legacy Tree
- 保留义务：无（测试数据）
- 备份：`sha256:5278aafc7f9d4bf01607133c09dfff7a9846f9543a68d7ee482097337f2cf078`
- 恢复验证：源库与恢复库 28 张表的合并指纹均为 `a02bf8458579a046856caa4fe0797525086eb97f698bf7e01a2f9bae9d9d081c`
- 版本化 manifest：`issue-34-local-cutover-release-2026-08-24.json`
- 审批合同：`issue-34-local-reset-approval-2026-08-24.json`
- 备份合同：`issue-34-local-backup-verification-2026-08-24.json`

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
