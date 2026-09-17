## ADDED Requirements

### Requirement: Build reproducible isolated deployments

系统 SHALL 使用同一锁定构建产物部署同一 release，隔离 staging/production 的数据库、对象和 secrets，公开健康响应不得泄密。

#### Scenario: Two machines run one release
- **WHEN** 同一版本扩展到第二台机器
- **THEN** 两台使用相同构建和必要共享配置，不各自生成不兼容产物

#### Scenario: Preview starts
- **WHEN** 测试实例启动
- **THEN** 不自动继承生产数据库或付费无限额凭据

### Requirement: Share correctness-critical state

系统 SHALL 将账户、预占、准入、Generation、取消、需跨请求的快照和附件放在可由所有实例正确访问的持久状态中。

#### Scenario: Follow-up reaches another instance
- **WHEN** 用户刷新/续读/停止请求被路由到另一实例
- **THEN** 能按授权获得一致状态，不丢数据、不重复收费

### Requirement: Scale within measured capacity and budget

系统 SHALL 依据真实内存、并发、延迟、连接池和供应商容量设置有限扩容边界，不承诺最低规格足够或无限自动建机。

#### Scenario: Capacity ceiling reached
- **WHEN** 所有允许实例和供应商容量达到上限
- **THEN** 拒绝或有界排队新工作并说明容量状态，不无界扩容

### Requirement: Do not idle-stop active background work

系统 SHALL 将后台 Generation 与 HTTP 连接状态分开，在未证明后台工作安全前关闭可能停止工作实例的自动停机。

#### Scenario: Browser detaches from running generation
- **WHEN** 用户关闭页面但服务端任务仍在运行
- **THEN** 不仅因连接数为零就停止该任务所属实例

### Requirement: Drain before planned replacement

系统 SHALL 在计划替换实例前停止新受理并处理在途任务，平台终止窗口不足时不得只靠 signal handler 承诺完成。

#### Scenario: Long task remains during deploy
- **WHEN** 在途任务无法在当前替换窗口安全收尾
- **THEN** 发布等待明确的 drain 条件或被阻止，不静默杀掉任务

### Requirement: Recover without duplicating external work

系统 SHALL 利用现有 Generation 结果、lease 和 CAS 恢复崩溃状态，保留成本证据，不自动重放不确定的付费或外部写入。

#### Scenario: Old process returns after recovery
- **WHEN** lease 已失效的旧进程试图提交终态
- **THEN** 不能覆盖当前事实或重复扣费

### Requirement: Centralize migrations and verify restoration

系统 SHALL 在 develop 单一集成流程生成验证迁移，发布只应用审核产物，并在开放前演练备份恢复及兼容回滚。

#### Scenario: Multiple instances start together
- **WHEN** 新版本启动多个实例
- **THEN** 不在每台启动时分别生成或并发执行迁移

#### Scenario: Backup exists without restore test
- **WHEN** 只配置备份但没有实测恢复证据
- **THEN** 发布门禁的恢复项保持未通过
