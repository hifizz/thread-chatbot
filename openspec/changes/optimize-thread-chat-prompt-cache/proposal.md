## Why

本 change 以 `codex/feat-agent-observability-evaluation@2f3024747ddb72e1e69aa916cb45addb7140f6ab` 为基准。该分支已经建立 assistant Message、根 Trace、模型调用、Search provider attempt、反馈 Score/Outbox 与 Agent eval run 的统一身份和观测链路，并新增私有模型中继路由；但 Thread Chat 的最终模型请求仍然以动态 system 字符串、动态工具集合和扁平消息数组拼装，应用无法稳定保护分叉前的共同上下文，也无法解释一次缓存为什么命中或失效。

当前分叉流程把用户选中的 `anchorText` 保存到 Thread，把用户问题单独保存为 B1；生成时又把具体 `anchorText` 拼入最前面的 system prompt。这样两个兄弟分支在进入共同祖先对话之前就已经不同，即使它们继承同一段 A Thread 历史，也无法充分复用这段历史的 Provider Prompt Cache。

项目已经定义 `data-quote`，但现有 payload 只有 `{ text }`，创建分支时并未把它写入 B1，也不能表达多份引用、来源 Thread、来源 Message 和可恢复文本锚点。为了同时解决缓存、消息语义和未来“点击引用跳回来源并高亮”的需要，必须先把引用设计成服务端验证、可持久化、支持多份且与模型输入解耦的消息协议。

需要把 Prompt Cache 设计成一套系统性的输入管理方法，而不是一个 Provider 开关：

1. 哪些内容必须稳定并放在最前面；
2. 哪些内容允许变化但必须放在共同历史之后；
3. 哪些元信息只服务产品功能、永远不应发送给模型；
4. 哪些变化必然形成新的缓存分区，并需要被明确记录。

目标不是承诺所有分叉都必然命中，而是让满足条件的分叉发送确定性、可测量的共同前缀，并让冷启动、TTL、模型/路由、工具、Prompt 版本和数据保留策略等原因都能被现有观测与评测系统解释。

## What Changes

- 新增版本化的多引用消息协议。一个用户 Message 可以按顺序包含零到多份 `data-quote` Part；每份引用保存服务端生成的 `quoteId`、引用类型、冻结正文、来源 Project/Thread/Message 和 `TextAnchor`，新写入使用 `thread-quote-v1`，读取兼容历史 `{ text }` payload。
- 引用来源由服务端验证并生成冻结快照。客户端只提交来源 Thread、来源 Message 和锚点选择器；客户端不得直接决定 Project、持久化正文、来源标题或导航状态。
- Thread 的 `forkMessageId`、`forkAnchor`、`anchorText` 和 `forkContext` 继续作为“这个分支从哪里来”的拓扑事实；B1 中的 branch-origin Quote 是“这条用户消息向模型引用了什么”的不可变快照。两者在同一事务内保持一致。
- 直接在分叉弹窗输入问题时，服务端自动把 branch-origin Quote 写入 B1；先创建空分支、稍后第一次发送时也自动写入同一 Quote。普通续聊可以额外携带多份同 Project Message Quote。
- 编辑最新用户消息时默认保留原有 Quote Parts，只替换可编辑文本和附件；Retry 继续复用原 User Message，不复制或重建 Quote。未来允许用户增删引用时另立显式命令，不在普通文本编辑中静默改变来源。
- `messages.parts` JSONB 继续作为 Message Quote 快照的权威存储，不新增 Quote 业务表；`MessageDTO.parts` 保持单一传输入口。第一阶段不提供反向引用查询表，未来只有在跨 Project、反向链接或独立权限需求出现时再评估。
- 新增集中 `quoteTextToModelText()` / Quote Part 转模型文本 helper。模型只收到稳定标签包裹的引用正文；`quoteId`、Project/Thread/Message ID、Anchor、标题、脚注和其他导航信息不得进入模型 Prompt、Prefix Hash 或生产内容遥测。多份 Quote 按 Message Parts 顺序逐份转换。
- 稳定 Agent Kernel 只定义“用户消息含一份或多份引用时如何理解”：引用是上下文数据，不是更高优先级指令；普通文本是当前请求；指代优先解析到引用；多引用按顺序综合。具体引用正文不再进入 system prompt。
- 重构 Thread Chat Prompt Compiler。Provider-visible 请求固定为 Tool Profile、Agent Kernel、可选 Project Contract、冻结祖先历史、已完成分支历史、本轮运行控制和当前用户消息；B1 Quote 与问题位于冻结祖先历史之后。
- 建立缓存稳定性分类和 Manifest，系统性记录 Tool/Profile、Kernel、Project Contract、冻结历史、分支历史、Runtime、当前用户、附件、模型路由和保留策略的变化会保护、局部破坏还是完全分区缓存。
- 将模型解析结果从裸 `LanguageModel` 扩展为包含实际 Adapter、Gateway、上游模型、路由身份、缓存策略、TTL、cache marker、会话亲和与 Usage 支持能力的 `ResolvedChatModel`。
- 对已验证路由采用 Provider 专属策略，优先验证高成本 Claude 路由：Vercel AI Gateway 使用自动缓存能力；OpenRouter 使用稳定且脱敏的 Project/模型级路由亲和，并按模型能力启用 implicit 或 explicit caching；UMAPIS、Private Relay 等代理路径必须分别验证 marker 透传和 Usage。
- 规范化每个模型 Step 的 cache read、cache write、uncached input、实际 Provider/Endpoint 和缓存策略，直接扩展现有 Trace 与 Agent eval result，不新增第二套生成事实源。
- 通过 server-only `off`、`observe`、`enabled` 三态渐进发布。缓存配置、Quote 解析、Hash 或遥测失败不得改变 Agent 正确性、流式生命周期或 Message 终态。
- 前端多引用 Composer、Quote Pill、点击来源导航和高亮交互不在本次后端方案实施范围；本 change 只把 DTO、数据库语义、命令、服务端构造、模型转换和缓存边界定义清楚，为下一阶段前端设计提供稳定合同。

