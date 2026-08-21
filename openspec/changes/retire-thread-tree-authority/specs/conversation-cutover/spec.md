## Purpose

以可审计、互斥、可回滚且不产生双重事实源的方式，将生产 Conversation 从 ThreadTree JSON 权威切换到规范实体，并安全退役旧协议、代码和数据结构。

## ADDED Requirements

### Requirement: Cutover 必须满足显式前置门禁

切换生产权威前，系统 SHALL 证明规范持久化、Generation 生命周期、命令 API 和 normalized 客户端的必需任务及行为矩阵已经完成。发布记录 MUST 包含严格测试结果、数据审计、容量/性能基线、安全检查、备份验证、回滚演练和明确 go/no-go 决策；任一阻塞门禁失败 MUST 取消切换。

#### Scenario: Generation partial 回归未通过

- **WHEN** 门禁测试仍会在 stale recovery 中覆盖已保存 partial
- **THEN** 发布保持 legacy authority，不进入数据冻结或 cutover

#### Scenario: 所有门禁满足

- **WHEN** 实现、数据、行为、安全、备份和回滚证据均满足记录的验收标准
- **THEN** 负责人可以批准进入受控维护窗口

### Requirement: 用真实审计决定导入或重置

系统 SHALL 根据 `normalize-conversation-persistence` 产生的只读审计和目标环境用途，记录选择“一次性导入”或“受批准重置”的决定、影响范围、记录数量、不可迁移项及处理人。存在需保留的用户数据时 MUST 导入或逐项解决，不能为简化开发而静默清空。

#### Scenario: 目标环境有需保留用户数据

- **WHEN** 审计发现属于真实用户且在保留范围内的 Conversation
- **THEN** cutover 计划选择确定性导入，并为全部不可直接映射记录给出修复或明确排除批准

#### Scenario: 隔离开发环境获准重置

- **WHEN** 审计证明数据无保留义务且负责人书面批准重置
- **THEN** 发布记录保存范围、备份与批准证据后，才可初始化空规范数据

### Requirement: 一次性导入必须确定且引用完整

导入器 SHALL 在旧写入冻结后，把每个 legacy `(tree, entityType, localId)` 确定映射为规范稳定 ID，并迁移 Conversation、Thread、ThreadFork、Turn、Message、Generation、标题、反馈、Artifact 和 usage 关联。导入 MUST 可重复运行、事务安全并输出映射/拒绝报告；任何跨所有者、悬空或计数不一致 MUST 阻止该记录切换。

#### Scenario: 导入含嵌套 Fork 的树

- **WHEN** 合法遗留树包含 A → B → C 及 Message 反馈、Artifact 和已终结 Generation
- **THEN** 导入产生一个 Conversation、三个 Thread、两条 ThreadFork 和完整辅助外键，重跑不会产生重复实体

#### Scenario: 导入发现悬空 Generation Message

- **WHEN** `branch_generations` 引用无法映射的 JSON Message ID
- **THEN** 导入将该 Conversation 标为阻塞并保持旧备份，不伪造 Message 或忽略计费引用

### Requirement: 在无旧写入窗口排空运行任务

Cutover SHALL 先进入受控只读/维护模式，拒绝新的 legacy Conversation 写入和 Generation 开始，再等待非终态 Generation 正常完成、停止或由既有规则收敛。直到旧系统没有未确认的模型执行、checkpoint 或计费事务，系统 MUST NOT 执行最终数据导入和 authority 切换。

#### Scenario: 维护开始时仍有运行任务

- **WHEN** legacy Generation 仍为 `running` 或 `stop_requested`
- **THEN** cutover 等待或按声明策略停止/收敛，并在终态与计费可审计后继续

#### Scenario: 维护期间旧客户端发送写入

- **WHEN** 旧客户端尝试 PUT 整树或开始 Generation
- **THEN** 系统返回稳定维护响应且不接受新事实

### Requirement: 规范 Conversation 必须成为唯一权威

Cutover 后，所有读取、命令、Generation、计费和客户端页面 SHALL 只使用规范 Conversation 实体。authority 模式 MUST 在同一部署中互斥；系统不得双写、双读择优、从 legacy 回填缺失规范记录，或运行两个 Store 相互同步。

#### Scenario: 规范记录缺失

- **WHEN** cutover 后请求的 Conversation 无规范记录但旧 JSON 仍有备份
- **THEN** 系统返回规范未找到/数据错误并告警，不在请求路径回退读取旧 JSON

#### Scenario: 配置同时启用两套写入

- **WHEN** 部署配置尝试同时启用 legacy 与 canonical authority
- **THEN** 应用启动或健康门禁失败，部署不得接收流量

### Requirement: Cutover 后保持目标行为矩阵

