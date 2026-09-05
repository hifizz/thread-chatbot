## Context

本设计实现 Thread Chat Prompt 缓存 V1。目标不是缓存最终回答，而是让供应商复用逐字相同的模型输入前缀，同时保持现有生成语义、工具权限、强制工具行为、推理设置、计费流程和消息终态。

当前回答链路为：

```text
run-generation.ts
  → compile-model-context.ts
  → generation-plan.ts
  → resolveChatModel / streamText
  → LanguageModelUsage
  → generation finalize / providerUsage / Langfuse
```

当前影响前缀稳定性的主要问题：

1. `buildThreadChatSystem(anchorText, ...)` 把每个 Child 的具体选区放入早期 System，兄弟 Fork 从 System 开始分叉。
2. `compile-model-context.ts` 对 Child 继承历史单独应用 6000 字符预算并插入伪 User 省略消息，Parent 与 Child 的共同历史不再逐字一致。
3. System、工具、首步工具、推理和最大步骤分别按研究路由与 Artifact 请求动态拼装，没有一个可验证的固定生成模式合同。
4. 当前代码没有统一 Provider 缓存资格和缓存断点注入层。
5. generation 已保存 AI SDK 原始 `LanguageModelUsage`，但 Langfuse/日志尚未形成缓存读取、写入、未缓存和未知状态的统一观测合同。

Research 阶段已用 UMAPIS Claude Opus 5 与 Sonnet 5 完成真实请求验证：两者均能透传 Anthropic `cache_control` 并返回标准缓存用量。Sonnet 5 表现为先写入后读取；Opus 5 在八次全新前缀实验中首次写入、第 2 至 6 次读取、第 7 至 8 次在 TTL 内重新写入，说明缓存只能承诺尽力命中。

本 change 与 `add-thread-chat-message-quotes-v2` 有实现依赖。Quote change 定义 Quote 的 Schema、编辑和来源规则；本 change 只依赖其模型输入结论：Quote 位于所属 User Message，`anchorText` 不再进入 System，Child 不再使用专属历史截断。

## Data Contracts First

本 change 在任何缓存策略决策之前先锁定持久化、Composer、命令、模型投影和观测契约。实现不得用临时对象代替这些边界，也不得为了缓存另建 Quote 表或改变 Quote 生命周期。

### 数据库 Schema

V1 复用现有 `thread_chat.messages` 表，不新增表或列：

```ts
export const messages = dbSchema.table("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  threadId: text("thread_id").notNull(),
  sequence: integer("sequence").notNull(),
  role: text("role").$type<"user" | "assistant">().notNull(),
  parts: jsonb("parts").$type<ThreadChatUIMessage["parts"]>().notNull(),
  status: text("status").$type<ConversationMessageStatus>().notNull(),
  modelId: text("model_id"),
  replacesMessageId: text("replaces_message_id"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  providerUsage: jsonb("provider_usage").$type<Record<string, unknown>>(),
  // 其他现有生成生命周期字段保持不变
})
```

字段归属：

| 数据 | 持久化位置 | 规则 |
| --- | --- | --- |
| Quote | User Message 的 `messages.parts` JSONB | Quote 随 Message 创建和替换，不具有独立行或独立生命周期。 |
| Fork 来源 | `threads.parentId / forkMessageId / forkContext / forkAnchor / anchorText` | 只描述 Thread 从哪里分叉；不能代替 User Message 中最终保留的 Quote。 |
| 模型原始/标准 usage | Assistant Message 的 `messages.providerUsage` JSONB | 保留 AI SDK 标准字段与 Provider 原始用量；缓存字段缺失不得补零。 |
| 标准化缓存摘要 | Langfuse metadata 与结构化日志；V1 不新增数据库列 | 它是每次调用的观测投影，不是 Provider 缓存状态。 |
| Project Contract 分区 | `projects.contractVersion` | Contract 修改自然产生新前缀；不新增缓存键表。 |

数据库约束不解析 `parts` 内部 Quote JSON。Quote 的版本、字段和跨实体合法性由命令边界的 Zod Schema 与应用服务验证；PostgreSQL 只负责原子保存整份 Message Parts。这样编辑仍沿用 `replacesMessageId / supersededAt`，不产生 Quote 行级更新。

