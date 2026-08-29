## Why

本 change 以 `codex/feat-agent-observability-evaluation@30a540a315841f78a816adc761fb6bde37fedf7a` 为基准。该分支已经建立 assistant Message、根 Trace、模型调用、Search provider attempt、反馈 Score 与 Agent eval run 的统一身份和观测链路，但 Thread Chat 的最终模型请求仍然以扁平字符串和扁平消息数组拼装，应用无法声明哪些内容是稳定共享前缀、哪些内容只属于当前分支或当前运行，也无法根据真实 Provider 路由选择缓存策略或解释缓存未命中。

当前 `anchorText`、Artifact 指令、Research mode 和 Research plan 会参与前置 system prompt 拼装，工具集合也会随请求动态变化。这些变化可能在冻结祖先对话之前就让请求前缀分歧，使兄弟分支无法充分复用共同上下文。与此同时，`resolveChatModel()` 只返回裸 `LanguageModel`，调用层不知道请求最终经过 Vercel AI Gateway、OpenRouter、UMAPIS、Cloudflare compatible endpoint、Ark 还是直连 Provider，因此不能安全地统一发送 cache marker、会话亲和键或 Gateway 缓存选项。

需要先把 Prompt Cache 设计成一个可验证的 Prompt 编译契约，再启用 Provider 缓存能力。目标不是承诺所有分叉都必然命中，而是让所有满足条件的分叉发送确定性、可测量的共同前缀，并让冷启动、前缀变化、TTL、模型/路由变化、工具配置变化和 Provider 不支持等原因都能被现有观测与评测系统解释。

## What Changes

- 建立版本化的 Thread Chat Prompt Compiler，将最终请求拆分为稳定 Agent Kernel、可选 Project Contract、冻结祖先上下文、分支 Genesis Context、分支内历史和本轮动态上下文，并生成只含 Hash、版本和长度摘要的 Prompt Manifest。
- 将 `anchorText`、Research plan、运行期记忆/引用以及其他分支或本轮动态数据移出共同历史之前的 system 前缀；稳定 System Kernel 只描述长期角色、上下文语义和工具规则。
- 将上下文编译改为两阶段：先编译可复用的基础段和当前用户消息，再完成 Research route/plan，最后把运行期控制上下文放到历史尾部并构造模型请求。
- 建立有限、版本化且顺序稳定的 Tool Profile，避免同一能力集合因对象构造顺序或请求分支造成无意义的工具 Schema 前缀变化；不同安全/能力面仍允许形成明确的缓存分区。
- 将模型解析结果从裸 `LanguageModel` 扩展为包含实际 Adapter、Gateway、上游模型、路由身份、缓存策略、TTL、cache marker、会话亲和与 Usage 支持能力的 `ResolvedChatModel`。
- 对已验证的路由采用 Provider 专属策略：Vercel AI Gateway 使用自动缓存选项；OpenRouter 使用稳定且脱敏的 Project/模型级会话亲和键，并按模型能力应用 implicit 或 explicit caching；Anthropic-compatible 路径按支持情况设置确定性 breakpoint；未知 compatible endpoint 默认不发送未经验证的字段。
- 规范化每个模型 Step 的 cache read、cache write、uncached input、总输入、实际 Provider/Endpoint 和缓存策略，保留原始 provider usage，不把缺失值伪装为 0。
- 扩展现有 Trace 与 Agent eval result，而不是新建另一套日志：记录 Prompt/Tool/Route Hash、缓存资格、模型 attempt 和缓存摘要；生产环境仍默认不记录 Prompt 正文。
- 增加兄弟分支、同分支续聊、冷启动、TTL、模型切换、Tool Profile 切换、Research mode 切换和 Provider fallback 的确定性测试及可选 live provider 评测。
- 通过 server-only `off`、`observe`、`enabled` 发布模式先建立基线和影子 Manifest，再逐路由启用实际缓存控制；缓存配置或观测失败不得改变 Agent 正确性、流式生命周期或 Message 终态。
- 定义第二级 Compiled Segment Cache 接口和内容寻址键，但只有在观测证明数据库读取或编译 CPU 成为瓶颈后才启用有界进程缓存或可信分布式缓存；Provider KV Cache 是首阶段重点。
- 明确不使用 Exact Response Cache 代替模型生成，不新增 generation 业务实体，不把 Langfuse、Gateway 或缓存层变成会话事实源。

## Capabilities

### New Capabilities

- `thread-chat-prompt-cache`: 定义缓存友好的 Prompt 分段与顺序、Provider 能力与路由亲和、缓存 Usage 归一化、观测与评测契约、分级缓存边界、隐私要求和渐进发布行为。

### Modified Capabilities

无。该能力依赖目标基准分支中的 `agent-observability` 与 `agent-evaluation` 实现，并通过它们现有的 Trace、runtime context、provider attempt collector、result envelope 和 scorer 基础扩展，但不在本 change 中复制或替代这些能力。

## Impact

- Prompt 编译：主要影响 `lib/chat/thread-chat-prompt.ts`、`lib/thread-chat/application/compile-model-context.ts`、`lib/thread-chat/streaming/generation-plan.ts`，并新增版本化 Prompt Segment、Manifest、Canonical Hash 与两阶段编译模块。
- 模型路由：主要影响 `lib/ai/provider.ts`、OpenRouter/UMAPIS/Ark/MiniMax adapter 和 Vercel Gateway 调用边界；所有未经验证的 compatible endpoint 继续安全回退为无显式缓存控制。
- 工具：影响 `lib/thread-chat/streaming/generation-tools.ts` 和正式回答的 step policy；工具行为与权限不扩大，只把当前动态组合收敛为少量稳定 Profile。
- 可观测性：扩展 `constants/observability.ts`、`lib/observability/types.ts`、AI SDK telemetry runtime context 和 run-level collector；不记录 Anchor、Prompt、Message 或文件正文，只记录版本、Hash、Token 和枚举状态。
- 评测：扩展 `evals/agent/` 的 case schema、result envelope、fingerprint、scorer、baseline compare 和 scheduled/release 模式；第一阶段缓存分数为诊断或性能门禁，不覆盖回答质量、安全和隔离的硬失败。
- 数据：首阶段不需要数据库迁移。可选的第二级分布式 Compiled Segment Cache 需要单独配置受信任 KV、租户隔离、TTL 与删除策略，默认关闭。
- 兼容性：客户端 API、Thread/Message DTO、冻结 `forkContext`、后台流式生成和终态落库保持不变。Prompt Kernel 版本升级会产生一次有意的缓存冷启动，并必须通过现有 Agent eval 比较质量回归。
