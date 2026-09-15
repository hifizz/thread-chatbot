## Context

thread-chat 当前通过 `resolveResearchRoute()` 把请求分为 `answer`、`fetch`、`search` 和 `research`。`research` 会在主模型调用前生成一次结构化 `ResearchPlan`，然后由 AI SDK 多步工具循环执行 `webSearch`、`readUrl` 和最终综合。`lib/thread-chat/streaming/ui-message-pipeline.ts` 把 route、plan、Reasoning、工具输入输出和 `data-research-activity` 归并进 `ThreadChatUIMessage.parts`；`MessageCheckpointer` 周期性序列化并克隆完整 parts，最终写入 `messages.parts` JSONB。

这个结构适合少量普通联网步骤，不适合数百来源的 Deep Research：

- `readUrl` 每页最多返回 16,000 字符，277 页最多约 4,432,000 字符，尚未计入搜索摘要、URL、Reasoning 和最终报告。
- 运行中 Session 同时保存完整 snapshot 和 replay；checkpoint、SSE、客户端 reducer 和 Project bootstrap 都会重复处理大对象。
- `data-research-activity` 的 running/complete 使用相同 part ID 原位更新，不能作为完整、持久的活动历史。
- 当前只有初始计划，没有计划版本、研究轮次、持久事件序号、来源级状态或可靠失败语义。
- inline `SearchTrace` 按活动展开时会把研究过程铺满消息，数百来源时最终正文难以阅读。

Phase A 参考的成熟产品共同采用“聊天摘要 + 独立研究工作区 + 最终报告”的分层：