### Quote 持久化 Schema

Quote 的权威 V1 持久化类型沿用 `add-thread-chat-message-quotes-v2`，并在本设计中完整重述缓存所依赖的字段：

```ts
export type ThreadQuoteSourceV1 =
  | {
      type: "message"
      messageId: string
      anchor: TextAnchor
    }
  | {
      type: "artifact"
      messageId: string
      artifactId: string
      anchor: TextAnchor
    }

export interface ThreadQuoteDataV1 {
  schemaVersion: "thread-quote-v1"
  text: string
  comment?: string
  source: ThreadQuoteSourceV1
}

export type ThreadQuotePartV1 = {
  type: "data-quote"
  data: ThreadQuoteDataV1
}

export type LegacyThreadQuotePart = {
  type: "data-quote"
  data: { text: string }
}
```

持久化 JSON 示例：

```json
{
  "type": "data-quote",
  "data": {
    "schemaVersion": "thread-quote-v1",
    "text": "被划选的原文快照",
    "comment": "请解释这一段",
    "source": {
      "type": "message",
      "messageId": "message_A11",
      "anchor": {
        "quote": {
          "exact": "被划选的原文快照",
          "prefix": "前文",
          "suffix": "后文"
        },
        "position": { "start": 120, "end": 129 }
      }
    }
  }
}
```

强制不变量：

- `data.text` 非空，并与 `data.source.anchor.quote.exact` 完全相等；
- `source.messageId` 是来源身份，Project 与 Thread 不重复存入 Quote；
- Artifact Quote 同时保存来源 `messageId` 与 `artifactId`；
- `text`、`source` 和 `anchor` 是只读快照；编辑只允许删除、排序和修改 `comment`；
- Legacy Quote 只能原样保留、排序或删除，不能升级、复制或补来源；
- Quote 不保存 Quote ID、`required`、创建入口、标题、DOM 路径或来源状态；
- 删除 Composer 中的预填 Quote 后，服务端不得从 `threads.anchorText` 或 `forkAnchor` 补回。

### Composer 草稿类型

Composer 必须显式区分“尚未发送的可编辑草稿”和“已经持久化的 Message Part”。建议的客户端领域类型为：

```ts
export type ComposerQuoteSourceDraft =
  | {
      type: "message"
      messageId: string
      anchor: TextAnchor
    }
  | {
      type: "artifact"
      messageId: string
      artifactId: string
      anchor: TextAnchor
    }

export interface ComposerQuoteDraft {
  text: string
  comment: string
  source: ComposerQuoteSourceDraft
  origin: "selection" | "fork-prefill" | "message-edit"
  readonlySnapshot: boolean
}

export type ComposerMessagePartDraft =
  | {
      localId: string
      type: "text"
      text: string
    }
  | {
      localId: string
      type: "file"
      file: FileReference
    }
  | {
      localId: string
      type: "quote"
      quote: ComposerQuoteDraft
    }

export interface ThreadComposerDraft {
  parts: ComposerMessagePartDraft[]
}
```

字段语义：

| 字段 | 用途 | 是否持久化 |
| --- | --- | --- |
| `parts[].localId` | React 列表、排序和删除的本地稳定键 | 否 |
| Text Part 的 `text` | 总体问题文字，可拆成多个有序文本段 | 是，进入普通 `text` Part |
| File Part 的 `file` | Composer 附件引用 | 是，进入普通 `file` Part |
| Quote 的 `text` | Quote 原文预览；发送后成为冻结快照 | 是，进入 `ThreadQuoteDataV1.text` |
| Quote 的 `comment` | Quote 局部批注输入；空字符串提交时省略 | 条件持久化 |
| Quote 的 `source` | 创建时来源验证和未来导航 | 是 |
| Quote 的 `origin` | 区分普通选区、Fork 预填和 Edit 恢复的 UI 规则 | 否 |
| Quote 的 `readonlySnapshot` | 控制 UI 不允许改写 `text/source/anchor` | 否 |

普通 Composer 可以追加来自当前 Thread 已完成 Message 或 Artifact 的 Quote。Fork Composer 初始最多预填一份 Message Quote，允许整体删除但不能替换其只读来源。Edit Composer 从原 `parts` 顺序恢复文本、文件和 Quote；V1 不允许新增或复制 Quote，只允许删除、重排和修改 V1 Quote 的 `comment`。

