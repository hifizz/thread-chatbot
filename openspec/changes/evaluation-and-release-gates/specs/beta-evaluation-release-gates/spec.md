## ADDED Requirements

### Requirement: Reuse versioned evaluation infrastructure

系统 SHALL 复用现有 Case、manifest、production executor 和 baseline，固定候选指纹，不以远端 latest 或集合交集代替批准基线。

#### Scenario: Candidate changes model or search policy
- **WHEN** 相同代码使用了不同模型/工具/价格/搜索策略
- **THEN** 记录新的 candidate fingerprint，不能冒充相同候选结果

#### Scenario: Case removed
- **WHEN** 新集合删除了旧失败 Case
- **THEN** 比较报告显式说明集合变化，不能静默只对交集得出通过

### Requirement: Separate fixture checks from production-path acceptance

系统 SHALL 区分 fixture、真实 provider/隔离数据库、浏览器及双实例证据。

#### Scenario: Fixture smoke passes
- **WHEN** 默认 smoke 不访问模型或数据库且通过
- **THEN** 只能标记 fixture 检查完成，真实供应商和部署检查仍保持 not_run

### Requirement: Block release on missing or failed hard evidence

系统 MUST 在任何 blocking 检查 fail 或 not_run 时阻止 Beta 开放，平均质量分或人工偏好不能覆盖安全、账务和隐私硬失败。

#### Scenario: High judge score but duplicate charge
- **WHEN** 回答质量分高但账务测试发生重复扣费
- **THEN** 发布决策为 blocked

#### Scenario: No restore evidence
- **WHEN** 所有模型测试通过但恢复演练未执行
- **THEN** 不允许将 Beta 完整开放门禁标记 approved

### Requirement: Promote feedback with ownership and reuse authorization

系统 SHALL 复用现有反馈事实，绑定实际输出，并在生产内容进入评测前完成授权/隐私审核。

#### Scenario: Feedback has no reuse permission
- **WHEN** 用户给出差评但未授权评测复用
- **THEN** 可以处理本人反馈，不自动上传其私有聊天到 Dataset

#### Scenario: Delayed feedback after regeneration
- **WHEN** 原输出被重新生成后反馈镜像重试
- **THEN** 仍关联被评分的原输出版本，不给新输出错误评分

### Requirement: Isolate and budget live evaluation

系统 SHALL 使用受保护的隔离数据库、受信任执行环境和有限成本预算运行真实评测，不向外部不受信任 PR 提供生产 secrets。

#### Scenario: Evaluation database points to production
- **WHEN** 配置未通过既有数据库命名/URL/guard 检查
- **THEN** 在首次写入或付费调用前停止

### Requirement: Validate trial economics on explicit workloads

系统 SHALL 通过固定渠道/用量/cache/搜索/扣额政策实验验证 ¥5 体验目标，不能把一百万 Token 当通用承诺。

#### Scenario: Cheapest model exceeds one million tokens
- **WHEN** 单个廉价模型样本达到百万 Token
- **THEN** 不据此宣称所有模型、任务和联网比例均达到同样水平

### Requirement: Approve staged rollout with auditable evidence

系统 SHALL 为每次放量记录候选、指标、采购/监控/支持准备和批准人，能够暂停后续邀请和新付费工作。

#### Scenario: Candidate has incomplete procurement
- **WHEN** 搜索主备还没有真实付费容量或有效价格记录
- **THEN** 即使方案和 CI 通过，放量仍被阻止
