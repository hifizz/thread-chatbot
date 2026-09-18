## 1. 事实与事件

- [x] 1.1 清点既有 Axiom/Langfuse/反馈/outbox，定义唯一关联、指标字典与数据用途。
- [x] 1.2 定义 ProductEvent schema、稳定 eventId 和真实状态提交后的发送入口。
- [x] 1.3 对接 #165 的浏览器/服务端 consent gate，先关闭 replay/autocapture。

## 2. 追踪兼容

- [x] 2.1 实现 Generation trace mapping v2 保存与 v1 回读，Session 改为 Thread metadata 保留 Project。
- [x] 2.2 迁移反馈目标解析/outbox，测试旧反馈、重新生成、延迟投递，不双报用量。
- [x] 2.3 release 使用 CI SHA，attempt/账务/日志链接统一 request/Generation/trace。

## 3. Admin 与指标

- [x] 3.1 实现最小核心面板和用户详情，Admin guard/范围分页校验，分别展示全部服务与同意分析人群。
- [x] 3.2 固定 UTC 指标、cohort 窗口、内部测试排除、状态分母、未知成本覆盖。
- [ ] 3.3 对接 #164/#166/#167 的账务、准入和搜索事件，避免依赖形成循环。

## 4. 监控与验收

- [x] 4.1 配置外部探测、供应商/卡住任务/结算/邮件反馈积压/预算告警，指定接收人与 runbook。
- [ ] 4.2 演练一次应用不可达和一次真实通知送达，验证冷却、去重和恢复消息。
- [x] 4.3 测试同意撤回、重复事件、跨账号、反馈映射、成本缺口和未成熟 D7。
- [x] 4.4 develop 集成必要 migration；运行相关测试/typecheck 和 pnpm exec openspec validate product-analytics-and-observability --strict。

本次不启用生产分析、发送告警或修改用户数据。
