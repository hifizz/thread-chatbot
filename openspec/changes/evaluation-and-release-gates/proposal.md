## Why

数据驱动与评测驱动必须落实到发布条件。现有 evals/agent、固定 manifest、隔离 DB、基线比较及反馈镜像已经具备基础；需要覆盖 Beta 的真实用户路径、资金安全、隐私和部署，防止 fixture 通过被误认为可以开放。

## What Changes

- 复用现有 AgentCase、EvaluationScore、runner、baseline 和 MessageFeedback，不新增评测平台。
- 补充反馈原因/评测复用授权、故障回流 Case 的人工审核流程和版本指纹。
- 定义确定性硬门禁、真实 provider/浏览器/双实例验收及小批量开放证据。
- 建立跨八项方案的发布清单、采购准备状态和任务归属。
- 将 ¥5 约百万 Token 变为固定 workload 的成本体验实验，不作为未经验证宣传结论。

## Capabilities

### New Capabilities

- `beta-evaluation-release-gates`: Beta 回归、反馈回流、证据与发布决策。

### Modified Capabilities

无。扩展现有评测和反馈能力，不更换其事实来源或已批准历史基线。

## Impact

后续扩展 evals/agent、已有 feedback DTO/界面、release evidence 与 CI 接入。本 PR 仅方案，附 docs/beta/release-checklist.md。

## Dependencies

Git 父分支 spec/beta-06-analytics（#168，含 #165/#163）；实际发布必须汇总 #164 计费、#166 准入、#167 搜索、#169 部署及前述方案的实现和真实证据。方案 PR 合入不等于这些功能已完成。

## Non-goals

不重建 runner、不默认把全部用户聊天上传评测、不用单个平均分替代硬门禁、不保证固定价格覆盖任意 workload、不在本次运行付费评测或部署。
