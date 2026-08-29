## Context

本设计以 `codex/feat-agent-observability-evaluation@30a540a315841f78a816adc761fb6bde37fedf7a` 为唯一基准。该分支已经完成以下可复用基础：

- `runGeneration()` 以 assistant Message 为一次生成尝试，并以确定性 Trace 包住后台生成、checkpoint 与 finalize 生命周期。
- `buildAiTelemetryConfig()` 统一 AI SDK v7 telemetry、runtime context、内容记录策略和 Langfuse 导出。
- `ProviderAttemptEvent` 与 AsyncLocalStorage collector 已用于 Search/Fetch provider attempt，并能进入 eval run result。
- `evals/agent/` 已提供版本化 case、candidate fingerprint、result envelope、scorer、baseline/candidate compare、CI 和 scheduled/release 模式。
- 冻结 `thread.forkContext` 以有序 Message ID 表达分支创建时继承的上下文，编辑和重试通过新 Message/Supersede 语义保持旧快照可重放。

当前 Prompt 路径仍有四个缓存结构问题：

1. `buildThreadChatSystem(anchorText, ...)` 把分支 Anchor 和可选 Artifact 指令拼到前置 system 中。
2. `generation-plan.ts` 把 Research mode、Research system 和每轮 Research plan 继续拼到同一个前置 system 中。
3. `compileModelContext()` 返回一个扁平 `ModelMessage[]`，无法区分冻结祖先、分支内历史、当前用户消息或其他运行期上下文，也无法在稳定边界设置 cache marker。
4. `resolveChatModel()` 只返回裸 `LanguageModel`，调用层无法知道真实 Adapter、Gateway、上游模型、路由策略或缓存能力。

Provider Prompt Cache 复用的是相同请求前缀的预填充结果，而不是 Message ID、Thread ID 或应用层对象本身。Provider 通常还会把 Tool Schema 放在 system/messages 之前。因此，只有把工具定义、System Kernel、Project 级稳定内容和冻结祖先历史构造成确定性前缀，缓存参数才有意义。

本设计把“缓存命中”分成三个不同问题：

- **前缀资格**：应用是否产生了相同、足够长且路由兼容的前缀。
- **缓存温度**：该前缀是否曾经作为输入提交、仍在 TTL 内且落在同一实际 Provider Endpoint。
- **Provider 证据**：上游是否返回了非零 cache read/write usage 或等价元数据。

应用可以严格保证第一项，只能通过路由亲和提高第二项，并以第三项作为最终命中事实。不得把“前缀 Hash 一致”表述为已经命中 Provider Cache。

## Goals / Non-Goals

**Goals:**

- 让同一冻结祖先上下文的兄弟分支在真正的分叉信息出现前拥有确定性共同前缀。
- 让同一 Thread 的后续轮次可以增量复用已经稳定的分支内历史。
- 对 Provider/Gateway/compatible endpoint 使用显式能力注册，而不是向所有路由盲发同一缓存参数。
- 将缓存读写、资格、路由变化和未命中原因接入现有 Trace 与 eval result。
- 保持 Prompt 内容、用户身份和敏感数据默认不进入生产遥测。
- 以影子 Manifest 和 Provider probe 验证请求形状，再逐路由启用缓存控制。
- 为应用层 Compiled Segment Cache 保留第二级接口，但不在缺少性能证据时引入新的分布式基础设施。

**Non-Goals:**

- 不使用 Exact Response Cache 返回旧模型答案。
- 不承诺任意模型、任意代理或任意首次分叉都一定产生 Provider cache read。
- 不为缓存新增 generation、conversation 或 Message 事实源。
- 不在本 change 实现 Project Memory、Project Contract、上下文摘要或跨 Thread `@` 引用；Prompt Segment 为这些能力预留稳定位置。
- 不在第一阶段缓存 Search 结果、网页正文、模型输出或工具副作用。
- 不为了最大化命中而向所有请求暴露所有工具或放宽工具权限。
- 不把缺失的 Provider cache usage 当作 0，也不根据通用单价自行覆盖现有计费事实。

