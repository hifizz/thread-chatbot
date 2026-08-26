## Purpose

定义 ThreadChat 面向客户端的查询与命令边界，使所有会话变更都经过认证、所有权校验、结构校验、幂等处理和数据库原子提交。

## ADDED Requirements

### Requirement: 所有会话 API 执行认证和所有权校验

所有 Project、Thread、Message、Artifact 和流订阅 API SHALL 要求已认证用户，并在读取或写入前通过 Project 所有权解析整个资源链。系统 SHALL 对不存在和不属于当前用户的资源返回不泄露其存在性的响应。

#### Scenario: 订阅他人的 Message

- **WHEN** 已认证用户提交另一个用户 Message ID 的流订阅请求
- **THEN** 系统不返回消息、状态、快照或 Session 存在信息

### Requirement: 命令请求使用严格契约

创建项目并首发、发送、Fork、编辑、Retry/Regenerate、Stop、反馈、重命名、归档和删除命令 SHALL 使用版本化且严格校验的请求/响应结构。未知字段、无效 ID、越权引用、空消息和不支持的状态转换 SHALL 在写数据库或调用模型前被拒绝。

#### Scenario: 发送命令包含未知字段

- **WHEN** 客户端提交超出当前 API 契约的字段
- **THEN** 系统返回结构化验证错误且不创建任何 Message

### Requirement: 创建类命令可安全重放

会创建 Project、Thread、Message 或生成任务的命令 SHALL 接受客户端生成的唯一 command ID 和实体 ID。相同用户、相同 command ID 的重放 SHALL 返回第一次提交的结果；若相同 ID 携带不一致语义，系统 SHALL 返回冲突且不得创建额外实体或调用模型。

#### Scenario: 首次发送响应丢失

- **WHEN** 客户端因网络超时重放同一创建项目并首发命令
- **THEN** 系统返回既有 Project、用户 Message 和助手 Message，且模型任务不重复启动

### Requirement: 会话写入原子提交

每个命令 SHALL 在单一事务中提交其相互依赖的记录、顺序号和关系元数据。若任一步失败，系统 SHALL 不留下半个 Project、无配对消息、无来源的 ForkedThread 或已 supersede 但没有替代 Message 的状态。

#### Scenario: Retry 创建新消息失败

- **WHEN** Retry 事务无法创建新的助手 Message
- **THEN** 原 Message 不写入 `superseded_at` 且系统不启动模型任务

### Requirement: API 返回服务端权威投影

查询和命令响应 SHALL 返回足以归并到客户端 Store 的权威 Project、Thread、Message、Artifact 与 generation 状态 DTO。创建生成的命令 SHALL 在数据库提交后立即返回助手 Message ID 与订阅定位信息；流不可用时客户端仍可通过 Message 查询观察终态。

#### Scenario: 生成 Session 在响应后不可用

- **WHEN** 创建 Message 成功但客户端无法建立 SSE
- **THEN** 客户端可以使用响应中的 Message ID 轮询并得到最终数据库结果

### Requirement: 空项目 URL 可在首发时建立

客户端 MAY 在用户发送第一条消息前生成 Project 和根 Thread ID 并导航到对应 URL。查询不存在但格式合法的自有候选 Project ID SHALL 返回空工作区语义；第一条发送命令 SHALL 原子建立 Project、根 Thread、用户 Message 和助手 Message。

#### Scenario: 打开新建聊天 URL

- **WHEN** 用户进入一个尚未持久化的、由客户端为当前会话生成的合法 Project URL
- **THEN** 页面显示既有空工作台，且第一次发送后该 URL 对应的 Project 被持久化