总体问题是所有 Text Part 的非空文本按原序组成的用户输入。Quote 和文件不能代替非空总体问题：所有 Text Part 归一化后为空时不得创建 User Message 或触发模型调用。

### 提交命令类型

网络命令不提交 `localId`、`origin` 或 `readonlySnapshot`。Composer 在发送前把草稿投影成严格命令输入：

```ts
export interface ThreadQuoteInputV1 {
  schemaVersion: "thread-quote-v1"
  text: string
  comment?: string
  source: ThreadQuoteSourceV1
}

export type MessageContentPartInput =
  | {
      type: "text"
      text: string
    }
  | {
      type: "file"
      file: FileReference
    }
  | {
      type: "quote"
      quote: ThreadQuoteInputV1
    }

export interface MessageContentInput {
  parts: MessageContentPartInput[]
}

export interface FirstForkTurnInput extends MessageContentInput {
  userMessageId: string
  assistantMessageId: string
}
```

`StartProjectCommand`、`SendMessageCommand`、`EditLatestTurnCommand` 和 `ForkThreadCommand.firstTurn` 在 Quote change 落地后统一复用 `MessageContentInput`。应用服务逐项把命令 `parts` 投影成 `ThreadChatUIMessage["parts"]`，保持 Composer 最终顺序；不得先按类型分组，也不得将 Quote 自动移动到文本或文件之前。

服务端验证顺序：

1. Zod 严格解析命令和 Quote 版本；
2. 检查 `text === source.anchor.quote.exact`；
3. 检查来源归属、Thread、完成状态和 Artifact 关系；
4. Edit 时与被替换 Message 的旧 Quote 做一一对应，禁止新增或复制；
5. 原子保存最终 Parts，并创建现有 assistant generation 行。

### UI Message 与模型投影类型

`ThreadChatDataParts` 必须把 Quote 从历史简化类型升级为版本化联合：

```ts
export type ThreadChatQuoteData =
  | ThreadQuoteDataV1
  | { text: string }

export type ThreadChatDataParts = {
  quote: ThreadChatQuoteData
  // 其他已有 data parts 保持不变
}
```

模型转换使用独立、最小的投影类型，防止来源元信息泄漏给模型：

```ts
export interface ModelVisibleQuote {
  text: string
  comment?: string
}

export function quoteForModel(
  quote: ThreadQuoteDataV1 | { text: string }
): ModelVisibleQuote
```

模型只接收安全转义后的 `text` 和可选 `comment`，不得接收 `schemaVersion`、`source`、Message ID、Artifact ID、Anchor、`localId` 或 `origin`。Quote 按持久化 Parts 原序出现在所属 User Message 中，不进入早期 System。

### Prompt 缓存与观测类型

缓存实现不新增持久化状态，但需要在应用层先定义稳定类型：

```ts
export type ThreadChatGenerationModeId =
  | "answer"
  | "answer-artifact"
  | "fetch"
  | "fetch-artifact"
  | "search"
  | "search-artifact"
  | "research"
  | "research-artifact"

export interface PromptCacheRouteIdentity {
  actualProvider: string
  protocol: "anthropic" | "openai-compatible" | "openrouter"
  credentialGroup?: string
  upstreamModel: string
}

export interface PromptCachePolicy {
  explicitCacheEnabled: boolean
  namespace?: "anthropic"
  type?: "ephemeral"
  ttl?: "5m"
}

export type PromptCacheObservationStatus = "hit" | "miss" | "unknown"
export type PromptCacheMetricFormula = "detailed-input" | "input-total" | "unavailable"

export interface PromptCacheObservation {
  status: PromptCacheObservationStatus
  route: PromptCacheRouteIdentity
  generationMode: ThreadChatGenerationModeId
  promptSchemaVersion: string
  projectContractVersion: number
  explicitCacheEnabled: boolean
  inputTokens?: number
  noCacheTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
  metricFormula: PromptCacheMetricFormula
  tokenHitRate?: number
}
```

`PromptCacheObservation` 在 `LanguageModelUsage` 转成 JSON 前构造，以保留 `undefined` 与 `0` 的差异。它只进入 Langfuse metadata 和脱敏结构化日志；原始 usage 继续进入 `messages.providerUsage`。任何观测字段都不能进入模型可见 Prompt，也不能反向控制生成。

