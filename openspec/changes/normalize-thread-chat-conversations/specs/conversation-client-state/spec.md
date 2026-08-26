## Purpose

定义前端如何以服务端规范化实体为权威状态、归并流与轮询结果，并在不改变既有 ThreadChat 工作台视觉与主要交互的前提下完成切换。

## ADDED Requirements

### Requirement: Store 使用规范化服务端实体

前端 Store SHALL 按 ID 保存 Project、Thread、Message 和 Artifact，并以服务端返回的序号、状态和关系作为会话内容权威。组件所需的列、画布节点、消息列表和 Artifact 视图 SHALL 由这些实体派生；本地缓存不得覆盖服务器会话内容。

#### Scenario: 同一 Message 经流与轮询到达

- **WHEN** Store 先收到某 Message 的流快照，随后收到该 Message 的数据库终态
- **THEN** Store 按 ID 归并为一条 Message，并以终态完整 `parts[]` 收敛

### Requirement: 实时更新保持 parts 协议语义

客户端 SHALL 使用 AI SDK v7 或更高版本 UI Message 协议归并快照和 chunks，并 SHALL 将 text、reasoning、source、file、tool 与 data parts 投影给现有消息和 Artifact UI。客户端 SHALL NOT 通过仅拼接正文构造权威 Message。

#### Scenario: 同一 text part 多次增量

- **WHEN** 客户端收到具有同一 part 标识的多个 text delta
- **THEN** Store 按协议更新同一个 text part，而不是创建重复消息或丢弃结构化 parts

### Requirement: 断流后切换为终态轮询

活跃 SSE 断开时，Store SHALL 保留最后快照并把该 Message 标记为后台生成；它 SHALL 停止自动重连流并轮询权威 Message，直到收到终态或项目不可访问。页面刷新恢复到 `generating` Message 时 SHALL 直接采用相同行为。

#### Scenario: 工具结果出现前断流

- **WHEN** 客户端已显示工具输入后 SSE 断开，而服务端随后完成工具结果
- **THEN** 客户端保留工具输入和生成指示，轮询终态后显示完整工具结果

### Requirement: 保持现有工作台 UX/UI

除回复版本选择能力外，改造后的页面 SHALL 保持当前列视图、画布视图、消息操作入口、Composer、模型选择、Artifact 抽屉、标题和分叉交互的可见布局、样式和用户流程。任何因技术契约无法保持的冲突 SHALL 在实现前提交用户决策。

#### Scenario: 切换列视图与画布视图

- **WHEN** 用户在改造后的项目中切换既有工作台视图
- **THEN** 两种视图的控件、布局和交互结果与切换前一致

### Requirement: 移除回复版本切换状态

客户端 SHALL NOT 展示回复 variant picker、版本计数、上一版/下一版控件或把同一 Message 表示为多个生成版本。Retry/Regenerate 返回的新 Message SHALL 作为新的时间线消息显示；由旧 Message 派生的分支仍可从树和画布访问。

#### Scenario: 重新生成已完成回复

- **WHEN** 新助手 Message 完成并 supersede 旧回复
- **THEN** 当前时间线显示新回复且不显示版本切换器，旧回复派生分支仍保持可打开

### Requirement: 工作区布局继续本地持久化

不属于会话业务数据的工作区偏好 SHALL 继续按 Project 在浏览器本地持久化，包括当前视图、画布位置、面板尺寸和折叠状态。清除或缺失本地偏好 SHALL NOT 删除或改变服务器 Project、Thread、Message 或 Artifact。

#### Scenario: 在另一浏览器打开项目

- **WHEN** 用户在没有本地工作区偏好的浏览器打开已有 Project
- **THEN** 系统加载完整会话数据并使用默认布局，而不是把服务器内容视为空

### Requirement: 命令可乐观呈现并权威回滚

为保持既有响应速度，前端 MAY 使用客户端生成的实体 ID 乐观展示新 Thread 或 Message；成功响应 SHALL 用服务器 DTO 校正序号和元数据，失败响应 SHALL 仅回滚该命令产生的临时实体并展示既有错误反馈。

#### Scenario: 乐观 Fork 被服务端拒绝

- **WHEN** 客户端立即显示新列但 Fork 命令因来源 Message 无效而失败
- **THEN** Store 移除该临时列，原项目和其他列保持不变