| 产品 | 已核实做法 | 本设计采用的部分 |
|---|---|---|
| [ChatGPT Deep Research](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt) | 可查看计划和实时进度；完成报告提供来源与活动历史 | 独立工作区、活动历史、运行中状态 |
| [Gemini Deep Research](https://support.google.com/gemini/answer/15719111?hl=en) | 先生成研究计划；长任务可离开并在完成后返回 | 结构化计划、任务与面板解耦 |
| [Perplexity Advanced Deep Research](https://www.perplexity.ai/help-center/en/articles/13600190-what-s-new-in-advanced-deep-research) | 显示正在读取的来源、阶段性发现和报告形成过程 | 来源目录、安全过程摘要、阶段性发现 |
| [Claude Research](https://support.claude.com/en/articles/11088861-use-research-on-claude) | 多轮搜索根据前一轮结果继续调整并提供引用 | 研究轮次、策略更新、可核对来源 |

当前持久化模型已经规范化为 `projects → threads → messages → artifacts`。每次 assistant 生成尝试对应独立 `messages` 行，因此 Research Run 可以直接以 assistant message 作为所属对象，不需要恢复旧 `branch_generations` 模型。当前分支不是 `develop`，只能修改 `lib/db/schema.ts` 并对独立本地数据库运行 `pnpm db:push`；不得生成、修改或删除 `drizzle/` migration。

## Goals / Non-Goals

**Goals:**

- 仅为 `route.mode === "research"` 建立独立、持久的 Research Run。
- 用只追加事件准确记录计划、搜索、读取、策略更新、阶段性发现、综合和终态。
- 把来源元数据从消息 JSON 中拆出，支持 Run 内去重、状态更新、搜索和 cursor 分页。
- 让完整网页正文只存在于当前模型执行上下文，不进入公开流、Session、消息 JSON 或长期研究记录。
- 聊天正文只显示一张 Research compact entry，并保留最终正文、引用、附件与 Artifact。
- 右侧面板通过“概览 / 活动 / 来源”收纳复杂过程，运行中与历史消息使用同一数据契约。
- 关闭面板不停止研究；刷新后可以恢复已提交的研究摘要、事件和来源。
- 普通 `fetch`、`search` 与没有 sidecar 的历史消息保持兼容。
- 在 277 个来源、320px 视口、200% zoom、键盘和 reduced-motion 环境下保持可用。

**Non-Goals:**

- 第一版不支持计划审批或人工编辑。
- 第一版不支持运行中补充指令、站外通知或报告版本管理。
- 第一版不支持服务进程重启后继续执行；中断 Run 会明确收口为 `interrupted`。
- 第一版不保存完整网页正文，不提供跨 Run 来源缓存。
- 第一版不建立 activity、activity-source、citation 或 claim-source 关系表。
- 第一版不提供来源可信度评分、精确引用覆盖率或跨轮次来源筛选。
- 第一版不复制最终报告到面板，不新增独立报告页面。
- 第一版不引入虚拟列表、图表、关系图、逐行动画或新的第三方依赖。
- 本变更不修改普通 SearchTrace 的产品行为。

## Decisions

### 1. Research Run 与 assistant message 一对一

`research_runs.assistant_message_id` 同时作为主键和外键，指向 `messages.id`，删除 message 时级联删除 Run、Event 和 Source。

选择该方案而不是独立随机 run ID，原因是当前每次 assistant attempt 已有唯一 message 行，retry/edit 也会创建新的 assistant attempt。复用 message ID 可以删除额外身份映射，并自然继承 project/thread/owner 权限链。

只有 route 最终解析为 `research` 才创建 Run。自动路由仍是第一版唯一入口，不新增 `auto/deep/off` 模式字段，避免把本次工作扩大到 composer 和所有生成命令。

### 2. 三张表是最小持久化边界

#### `research_runs`

保存当前状态和快速摘要：

| 字段 | 类型/约束 | 语义 |
|---|---|---|
| `assistant_message_id` | text PK/FK → `messages.id`, cascade | Run identity |
| `contract_version` | integer, default 1 | DTO/schema 版本 |
| `status` | text check | `planning/researching/synthesizing/completed/stopped/failed/interrupted` |
| `route` | jsonb `ResearchRoute` | 已解析 research route |
| `current_plan` | jsonb nullable `ResearchPlan` | 当前有效计划 |
| `plan_version` | integer, default 0 | 初始计划为 1，完整修订递增 |
| `round` | integer, default 1 | 当前研究轮次 |
| `last_event_seq` | integer, default 0 | 已提交的最大连续事件序号 |
| `search_count` | integer, default 0 | 已开始的搜索活动数量 |
| `read_count` | integer, default 0 | 已开始的读取活动数量 |
| `source_count` | integer, default 0 | Run 内去重来源数量 |
| `latest_summary` | text nullable | 当前公开阶段摘要，长度受限 |
| `error_code/error_message` | text nullable | 安全终态错误 |
| `started_at/finished_at` | timestamptz | 生命周期时间 |
| `created_at/updated_at` | timestamptz | 持久化时间 |

数据库 SHALL 约束 `contract_version >= 1`、`plan_version >= 0`、`round >= 1`、`last_event_seq >= 0`、所有 counters 非负，并使用 status allowlist check。`planning/researching/synthesizing` 要求 `finished_at IS NULL`，terminal 状态要求 `finished_at IS NOT NULL`。主查询以 assistant message 主键完成，不新增冗余 project/thread/user 字段。

#### `research_events`

保存只追加活动：

| 字段 | 类型/约束 | 语义 |
|---|---|---|
| `assistant_message_id` | text FK → `research_runs`, cascade | 所属 Run |
| `seq` | integer | Run 内连续提交序号 |
| `idempotency_key` | text | 业务幂等键 |
| `round` | integer | 发生时的研究轮次 |
| `kind` | text check | 事件类型 allowlist |
| `summary` | text | 经过结构、长度与归属校验的公开摘要 |
| `tool_call_id` | text nullable | AI SDK 工具关联键 |
| `payload` | jsonb default `{}` | 版本化、受限结构数据 |
| `occurred_at` | timestamptz | 服务器记录时间 |

约束与索引：

- PK `(assistant_message_id, seq)`，并检查 `seq >= 1`、`round >= 1`。
- UNIQUE `(assistant_message_id, idempotency_key)`；幂等键最多 200 字符。
- INDEX `(assistant_message_id, round, seq)`，用于 Activity 分组。
- summary 最多 300 个 Unicode 字符；payload 只接受按 kind 区分的固定 schema，不接受任意深度 JSON。

#### `research_sources`

保存当前来源目录，不保存网页正文：

| 字段 | 类型/约束 | 语义 |
|---|---|---|
| `id` | text PK | source identity |
| `assistant_message_id` | text FK → `research_runs`, cascade | 所属 Run |
| `canonical_url_hash` | text | 规范化 URL 的 SHA-256 |
| `canonical_url` | text | 规范化 URL，用于碰撞校验 |
| `url` | text | 最近一次有效原始 URL |
| `title/domain/snippet` | text | 受限来源元数据 |
| `status` | text check | `discovered/reading/read/failed/cancelled` |
| `first_seen_seq/last_seen_seq` | integer | 首次和最近事件位置 |
| `created_at/updated_at` | timestamptz | 持久化时间 |

约束与索引：

- UNIQUE `(assistant_message_id, canonical_url_hash)`；hash 碰撞时安全失败，不尝试插入或误合并第二条 URL。
- 检查 `first_seen_seq >= 1` 且 `last_seen_seq >= first_seen_seq`。
- INDEX `(assistant_message_id, first_seen_seq, id)`，作为稳定 cursor 顺序。
- INDEX `(assistant_message_id, status, first_seen_seq, id)`。
- domain 索引仅在实际查询计划证明需要时添加，避免过早堆索引。

不建立 activity-source link 表。搜索完成事件的 payload 保存最多 8 个 `sourceIds`；来源页不承诺跨轮次精确关系查询。

### 3. 字段级权威来源

| 信息 | 唯一权威来源 |
|---|---|
| 整条 assistant 回答终态 | `messages.status` |
| 当前研究阶段、计划、轮次、计数 | `research_runs` |
| 完整研究历史 | `research_events` |
| 来源当前元数据与读取状态 | `research_sources` |
| 最终回答、引用、附件、Artifact reference | `messages.parts` / `artifacts` |
| SSE transient summary | 客户端低延迟缓存 |

`research_runs` 是 Event/Source 的当前摘要，不由客户端重新计算后写回。所有会改变 Event、Source 或 Run counters 的操作在同一事务内完成。

compact entry 的主终态读取 message status；运行中的阶段和计数读取 Run summary。状态映射如下：

```text
message=generating + run=planning      → 正在制定研究计划
message=generating + run=researching   → 正在研究
message=generating + run=synthesizing  → 正在整理研究结果
message=completed  + run=completed     → 研究完成
message=stopped    + run=stopped       → 研究已停止
message=failed     + run=failed        → 研究失败
message=failed     + run=interrupted   → 研究已中断
```

合法 Run 迁移：

```text
planning → researching
researching → synthesizing
synthesizing → researching
planning/researching/synthesizing → completed|stopped|failed|interrupted
```

`researching ↔ synthesizing` 允许整理过程中发现新证据缺口并继续检索。任何 terminal 状态都不能转为另一状态或接受新的普通活动。终态以 `finalizeGeneration()` 完成有效内容判定后的 message 状态为输入，由 research-aware finalize 在同一事务中更新 message、Run、唯一 terminal Event、未结束工具、reading 来源和 Artifact；重复 finalize 幂等返回现有结果。

### 4. Event 类型与 payload

| kind | 触发点 | payload 最小结构 |
|---|---|---|
| `plan_created` | 初始 ResearchPlan 保存 | `{ planVersion, plan }` |
| `plan_revised` | 完整计划被更新 | `{ planVersion, plan }` |
| `strategy_updated` | 方向发生实质调整 | `{ summary }` |
| `finding_recorded` | 形成可公开阶段性发现 | `{ sourceIds: string[] }` |
| `search_started` | webSearch input 可用 | `{ query }` |
| `search_completed` | webSearch 成功 | `{ query, sourceIds }` |
| `search_failed` | webSearch 执行失败 | `{ query?, errorCode }` |
| `search_stopped` | Run 停止时 search 未结束 | `{ query? }` |
| `search_denied` | 工具输入/输出被拒绝 | `{ query?, errorCode }` |
| `read_started` | readUrl input 可用 | `{ sourceId, url }` |
| `read_completed` | readUrl 成功 | `{ sourceId, url, contentChars }` |
| `read_failed` | readUrl 执行失败 | `{ sourceId?, url, errorCode }` |
| `read_stopped` | Run 停止时 read 未结束 | `{ sourceId?, url }` |
| `read_denied` | 工具输入/输出被拒绝 | `{ sourceId?, url, errorCode }` |
| `synthesis_started` | 无活动工具时首次出现公开 text-start | `{}` |
| `run_completed` | message 成功 finalize | `{}` |
| `run_stopped` | stop finalize | `{}` |
| `run_failed` | error finalize | `{ errorCode }` |
| `run_interrupted` | runtime 恢复遗留 generating | `{ errorCode: "PROCESS_RESTARTED" }` |

幂等键使用稳定业务身份，例如：

```text
plan:1:created
search:{toolCallId}:started
search:{toolCallId}:terminal
read:{toolCallId}:started
read:{toolCallId}:terminal
synthesis:{round}:started
run:terminal
```

terminal 幂等键不包含 outcome，因此同一 toolCall 的 completed、failed、stopped 和 denied 只能有一个胜出结果；`run:terminal` 同理只允许一个 Run 终态。

同一 Run 的 `appendResearchEvent()` 事务流程：

1. `SELECT ... FOR UPDATE` 锁定 `research_runs` 行。
2. 以 `(assistantMessageId, idempotencyKey)` 查询现有 Event；无论 Run 是否已终态，只要存在就直接返回，不更新 seq、来源、计划或计数。
3. 幂等键不存在且 Run 已终态时，拒绝追加任何新事件。
4. 取 `last_event_seq + 1` 作为新 seq；事务回滚和重复事件不消耗序号。
5. 按事件 upsert sources，状态转换不得倒退。
6. 更新 plan version、round、Run status、latest summary 和 counters。
7. 插入 Event 并提交。
8. 事务成功后发布 transient Run summary。

并行工具通过 Run 行锁串行分配 seq；seq 表示服务器提交顺序，不声称代表外部网页响应的绝对时间。Run terminal event 必须是最后一条 Event，提交后不再接受普通活动。

### 5. URL 规范化与来源状态

规范化和请求安全边界位于服务端纯函数与联网 provider adapter：

- 只接受无 userinfo 的 `http:` / `https:` URL，拒绝控制字符。
- host 和 scheme 小写，删除 fragment 和默认端口，规范化空 path 与 trailing slash。
- tracking 参数只删除明确 allowlist；敏感参数名按大小写无关 denylist 删除，第一版包含 `access_token`、`api_key`、`apikey`、`auth`、`authorization`、`signature`、`sig`、`session`、`session_id`、`x-amz-signature`、`x-goog-signature`。raw URL 只能供当次 provider 调用，不进入 Event、Source、日志或客户端；普通业务 query 不猜测删除。
- URL、title、domain、snippet 上限分别为 2,048、500、253 和 2,000 字符。
- 对 canonical URL 计算 SHA-256；数据库以 `(assistantMessageId, hash)` 唯一。hash 命中但完整 canonical URL 不同时安全失败，不误合并也不覆盖已有来源。
- DNS 解析和每一次重定向都拒绝 loopback、RFC1918、link-local、metadata、IPv6 本地/私网及非 HTTP(S) 目标，防止重定向绕过。
- 沿用并补齐连接超时、总超时、最多 5 次重定向、响应字节、解压后字节、每 Run 最多来源/事件/读取次数和累计元数据硬上限；具体预算集中在 `constants/research.ts`，服务端严格校验。
- 来源 API 使用 `Cache-Control: private, no-store`；title、snippet、summary 只以文本渲染，外链使用 `noopener noreferrer`。

第一版预算集中定义并由 provider adapter 和 Research service 同时执行：

| 预算 | 上限 |
|---|---:|
| 每个 Run 的去重来源 | 500 个 |
| 每个 Run 的 Research Event | 2,500 条 |
| 每个 Run 的 readUrl started | 500 次 |
| 每个 Run 的公开 Research 元数据 | 2,000,000 bytes |
| 单次 provider 原始响应 | 5,000,000 bytes |
| 单次解压后响应 | 10,000,000 bytes |
| 单次读取重定向 | 5 次 |
| 每个 Run 的公开过程摘要 | 4 次 |

provider-managed extract 如果不能证明其重定向和响应预算满足上述要求，适配器必须在可观测边界执行等价限制或安全拒绝，不得默认为已满足。

来源状态只保存当前最佳结果：

```text
discovered → reading → read
                 ↘ failed → reading → read
                 ↘ cancelled → reading → read
```

有效 readUrl input 在 `read_started` 前创建或取得 source identity。输入在 URL 通过校验前被 denied 时不创建 Source；Source 已进入 `reading` 后收到 output-denied、stop 或 abort 时，terminal Event 与 Source `cancelled` 在同一事务提交；执行错误写为 `failed`；成功写为 `read`。成功 `read` 是最高状态，不因后续失败或再次发现退回。Run 进入 stopped、failed 或 interrupted 时，同一终态事务为未结束工具追加 stopped terminal Event，并把所有 `reading` 来源收口为 `cancelled`。

### 6. 公开过程摘要由受限工具产生

不从 raw reasoning 推断“反思”或“再计划”。research 模式增加可选 `recordResearchUpdate` 工具：

```ts
type ResearchUpdate =
  | {
      kind: "strategy_update"
      summary: string
      revisedPlan?: ResearchPlan
    }
  | {
      kind: "finding"
      summary: string
      sourceUrls: string[]
    }
```

服务端可机械验证的边界：

- 只接受专用工具产生的 discriminated union，不从 raw reasoning、网页正文或普通 tool output 自动提取。
- summary 最多 300 个 Unicode 字符，sourceUrls 最多 8 个且必须属于当前 Run。
- 拒绝未知字段、未知类型、控制字符、已知密钥/认证头字段模式和超出嵌套深度的 payload。
- 通过后的 summary 以纯文本存储与渲染，不作为 HTML 或 Markdown 执行。
- 每个 Run 最多接受 4 次；超过后返回 `{ recorded: false, reason: "limit_reached" }`，不写 Event。
- prompt 明确要求仅在策略实质改变或形成阶段性发现时调用，优先与下一次 search/read 同一模型 step 发出。
- 缺失或拒绝 update 不阻断研究，该工具不进入 search/read counters。
- 网页 prompt injection 仍可能影响模型生成文字，因此设计不宣称能语义证明摘要绝不含隐藏信息；无法通过机械校验的 update 直接丢弃。

现有 `RESEARCH_MAX_STEPS` 从 20 调整为 24，为最多 4 次 bookkeeping tool 调用留出余量；仍由独立 update 次数限制防止循环。实施时必须用安装版 AI SDK v7 验证工具 step 计数；若 update 明显削弱 substantive search/read 预算，则第一版保留 Event 类型但不向模型暴露该工具。

选择受限工具而不是展示 Reasoning，是为了获得稳定事件类型和可机械限制的公开文本。选择可选调用而不是每步强制，是为了避免进度记录反过来削弱研究质量。

### 7. Deep Research 工具输出在进入 UI stream 前裁剪

模型内部必须继续获得完整 webSearch snippets 和 readUrl content，否则无法完成研究；公开 UI stream 不需要这些大结果。

处理顺序：

```text
streamText 内部工具循环
  └─ 模型收到完整 tool result
       ↓
toUIMessageStream 生成完整 UI chunk
       ↓
research recorder（仅 research）
  ├─ 根据完整 chunk 事务写 Event / Source / Run
  └─ 事务失败则 fail closed
       ↓
research public sanitizer
  ├─ webSearch output → { query, sourceIds, resultCount }
  ├─ readUrl output → { sourceId, url, contentChars, fetched: true }
  ├─ source/provider metadata → 字段白名单 + 容量限制
  └─ 生成轻量 UI chunk 与 transient Run summary
       ↓
现有 reducer / Session / SSE / checkpoint / finalize
```

具体边界落在 `lib/thread-chat/streaming/ui-message-pipeline.ts` 的 `toUIMessageStream()` 输出与 `reducerWriter.write()` 之间。recorder 先消费完整 UI chunk；事务提交后 sanitizer 才把公开 chunk 交给 reducer、Session、`onSnapshot` 和 `session.publish()`。recorder、sanitizer 或 source upsert 失败时中止 research，完整 output 不得退回旧 pipeline、日志或错误响应。不在客户端 live parts 上执行 splice/filter，也不修改当前模型循环使用的对象。

对 Deep Research：

- `sendReasoning` 关闭，raw reasoning 不进入客户端。
- `data-research-route`、`data-research-plan`、旧 `data-research-activity` 不作为新 Run 的长期事实来源。
- research webSearch/readUrl tool parts 不进入公开 parts，面板从 sidecar 获取活动。
- `data-research-run-summary` 使用固定 ID、`transient: true`，只携带版本、状态、计数、plan version、round 和 lastEventSeq；它可以进入轻量 Session replay，但 checkpoint/finalize 必须移除。
- text、file、artifact reference 和经过字段白名单的 source citation parts 保持原顺序；`source-document`、provider metadata 与未知 source 类型不得无条件透传。
- `buildAiTelemetryConfig()` 在 research 模式关闭 input/output 内容捕获；开发工具、应用日志和 error cause 不记录完整工具 output，只允许 identity、字符数、状态和稳定错误码。
- stop、abort、tool denied、协议错误与 recorder 失败路径使用同一 sanitizer，不得旁路。
- 最终持久化 snapshot 必须来自已消费公开 chunk 的 Session snapshot，不得改用含完整 output 的原始 pipeline result。

对普通 `fetch/search`：沿用现有 dispatcher、tool parts、data activity 和 SearchTrace，不经过 Research recorder 或专用裁剪。

最终持久化不使用“删除所有 tool/data”的黑名单，而是让 research 公开流从源头不产生大 parts；`stripTransientParts` 在 checkpoint/finalize 时移除 Run summary。这样不需要在终态对完整消息做危险的二次清理。

### 8. DTO、Bootstrap 与实时缓存

新增版本 envelope 与 v1 summary：

```ts
interface ResearchRunEnvelopeDTO {
  exists: true
  contractVersion: number
  payload: unknown
}

interface ResearchRunSummaryV1DTO {
  assistantMessageId: string
  status: ResearchRunStatus
  route: ResearchRoute
  currentPlan: ResearchPlan | null
  planVersion: number
  round: number
  lastEventSeq: number
  searchCount: number
  readCount: number
  sourceCount: number
  latestSummary: string | null
  startedAt: string
  finishedAt: string | null
  error: { code: string; message: string } | null
}
```

`MessageDTO` 增加必有但可为 null 的 `researchRun: ResearchRunEnvelopeDTO | null`。Project bootstrap 中的 message 与单条 message GET 都返回同一字段：没有 Run 时为 null；存在 Run 时 envelope 始终可解析，payload 再按 contractVersion 分发给对应 schema。这样 `exists=true` 与“summary 是否已加载或是否支持该版本”不会混为一谈，`reconcileTerminalMessage()` 也能在一次 store 更新中同时收口 message 和 Run。

normalized store 增加：

```ts
researchRunEnvelopesByMessageId: Record<string, ResearchRunEnvelopeDTO>
```

已知 v1 payload 通过 selector 解析为 `ResearchRunSummaryV1DTO`；未知版本仍保留 existence/version，并让 compact entry 显示兼容错误而不是退回 legacy traces。

合并规则：

1. 已知 payload 的 assistantMessageId 必须与 MessageDTO ID 匹配。
2. contractVersion 未知时保留 existence/version，不解释 payload，并让 entry 与面板进入兼容错误状态。
3. 已知版本中，更大的 `lastEventSeq` 胜出。
4. seq 相同时，更大的 planVersion 胜出。
5. terminal 状态不得被迟到的非终态 summary 覆盖。
6. API/terminal DTO 可以纠正 transient cache；较旧响应不得让状态倒退。

Event 和分页 Source 不进入 Project 全局 bootstrap；面板组件通过专用 query state 按 active assistant message 加载，关闭后可以释放详情列表。

### 9. Detail 与 Sources API

API 均通过 assistant message → thread → project → current user 做 owner-scoped 查询，不信任客户端提供的关联字段。已登录请求的资源不存在或不属于当前 owner 时统一返回 `404 NOT_FOUND`；参数/cursor schema 错误返回 `400 VALIDATION_ERROR`；持久 Event seq 缺口返回 `409 STATE_CONFLICT`。响应统一使用 `Cache-Control: private, no-store`。

#### 研究详情

```http
GET /api/thread-chat/v1/messages/{messageId}/research?afterSeq=42&limit=100
```

参数：

- `afterSeq`：排他游标，默认 0，必须为非负整数。
- `limit`：默认 100，allowlist 范围 1–200。

响应：

```ts
interface ResearchDetailDTO {
  run: ResearchRunEnvelopeDTO
  events: ResearchEventDTO[]
  nextAfterSeq: number
  latestSeq: number
  hasMore: boolean
}
```

语义：

- Event 满足 `seq > afterSeq`，按 seq ASC；非空批次首条必须为 `afterSeq + 1` 且批次内部连续。
- `nextAfterSeq` 是本批最后 seq；空批次保持输入 afterSeq。
- API 发现持久 seq 缺口时返回稳定一致性错误，不返回缺口后的事件。
- `latestSeq` 来自与事件查询相同的事务快照，或允许是更大的最新值；客户端始终按连续游标追赶。
- 积压超过 limit 时 `hasMore=true`，客户端立即继续请求。
- 追平后，面板打开且 Run 非终态时约每秒轮询；前一请求未完成时不得叠加。
- 页面不可见时降低频率；面板关闭或切换 message 时取消当前详情请求。
- Run terminal 后先追到 `latestSeq`，再停止轮询；迟到响应按 assistantMessageId 隔离。

#### 来源分页

```http
GET /api/thread-chat/v1/messages/{messageId}/research/sources
  ?cursor={opaque}
  &limit=25
  &q=...
  &status=read
  &domain=example.com
```

响应：

```ts
interface ResearchSourcesPageDTO {
  items: ResearchSourceDTO[]
  nextCursor: string | null
  total: number
  filteredTotal: number
}
```

- 默认和最大每页数分别为 25 和 100。
- cursor 是 base64url 编码的 `{ version, assistantMessageId, firstSeenSeq, sourceId, filterHash }`，不引入签名密钥；服务端使用 strict schema 完整校验并重新计算 filterHash，cursor 不是授权依据，客户端值不得直接成为数据库条件。
- q 最多 200 字，搜索 title、domain 和 snippet；SQL wildcard 按字面转义。
- status 使用 allowlist；domain 是最多 253 字的精确值。
- cursor 必须绑定当前 message 与规范化后的 q/status/domain；过滤变化清空 cursor，从第一页重新加载。
- 默认排序为 `(firstSeenSeq ASC, id ASC)`，运行中新来源只追加到后续游标范围，不让已浏览条目重复。
- 第一版不提供 round、可信度或 citation filter。

### 10. 聊天摘要卡与 assistant body

`ConversationViewMessage` 增加 `researchSidecarKnown` 与可选、已解析的 `researchRun`。`assistantPartRenderPlan()` 不把 entry 伪造成 `ThreadChatUIPart`，而是先建立独立 synthetic `research-entry` item：

1. 每个 assistant body render plan 在 `researchSidecarKnown=true` 时无条件输出且最多输出一个 entry；entry 固定排在所有最终 text/source/file/附件/Artifact/非研究工具交付 item 之前，即使 message parts 为空也成立。
2. summary 已解析时展示正常 Run 状态；版本未知或加载失败时展示兼容/加载错误 entry。
3. sidecar 已知时跳过该 Run 的 reasoning、webSearch/readUrl tool、route/plan 和旧 data activity 展示。
4. 保留全部 text、经过白名单的 source citation、file、附件、Artifact reference 以及非研究工具 parts，顺序不变。
5. `researchSidecarKnown=false` 且存在 legacy research parts 时使用当前 inline traces。
6. 从列模式或 Canvas 打开时记录实际 trigger element；关闭后返回该实例，而不是按 messageId 查找第一个 entry。

运行中：

```text
┌─ Deep Research ─────────────────────────┐
│ 正在研究 · 第 2 轮                      │
│ 正在核对系统日期与版本变更              │
│ 8 次搜索 · 21 次读取 · 43 个来源 [查看] │
└─────────────────────────────────────────┘
```

完成后：

```text
┌─ Deep Research ─────────────────────────┐
│ 研究完成                                │
│ 12 次搜索 · 38 次读取 · 277 个来源      │
│                               [查看依据] │
└─────────────────────────────────────────┘

最终回答正文……
```

entry 使用原生 button 打开面板；状态不能只靠颜色表达。运行中更新原位发生，不追加卡片，不自动抢焦点。

### 11. 独立右侧 Research Panel

复用 `.art-drawer` 的固定位置、层级、纸张表面和滑入几何，但不把 Research 业务并入 `ProjectPanel`。第一版不抽取通用 DrawerShell；两个业务面板只共享现有语义 CSS，避免为了两个调用点提前建立复杂抽象。

同一时刻只允许一个右侧工作面板：

```text
openResearch(messageId) → close ProjectPanel → open ResearchPanel
openArtifact(id)        → close ResearchPanel → open ProjectPanel
```

桌面为 `aria-modal=false` 的非模态工作区，不限制焦点在面板中；打开后聚焦标题或主操作，关闭后返回触发 entry。移动端断点使用近全屏单栏、阻止背景误触并保持 44px 主操作触控区域。

面板结构：

```text
┌──────────────── Deep Research ───────────────┐
│ 研究中 · 第 2 轮                    [停止][×]│
│ 12 次搜索 · 38 次读取 · 277 个来源           │
├──────────────────────────────────────────────┤
│ [概览]          [活动]          [来源 277]   │
├──────────────────────────────────────────────┤
│ 当前阶段                                     │
│ 正在核对官方更新记录                         │
│                                              │
│ 研究计划                                     │
│ ✓ 明确时间范围                               │
│ ✓ 收集官方记录                               │
│ ● 交叉验证版本差异                           │
│ ○ 整理最终结论                               │
│                                              │
│ 最新发现                                     │
│ 官方记录与第三方页面存在日期差异             │
│ 依据 4 个来源                                │
└──────────────────────────────────────────────┘
```

- **概览：** 当前阶段、计数、只读当前计划、最新公开发现、错误与限制。
- **活动：** 按 round 分组；当前 round 展开，历史 round 折叠；Event 按 seq ASC；用户离开底部后不强制贴底，提供“回到最新活动”。
- **来源：** 当前页 25 条，搜索、status/domain filter、稳定分页；来源详情显示完整 URL、受限摘要和原页面链接。

Panel 只有一个主垂直滚动区域；header 和 tabs 固定，不给每个 section 创建嵌套滚动框。URL 使用 `overflow-wrap:anywhere`；长报告不在面板重复渲染。

产品状态：

| 状态 | 面板行为 |
|---|---|
| loading | 保留 shell/tabs，显示静态骨架和“正在加载研究任务” |
| empty | 解释计划或活动尚未产生，不混同“没有来源” |
| researching | 展示阶段和最近受限公开摘要，按需轮询 |
| completed | 停止追平后的轮询，保留历史与来源 |
| stopped | 显示已保存阶段和来源数量；允许查看部分结果，使用既有 retry 时创建新 assistant attempt/Run，不恢复原 Run |
| failed | 显示安全错误和保留内容；允许查看，既有 retry 创建新 assistant attempt/Run |
| interrupted | 明确说明进程中断；允许查看已提交内容或用既有 retry 重新生成，不显示“继续原任务” |
| detail API error | 显示“任务可能仍在运行”；只提供重新加载详情和关闭面板，不改 Run 状态 |

状态播报通过稳定 `aria-live="polite"` 区域每 5–10 秒合并更新，不逐来源播报；失败使用现有 alert 语义。Tabs 使用 `tablist/tab/tabpanel`、关联 ID、方向键与 Home/End；disclosure 使用原生 button + `aria-expanded`；分页、关闭和停止均使用原生控件与 `:focus-visible`。桌面 Panel 为 `aria-modal=false` 的非模态工作区；移动端近全屏时背景设置 inert 或等价 pointer/keyboard 隔离，Escape 先关闭菜单再关闭 Panel。触发 entry 已卸载时，关闭后焦点回到所属 message 或最近可用聊天容器。reduced-motion 下 drawer 改为短淡入或即时切换，不依赖位移动画表达状态。

### 12. 停止、关闭、刷新与历史兼容

- route 解析为 research 后、planner 调用前幂等创建 Run；Run 创建失败时 generation 安全失败，不得继续走会公开完整工具输出的旧 research 路径。
- 关闭 Panel 只取消当前 message 的 detail/source 请求和本地 UI 状态，不调用 stop、abort 或 command dispose。
- 停止复用现有 `stopMessage` 命令；同一 Run 的 tool terminal 和 Run terminal 使用固定幂等键。
- research-aware finalize 先锁 message 与 Run；若 message 已终态则幂等返回。否则先完成既有有效内容判定，再关闭未结束工具、把 reading sources 改为 cancelled、追加唯一 Run terminal Event、更新 Run 与 message 终态并写 Artifact，全部在同一事务提交。提交后才发布 terminal summary 和现有 message terminal 通知。
- Project bootstrap 和 message GET 通过 `MessageDTO.researchRun` envelope 加载 sidecar existence/summary；`bootConversationProject()` 对 generating message 保持既有后台轮询，Research Panel 打开时另行追赶 Event。
- runtime 启动时现有 PROCESS_RESTARTED 恢复逻辑使用同一 research-aware terminal transaction，把 Run 标为 `interrupted`、关闭未结束工具/source 并追加 terminal Event。
- 新 UI 的唯一选择顺序是：`sidecarKnown=true` → compact entry + Panel；`sidecarKnown=false` 且旧 parts 存在 → 旧 inline traces；两者都不存在 → 普通消息。未知版本仍属于 sidecarKnown，不得 fallback。
- 双写阶段 sidecar 作为新 Panel 唯一来源，旧 parts 仅用于旧 UI 验证，不在新 Panel 中合并，避免两份状态互相覆盖。

### 13. 文件职责

计划新增或集中修改：

```text
lib/thread-chat/contracts/
  research.ts                         # Zod/DTO/event/source/API contracts

lib/thread-chat/application/
  research-service.ts                 # Run 创建、事件事务、终态收口

lib/thread-chat/persistence/
  research-repository.ts              # owner-scoped query、cursor、Drizzle 写入

lib/thread-chat/streaming/
  research-recorder.ts                # AI SDK chunk → Event/Source/Run
  research-public-chunks.ts           # research 工具公开裁剪与 transient summary
  ui-message-pipeline.ts              # 组合 recorder 与现有 reducer

lib/chat/
  research-tools.ts                   # recordResearchUpdate + search/read observer
  research-contract.ts                # 复用并扩展现有 ResearchPlan

app/api/thread-chat/v1/messages/[messageId]/research/
  route.ts                            # detail afterSeq API
  sources/route.ts                    # source cursor API

app/thread-chat/core/
  types.ts                            # researchRunEnvelopesByMessageId、ConversationViewMessage
  store.ts                            # envelope/summary merge 与 hydrate
  projections.ts                      # message + summary → view message

app/thread-chat/orchestration/research/
  research-entry.tsx
  research-panel.tsx
  store-bound-research-panel.tsx
  research-panel-logic.ts
  research-overview.tsx
  research-activity-list.tsx
  research-source-list.tsx

app/thread-chat/orchestration/overlays/
  use-workspace-overlays.ts           # 单一右侧面板互斥选择

app/thread-chat/branching/assistant/
  assistant-part-render-plan.ts       # research-entry 与 legacy fallback
  anchored-assistant-body.tsx         # entry 打开面板

app/thread-chat/styles/
  research-entry.css
  research-panel.css
  drawer.css                          # 仅必要的共享几何补充
  thread-chat.css                     # 按级联顺序引入新样式

lib/db/schema.ts                      # 三表与 relations；本分支无 migration
```

文件拆分以职责为准；如果实施时某个列表组件很短，可保留在 `research-panel.tsx`，不得为了匹配树形图创建只有一次使用的空壳组件。

### 14. 测试策略

仓库没有独立 test runner，沿用 Node `.test.mjs`、TypeScript 检查、ESLint 和 Ego Browser：

- **契约与纯逻辑：** 完整 Run/source 状态迁移、URL canonicalization 与受限地址判定、版本 envelope、cursor/filter hash、event/payload schema、source 状态不倒退、summary 合并。
- **Repository 并发：** 100 个并发 append 产生连续无缺口 seq；相同 idempotency key 只产生一条 Event；同一 tool terminal outcome 竞争只允许一个结果；terminal 与迟到 Event 竞争后不能追加；source 去重和 read 优先级正确。
- **终态事务：** message、Run、terminal Event、未结束工具、reading sources 和 Artifact 任一步失败时全部回滚；空响应改判失败与 PROCESS_RESTARTED 都同步收口；重复 finalize 幂等。
- **内容隔离：** 使用唯一哨兵正文，断言它不出现在 SSE、Session snapshot/replay、checkpoint、terminal parts、Event、Source、telemetry、开发工具、日志或 error cause；覆盖 recorder failure、abort 和 source-document；普通 fetch/search fixture 与变更前等价。
- **恢复与 API：** bootstrap/message GET envelope、未知版本、迟到响应不倒退、seq gap 报错、terminal backlog 追平、cursor 跨 message/filter 拒绝、A/B Run 请求隔离。
- **UI：** sidecar message 恰好一个 synthetic entry；零 parts 终态仍显示；未知版本不 fallback；非研究工具和交付 parts 保留；Panel/ProjectPanel 互斥；277 source 分页；关闭不调用 stop。
- **安全：** owner scope、跨 Run source 拒绝、SSRF/DNS/redirect/private address/userinfo/sensitive query、响应和累计预算、纯文本/XSS、`private, no-store`。
- **Ego Browser：** 桌面亮/暗色、移动端背景 inert、列模式与 Canvas 的焦点返回、键盘 tabs/disclosure/pagination、200% zoom、reduced-motion；使用离线 fixture，不发付费模型请求。
- **数据库：** 功能分支只在独立本地库运行 `pnpm db:push`；develop 生成 migration 后检查 SQL，并从上一版本 schema 执行 `pnpm db:migrate`。

## Risks / Trade-offs

- **[额外进度工具消耗模型步骤]** → 最多 4 次、返回极小、优先与 search/read 同 step、研究总步数增加对应余量；缺失 progress 不阻断主流程。
- **[Run summary 与 Event 不一致]** → Event/Source/counters 同事务，重复幂等键不重复计数，客户端不根据 Event 反写 Run。
- **[SSE summary 领先 API]** → summary 携带 lastEventSeq；Panel 从最后连续 seq 追赶，不能跳过缺口。
- **[较旧 API 响应覆盖实时状态]** → 使用 lastEventSeq、planVersion 和 terminal 不倒退规则合并。
- **[并行工具事件顺序不稳定]** → 数据库提交时串行分配 seq，并在文案中把它定义为系统记录顺序。
- **[来源 canonicalization 误合并]** → 只移除安全 tracking 参数，hash 命中后比较完整 canonical URL。
- **[不保存网页正文降低重现能力]** → 保存 URL、摘要、访问状态和事件；第一版明确不承诺离线复现或跨进程续跑。
- **[Panel 每秒轮询增加请求]** → 仅打开且非终态时轮询，积压立即追赶，页面隐藏降频，禁止并发叠加。
- **[旧消息与新 sidecar 同时显示]** → sidecar 存在时新 UI 独占；旧 parts 仅在 sidecar 不存在时 fallback。
- **[移动端非模态 drawer 造成背景误触]** → 移动端切换为近全屏 dialog 语义并禁用背景；桌面保持非模态。
- **[本分支 schema 与数据库不一致]** → 只对独立本地库 db:push；在 develop migration 生成和升级测试前不得视为可部署。
- **[一次实现跨越数据库、流和 UI，回滚复杂]** → additive schema、先 sidecar 双写验证、再启用 Panel、最后切断 Deep Research 的旧 inline parts；普通 search 始终不变。

## Migration Plan

1. **Expand schema（功能分支）**
   - 在 `lib/db/schema.ts` 增加三表与 relations。
   - 不生成或改动 `drizzle/`。
   - 对当前 worktree 的独立本地数据库运行 `pnpm db:push`，验证约束和 repository 测试。

2. **建立 sidecar 写入，不切换 UI**
   - research route 创建 Run。
   - recorder 双写 Event/Source/Run summary，同时保留旧 research parts 展示。
   - 对同一 fixture 比较旧活动与 sidecar 事件的数量、顺序和终态。

3. **接入 API、Bootstrap 和客户端 summary**
   - bootstrap 和 message GET 通过 `MessageDTO.researchRun` 返回版本 envelope。
   - detail/source API owner-scoped、分页和限流参数生效。
   - 客户端支持 transient summary、seq 追赶和历史恢复。

4. **启用 compact entry 与 Panel**
   - `sidecarKnown=true` 时启用唯一 compact entry；summary 未加载或版本未知时显示对应错误状态。
   - `sidecarKnown=false` 时才允许继续旧 inline UI。
   - ProjectPanel 和 ResearchPanel 保持互斥。

5. **收紧 Deep Research 公开流**
   - recorder 在裁剪前写 sidecar。
   - Deep Research 禁止 raw reasoning 进入客户端。
   - 搜索/读取大结果不进入公开 stream 和 message parts。
   - 验证最终 text、引用、附件和 Artifact 不受影响。

6. **验证与灰度边界**
   - 完成 typecheck、lint、相关 Node tests、repository tests、stream fixture 和 Ego Browser 全状态验收。
   - 不增加客户端 feature flag。服务端私有回滚开关只阻止新建 Research Run 和发送新 summary，不影响已有 sidecar 的读取与新 UI 选择；开关关闭时，新 research 请求必须走明确安全失败或已验证降级，不能把完整 tool output 重新送入旧 pipeline。如果现有配置系统无法提供该边界，实施时补一个服务端私有开关，不暴露为客户端设置。

7. **Develop 集成 migration**
   - 合并到 `develop` 后由单一集成任务运行 `pnpm db:generate`。
   - 检查 SQL 只包含三张新增表、约束、索引和关系，没有意外删除、重命名或类型变化。
   - 在上一版本数据库执行 `pnpm db:migrate`，再运行完整验证。
   - 先部署兼容 schema，再部署依赖新表的应用代码。

8. **Rollback**
   - 应用回滚时停止新建 Research sidecar，新 schema 保留，不在事故窗口 drop table。
   - 旧应用继续忽略新表；旧消息 parts 和普通 SearchTrace 可继续工作。
   - 已有 sidecar 数据保留，重新上线后可继续读取；正在运行但失去执行进程的 Run 收口为 interrupted。

## Open Questions

- 当前设计已明确第一版范围，没有阻塞 spec/design 的产品问题。
- `recordResearchUpdate` 是否能稳定与 substantive tool call 同 step，需要在实施阶段用安装版 AI SDK v7 行为测试验证；如果会显著降低搜索预算，第一版保留 Event 类型但不向模型暴露该工具，只显示可确定的 plan/search/read/synthesis 事件。
- Deep Research 服务端私有回滚开关应复用哪个现有配置入口，需要在实施前检查项目配置模式；它不得成为客户端可选择的 provider/routing 设置。