## Goals / Non-Goals

### Goals

- 用单一固定生成模式注册表稳定 System、工具和生成策略。
- 保持共同历史完整原序，让续聊、重新生成和兄弟 Fork 尽量共享相同前缀。
- 用单一 Provider 缓存策略为已验证的 UMAPIS Claude Opus 5 与 Sonnet 5 注入 Anthropic 缓存断点。
- 将缓存装饰与模型可见 Prompt 分离，保证移除缓存参数后请求语义不变。
- 复用现有 generation usage、Langfuse 和日志链路记录缓存结果，并保留未知状态。
- 用合同测试证明固定模式和共同前缀的确定性。

### Non-Goals

- 不冻结历史 PDF 或 Project File 的模型可见正文；该问题属于后续独立 change。
- 不实现长上下文摘要或稳定压缩检查点。
- 不移动研究计划，不改变其服务端 System 权威。
- 不为 OpenRouter、火山方舟、UMAPIS GPT、私有中继或其他 OpenAI-compatible 线路发送未经验证的显式缓存参数。
- 不实现 Redis 缓存、数据库 Prompt 缓存、语义缓存或最终回答缓存。
- 不保证缓存写入后 TTL 内每次请求都命中。
- 不根据缓存结果控制模型路由、重试、权限、计费或消息终态。

## Decisions

### D1：使用固定生成模式注册表，而不是继续分散拼装

建立一个 Thread Chat 固定生成模式解析入口。模式身份由：

```text
(researchMode, artifactRequested)
```

决定。解析结果至少包含：

- 稳定模式 ID；
- System 静态片段选择和顺序；
- 工具名称及顺序；
- 首步强制工具；
- 推理设置；
- 最大步骤。

合法模式应按真实能力枚举，而不是假设所有笛卡尔积组合都有意义。`searchReady` 在研究路由解析前决定请求最终进入哪个真实模式；模式解析后，同一模式的模型可见配置不能再因 `routeReason`、请求 ID 或观测字段变化。

`researchPlan` 是 `research` 模式内已知的动态 System 例外。它继续在固定静态 System 之后、历史之前出现。观测应区分静态模式相同与完整前缀因研究计划不同而提前分叉，不能虚报深度研究的历史缓存覆盖率。

**备选方案：继续在 `generation-plan.ts` 使用条件表达式。**

不采用。分散条件可以维持功能，但无法集中验证一个模式的 System、工具、首步规则和推理设置是否同步变化，也容易因新增工具产生隐式缓存分区。

**备选方案：把缓存资格、路由原因和命中状态一并放入模式枚举。**

不采用。这些是不同维度；混入同一枚举会产生组合爆炸，并让观测状态反向控制生成配置。

### D2：Prompt Schema 版本显式独立于应用版本

定义 Thread Chat Prompt Schema 版本常量。它表示会影响模型可见固定前缀或序列化合同的版本，而不是 Git commit 或部署版本。

以下变化需要提升 Prompt Schema 版本：

- System 固定文本或顺序变化；
- 工具名称、顺序、描述或 Schema 变化；
- Quote-to-model 序列化变化；
- Project Contract 模型序列化变化；
- 历史消息角色、顺序或内容转换规则变化。

仅观测字段、日志格式或 UI 展示变化不提升 Prompt Schema 版本。

该版本用于测试、日志和聚合分组，不作为项目自建缓存键。Provider 仍根据实际请求内容决定缓存身份。

**备选方案：使用应用 release 作为缓存版本。**

不采用。无关部署会把指标切碎；反之，同一 release 内 Prompt 合同变化也可能无法准确识别。

### D3：先规范模型上下文，再由 Provider 策略装饰缓存

Prompt 编译保持 Provider 中立，分为两个结果：

1. 模型可见的 `instructions`、`messages`、工具和生成配置；
2. 可缓存边界的语义标记，例如“稳定 System 末尾”和“当前 User Message 之前最后一条稳定历史末尾”。

Provider 缓存策略根据实际线路把这些语义边界转换为 AI SDK `providerOptions`。通用 Prompt 编译器不直接散落 `anthropic.cacheControl` 或 `openrouter.cacheControl`。