## Current request shape

当前正式回答请求近似为：

```text
provider serialized tools (请求动态变化)

system:
  THREAD_CHAT_SYSTEM
  + optional artifact policy
  + branch anchor text
  + research-mode policy
  + research plan

messages:
  optional inherited omitted notice
  + frozen inherited messages
  + current-thread messages, including latest user message
```

兄弟分支的 Anchor、Research mode 或 Tool Set 只要不同，请求就可能在冻结共同历史之前发生分歧。

目标请求形状为：

```text
Tool Profile vN

System Segment
  S0 Agent Kernel vN
  S1 optional Project Contract revision

Conversation Segment
  S2 Frozen Inherited History
  S3 optional Branch Genesis Context
  S4 Stable Branch-local History, excluding current user

Runtime Tail
  S5 dynamic runtime control / retrieved memory / references
  S6 current user message
```

Provider adapter 从 S0-S4 中选择实际 cache breakpoints；S5-S6 永远不属于跨请求共同前缀候选。

## Decisions

### D1. Prompt Cache 是 Prompt 编译契约，不是 `streamText` 上的布尔开关

新增一个单一入口 `compileGenerationPrompt()`，负责：

- 加载并验证 owner-scoped Thread/Message；
- 构造版本化 Prompt Segment；
- 解析附件并标记稳定或动态内容；
- 选择 Tool Profile；
- 生成 Canonical Hash 和 Prompt Manifest；
- 根据 `ResolvedChatModel.cache` 应用 Provider 专属 marker、providerOptions 或 headers；
- 输出最终 `system`、`messages`、`tools` 和调用选项。

正式 `streamText()` 不再自行拼接 system、工具与缓存参数。Research route/plan、Artifact intent 等上游步骤只提供结构化输入给编译器。

建议接口：

```ts
interface CompiledGenerationPrompt {
  system: SystemModelMessage[]
  messages: ModelMessage[]
  tools: ToolSet
  providerOptions?: ProviderOptions
  headers?: Record<string, string>
  manifest: PromptManifest
}
```

`PromptManifest` 只保存和导出版本、枚举、数量、Token 估计与 Hash，不保存 Prompt 正文。

**替代方案：**直接在 `generation-plan.ts` 增加 `providerOptions`。它不能解决动态 system、扁平上下文、工具前缀和路由能力未知的问题，只会把 Provider 分支继续堆在编排代码中。

### D2. 使用六类有序 Segment，并明确稳定性和作用域

```ts
type PromptSegmentKind =
  | "agent-kernel"
  | "project-contract"
  | "inherited-history"
  | "branch-genesis"
  | "branch-history"
  | "runtime-tail"

type PromptCacheScope =
  | "global"
  | "project"
  | "fork-prefix"
  | "thread-prefix"
  | "none"
```

Segment 规则：

| Segment | 内容 | 作用域 | 稳定性 |
|---|---|---|---|
| Agent Kernel | 角色、上下文语义、安全、工具通用规则 | global | 仅版本升级变化 |
| Project Contract | 未来的 target/instructions/pinned memory | project | revision 内不变；当前可为空 |
| Inherited History | 预算处理后的冻结 `forkContext` Message | fork-prefix | 对同一冻结前缀确定性 |
| Branch Genesis | Anchor、来源 Message 和分支指代规则 | thread-prefix | 同一 Thread 不变，位于祖先历史之后 |
| Branch History | 当前 Thread 已完成的历史，不含当前用户 | thread-prefix | 只追加，不重排旧内容 |
| Runtime Tail | Research plan、动态记忆、引用、当前运行控制、当前用户 | none | 每轮可变 |

`anchorText` 不再进入 Agent Kernel。Branch Genesis 由服务端根据 `thread.anchorText`、`forkMessageId` 和模板版本确定性生成，作为位于 Inherited History 后的服务端上下文 Message。Main Thread 没有该 Segment。

Project Contract 尚未实现时 Segment 为空，不允许用随机占位或时间戳填充。