规范路径 SHALL 跑通 Conversation 列表/标题/归档、Thread 列/画布/归档、A → B → C Fork、锚点、Turn/Message 变体、Message actions、Markdown/Artifact/研究活动、Generation 流式/Stop/刷新恢复、反馈、所有者隔离和计费幂等。行为以新 specs 为准，不要求保留旧数据结构或已确认的错误语义。

#### Scenario: 切换后停止部分回答并刷新

- **WHEN** 用户在规范路径停止已有 partial 的 Generation 并刷新
- **THEN** 相同 Thread/Turn/Message、`incomplete` 内容、研究活动、usage 完整度和 `stopped` 状态被恢复

#### Scenario: 切换后嵌套 Fork

- **WHEN** 用户从根 Thread Fork B，再从 B Fork C
- **THEN** 列和画布显示两条 ThreadFork 的正确来源，服务端不存在重复 parent/children/Fork 写入

### Requirement: 旧 ThreadTree 协议必须明确退役

Authority 切换后，整树写入、旧 Generation 协调、active-leaf 切换和 legacy reconcile 路由 SHALL 被关闭，并对旧客户端返回稳定 `legacy_protocol_retired` 结果或不存在结果。旧协议不得在错误、缺失记录或回滚时重新启用为生产写入入口。

#### Scenario: 旧客户端提交整树 PUT

- **WHEN** cutover 后旧客户端调用 legacy branch-tree 写路由
- **THEN** 系统拒绝请求并返回稳定 retired 响应，不修改规范或备份数据

#### Scenario: 新客户端正常加载

- **WHEN** canonical 客户端加载 Conversation
- **THEN** 它只调用规范 snapshot/command/Generation API，不探测或调用旧路由

### Requirement: 切换期必须可观测和可审计

系统 SHALL 记录 authority epoch/schema、请求路径、命令错误分类、revision 冲突、Generation 终态/checkpoint age、stale 收敛、usage 对账、导入计数和完整性失败。发布 SHALL 使用预先记录的阈值和观察窗口判断继续、只读或前滚修复，日志不得泄漏 Message 内容或凭据。

#### Scenario: 切换后 usage_unavailable 异常上升

- **WHEN** 计费完整度指标超过批准阈值
- **THEN** 发布进入声明的保护动作并保留规范记录用于诊断，不切回旧 JSON 结算

#### Scenario: 审计查询单次 Fork

- **WHEN** 运维按 requestId/commandId 调查 Fork
- **THEN** 可以关联 actor、Conversation revision、ThreadFork/outbox 事件和结果，而无需读取整树 mutation diff

### Requirement: 回滚不得重新引入双重事实源

切换前的回滚可以继续使用未修改的 legacy authority；一旦 canonical 接受生产写入，回滚 SHALL 保持规范数据库为事实源，通过关闭写入、回滚应用代码兼容层、恢复规范备份或前滚修复处理。系统 MUST NOT 把新规范写入反向合并回旧 JSON 后恢复旧权威。

#### Scenario: 切换后客户端渲染故障

- **WHEN** canonical 数据正确但新客户端出现严重回归
- **THEN** 发布回滚/修复客户端或进入只读，服务端规范实体继续保持权威

#### Scenario: 切换后发现规范数据损坏

- **WHEN** 完整性检查发现不可接受的规范写入损坏
- **THEN** 系统停止相关写入并从已验证规范备份恢复或执行审计前滚，不从落后的 legacy JSON 覆盖

### Requirement: 遗留代码和表分阶段删除

系统 SHALL 在 authority 切换成功后先证明旧路由零调用、无代码写引用且备份可恢复，再按声明保留期删除 ThreadTree 领域类型、浏览器 persistence/reconcile、旧仓储和重复关系字段。物理表删除 MUST 经过依赖清单确认；名称相似但仍服务其他能力的表不得被顺带删除。

#### Scenario: 观察期仍有旧路由调用

- **WHEN** 指标显示受支持客户端仍调用 branch-tree route
- **THEN** 系统保持路由拒绝状态并追踪调用方，不提前删除诊断信息或备份

#### Scenario: 删除旧表前发现外部依赖

- **WHEN** 依赖扫描发现某个 billing/feedback job 仍读取 `branch_generations`
- **THEN** 表删除门禁失败，先迁移该 job 并重新验证

### Requirement: OpenSpec 历史必须如实标记替代关系

依赖 ThreadTree 权威的完成 changes SHALL 作为历史实现记录保留，并在目标 specs 生效顺序中由新链覆盖。未完成的 `persist-thread-chat-generations` MUST 明确标记为被 `migrate-generation-lifecycle` 与本 cutover 替代；系统不得仅为归档而勾选未实现任务或把旧机制继续发布为当前契约。

#### Scenario: 处理未完成旧 Generation change

- **WHEN** cutover 准备归档 OpenSpec 记录
- **THEN** 文档保留其真实未完成项和 superseded 原因，并使新的 lifecycle spec 成为目标权威

