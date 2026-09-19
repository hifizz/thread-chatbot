## 1. 基线与 Case

- [ ] 1.1 盘点既有 evals/agent、MessageFeedback、反馈 outbox；明确不新建 runner/评分事实。
- [ ] 1.2 从现有集整理约 30 条 Beta 核心任务，补齐缺口并审查 manifest 与 baseline 集合。
- [ ] 1.3 冻结 candidate/evaluator/价格/搜索指纹、质量阈值及内部评测预算。

## 2. 反馈闭环

- [ ] 2.1 扩展现有反馈 DTO/详情组件的原因、comment 和默认关闭的复用授权，保持 clear/up/down。
- [ ] 2.2 实现输出版本/所有权校验和 #168 的 trace 兼容。
- [ ] 2.3 建立 Case promotion 审批、最小复现、private 双重开关及撤回/删除处理。

## 3. 三层验收

- [ ] 3.1 运行确定性权限/账务/状态/语言/隐私测试与 fixture smoke。
- [ ] 3.2 使用 --executor=declared、隔离库/guard 和受限实际模型/搜索主备完成真实路径验收。
- [ ] 3.3 手机/桌面验证分支核心任务；双实例验证预算/cursor/恢复/部署收尾。
- [ ] 3.4 执行 ¥5 固定 workload 实验并报告各模型成本和可完成任务，不预写成功结论。
- [ ] 3.5 实际演练邮件、外部告警、备份恢复和回滚，填入 release-checklist evidence。

## 4. 发布决策

- [ ] 4.1 实现 pass/fail/not_run 和 blocking/quality/diagnostic 规则；硬失败不能被平均分覆盖。
- [ ] 4.2 保护 live CI secrets/成本；未受信任 PR 只跑无秘密测试。
- [ ] 4.3 develop 集成所需反馈字段迁移；运行相关测试/typecheck 和 pnpm exec openspec validate evaluation-and-release-gates --strict。
- [ ] 4.4 汇总八项证据，指定批准人，按小批次邀请复核质量/费用/支持负担与暂停开关。

上述测试、付费调用和放量均未在文档 PR 中执行。
