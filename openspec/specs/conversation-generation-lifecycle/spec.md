## Purpose

让每次 AI Generation 都绑定规范 Thread/Turn/Message，并以可恢复、可停止、可审计和可正确计费的服务端生命周期保存完整或部分结果。

## Requirements

### Requirement: Generation 使用规范实体身份

系统 SHALL 为每次 AI 尝试创建稳定 Generation ID，并使其同时引用同一 Conversation 中的 Thread、Turn、输入 Message 和输出 Message。Generation SHALL 保存请求意图、尝试序号和幂等键；跨 Conversation、跨 Thread、跨 Turn 或角色不匹配的引用 MUST 被拒绝。

#### Scenario: 为重新生成创建同 Turn 新变体

- **WHEN** 用户对既有 Turn 请求重新生成助手回答
- **THEN** 系统创建新的助手 Message 与 Generation，二者属于原 Turn，且不会复用或覆盖旧助手 Message 的身份

#### Scenario: 拒绝跨 Thread 输出 Message

- **WHEN** Generation 尝试把另一条 Thread 的 Message 设为输出
- **THEN** 系统拒绝开始该 Generation，且不调用付费模型

### Requirement: 在付费执行前幂等开始 Generation

系统 SHALL 在任何付费模型调用前，通过单个事务验证相关聚合或实体的预期 revision、追加或确认目标 Message、创建 Generation 并提交幂等键。重复提交相同幂等键和等价载荷 SHALL 返回同一 Generation；相同键但不同载荷 MUST 被拒绝。

#### Scenario: 开始成功后调用模型

- **WHEN** 开始事务提交成功
- **THEN** 执行器可以调用模型，且查询方已能读取状态为 `running` 的 Generation

#### Scenario: 开始事务失败

- **WHEN** 归属、版本或约束验证导致开始事务回滚
- **THEN** 系统不调用模型、不产生扣费，也不留下孤立 Message 或 Generation

#### Scenario: 重放相同开始命令

- **WHEN** 客户端因超时重放相同幂等键和载荷
- **THEN** 系统返回已有 Generation，不创建第二次模型执行

### Requirement: Generation 由服务端持续执行

Generation 开始后 SHALL 由服务端拥有流消费、心跳和终结责任。浏览器断线、页面卸载或单个响应流关闭不得自动中止模型执行；只有持久化 Stop 请求、执行错误、租约收敛或正常完成可以改变执行结果。

#### Scenario: 浏览器在流式响应中断线

- **WHEN** 响应消费者断开但服务端执行仍健康
- **THEN** 服务端继续消费模型流、更新心跳和 checkpoint，直至合法终态

#### Scenario: 新页面查询进行中任务

- **WHEN** 用户刷新后查询仍为 `running` 或 `stop_requested` 的 Generation
- **THEN** 系统返回最新服务端 checkpoint 和状态，而不是要求原浏览器恢复执行所有权

### Requirement: 持久化有版本的部分 checkpoint

系统 SHALL 以单调版本保存正文、Artifact 引用、研究计划、联网活动、来源和内容状态的服务端 checkpoint。checkpoint 更新 MUST 只接受更新版本，且不得把已持久化的非空内容替换为较旧或缺失的投影。

#### Scenario: 保存流式部分结果

- **WHEN** 执行器获得新的正文片段、Artifact 或研究活动状态
- **THEN** 系统以更高 checkpoint 版本保存规范结构，并使后续查询可恢复相同部分结果

#### Scenario: 拒绝旧 checkpoint 回写

- **WHEN** 延迟任务提交低于当前版本的 checkpoint
- **THEN** 系统忽略或拒绝该写入，保留较新的 Message 内容

#### Scenario: 保留未完成联网活动

- **WHEN** Stop 或失败发生时某项搜索或深读仍处于输入/执行阶段
- **THEN** checkpoint 保留该活动为 `running` 或明确中止状态，不得无条件投影为 `complete`

### Requirement: 分离 Generation 终态与 Message 内容状态

Generation SHALL 使用 `completed`、`stopped`、`failed` 或 `superseded` 表达执行终态；Message SHALL 独立使用 `complete`、`incomplete` 或 `failed` 表达内容可用性。有可恢复正文、Artifact 或研究结果的 Stop/失败 MUST 保留内容并标记 `incomplete`，不得仅因 Generation 未完成而清空或统一标记 Message 为失败。

