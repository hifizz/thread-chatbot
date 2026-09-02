## Purpose

定义 ThreadChat 的服务端权威持久化契约，使项目、线程、消息、分支上下文和产物可以独立查询、原子更新并完整恢复 AI SDK UI Message 内容。

## ADDED Requirements

### Requirement: 以规范化记录持久化会话

系统 SHALL 将每个会话工作区持久化为一个 Project、一个根 Thread、零个或多个 ForkedThread、每个 Thread 的有序 Message 记录以及由 Message 产生的 Artifact 记录。系统 SHALL NOT 依赖整棵客户端 JSON 快照作为会话内容的权威源。

#### Scenario: 加载已有项目

- **WHEN** 已认证用户打开一个自己拥有的 Project
- **THEN** 系统从规范化记录返回项目元数据、线程拓扑、各线程消息和关联 Artifact

#### Scenario: 拒绝孤立线程

- **WHEN** 写入的 ForkedThread 不属于其父 Thread 所在的 Project
- **THEN** 系统拒绝写入且不产生部分记录

### Requirement: 持久化完整 UI Message parts

每条 Message 的内容 SHALL 以项目所用 AI SDK v7 或更高版本的 `UIMessage.parts[]` 结构持久化，而不是仅持久化拼接后的文本。系统 SHALL 保存支持的 text、reasoning、source、file、tool 和 data parts 及其协议所需字段，并 SHALL 在读取时返回等价结构。

#### Scenario: 工具调用回复完成

- **WHEN** 助手回复包含文本、工具输入、工具输出和自定义 data part
- **THEN** 完成后的 Message 读取结果包含全部 parts，且顺序与最终 UI Message 一致

#### Scenario: 纯文本回复完成

- **WHEN** 助手回复仅包含一个或多个 text parts
- **THEN** 系统仍以 `parts[]` 保存并返回，而不降级为单一字符串字段

### Requirement: 保证线程内消息顺序唯一且单调

每个 Thread SHALL 维护服务端分配的单调消息序号；同一 Thread 内序号 SHALL 唯一。并发命令 SHALL 通过原子分配得到确定顺序，不得通过读取最大值后在客户端推断下一个序号。

#### Scenario: 并发发送两条消息

- **WHEN** 同一 Thread 同时收到两个合法发送命令
- **THEN** 两组新增 Message 获得互不冲突且可稳定排序的序号

### Requirement: 冻结分支上下文

ForkedThread 创建时 SHALL 持久化来源 Message、选区锚点、父 Thread 以及用于后续模型调用的有序 `fork_context` Message ID 列表。该列表 SHALL 在创建后保持不变，并且其中已被 supersede 的历史 Message SHALL 继续可读。

#### Scenario: 从历史回复分叉后重新生成来源

- **WHEN** 用户先从助手回复 A 创建分支 X，随后在父 Thread 中以回复 B supersede A
- **THEN** X 的 `fork_context` 仍引用 A，且在 X 中继续发送时使用 A 而不是 B

### Requirement: Artifact 保持消息溯源

每个 Artifact SHALL 属于一个 Project 并引用产生它的 source Message。删除一个 Project SHALL 级联删除其 Thread、Message 和 Artifact；对 Message 做 supersede SHALL NOT 删除其 Artifact。

#### Scenario: 查看被取代回复的 Artifact

- **WHEN** 一条产生 Artifact 的 Message 已被 supersede 但仍被现有分支引用
- **THEN** 该 Artifact 仍可通过其 Project 和 source Message 查询

### Requirement: 会话记录满足所有权和引用完整性

Project SHALL 归属于一个已认证用户；Thread、Message 和 Artifact SHALL 只能通过所属 Project 被该用户访问。系统 SHALL 拒绝跨 Project 的父线程、来源消息、替代关系或 Artifact 引用。

#### Scenario: 伪造跨项目来源消息

- **WHEN** 用户尝试以另一个 Project 的 Message 创建 ForkedThread
- **THEN** 系统拒绝命令且两个 Project 都不发生改变
