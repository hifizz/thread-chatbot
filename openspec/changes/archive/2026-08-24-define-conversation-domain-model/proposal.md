## Why

当前 `Thread Tree / MainThread / ForkedThread` 术语把产品概念绑定到整树 JSON 和当前界面拓扑，也缺少 Project 与单列 Thread 之间的 Conversation 聚合边界。Issue #34 已要求规范化 Thread Chat；在继续设计数据库、命令接口和前端状态存储前，必须先建立唯一、稳定的领域语言与目标实体关系，否则后续变更会继续用同一个词描述不同事物。

## What Changes

- **破坏性变更**：以 `Conversation` 取代 `Thread Tree` 作为完整可分叉对话的领域名称；旧名称只允许出现在迁移说明、遗留适配器或具体树形投影中。
- **破坏性变更**：统一采用 `Project → Conversation → Thread`。每一列对话都是 Thread；Main Thread 与 Branch Thread 只是由关系推导的角色，不是两套实体，也不持久化 `kind` 或魔法 `id = "main"`。
- 将 Fork 明确定义为服务端动作，并将 `ThreadFork` 定义为上游 Thread、来源 Message 与下游 Thread 之间的唯一来源关系；`children[]`、`Message.forks[]` 只能是派生索引。
- 引入显式 `Turn` 作为用户编辑、助手重新生成和回复变体的归属边界；`Message` 与 `Generation` 必须具有稳定身份并严格属于同一 Thread/Turn。
- 明确当前有效变体会决定后续提示词与 Fork 来源，因此是持久化领域选择；列、折叠、画布和面板等仍属于界面工作区状态。
- 定义 Workspace、Project、Conversation、Thread、ThreadFork、Turn、Message、Generation、File、MemoryItem 与 ProjectInstruction 的规范术语、生命周期边界和依赖关系。
- 明确领域层、应用层、持久化层、接口与传输层、客户端状态层和界面组件层的模块职责，禁止 React、HTTP 或 Drizzle 规则渗入纯领域层。
- 建立从当前 `ThreadTreeState`、`branch_trees`、`branch_generations` 到目标模型的迁移地图，并把后续落地拆为规范化持久化、Generation 生命周期、命令接口、前端规范化状态存储、切换清理等独立变更。
- 分支结论回流与收敛机制保持在 Issue #39，Project Memory、File、Instruction 的完整产品能力分别后续提案，均不扩大本变更的实现范围。

## Capabilities

### New Capabilities

- 无。本变更先修正已有 `domain` 能力规范，避免在统一术语前复制出第二套领域规范。

### Modified Capabilities

- `domain`：用 Project、Conversation、Thread、ThreadFork、Turn、Message 与 Generation 的统一语言替换 Thread Tree 模型，并补充角色推导、身份归属、当前有效变体、Project 资产边界和模块依赖要求。

## Impact

- 规范与文档：`openspec/specs/domain/spec.md`、所有仍把 `Thread Tree` 当作产品实体的活跃变更、架构说明和术语引用。
- 领域代码：`lib/thread-chat/domain/` 中的类型、消息图、重新生成、选择器与遗留 `ThreadTreeState` 边界。
- 服务端：后续将影响 `branch_trees`、`branch_generations`、Artifact、Feedback、Title 的归属、仓储和事务命令；本变更只建立目标契约与迁移边界，不执行数据库切换。
- 前端：后续将影响整树状态存储、列与画布选择器、Message 操作与界面工作区状态；本变更不重写现有渲染、流式界面或编辑器。
- 依赖：后续变更必须依次引用本变更的术语与架构决策记录；Issue #39 在基础模型稳定后再继续设计。