### D3. 上下文编译改为两阶段，Research 动态信息进入尾部

当前调用顺序是先 `compileModelContext()`，后在 `prepareGeneration()` 内解析 Research route/plan。新流程分为：

```text
Phase A: compilePromptBase
  -> stable system segments
  -> frozen inherited segment
  -> branch genesis
  -> stable branch history
  -> detach current user message

Phase B: resolve runtime
  -> research route
  -> optional research plan
  -> artifact intent
  -> tool profile
  -> optional dynamic memory/reference context

Phase C: finalizeGenerationPrompt
  -> runtime-tail context
  -> current user message
  -> provider cache controls
  -> manifest and final request
```

长期 Web/Artifact 行为规则收敛进稳定 Agent Kernel。Research mode 和计划作为结构化 runtime control 放在历史尾部；它们不得包含时间戳、请求 ID 或无关运行元数据。

动态 runtime block 由服务端创建并使用稳定标签，例如：

```text
<runtime_control version="v1">
  selected_mode: research
  plan: ...
</runtime_control>
```

Agent Kernel 明确该 Block 是服务端运行控制而不是用户内容，但其位置仍在共同历史之后。实现必须通过现有 instruction-following、Search routing 和 Artifact eval 验证语义没有回归。

**替代方案：**继续保留 mode-specific system。它实现简单，但会让每次 route 变化在共同历史之前切分缓存空间，因此拒绝作为目标结构；仅允许在回滚模式临时保留。

### D4. Canonical Hash 同时描述语义段和最终请求前缀

定义两个层级的 Hash：

1. `segmentContentHash`：对 Provider-neutral Segment 内容做稳定 JSON 序列化；保留数组顺序和所有对模型可见的空白，不包含 Message ID、Trace ID、时间戳和 UI metadata。
2. `requestPrefixHash`：对最终传给 AI SDK 的 Tool Profile、System Messages、稳定 Conversation Messages、Provider cache marker 位置、Compiler Version 和 Route Cache Profile 做稳定序列化。

另外记录：

- `forkContextHash`：有序 Message ID 与不可变 parts content hash；
- `toolProfileId` / `toolProfileHash`；
- `promptCompilerVersion`；
- `agentKernelVersion`；
- `projectContractRevision` / Hash（存在时）；
- `stablePrefixCharacters` 与可用时的 Token 估计；
- `firstDynamicSegment`；
- `cacheEligibility` 和 reason codes。

Hash 使用 SHA-256；生产遥测只输出 Hash，不输出 Hash 输入。不得对空白、消息角色或 Tool Schema 做“语义等价”归一化，因为 Provider 看到的 Token 序列可能不同。

应用层 Hash 只能证明应用请求形状一致，不能代替 Provider cache read 证据。

### D5. 工具集合收敛为有限 Tool Profile

Provider 往往把 Tool Schema 作为 Prompt 前缀的一部分。当前工具对象随 `artifactRequested` 和 `researchMode` 动态组合，会产生较多前缀变体。

首阶段定义少量 Profile：

```text
thread-answer-v1
thread-artifact-v1
thread-web-v1
thread-web-artifact-v1
```

每个 Profile 必须保证：

- 工具名、描述、JSON Schema 和顺序固定；
- 不把 route reason、Message ID、当前 Query 或其他动态数据写进工具描述/Schema；
- 工具执行闭包可以持有当前 Message ID，但闭包数据不得进入 Provider-visible Schema；
- Profile 内所有模型步骤发送相同工具定义；`toolChoice` 可以按 step 改变，但必须单独记录 policy version；
- 未授权或未配置的工具不能为了缓存而出现在 Profile 中。

`answer` 与 `fetch/search/research` 可以分区，因为安全面和 Token 成本不同。减少 Profile 数量不以扩大权限为代价。

### D6. `resolveChatModel` 返回路由与缓存能力，而不是裸模型

建议结果：

