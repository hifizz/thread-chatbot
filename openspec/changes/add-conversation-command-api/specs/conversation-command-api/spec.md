## Purpose

为网页、未来 CLI 与 MCP 提供同一套 Conversation 查询和原子命令契约，使授权、幂等、并发、Fork、Message 变体与 Generation 只能通过服务端应用层改变。

## ADDED Requirements

### Requirement: 通过应用命令改变规范实体

系统 SHALL 只允许应用命令改变 Conversation、Thread、ThreadFork、Turn、Message、Generation 或当前有效变体。传输层 MUST 只负责认证、解析、调用命令和序列化结果，不得自行拼装关系或接受整包 Conversation 快照覆盖规范实体。

#### Scenario: 拒绝整树写入

- **WHEN** 客户端尝试提交全部 Thread、Message 与 Fork 以覆盖一条 Conversation
- **THEN** 新接口不提供该写入能力，并要求调用对应实体或领域动作命令

#### Scenario: 多种适配器调用相同命令

- **WHEN** 网页接口和未来 CLI 对同一 Conversation 执行相同领域动作
- **THEN** 二者调用同一应用命令并获得相同权限、不变量、幂等与冲突语义

### Requirement: 提供 Conversation 生命周期查询和命令

系统 SHALL 提供按 Project 列出和创建 Conversation、按 ID 读取快照，以及重命名、归档、恢复和删除 Conversation 的查询或命令。创建 SHALL 在一个事务中创建 Conversation 与根 Thread；删除 SHALL 遵守运行中 Generation 和归属资产保护规则。

#### Scenario: 创建 Conversation 与根 Thread

- **WHEN** 有权限成员在 Project 中创建 Conversation
- **THEN** 系统原子创建 Conversation 和唯一根 Thread，并返回二者的规范增量与初始版本

#### Scenario: 归档后从默认列表隐藏

- **WHEN** 用户归档 Conversation
- **THEN** Conversation 保持可按 ID 恢复和审计，但默认活跃列表不再返回它

#### Scenario: 运行中任务阻止删除

- **WHEN** Conversation 仍有非终态 Generation 且用户请求删除
- **THEN** 系统返回稳定状态冲突且不删除任何实体

### Requirement: 提供 Thread 生命周期命令

系统 SHALL 提供 Thread 重命名、归档和恢复命令。归档 Thread 不得删除 Message、Generation 或 ThreadFork，也不得改变其他 Thread 的身份；若归档会使当前界面路径不可见，服务端仍 SHALL 保留规范关系，由客户端选择其他可见 Thread。根 Thread 不得脱离 Conversation 单独归档；调用方必须改用 Conversation 归档命令。

#### Scenario: 归档非根 Thread

- **WHEN** 用户归档一个没有非终态 Generation 的分支 Thread
- **THEN** 系统更新该 Thread 生命周期与 revision，保留其 Fork 来源、后代和历史内容

#### Scenario: 运行中任务阻止 Thread 归档

- **WHEN** Thread 中仍有非终态 Generation
- **THEN** 系统返回稳定状态冲突，Thread 保持活跃

#### Scenario: 单独归档根 Thread

- **WHEN** 用户直接请求归档 Conversation 的根 Thread
- **THEN** 系统返回稳定 `conversation_action_required` 结果，并保持 Conversation 与根 Thread 活跃

### Requirement: 原子执行 forkThread

`forkThread` 命令 SHALL 验证来源 Message 属于上游 Thread，随后在单个事务中创建下游 Thread、唯一 ThreadFork、继承上下文边界、必要版本更新和事务事件箱事件。命令不得复制上游 Message 作为新的规范 Message，也不得要求客户端随后补写 parent、children 或反向 Fork 列表。

#### Scenario: 从任意 Thread 的确定 Message Fork

- **WHEN** 用户以有效上游 Thread、来源 Message、预期 Conversation revision 和幂等键执行 `forkThread`
- **THEN** 系统返回新 Thread、ThreadFork 和版本增量，下游上下文在来源 Message 处截止

#### Scenario: Fork 事务中途失败

- **WHEN** 来源错配、版本冲突或约束使事务失败
- **THEN** 系统不留下孤立 Thread、半条 ThreadFork 或事件箱事件

### Requirement: 原子执行发送与 Generation 开始

发送命令 SHALL 在目标 Thread 中原子创建 Turn、用户 Message、待生成助手 Message 和 Generation，并在事务提交后才开始模型执行。命令 SHALL 使用 Thread revision 保护追加顺序；同一幂等键不得创建重复 Turn 或重复付费执行。

#### Scenario: 在 Thread 尾部发送消息

- **WHEN** 用户以当前 Thread revision 发送有效输入
- **THEN** 系统提交新的 Turn、两条 Message 和 Generation，返回规范增量，然后启动服务端执行

#### Scenario: 并发发送使用旧 revision

- **WHEN** 另一个命令已经推进 Thread，而客户端仍以旧 revision 发送
- **THEN** 系统返回版本冲突和最新可读 revision，不创建第二个不确定顺序的 Turn

### Requirement: 编辑与重新生成追加 Message 变体

编辑当前 Turn 的用户输入和重新生成助手回答 SHALL 在同一 Thread/Turn 中追加新 Message 变体与新 Generation，不得原地覆盖旧 Message。编辑历史位置若已有后续 Turn MUST 被拒绝或要求显式 Fork，不能静默重写后续上下文。