装饰前后必须满足：

- 文本不变；
- Message role 不变；
- Message 和 Part 顺序不变；
- 工具定义和顺序不变；
- 推理、步骤和输出限制不变；
- 唯一差异是 Provider 缓存元数据。

**备选方案：在 `compile-model-context.ts` 直接写 Anthropic 字段。**

不采用。该模块负责通用模型上下文；直接写 Provider 字段会把缓存线路知识扩散到历史加载和附件处理逻辑。

**备选方案：只使用顶层自动缓存。**

不采用。真实实验验证的是显式 `cache_control`；并且明确标记共同历史末尾能控制当前动态 User Message 不进入该稳定断点。

### D4：V1 使用最多两个有意义的断点

Anthropic 每次请求最多允许四个缓存断点。V1 不为用满额度而制造断点，只考虑：

1. **稳定服务端指令断点：** 固定模式 System 与 Project Contract 形成的稳定前缀末尾；
2. **共同历史断点：** 当前 User Message 之前最后一条稳定历史 Message 的合法末尾。

优先级为共同历史断点高于静态指令断点，因为它覆盖更长、与续聊/Fork 直接相关的前缀。

具体装饰规则：

- `instructions` 使用 AI SDK v7 的 `SystemModelMessage` 形式时可携带 Provider Options；不得退回把 System Message 放入 `messages`，因为默认禁止该形式。
- 历史断点优先附加到最后一条稳定历史 Message；若 Message 内容是 Part 数组，可附加到最后一个 Provider 支持缓存的 Part 或 Message 本身。
- 当前 User Message 不标记为共同历史断点，避免把本轮差异错误描述为共享前缀。
- 没有历史时，不插入占位 Message；只保留合法的稳定指令断点。
- 工具缓存断点不在 V1 单独使用。工具定义仍需稳定，但多一个断点的真实收益应在后续指标中验证后再加入。

Project Contract 当前与固定 Thread System 一起构造成顶层服务端指令。Project Contract 修改后自然形成新前缀；不把它移到历史后面。

**备选方案：每条历史 Message 都加断点。**

不采用。会超过 Provider 上限，也无法提高最长公共前缀命中，反而使策略复杂且难以跨 Provider 迁移。

### D5：缓存白名单按实际线路和上游模型判定

建立单一缓存能力描述，概念上包括：

```text
actualProvider
protocol
upstreamModel
explicitPromptCache
cacheControlNamespace
cacheTtl
usageCapabilities
```

V1 显式缓存资格为：

```text
provider = umapis
credentialGroup = claude
protocol = anthropic
upstreamModel ∈ { claude-opus-5, claude-sonnet-5 }
```

TTL 使用已验证的 `5m`。暂不启用 `1h`，因为本轮实验只验证了 5 分钟合同，且更长 TTL 有不同成本与失效权衡。

不得仅根据 `creator = anthropic` 启用缓存。OpenRouter 或未来其他中转站即便承载 Claude，也必须分别验证协议透传和 usage 后再进入白名单。

对于非白名单线路：

- 不注入显式缓存参数；
- 保留 Provider 原有自动缓存行为；
- 如果 AI SDK 返回缓存用量，照常观测；
- 不把“未启用显式缓存”等同于“Provider 不支持缓存”。

**备选方案：所有 Anthropic 创建的模型统一启用。**

不采用。模型创建者不等于实际协议或中转站能力，可能导致参数被拒绝、静默忽略或改变路由。

**备选方案：所有 OpenAI-compatible 线路发送 `cache_control`。**

不采用。OpenAI-compatible 没有统一显式 Prompt 缓存合同；AI SDK 的该 Provider 当前只统一读取 `cached_tokens`。

### D6：共同历史必须完整原序，Quote/Fork 修正作为前置依赖

实现时必须先满足 Quote/Fork Prompt 合同：

- `buildThreadChatSystem` 不再接受或序列化 `anchorText`；
- Quote 只通过 Message Parts 的唯一确定性转换入口进入模型；
- `compile-model-context` 不再调用 Child 专属 `applyInheritedBudget`；
- 不再插入 `inherited-omitted` 伪 User Message；
- `forkContext` 按保存的有序 Message ID 完整加载；
- 当前 Thread 历史位于继承历史之后；
- 当前 User Message 位于所有共同历史之后。