```ts
type PromptCacheStrategy =
  | "implicit"
  | "explicit-breakpoint"
  | "gateway-auto"
  | "unsupported"
  | "probe-required"

type ResolvedChatModel = {
  model: LanguageModel
  route: {
    appModelId: string
    adapter: "gateway" | "openrouter" | "anthropic" | "openai-compatible" | "ark" | "minimax"
    gateway: "vercel" | "cloudflare" | "openrouter" | "umapis" | null
    upstreamModelId: string
    routeId: string
  }
  cache: {
    strategy: PromptCacheStrategy
    profileVersion: string
    supportsAffinity: boolean
    supportsCacheReadUsage: boolean
    supportsCacheWriteUsage: boolean
    supportedTtls: Array<"provider-default" | "5m" | "1h">
    maxBreakpoints?: number
    retentionClass: "ephemeral-memory" | "extended" | "unknown"
  }
}
```

能力表以实际 Adapter + Gateway + 上游模型族为键，不只看产品 `modelId`。同一个产品模型通过 Vercel Gateway、OpenRouter 和 compatible proxy 时可以得到不同策略。

未知 compatible endpoint 默认 `probe-required`，在验证 request passthrough、usage 和数据保留前不得发送 cache marker 或声称已启用。

### D7. Provider 策略由 Adapter 实现，并保留安全回退

实施时必须重新核对锁定版本的 TypeScript 类型和官方文档。设计上的默认策略：

| 路由 | 首选策略 | 备注 |
|---|---|---|
| Vercel AI Gateway | `gateway-auto` | 通过 Gateway provider options 请求自动缓存；记录实际 Provider metadata |
| OpenRouter implicit 模型 | `implicit` + affinity | 使用稳定 session affinity，提高相同 Endpoint 命中概率 |
| OpenRouter Anthropic/Qwen 等显式模型 | `explicit-breakpoint` + affinity | 使用 OpenRouter providerOptions 转换 cache control；按能力表启用 |
| UMAPIS Anthropic adapter | `probe-required` | 虽使用 Anthropic SDK，也必须验证代理透传 marker 与 usage |
| OpenAI direct/compatible | implicit 或 provider cache key，需验证 | 不向普通 compatible endpoint盲发 OpenAI 专属字段 |
| Ark/MiniMax/Cloudflare compatible | `probe-required` | 以请求/usage probe 为准 |

OpenRouter affinity key 使用服务端 HMAC，建议作用域：

```text
HMAC(serverSalt, userId + projectId + upstreamModelId + cacheProfileVersion)
```

这样同一 Project、同一模型的父 Thread 与兄弟分支倾向落到同一实际 Endpoint，不泄漏原始用户或 Project ID。Key 不超过 Provider 限制，不包含标题、Anchor、Prompt Hash 或当前 Thread ID。不同用户、Project、模型和 profile 必须产生不同值。

如果运营策略显式设置固定 Provider order，必须记录该策略可能优先于 sticky routing；`routeId` 与 `providerRoutingPolicyVersion` 进入资格判断。

任何缓存配置异常都只禁用本次缓存优化，不能让模型请求失败；模型本身无法调用时仍按原错误路径处理。

### D8. Breakpoint 同时服务兄弟分支和同分支增量缓存

Provider-neutral Manifest 声明候选边界：

- `kernel-end`：Agent Kernel/Project Contract 末尾；
- `inherited-end`：冻结祖先历史末尾；
- `thread-stable-end`：Branch Genesis 与已完成分支历史末尾、当前用户之前。

Provider adapter 根据能力、最小长度和 breakpoint 上限选择实际 marker。显式缓存路径优先保证：

1. 兄弟分支可复用的 `inherited-end`；
2. 同一 Thread 续聊可复用的 `thread-stable-end`；
3. 有剩余额度且内容足够长时保留 `kernel-end`。

隐式缓存和 Gateway auto 路径不手工伪造 marker，但仍使用同一 Manifest 和 Hash 进行诊断。

首次从最新 assistant 输出创建分支时，该 assistant 内容可能从未作为后续请求的输入，因此 Provider 未必已经把它缓存。此时可命中的最长前缀可能只到更早一轮。设计必须把以下状态分开：

