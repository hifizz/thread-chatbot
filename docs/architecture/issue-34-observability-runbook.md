# Issue 34：Cutover 可观测性与观察期 Runbook

状态：本地只读审计入口已建立；生产 dashboard、告警阈值、负责人和观察窗口尚未配置，因此 OpenSpec 6.1/6.2/6.4 仍未完成。

## 只读健康快照

运行：

```bash
pnpm audit:conversation-cutover-health
```

输出不包含 Message 正文、query、URL、API key 或 Authorization，覆盖：

- canonical Generation 的 status/billing/usage completeness 组合、最大 heartbeat age；
- active、pending billing、终态无 checkpoint、completed/stopped 但 content 不完整、终态无 finishedAt；
- outbox 状态/最大年龄、command type 数量；
- canonical usage 流水、settled 无 usage、token mismatch、历史/非 canonical usage；
- legacy 三表剩余行数、产品运行时代码引用文件数；
- 安装且有权限时，从 `pg_stat_statements` 汇总 legacy 三表 SQL 调用次数和执行时间，不输出 SQL 正文。

数据库无法证明 HTTP 请求率，所以快照会把以下指标显式列为 unavailable，而不是伪造零值：authority mismatch、命令错误、revision/idempotency conflict、legacy route 请求。

## 生产接入要求

应用日志与平台指标必须按同一 cutover epoch 聚合，并建立以下 dashboard/alert：

| 指标                          | 必须观察的维度                                     | 放行原则                                  |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------- |
| authority mismatch            | epoch、client schema、route                        | canary 后为零；任何持续非零阻止放量       |
| command error                 | code、command type、HTTP status                    | 与基线比较；认证失败和冲突不能混成 500    |
| revision/idempotency conflict | command type、scope type                           | 突增时检查陈旧客户端或重放风暴            |
| Generation                    | status、heartbeat age、checkpoint、Stop/stale      | 非终态必须在 drain/阈值内收敛             |
| billing/usage                 | billing status、usage completeness、token mismatch | pending 与 settled-without-usage 必须为零 |
| outbox                        | status、age、attempts                              | pending/failed 不得超过批准阈值           |
| legacy protocol               | route、caller version、epoch                       | 切换后观察窗口内持续为零                  |
| legacy SQL                    | table、调用次数（不记录 SQL 正文）                 | 产品流量开放后持续为零                    |

## 观察期证据

每天保存一次健康快照和平台 dashboard 导出，并关联部署 ID、epoch、数据库 migration hash、负责人和时间范围。任何 unavailable 指标都必须先完成平台接入，不能用数据库快照替代。观察窗口结束时由负责人签署完整性与计费审计，之后才允许进入 legacy 运行时与物理表删除。