如果 Quote change 尚未实现完毕，本 change 的缓存断点不能绕过它单独上线，否则会把当前错误前缀缓存得更稳定。

历史 PDF 仍可能因当前 Query 被重新检索，因此 V1 的“确定性共同历史”验收必须区分：

- 无 PDF 或模型可见 PDF 内容未变化的请求：必须逐字稳定；
- 含动态 PDF 重检索的请求：记录为已知限制，不宣称完整历史稳定，留给 V2。

**备选方案：保留 6000 字符截断以减少缓存写入成本。**

不采用。该截断只作用于 Child，会改变语义并破坏 Parent/Child 共同前缀，不符合缓存不得改变行为的原则。

### D7：观测使用三态结果，不建立缓存状态机

从 AI SDK `LanguageModelUsage` 读取：

- `inputTokens`；
- `inputTokenDetails.noCacheTokens`；
- `inputTokenDetails.cacheReadTokens`；
- `inputTokenDetails.cacheWriteTokens`；
- `outputTokens`；
- `raw`。

生成结束时构造标准化缓存观测摘要：

```text
status = hit | miss | unknown
explicitCacheEnabled
inputTokens
noCacheTokens
cacheReadTokens
cacheWriteTokens
outputTokens
usageCompleteness
metricFormula
```

判定：

- `cacheReadTokens > 0` → `hit`；
- 缓存读取字段存在且等于 0 → `miss`；
- 缓存读取字段缺失 → `unknown`。

JavaScript 序列化可能使 `undefined` 字段消失，因此必须在原始 `LanguageModelUsage` 转 JSON 前计算字段是否存在和三态结果，不能事后从 JSON 缺失字段补零。

标准化摘要进入：

1. Langfuse generation/trace metadata；
2. 服务端结构化日志；
3. 现有 generation `providerUsage`，继续保留原始 Provider 用量用于排障。

不新建“缓存生命周期”数据库状态。缓存由 Provider 管理，项目只记录每次模型调用观察到的结果。

日志禁止包含完整 Prompt、用户正文、Quote 正文、附件正文、研究计划正文、API Key 或 Provider 原始请求。可记录版本、模式、模型线路、数值和非敏感布尔字段。

**备选方案：字段缺失按零处理。**

不采用。会把“不支持上报”误报成“未命中”，扭曲模型和 Provider 对比。

**备选方案：根据低命中率自动关闭缓存或切换模型。**

不采用。真实 Opus 5 实验表明同一 TTL 内也可能重新写入；缓存结果属于观测，不能反向改变生成行为。

### D8：指标以 Token 命中率为主，并保留计算口径

完整明细存在时：

```text
Token 缓存命中率 =
cacheReadTokens /
(noCacheTokens + cacheReadTokens + cacheWriteTokens)
```

仅 `inputTokens` 和 `cacheReadTokens` 存在时：

```text
降级缓存覆盖率 = cacheReadTokens / inputTokens
```

每个聚合值必须带口径标识，避免把两种公式混为同一指标。

请求命中率为：

```text
已知请求中 cacheReadTokens > 0 的请求数 / 缓存读取字段已知的请求数
```

另行报告未知率。聚合至少按实际 Provider、上游模型、固定生成模式和 Prompt Schema 版本分组。Project Contract 版本可以作为排障维度，但不建议默认形成高基数长期指标标签；可留在单次 trace metadata 中。

### D9：测试以请求合同和纯策略为主，真实模型实验为发布门槛

自动化测试分为：

1. 固定生成模式快照/结构测试：同一模式静态 System、工具顺序、描述、Schema、首步规则、推理和最大步骤稳定。
2. Prompt 确定性测试：只改变请求 ID、Generation ID 或 `routeReason` 时模型可见前缀不变。
3. Fork 共同历史测试：兄弟 Fork 在当前 User Message 前逐字相同；超过 6000 字符仍完整。
4. 缓存装饰不变性测试：装饰前后移除 Provider Options 后请求深度相等。
5. 白名单测试：仅 UMAPIS Claude Opus 5 与 Sonnet 5 获得显式缓存参数。
6. 三态 usage 测试：命中、未命中、未知和上报失败均按合同处理。
7. 日志安全测试：观测事件不含 Prompt 或正文。