- `eligible`: 请求前缀符合复用条件；
- `cold-start`: 没有已知的先前相同输入请求；
- `partial-warm`: 共同前缀的一部分可能已经作为输入；
- `provider-hit`: Provider usage 证明发生 read；
- `provider-miss/unknown`: read 为 0 或 Provider 未返回证据。

产品和指标不得把合法冷启动计为 Prompt 架构失败。

TTL 默认由 Provider 决定；只有观察到会话停顿分布和 write/read 成本后，才对支持路由启用 1 小时或其他 extended TTL。Extended caching 还必须通过数据保留政策检查。

### D9. 缓存 Usage 采用 best-effort 归一化并保留来源

新增统一结构：

```ts
type PromptCacheUsage = {
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  uncachedInputTokens?: number
  source:
    | "ai-sdk-usage"
    | "provider-metadata"
    | "gateway-metadata"
    | "derived"
    | "unavailable"
  complete: boolean
}
```

规则：

- 优先使用 AI SDK 标准 input token details；
- 再读取经过 allowlist 的 Provider/Gateway metadata；
- 只有输入总量和 cache read/write 都可证明时才派生 uncached input；
- 缺失字段保持 `undefined`，不得补 0；
- 原始 `providerUsage` 继续随 Message finalization 保存，归一化结果用于观测和评测，不覆盖计费；
- 多步 `streamText` 使用 `onStepFinish` 或等价 collector 记录每个 Model Attempt，再计算 run summary，不能只读取最后一步。

建议新增与 Search provider attempt 平行的 `ModelAttemptEvent`：

```text
step index
purpose
routeId / actual provider / upstream model
input/output tokens
cache read/write tokens
finish reason
TTFT / duration（可得时）
toolProfileId
requestPrefixHash
cache strategy / eligibility / miss reason
```

事件只含数值、Hash 和枚举。AI SDK/Langfuse 已自动创建的模型 Observation 继续作为步骤 Trace；collector 只为应用比较和 eval result 提供稳定 envelope，避免重复创建高噪声 span。

### D10. 直接扩展现有 Observability 与 Agent Eval

在 `constants/observability.ts` 和 allowlist 增加：

```text
promptCompilerVersion
agentKernelVersion
promptCacheProfileVersion
promptCacheStrategy
toolProfileId
requestPrefixHash
forkContextHash
cacheEligibility
providerRouteId
providerRoutingPolicyVersion
```

根 Trace 记录运行级摘要，模型步骤记录 Model Attempt。生产默认仍是 metadata-only。

`AgentExperimentResult` 增加：

```ts
modelAttempts: ModelAttemptRecord[]
cache: {
  eligible: boolean
  reason: string
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheReadRatio?: number
  requestPrefixHash?: string
  toolProfileId?: string
  routeId?: string
}
```

Candidate fingerprint 必须加入：

- Prompt Compiler Version；
- Agent Kernel Version；
- Cache Profile Version；
- Tool Profile ID；
- Provider Routing Policy Version；
- model/adapter/gateway route identity。

新增 `prompt-cache` suite 或等价明确 suite，至少覆盖：

- 相同冻结祖先的两个兄弟分支；
- 同一分支连续三轮；
- Anchor 不同但 shared prefix Hash 相同；
- Research mode 和 Tool Profile 变化导致的有意分区；
- 模型/Gateway/Provider route 变化；
- 冷启动、TTL 过期和 fallback；
- explicit marker 的位置与数量；
- 未知 compatible endpoint 不发送字段；
- Prompt 质量、安全、工具选择与 Artifact 行为不回归。

CI 使用 fake adapter/fixture 断言请求结构和 Hash；scheduled/release 才运行批准的 live provider cache probe。首阶段缓存 scorer 为 diagnostic；只有在样本量、Provider 证据和基线稳定后，才对 eligible warm case 设性能门禁。回答质量、安全、隔离和终态 hard scores 始终优先。

### D11. 分级缓存按收益和数据风险逐步启用

#### L1: Provider Prompt/KV Cache

