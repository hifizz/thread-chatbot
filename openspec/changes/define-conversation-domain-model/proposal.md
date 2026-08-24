## Why

Issue #34 的目标模型经过多轮讨论后已经收敛：当前 MVP 不需要同时维护 Thread 分支、Message 变体、Turn 选择和 Generation 领域实体四套关系。继续沿用此前的 `ThreadFork + Turn + Message Variant + Generation` 方案会把重新生成、编辑、提示词构造、客户端状态和数据库约束都建立在不必要的复杂度上，也会偏离“每一列就是一条严格线性 Thread”的产品心智模型。

在设计 API、前端 Zustand Store、Hooks 和迁移实现之前，需要先用一份独立于现有代码的 OpenSpec 固化最终领域语言、实体关系、数据库目标结构和模块边界。后续服务端实现、集成测试、API 测试与前端接入都必须以这份模型为唯一基础。

## What Changes

- **BREAKING**：将 Chat Domain 收敛为 `Project → Conversation → Thread → Message[]`；Thread 内 Message 永远严格线性，不再引入 Turn、Message DAG、Message Variant 或 `activeGenerationId`。
- **BREAKING**：Edit 和 Regenerate 改为破坏式操作。只有当前 Thread 最后一条 user Message 可以 Edit，只有最后一条 assistant Message 可以 Regenerate；需要保留另一条历史时必须创建新 Thread。
- **BREAKING**：不再把 ThreadFork 建模为独立实体。Fork 是服务端领域命令，唯一入向来源直接保存在 Child Thread 的 `parentThreadId`、`sourceMessageId`、`forkSourceSnapshot` 与 `baseContext` 中。
- 引入不可变 `baseContext` 值对象：服务端在 Fork 事务中冻结 Parent Thread 截至来源 Message 的有效历史，保证 Child Thread 不受 Parent 后续 Edit、Regenerate、追加、归档或来源失效影响。
- 引入 `forkSourceSnapshot` 值对象，独立记录选区、上下文片段和来源内容哈希；来源变化只产生 `outdated/unavailable` 读取状态，不删除或改写 Child Thread。
- 将模型执行生命周期收敛到持久化运行记录 `MessageRun`。它属于执行与计费子域，不是 Chat 内容实体；浏览器断开只取消订阅，不终止后台执行。
- 明确 Workspace 是成员与授权边界，Project 是 Conversation、项目指令、记忆和文件的长期资产边界；Project 资产能力只定义关系与扩展位置，不在本变更实现完整产品功能。
- 明确 Message 内容使用项目版本化协议并与 AI SDK v7 `UIMessage.parts` 兼容，同时禁止 AI SDK、React、Next.js、HTTP 或 Drizzle 类型渗入纯领域层。
- 定义目标 PostgreSQL schema、复合约束、索引、事务边界、读取投影和服务端模块骨架，但不编写迁移、仓储、API、前端 Store、Hooks 或 UI 代码。
- 将后续落地拆为：服务端领域与持久化、应用命令与 API、服务端集成/API 验收、前端 Zustand/Selectors/Hooks、UI 接入与遗留权威退出。
- 幂等命令、离线重放、Message 版本保留、跨 Thread 收敛与多来源合并不进入 MVP；其中通用幂等机制明确留待 V2。

## Capabilities

### New Capabilities

- 无。本变更继续以既有 `domain` 能力作为唯一领域规范入口，避免产生第二套相互竞争的术语规范。

### Modified Capabilities

- `domain`：以 Workspace、Project、Conversation、线性 Thread、Message、MessageRun、BaseContext 和 ForkSourceSnapshot 的简化模型，替换此前的 ThreadFork、Turn、Message Variant 与 Generation 领域模型，并明确 Project 扩展资产、运行子域和模块依赖边界。

## Impact

- OpenSpec：本变更重定义 `define-conversation-domain-model` 的目标模型；仍依赖 Turn、Generation、独立 ThreadFork、revision 或幂等命令的后续活跃变更，在继续实现前必须基于本设计重新审查。
- 后端目标模块：Workspace/Project、Conversation/Thread/Message 领域契约，Fork/Edit/Regenerate/Prompt 规则，MessageRun 执行端口，PostgreSQL schema 与仓储事务。
- 服务端后续验收：数据库约束测试、领域策略测试、事务集成测试、API 契约测试、后台运行与断线恢复测试。
- 前端后续工作：Conversation Bootstrap、规范化 Entity Store、MessageRun Stream 状态、Zustand Store、Selectors、Hooks 与现有 ThreadChat UI 接入；本变更不提前规定实现细节。
- 现有实现：当前 `ThreadTreeState`、整树 JSON、branch generation 协调和客户端生成实体 ID 均不作为目标设计依据；数据迁移和切换策略由后续独立变更处理。
- 外部扩展：稳定的 Workspace、Project、Conversation、Thread 和 Message ID 为未来分享、CLI、MCP 与公开 Token API 保留寻址能力，但本变更不实现这些入口。