#### Scenario: 重新生成当前助手回答

- **WHEN** 用户对 Turn 的当前助手 Message 执行重新生成
- **THEN** 系统追加新的助手 Message 和 Generation，并在合法终结后按版本更新当前助手变体

#### Scenario: 编辑有后续内容的历史 Turn

- **WHEN** 用户尝试直接编辑并续跑一个已有后续 Turn 的历史输入
- **THEN** 系统返回稳定 `fork_required` 结果，且不修改当前 Thread 历史

### Requirement: 持久化选择当前有效变体

选择变体命令 SHALL 只允许把同一 Thread/Turn、角色匹配且内容可用的 Message 设为当前有效用户或助手变体。命令 MUST 使用 Turn revision，原子更新选择并返回受影响 Turn 增量。

#### Scenario: 切换助手变体

- **WHEN** 用户以当前 Turn revision 选择同 Turn 的另一条可用助手 Message
- **THEN** 系统持久化新选择，推进 Turn revision，后续上下文使用该变体

#### Scenario: 拒绝跨 Turn 选择

- **WHEN** 命令尝试选择另一 Turn 或 Thread 的 Message
- **THEN** 系统拒绝命令且不改变当前选择

### Requirement: 提供 Generation 查询和 Stop 命令

系统 SHALL 按稳定 Generation ID 提供状态、最新 checkpoint、usage 完整度和计费状态查询，并提供幂等 Stop 命令。Stop 运行中任务 SHALL 返回已接受或当前状态；Stop 已终结任务 SHALL 返回现有终态，不得虚构版本冲突。

#### Scenario: 查询进行中 Generation

- **WHEN** 所有者查询 `running` 或 `stop_requested` Generation
- **THEN** 系统返回当前状态、最新 checkpoint 版本、内容状态与可用轮询提示

#### Scenario: Stop 已完成 Generation

- **WHEN** 所有者对 `completed` Generation 发出 Stop
- **THEN** 系统幂等返回 `completed` 结果，不返回无定义的冲突也不修改计费

### Requirement: 统一身份认证和资源授权

每个查询和命令 SHALL 先解析认证主体，再通过 Workspace/Project 成员关系检查目标资源。未认证请求 MUST 返回稳定未认证结果；不存在或调用方不可见的目标 MUST 使用不可枚举的未找到结果。客户端提交的 owner、workspace 或 project 字段不得覆盖服务端解析的归属。

#### Scenario: 伪造 owner 字段

- **WHEN** 已认证用户在载荷中提交另一个 owner ID
- **THEN** 系统忽略或拒绝该字段，并仅使用认证主体和成员关系解析权限

#### Scenario: 访问他人不可见 Message

- **WHEN** 用户按 ID 查询无权访问的 Message 或其 Generation
- **THEN** 系统返回与资源不存在相同的未找到结果，不泄漏资源是否存在

### Requirement: 命令具有统一幂等和版本语义

每个有副作用命令 SHALL 携带稳定幂等键；会修改既有聚合的命令 SHALL 携带相应 Conversation、Thread 或 Turn 的预期 revision。相同主体、作用域、幂等键和等价载荷 SHALL 返回原结果；同键不同载荷 MUST 返回幂等冲突；版本冲突 MUST 返回最新 revision 与可重试信息。

#### Scenario: 网络超时后重放命令

- **WHEN** 客户端未收到响应并以相同幂等键重放等价命令
- **THEN** 系统返回第一次提交的结果，不重复写实体、事件或付费任务

#### Scenario: 重用幂等键提交不同载荷

- **WHEN** 客户端用已提交的幂等键发送不同命令载荷
- **THEN** 系统返回稳定幂等冲突且不执行新载荷

### Requirement: 返回规范快照和实体增量

首次读取 Conversation SHALL 返回带 schema/version 的规范快照；成功命令 SHALL 返回命令结果、最新作用域 revision 和仅受影响的规范实体增量。派生 children、深度、Fork 数量和可见路径可以出现在读取投影中，但 MUST 标记为可重建，不得作为后续写命令输入。

#### Scenario: 首次加载 Conversation

- **WHEN** 客户端读取一条可见 Conversation
- **THEN** 系统返回稳定排序的 Conversation、Threads、ThreadForks、Turns、Messages、相关 Generation 摘要和当前有效选择

#### Scenario: Fork 命令只返回受影响实体

- **WHEN** `forkThread` 成功
- **THEN** 响应包含新 Thread、ThreadFork、更新的 Conversation revision 和必要投影失效信息，而不是回传可写整树

### Requirement: 使用稳定错误分类映射传输结果

应用层 SHALL 返回与 HTTP 无关的稳定结果分类，传输适配器 SHALL 一致映射为状态码和机器可读错误代码。只有真实预期版本冲突、幂等冲突或当前状态冲突可以映射为 `409`；格式错误、未认证、不可见、语义验证和服务器错误 MUST 分别映射，不得用自由文本区分。

#### Scenario: Stop 不存在冲突条件

- **WHEN** Stop 命令命中已终结 Generation
- **THEN** 应用层返回幂等成功结果，传输层不得为了列出状态码而返回 `409`

#### Scenario: Fork 使用旧 Conversation revision

- **WHEN** `forkThread` 的预期 revision 已过期
- **THEN** 应用层返回 `version_conflict`，HTTP 适配器映射为 `409` 并附最新 revision