首阶段必须完成。它直接影响 prefill、输入成本和首 Token 延迟，由 Prompt Compiler、Provider Capability 和 affinity 支撑。

#### L2: Compiled Segment Cache

用于减少数据库读取、附件稳定解析、Message 转换、Canonical Hash 和 Token 估计成本，不减少 Provider Token。定义接口但默认关闭：

```ts
interface CompiledSegmentCache {
  get(key: CompiledSegmentCacheKey): Promise<CompiledPromptSegment | null>
  set(key: CompiledSegmentCacheKey, value: CompiledPromptSegment, ttl: number): Promise<void>
}
```

Key 至少包含：

```text
tenant HMAC
promptCompilerVersion
segment kind
source revision/content hash
model family / attachment strategy
tool profile where relevant
```

初次实现优先使用有界进程 LRU，避免引入新外部数据副本。只有观测证明跨实例命中值得成本时，才接可信分布式 KV。分布式 value 包含 Prompt 内容，必须使用 TLS、服务端凭据、租户隔离、短 TTL、容量限制和删除策略；不得使用公共或客户端可访问缓存。

#### L3: Durable Summary/Compaction Snapshot

它解决长期上下文预算和深树压缩，不等同于缓存参数。当前 change 只要求 Segment 接口兼容未来不可变 Summary Snapshot；摘要生成、持久化和语义验证另立 change。

#### L4: Exact Response Cache

明确不采用为普通聊天缓存层。只有未来的幂等离线任务或命令重放在独立设计中评估。

### D12. 缓存不能绕过隐私、保留和 Provider 政策

- Provider Cache 策略必须尊重现有 ZDR、region、Provider allowlist 和用户/部署数据政策；需要 extended retention 的缓存默认关闭。
- OpenRouter/Gateway session 或 prompt cache key 必须是服务端 HMAC，不发送原始用户、Project、Thread 或 Message ID。
- Trace、日志和 eval summary 不记录 Prompt、Anchor、Message、Research query、文件或网页正文。
- L2 Cache key 不包含明文；value 只存在于受信任服务端缓存。
- 生产内容遥测开关与缓存开关独立。启用 Prompt Cache 不意味着允许记录 Prompt。
- Provider 返回的 raw metadata 继续经过现有 mask/allowlist，不因排查缓存而导出完整请求。

### D13. 采用 `off` / `observe` / `enabled` 三态渐进发布

```text
off
  发送旧 Prompt；只保留现有观测。

observe
  仍发送旧 Prompt，同时影子编译新 Prompt Manifest、Hash、资格和预计边界；
  不发送 cache marker、affinity 或新 Prompt。

enabled
  发送新 Prompt 和该路由已验证的缓存控制。
```

开关是 server-only，并支持按环境、模型 route 和小比例 cohort 覆盖。发布顺序：

1. fixture 测试与 OpenSpec/TypeScript 校验；
2. `observe` 收集旧请求的前缀变体和 Tool Profile 分布；
3. staging 对一个已验证 Provider route 启用；
4. 运行 sibling-fork live probe 和全套 Agent eval；
5. production 小 cohort；
6. 对其余 route 分别验证并启用；
7. 有数据后决定是否启用 L2。

任何新 Prompt 的质量、工具或终态回归都通过配置回到 `off`。缓存 Usage 解析失败只标记 `unavailable`；不会终止生成。Provider 专属选项被拒绝时，该 route 自动降级为无显式控制并产生安全诊断。

## Detailed flow

```text
runGeneration
  ├─ load assistant Message + Thread
  ├─ build Trace context
  ├─ compilePromptBase
  │   ├─ Agent Kernel / Project Contract
  │   ├─ frozen inherited messages
  │   ├─ Branch Genesis
  │   ├─ stable branch history
  │   └─ current user detached
  ├─ resolveChatModel -> ResolvedChatModel
  ├─ resolve research route / plan
  ├─ select Tool Profile
  ├─ finalizeGenerationPrompt
  │   ├─ runtime tail + current user
  │   ├─ canonical hashes / eligibility
  │   └─ route-specific cache controls
  ├─ streamText
  │   └─ collect model attempts / cache usage per step
  ├─ checkpoint / finalize authoritative Message
  └─ update Trace + eval envelope summaries
```

