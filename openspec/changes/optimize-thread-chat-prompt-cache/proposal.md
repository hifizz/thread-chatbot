## Why

本 change 以 `codex/feat-agent-observability-evaluation@2f3024747ddb72e1e69aa916cb45addb7140f6ab` 为基准。

Thread Chat 已经具备规范化 Project / Thread / Message、冻结 `forkContext`、`TextAnchor`、后台生成、Trace、模型调用观测与 Agent Eval，但当前仍存在两组相互关联的问题：

1. **分叉引用破坏共同缓存。** 具体 `anchorText` 被拼进前置 System Prompt，出现在冻结祖先历史之前；兄弟分支因此过早产生不同前缀，无法充分复用共同对话。
2. **同一 Thread 内的引用入口尚未统一。** 划选后直接提问开分支、划选后先开空分支、把当前 Thread 的选区放回当前输入框，以及当前 Thread Markdown Artifact 的批量批注，本质都是“先形成 Quote Draft，再一次性形成一条用户 Message”。

本期明确不支持任意跨 Thread、跨分栏或 `@Thread` 引用。唯一会从另一个 Thread 带入引用的场景，是 Fork 自身的父 Thread 来源；该 `branch-origin` Quote 由服务端根据 Fork 字段自动生成，不构成通用跨 Thread 引用能力。

Claude 等高输入单价模型会放大重复上下文成本。缓存优化必须从输入顺序、Quote 协议、工具定义、模型线路、缓存时长、真实成本、观测与评测一起设计，而不是只增加一个 Provider 参数。

## What Changes

- 建立统一的 **Quote Draft → Message Parts → Prompt Compiler** 流程。引用在发送前只是 Composer Draft，不创建 Message、不调用模型；发送后按顺序持久化为零到多份 `data-quote` Part。
- 每条用户 Message 最多支持 **50 份 Quote**。50 是产品数量上限，不代表可无限发送长文本；正式模型调用前仍执行模型线路相关的输入预算检查。
- 普通 Quote 只允许来自目标 Composer 所属的当前 Thread：
  - 当前 Thread 内 `completed` assistant Message 的选区；
  - 当前 Thread 内由 `completed` assistant Message 产生的 Markdown Artifact 选区。
- `generating`、`stopped`、`failed` assistant Message 一律不可作为新 Quote 来源。
- Fork 的父 Thread 选区只通过服务端自动生成的 `branch-origin` Quote 进入新 Thread 第一轮；客户端不能借此提交其他 Thread 的任意来源。
- 划选后弹窗不输入问题时，只创建新 Thread；不创建 B1/BA1、不调用模型。新 Thread Composer 从 Fork 字段重建必需的 Quote Block。
- 用户可以把当前 Thread 中的选区加入当前 Thread Composer；不创建新 Thread、不自动发送。
- Markdown Artifact 批量批注只能回填到该 Artifact 来源 Message 所属 Thread 的 Composer；多条批注聚合后一次发送，只触发一次 assistant 生成。
- Quote V1 保存服务端生成的 Quote ID、冻结正文、可选批注、来源 Project/Thread/Message/Artifact 与 `TextAnchor`；屏幕坐标、滚动位置、DOM 路径、标题和脚注不作为定位身份。
- `messages.parts` JSONB 继续是 Quote Snapshot 的唯一事实源；`threads` Fork 字段继续是分支拓扑事实。第一阶段不新增 Quote 表、不增加顶层 `MessageDTO.quotes`、不执行数据库迁移。
- 建立唯一、版本化、支持多 Quote 的 Quote-to-model 转换函数。模型只接收引用正文与用户批注，不接收来源 ID、Anchor、标题、脚注、Draft ID 或 Trace 信息。
- 将具体 Quote、当前问题、Research plan 和其他本轮变化内容放在冻结祖先历史及已完成分支历史之后；稳定 Agent Kernel 只定义长期 Quote 行为。
- 系统性分类所有 Prompt 元素：稳定前缀、动态尾部、非模型元信息、主动缓存分区。任何新元素在进入 Prompt 前必须先完成分类。
- 将 Tool Profile、Prompt Compiler、Quote Model Format、模型实际线路和缓存策略版本化，并记录共同前缀 Hash、缓存资格、cache read/write、首 Token 时间和真实成本。
- 缓存与线路选择遵循一个产品目标：**在回答质量、工具行为、安全和终态不变差的前提下，选择经过验证的最低实际总成本方案。** 不要求用户理解或选择 Claude 路线、缓存参数和 TTL。
- Claude 首先验证当前实际可用的 UMAPIS Claude 路线；如不能证明缓存透传、Usage 和成本收益，则保持关闭，并用直接 Anthropic 路线作参考实验。第一阶段使用 Provider 默认短时缓存；1 小时 Extended TTL 默认关闭，只有真实使用数据证明更便宜时才启用。
- 通过 server-only `off / observe / enabled` 渐进发布。缓存参数、观测或 Provider 兼容失败不得改变 Agent 正确性、流式生命周期或 Message 终态。

## Capabilities

### New Capabilities

- `thread-chat-message-quotes`：定义当前 Thread 内多 Quote Message Parts、Fork 自动来源、Markdown 批注、来源验证、持久化、编辑、重试、模型转换和未来导航元信息。
- `thread-chat-quote-composer`：定义分支空 Draft、当前 Thread 引用、当前 Thread Artifact 批量批注、最多 50 个 Quote Block 和一次性发送行为；明确不支持任意跨 Thread 引用。
- `thread-chat-prompt-cache`：定义缓存友好的 Prompt 顺序、稳定性分类、Tool/Model Route 能力、真实成本与质量门禁、Usage 归一化、观测评测和渐进发布。

### Modified Capabilities

无。该 change 通过现有 `messages.parts`、Fork 字段、Trace 和 Agent Eval 扩展，不修改主规格中的领域事实源。

## Impact

- **数据与 DTO**：扩展 `ThreadChatDataParts.quote`、Quote Parser、Quote Selection Command 输入和 Message Parts Builder；`MessageDTO.parts` 继续是唯一传输入口。
- **数据库**：第一阶段沿用 `threads` 与 `messages.parts` JSONB，不新增表和迁移。未来只有出现任意跨 Thread/跨 Project引用、反向链接、独立删除权限或规模化统计时，才单独评估索引表。
- **后端应用服务**：影响 `forkThread`、`sendMessage`、`editLatestTurn`、Quote 来源解析、输入预算预检和模型消息编译。
- **Prompt 与模型路由**：影响 `thread-chat-prompt.ts`、上下文编译、正式生成计划、Tool Profile、`resolveChatModel()` 和各 Provider Adapter。
- **可观测性与评测**：扩展现有 Trace、Model Attempt、Agent Eval 与成本对比，不新增第二套生成身份或会话状态。
- **前端边界**：本 change 只定义 Draft 合同与行为规格，不选定具体 Composer 技术或视觉组件；任意跨 Thread 引用与 `@Thread` 明确留到未来独立 change。