真实 UMAPIS 集成测试不应放入普通 CI，因为会消耗额度并依赖外部 TTL/路由。它应作为受控发布检查：使用唯一合成前缀，先写入再读取，保存标准和原始 usage；如果出现 Opus 5 式重新写入，只记录结果而不阻止功能正确性发布。发布门槛是参数被接受、调用成功、至少一次实验能观察到读取或写入字段，而不是保证固定命中率。

## Risks / Trade-offs

### 中转站缓存分片导致命中不稳定

Opus 5 已在 5 分钟 TTL 内出现重新写入。→ 按模型持续观测命中、写入和未知率；不承诺确定命中，不做自动切换或重试。

### V1 尚未冻结 PDF，历史仍可能漂移

当前附件解析会使用最新问题重新检索历史 PDF。→ V1 验收明确区分无动态 PDF 的稳定前缀；PDF 冻结作为 V2 独立 change，不在本 change 临时打补丁。

### 研究计划仍在早期 System

每个深度研究请求的计划不同，会使其后的历史无法复用旧前缀。→ 保留正确指令权威；记录该模式的实际低命中，不为缓存降级计划。

### 工具或 System 文本修改会自然使缓存失效

任何模型可见静态内容修改都会重新写入缓存。→ 用 Prompt Schema 版本和固定模式合同测试让变化显式可追踪。

### 多步工具调用的实际前缀持续增长

后续 step 会加入 assistant 工具调用和 tool result；它们本来就是当前生成动态历史。→ 固定模式必须保持工具定义和 step 策略不变，但不把同一次生成的动态工具结果宣称为跨请求稳定前缀。

### 缓存写入可能增加首次请求成本

Anthropic Prompt 缓存通常区分创建和读取计量。→ 只对白名单长前缀启用，持续记录写入与读取；V1 不根据短期成本自动控制生成，后续用真实指标评估阈值或 TTL。

### Provider usage 口径不完全一致

不同 Provider 可能缺失写入、读取或未缓存字段。→ 保留标准字段、原始 usage、完整性和公式口径；未知不算未命中。

### Project Contract 版本可能产生高基数指标

每次修改会形成新前缀。→ 单次 trace 保留版本；聚合默认优先按 Provider、模型、模式和 Prompt Schema，Contract 版本按需排障。

## Migration Plan

1. 先实现并验证 Quote/Fork Prompt 合同，确保 `anchorText` 和 Child 专属截断已移除。
2. 引入固定生成模式和 Prompt Schema 版本，但暂不启用显式缓存；用测试确认与当前生成行为一致。
3. 引入 Provider 缓存能力策略和装饰层，仅对白名单模型生成 `cacheControl: { type: "ephemeral", ttl: "5m" }`。
4. 引入标准化缓存观测摘要，并接入现有 Langfuse、日志和 generation usage。
5. 在预发布环境用合成前缀分别验证 Opus 5 与 Sonnet 5：请求成功且返回可识别的缓存读取或写入字段。
6. 上线后按 Provider、模型、固定模式和 Prompt Schema 观察命中、写入及未知率。

回滚时只需在单一 Provider 缓存能力策略中移除或关闭显式缓存资格。回滚 MUST 保留固定模式、共同历史修正和缓存观测，因为它们本身不依赖 Provider 缓存成功。移除缓存装饰后模型可见请求和生成行为必须保持不变。

本 change 不需要数据库迁移。如果后续实现选择给 generation 增加独立标准化列，必须另行遵守项目 migration 流程；V1 可先使用现有 `providerUsage` 与观测 metadata 完成合同。

## Open Questions

- 无阻塞性产品决策。
- 实施阶段需要根据最终模型消息结构确认历史断点附加到 Message 还是最后一个可缓存 Part；选择标准是 Provider 请求合法且装饰前后模型可见内容完全相同。
- 是否将工具定义末尾作为第三个缓存断点，留待 V1 上线指标证明静态工具 Token 占比和收益后再决定，不阻塞本 change。
- UMAPIS Opus 5 的缓存分片或 TTL 内重写根因目前不可见；除非中转站未来提供实际节点元数据，否则保持为外部未知。