## Cache eligibility

一次跨请求复用至少要求以下字段兼容：

```text
same effective upstream model
same adapter/gateway route class
same provider routing policy
same cache profile and TTL class
same Tool Profile and Provider-visible schema
same Agent Kernel / Project Contract revisions
same Prompt Compiler serialization version
same stable prefix content/hash
same retention policy
prefix above route minimum, when known
```

以下情况必须报告为有意分区而不是错误：

- 用户切换模型；
- answer 与 web Tool Profile 不同；
- Project Contract revision 更新；
- Agent Kernel 或 Tool Schema 升级；
- Provider fallback 改变实际 Endpoint；
- 严格 ZDR 策略禁用 extended caching；
- Prompt 太短；
- TTL 已过或缓存为冷启动。

## Metrics

运行级核心指标：

```text
eligible_fork_cache_hit_rate
  eligible 且非合法 cold-start 的 fork 中，Provider 证明 cacheReadTokens > 0 的比例

cache_read_ratio
  cacheReadTokens / inputTokens（仅字段完整时）

cache_write_amortization
  同 route/profile 时间窗内累计 cacheReadTokens / cacheWriteTokens

shared_prefix_reuse_ratio
  cacheReadTokens / eligibleStablePrefixTokenEstimate，标记为估算指标

TTFT p50/p95 by cache outcome
  provider-hit / miss / unavailable

quality delta
  candidate 与 baseline 的 hard/quality scores 差异
```

成本节省优先使用 Provider/Gateway 返回的真实 cost metadata；缺少真实价格时只报告 Token，不制造通用美元估算。

## Risks / Trade-offs

### 稳定 Kernel 会增加每次基础 Prompt 长度

将 Web/Artifact 通用规则收敛进稳定 Kernel 可能比当前 mode-specific system 略长。通过 Profile、精简文案和 eval 比较权衡；不能为了缓存把所有详细动态 Plan 放进 Kernel。

### Tool Profile 仍会形成缓存分区

这是安全和 Token 成本的有意取舍。Profile 数量必须通过观测控制，但不追求单一超集。

### Provider Cache 行为和字段可能变化

能力表、Probe 与 usage source 都必须版本化；官方文档和锁定包类型是实施时事实源。未验证 route 保持 `probe-required`。

### 首次分叉可能只有部分温缓存

这是 Provider KV 生命周期决定的正常现象。验收测试必须先执行可控 warm-up，再验证 sibling reuse；产品指标排除合法 cold-start。

### Prompt 顺序改变可能影响质量

Research plan 和 Branch Context 的通道/位置变化需要现有 Search、Artifact、memory-context 和 reliability suites 验证。发布必须有 `off` 回滚。

### L2 分布式缓存会复制 Prompt 内容

因此默认不启用。只有收益明确且隐私、删除和租户隔离完成后才允许上线。

## Migration plan

1. 先新增纯函数 Segment/Manifest/Hash 与 fixture 测试，不改变请求。
2. 在 `observe` 模式接入当前生成链，记录旧 Prompt 与候选稳定前缀差异。
3. 引入 `ResolvedChatModel` 和能力表，但 route 默认无显式缓存。
4. 完成 Tool Profile 与两阶段 Prompt 编译，通过全部现有 Agent eval。
5. staging 逐 route 开启 cache controls 和 affinity。
6. 扩展 eval result/baseline compare，建立 Provider-backed scheduled probe。
7. production 小范围启用并观察质量、cache usage、TTFT、fallback 和错误。
8. 只有编译/数据库成本成为明显瓶颈时，实施 L2 Cache adapter。

客户端、Message DTO、数据库事实源和冻结 Fork 语义不需要迁移。Prompt Compiler/Kernel/Profile 版本变化会使旧 Provider Cache 自然过期，无需主动失效上游 KV。