## Capabilities

### New Capabilities

- `thread-chat-message-quotes`: 定义用户 Message 中零到多份 Quote 的版本化 Part 协议、来源验证、数据库与 DTO 语义、分支首问自动注入、编辑/重试保持、模型文本转换、兼容性和未来导航所需元信息。
- `thread-chat-prompt-cache`: 定义缓存友好的 Prompt 顺序、变化元素分类、Provider 能力与路由亲和、缓存 Usage 归一化、观测与评测契约、分级缓存边界和渐进发布行为。

### Modified Capabilities

无。两个新能力复用现有规范化 Thread/Message/Fork 事实源，以及目标基准分支中的 `agent-observability` 与 `agent-evaluation` 实现，不复制或替代这些能力。

## Impact

- 消息协议：影响 `lib/thread-chat/contracts/ui-message.ts`，新增 Quote V1 类型、兼容解析器和多 Quote Parts 约束；现有 `MessageDTO.parts` 不增加第二个 Quotes 字段。
- 命令与应用层：影响 `contracts/commands.ts`、`command-utils.ts`、`fork-thread.ts`、`send-message.ts` 和 `edit-turn.ts`。`SendMessageCommand` 增加可选 Quote Selection，Fork first turn 增加可选额外引用，服务端负责 branch-origin Quote；旧客户端不传 Quotes 时仍兼容。
- 数据库：`threads` 的 Fork 字段和 `messages.parts` JSONB 结构继续使用；基准分支新增的 `feedback_score_outbox` 与本能力正交。第一阶段不迁移表、不增加 Quote 表。Quote V1 形状通过 TypeScript/Zod 和应用事务校验；未来反向引用索引另立 change。
- Prompt 编译：主要影响 `lib/chat/thread-chat-prompt.ts`、`compile-model-context.ts`、`serialize-message-for-model.ts` 和 `generation-plan.ts`。删除具体 Anchor 的 system 拼装，新增 Quote-to-model serializer、版本化 Prompt Segment、Manifest 和两阶段编译。
- 模型路由：主要影响 `lib/ai/provider.ts`、OpenRouter/UMAPIS/Private Relay/Ark/MiniMax adapter 和 Vercel/Cloudflare Gateway 调用边界；所有未经验证的 compatible endpoint 继续安全回退为无显式缓存控制。
- 工具：影响 `generation-tools.ts` 和 step policy；工具行为与权限不扩大，只把动态组合收敛为少量稳定 Profile。
- 可观测性与评测：扩展现有 Trace、Model Attempt、eval case/result/fingerprint/scorer；生产默认只记录版本、Hash、数量、Token 和枚举，不记录 Quote 正文或来源 ID。
- 兼容性：历史 `{ text }` Quote 可继续读取和送模；历史 ForkedThread 缺少 B1 Quote 时，Prompt Compiler 根据 Thread Fork 字段确定性生成仅用于模型的兼容 Quote，不要求立即回填数据库。
- 前端：本 change 不实现新的 Composer 或导航 UI，只提供下一阶段可以直接消费的重复 `data-quote` Parts、来源元信息和稳定 DTO。