#### Scenario: Stop 后保留部分回答

- **WHEN** Generation 在已有部分输出后进入 `stopped`
- **THEN** 输出 Message 保留最后 checkpoint、标记为 `incomplete`，Generation 保持 `stopped`

#### Scenario: 无输出执行失败

- **WHEN** Generation 在没有任何可恢复输出时失败
- **THEN** Generation 标记为 `failed`，输出 Message 可以标记为 `failed` 并保存稳定错误分类

### Requirement: Stop 使用持久化请求和幂等状态转换

Stop SHALL 先以事务方式记录 `stop_requested`，再通过进程内控制器加速取消；数据库状态是跨实例的持久化事实源。重复 Stop SHALL 幂等返回当前状态；已终结 Generation 不得被改写为另一终态。

#### Scenario: 停止运行中的 Generation

- **WHEN** 所有者对 `running` Generation 发出 Stop
- **THEN** 系统持久化 `stop_requested`，执行实例观察后停止消费，并以最后 checkpoint 终结为 `stopped`

#### Scenario: 重复停止已终结 Generation

- **WHEN** 所有者再次停止 `completed`、`stopped`、`failed` 或 `superseded` Generation
- **THEN** 系统返回其现有终态且不修改结果、checkpoint 或计费记录

### Requirement: 僵尸任务按最后 checkpoint 收敛

系统 SHALL 依据租约和心跳识别失联的非终态 Generation，并以最后一个服务端 checkpoint 收敛为失败或停止结果。收敛过程 MUST 使用版本/租约条件写入，不得覆盖已由健康执行器提交的更新，也不得从开始时的空快照重建并覆盖部分内容。

#### Scenario: 服务进程在部分输出后崩溃

- **WHEN** Generation 心跳超时且已有持久化 checkpoint
- **THEN** 收敛器保留该 checkpoint，将 Generation 终结为 `failed`，并将 Message 标记为 `incomplete`

#### Scenario: 健康执行器抢先完成

- **WHEN** 收敛器准备写入时 Generation 已以更新版本进入终态
- **THEN** 条件更新失败，收敛器不得覆盖最终结果

### Requirement: usage 完整度与计费状态保持真实

系统 SHALL 分别保存已知 usage 值、`complete`/`partial`/`unavailable` 完整度和 `pending`/`settled`/`usage_unavailable`/`not_billable` 计费状态。只有完整 usage 才能进入 `settled`；已知部分 step usage 与未知中止 step 同时存在时，系统 MUST 保留已知值并标记 `partial` 和 `usage_unavailable`。

#### Scenario: 正常完成且 usage 完整

- **WHEN** 所有计费 step 都返回 usage 且 Generation 正常终结
- **THEN** 系统以 `complete` 完整度幂等写入唯一 usage 记录，并将计费状态设为 `settled`

#### Scenario: Stop 时只有部分 usage

- **WHEN** 已完成 step 有 usage，但当前被中止 step 无法取得 usage
- **THEN** 系统保存已知 usage、标记完整度为 `partial`，并将计费状态设为 `usage_unavailable`

#### Scenario: 重复终结不重复扣费

- **WHEN** 响应消费、后台收敛或重试并发终结同一 Generation
- **THEN** Generation ID 的唯一约束只允许一次 usage 入账和一次终态提交

### Requirement: 终结事务原子提交规范结果

Generation 终结 SHALL 在单个事务中条件更新 Generation 终态、输出 Message 的最终 checkpoint/内容状态、Turn 当前有效助手变体和计费记录。仅当前且尚未终结的 Generation 可以推进当前变体；已被更新尝试取代的执行 SHALL 终结为 `superseded`，不得覆盖新的 Message 选择。

#### Scenario: 当前 Generation 正常完成

- **WHEN** 当前 Generation 以匹配版本提交完整结果
- **THEN** 一个事务保存终态、完整 Message、Turn 当前助手变体和唯一计费记录

#### Scenario: 旧执行晚到

- **WHEN** 较早 Generation 在同一 Turn 的新尝试成为当前后才返回
- **THEN** 旧执行被标记或保持为 `superseded`，且不得覆盖新变体或重复扣费
