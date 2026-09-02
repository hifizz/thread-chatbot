## Purpose

定义从旧整树持久化到规范化会话内核的一次性切换边界、遗留计费隔离、部署拓扑前提和逐 Gate 放行标准，避免形成长期兼容层。

## ADDED Requirements

### Requirement: 切换时不迁移旧会话数据

正式切换 SHALL 不迁移 `branch_trees` 或 `branch_generations` 中的历史会话，不提供旧数据只读模式，也不进行旧新模型双写。切换后运行时 SHALL 只读取和写入规范化会话模型，旧会话历史按已确认决策不可用。

#### Scenario: 切换后访问旧项目 URL

- **WHEN** 某 URL 只在旧整树存储中存在且规范化 Project 中不存在
- **THEN** 系统按空或不存在的规范化 Project 处理，不回退读取旧 JSON

### Requirement: 遗留计费逻辑与新生成链路隔离

新会话命令、模型调用、终结和持久化链路 SHALL NOT 查询余额、credits 或 billing status，不得调用扣费、成本核算或 usage charging 逻辑，也不得把现有计费模块作为生成成功条件。系统 MAY 保存提供商返回的原始 token usage 作为非计费协议或诊断数据。

#### Scenario: 用户没有旧 credits 记录

- **WHEN** 已认证用户发送合法消息但旧计费系统没有余额或 credits 数据
- **THEN** 生成链路仍按会话和模型规则执行，不产生计费调用

### Requirement: 运行拓扑限制为单实例单进程

本 change 的流会话可靠性契约 SHALL 以一台受控 VPS、一个运行中的 Next.js 服务进程和一个进程内 Session Store 为部署前提。上线配置 SHALL 防止同时运行多个应用副本；若未来需要多实例，系统 SHALL 在扩容前设计新的跨进程协调能力。

#### Scenario: 部署配置请求多个副本

- **WHEN** 发布检查发现 ThreadChat 应用被配置为两个或更多并行进程或副本
- **THEN** 本 change 的上线 Gate 失败且不得宣称流会话可靠性已验收

### Requirement: 按 Gate 验收后推进切换

实施 SHALL 按契约与安全网、规范化后端、流与 API、前端 Store、一次性切换、部署验证的依赖顺序推进。每个 Gate SHALL 有自动化测试或可重复检查证明其出场条件；未通过当前 Gate 时 SHALL NOT 删除其仍需要的旧运行路径或推进生产切换。

#### Scenario: 后端状态机测试未通过

- **WHEN** Stop/完成竞态或 Retry 幂等测试仍失败
- **THEN** 团队不得进入以新 API 为权威的前端切换 Gate

### Requirement: UX 冲突必须先获得决策

实施中若发现除已批准的回复版本切换外，规范化契约与现有 UX/UI 存在无法兼容的严重冲突，系统设计 SHALL 暂停该冲突项的实现并提交用户选择，不得自行改变可见交互。

#### Scenario: 现有控件依赖无法表达的旧数据语义

- **WHEN** 某既有可见控件只能依靠被移除的整树或版本模型工作且没有等价投影
- **THEN** 实施者记录冲突与备选方案，并在用户决策前保留该区域现状
