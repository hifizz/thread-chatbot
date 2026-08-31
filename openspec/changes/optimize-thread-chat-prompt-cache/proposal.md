## Why

本 change 以 `codex/feat-agent-observability-evaluation@2f3024747ddb72e1e69aa916cb45addb7140f6ab` 为基准。

Thread Chat 已经具备规范化 Project / Thread / Message、冻结 `forkContext`、`TextAnchor`、后台生成、Trace、模型调用观测与 Agent Eval，但当前仍存在两组相互关联的问题：

1. **分叉引用破坏共同缓存。** 具体 `anchorText` 被拼进前置 System Prompt，出现在冻结祖先历史之前；兄弟分支因此过早产生不同前缀，无法充分复用共同对话。
2. **引用入口没有统一成一套草稿与消息协议。** 划选后直接提问、划选后先开空分支、在当前 Thread 中引用、跨分栏引用，以及 Markdown 批量批注，本质都是“先把若干引用放进输入草稿，再一次性形成一条用户 Message”，但当前协议只覆盖单引用和单一创建路径。

Claude 等高输入单价模型会放大以上问题。缓存优化必须从输入结构、引用协议、工具定义、模型线路、缓存时长、观测与评测一起设计，而不是只增加一个 Provider 参数。

## What Changes

- 建立统一的 **Quote Draft → Message Parts → Prompt Compiler** 流程。引用在发送前只是 Composer Draft，不会触发模型调用；发送后按顺序持久化为零到多份 `data-quote` Part。
- 每条用户 Message 最多支持 **50 份 Quote**。数量上限是产品约束；总正文还必须通过模型线路相关的输入预算预检，超出时在付费调用前明确拒绝，不静默截断。
- Quote 来源支持两类：
  - 已完成的 assistant Message 选区；
  - 已完成 assistant Message 所产生的 Markdown Artifact 选区。
- `generating`、`stopped`、`failed` assistant Message 一律不可作为新 Quote 来源。
- Quote V1 保存服务端生成的 Quote ID、冻结正文、可选批注、来源 Project/Thread/Message/Artifact 与 `TextAnchor`；屏幕坐标、滚动位置、DOM 路径、标题和脚注不作为定位身份。
- 同一条 Quote 可带可选 `comment`：
  - 普通引用可以没有 comment，由 Message 的主文本提出问题；
  - Markdown 批量批注使用多份 Quote，每份 Quote 保存自己的 comment，并可附加一段总说明。
- 明确三条统一产品路径：
  1. 划选后弹窗输入问题：直接创建 ForkedThread 与首轮 Message；
  2. 划选后弹窗不输入问题：只创建空 ForkedThread，在新 Thread 的 Composer 中显示 branch-origin Quote Block，不触发模型调用；
  3. 在当前 Thread 中划选或从 Markdown 批量批注：把一份或多份 Quote Block 加入当前 Composer，用户一次性发送。
- Composer Draft 中的 branch-origin Quote 由 Thread Fork 字段确定性重建；客户端不创建或伪造持久化 branch-origin Quote。发送首轮时由服务端自动物化并去重。
- `SendMessageCommand` 接收零到多份 Quote Selection；`ForkThreadCommand.firstTurn` 接收额外 Quote Selection；客户端只提交来源选择、Anchor 与可选 comment，服务端负责授权、冻结正文和生成 Quote ID。
- `messages.parts` JSONB 继续是 Message Quote Snapshot 的唯一事实源；`threads` Fork 字段继续是分支拓扑事实。第一阶段不新增 Quote 表和数据库迁移。
- 建立唯一、版本化的 Quote-to-model 转换：模型只收到 Quote 正文与用户 comment，不收到 Quote ID、来源 ID、TextAnchor、标题、脚注、UI 或 Trace 元信息。
- 重构 Prompt Compiler，把稳定工具、Agent Kernel、Project 固定信息、冻结祖先历史和已完成分支历史放在前面；本轮 Runtime Control、Quote、comment、当前问题和附件放在尾部。
- 建立缓存稳定性分类：稳定前缀、动态尾部、非模型元信息、主动缓存分区。任何新动态内容在进入 Prompt 前必须声明属于哪一类。
- 建立有限且版本化的 Tool Profile，以及包含实际 Adapter、Gateway、上游模型与缓存能力的 `ResolvedChatModel`。
- Claude 首轮验证不再要求用户选择抽象“路线”：以当前代码实际提供 Claude 的 **UMAPIS Claude 路线**为第一条 Probe；若不能证明缓存控制与 Usage 透传，则保持关闭，并用直接 Anthropic 路线作为参考验证。
- 缓存时长采用保守默认：先使用 Provider 默认短时缓存（支持时按约 5 分钟验证），1 小时 Extended TTL 默认关闭，只有成本收益和数据保留审查通过后才单独启用。
- 扩展现有 Trace 与 Agent Eval，记录模型 Step、稳定前缀 Hash、Tool Profile、实际路线、cache read/write、冷启动、部分温缓存、真实命中与成本摊销，不新增第二套生成事实源。
- 通过 `off / observe / enabled` 三态渐进发布；缓存配置或观测失败不得改变回答、权限、流式生命周期和数据库终态。

## Capabilities

### New Capabilities

- `thread-chat-message-quotes`：定义零到多份 Quote Parts、来源类型、服务端授权、Quote Snapshot、批注、编辑/重试、历史兼容与模型转换。
- `thread-chat-quote-composer`：定义统一 Quote Draft、空分支首问、当前 Thread 引用、跨分栏引用和 Markdown 批量批注如何汇入 Composer，并在一次提交中形成用户 Message。
- `thread-chat-prompt-cache`：定义缓存友好的 Prompt 顺序、稳定性分类、Tool/Model 路线、缓存能力、Usage、观测、评测与渐进发布。

### Modified Capabilities

无。该 change 复用现有 `domain`、`agent-observability` 与 `agent-evaluation` 能力，不改变它们的事实源。

## Impact

- **后端合同：** 影响 `commands.ts`、User Message Parts 构造、Fork/Send/Edit 应用服务、Quote parser/resolver 和 Prompt Compiler。
- **数据：** 第一阶段继续使用 `threads` Fork 字段和 `messages.parts` JSONB，不新增表；Quote 来源 ID 暂无数据库 FK，由 owner-scoped 事务、Zod 和运行期 parser 保证。
- **前端合同：** 新增 Composer Draft 与 Quote Block 的领域类型和交互要求，但本 PR 不实现具体组件、视觉样式、拖拽或跳转动画。下一阶段前端调研必须消费本协议，而不是重新定义一套引用结构。
- **模型输入：** 具体 Quote、comment 和当前问题只出现在当前用户消息尾部；来源元信息完全不送模。
- **缓存：** 重点保护兄弟分支的冻结祖先前缀和同分支的已完成历史；Quote 数量增加只扩大当前动态尾部，不应破坏它之前的缓存。
- **Provider：** 当前 Claude 先验证 UMAPIS；Private Relay、Ark、MiniMax、Cloudflare compatible 和其他代理均保持 `probe-required`，不能因为协议兼容就假设缓存兼容。
- **成本：** 每条消息最多 50 个 Quote，但必须再经过模型线路相关的 Token 预算预检；系统不得为了支持 50 个块而无上限发送全文。
