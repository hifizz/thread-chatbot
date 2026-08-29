## Context

见 `proposal.md` 的动机。本 change 横跨 Next.js 启动、AI SDK v7 模型调用、规范化 Thread Chat 后台生成、过渡期 `/api/chat`、Search provider 路由、消息反馈、评测数据和 CI，因此需要先统一身份、隐私和失败边界。

当前实现提供以下可复用基础：

- `lib/thread-chat/streaming/run-generation.ts` 已经包住一次规范化生成从读取 Message 到终态落库、Session finish 的完整服务端生命周期，是根 Trace 的首选边界。
- `lib/thread-chat/streaming/generation-plan.ts` 负责研究路由、研究计划、工具集和正式 `streamText`；路由、计划、回答和 embedding 已使用 `MODEL_CALL_PURPOSE` 区分用途。
- `lib/ai/model-call-logger.ts` 只输出 prompt 结构摘要、模型、用途和关联 ID，不输出正文，可继续作为远程遥测不可用时的诊断通道。
- 规范化 `messages` 表把每个 assistant Message 定义为一次独立生成尝试，并直接保存 feedback、provider usage、finish reason、错误和终态；不需要恢复旧 `generation` 旁路实体。
- feedback 命令已经在数据库事务和幂等命令收据内完成，外部 Score 只能放在事务提交后。
- `add-web-search-provider-routing` 已经规划 provider attempt event 和项目评测集，但尚未实施；本 change 提供共享可观测性与实验平台，它只保留 provider 合同、故障和策略专项测试。
- 项目没有通用测试框架，现有可执行测试使用 Node.js、`tsx` 和项目脚本；评测初期沿用该方式，避免仅为 experiment runner 引入另一套测试基础设施。
- 当前 `package.json` 未声明 Node.js engines，README 仍以旧运行时为准；AI SDK v7 当前遥测与 DevTools 配套要求 Node.js 22 以上。

## Goals / Non-Goals

**Goals:**

- 用 AI SDK 官方遥测注册同时支撑本地 DevTools 和 Langfuse，避免每个模型调用手写不同 exporter。
- 让一个 assistant Message 的路由、模型步骤、工具、Search attempt、后台消费和终态形成一棵可追踪的运行树。
- 保持数据库为会话与反馈事实源，Langfuse 只承担观测、分析、Score 和实验。
- 以 metadata-only 的生产默认策略降低隐私风险和 Cloud 用量；需要内容时采用明确环境或 cohort 开关和统一脱敏。
- 以项目内版本化 case 为评测事实源，并使用 Langfuse Datasets/Experiments 提供运行、比较和可视化。
- 允许从 Langfuse Cloud 平滑切到兼容的 Langfuse OSS endpoint。

**Non-Goals:**

- 不把 `streamText`/现有工具循环重构成新的 Agent 框架或 `ToolLoopAgent`。
- 不新增 generation 业务表或另一份 Message 状态；feedback Score 使用一张仅承载投递状态的持久化 outbox，产品 `messages.feedback` 仍是唯一事实源。
- 不在第一阶段部署 OpenTelemetry Collector、ClickHouse、Grafana、Phoenix、Promptfoo 或自建观测 UI。
- 不将 AI Elements 引入为第二套聊天组件系统；产品内公开活动时间线另立 change。
- 不记录或展示隐藏思维链；现有可公开 reasoning part 仍按产品协议处理。
- 不在第一阶段对所有评测维度设定阻断阈值，也不自动把生产内容复制进评测集。
- 不把模型 usage 重新解释为计费；本 change 只保留原始 usage 和可选估算成本。

## Decisions

### D1. 使用 AI SDK v7 遥测注册作为唯一模型/工具采集入口

根级 `instrumentation.ts` 只处理 Next.js runtime 分流；Node.js 专用模块负责初始化 OpenTelemetry、Langfuse span processor，并通过 AI SDK `registerTelemetry(...)` 注册环境对应的 integrations。注册必须带进程级幂等保护，避免开发热更新或测试重复初始化。

环境矩阵：

| 环境       |      AI SDK DevTools |                     Langfuse |                           内容记录 |
| ---------- | -------------------: | ---------------------------: | ---------------------------------: |
| 本地开发   | 默认开启，可显式关闭 |                     默认关闭 |     仅本机，可包含完整开发输入输出 |
| 自动测试   |                 关闭 |                     默认关闭 |                               关闭 |
| 显式评测   |                 关闭 | 使用独立 environment/project |          对批准 fixture 开启并脱敏 |
| staging    |                 关闭 |                         开启 |             默认关闭，允许受控开启 |
| production |             强制关闭 |                 有凭据时开启 | 默认关闭，仅显式抽样 cohort 可开启 |

所有 `streamText`、`generateText`、embedding 和后续 rerank 调用通过共享 helper 设置稳定的 `functionId`、是否记录输入输出以及运行上下文。`functionId` 优先复用 `MODEL_CALL_PURPOSE`；新增工具/步骤名称进入 `constants/`，不在调用点散落字符串。

保留 `withModelCallLogging`，但让它复用同一份关联上下文和脱敏摘要。第一阶段不删除日志 middleware，避免 Langfuse 配置错误时完全失去模型调用证据；稳定后再评估重复日志成本。

**替代方案：**仅使用 Langfuse 手写 tracing。它能工作，但会绕过 AI SDK 对模型步骤、工具、embedding 和 usage 的原生生命周期，后续每种调用都需维护适配。仅使用原始 OpenTelemetry 则缺少开箱即用的 Agent/模型视图和 experiment 闭环。

### D2. 本地使用 AI SDK DevTools，线上使用 Langfuse Cloud Hobby

开发环境注册官方 `DevToolsTelemetry()`，查看器读取其本地数据；`.devtools/` 整体进入 `.gitignore`，生产构建和运行时必须有断言防止 DevTools 初始化。

第一阶段生产使用独立 Langfuse Cloud project。按 2026-08-28 官方价格页，Hobby 当前无需信用卡，包含每月 50k units、30 天历史和 2 位用户；这些数字写入运维文档并标记查询日期，不作为永久合同。初期不采集生产正文且不增加 collector，可最大限度降低接入和运维成本。

配置至少区分：

- telemetry 总开关；
- Langfuse public/secret key 与 base URL/region；
- environment、release/commit；
- 内容记录策略；
- 用户 ID HMAC salt；
- 本地 DevTools 开关。

所有配置均为服务端变量，不使用 `NEXT_PUBLIC_`。部署文档要求在 Langfuse UI 观察 units、数据窗口和 ingestion 状态；达到免费层边界前，按顺序评估减少非必要 span/内容、配置抽样、升级 Cloud 或切到 OSS。切换 OSS 只改变 endpoint/credential 和部署设施。

**替代方案：**一开始在现有 VPS 自托管 Langfuse。它需要 PostgreSQL、ClickHouse、Redis/Valkey 和对象存储，会在数据尚少时增加明显运维面；保留为用量或数据主权需要出现后的迁移路径。

### D3. assistant Message 是根 Trace 的稳定种子

规范化 Thread Chat 的身份映射固定为：

```text
Langfuse sessionId = projectId
Langfuse traceId   = createTraceId("thread-chat:" + assistantMessageId)

root attributes:
  projectId
  threadId
  assistantMessageId
  pseudonymousUserId
  modelId
  environment
  release / commit
  promptVersion
  searchPolicyVersion
  memoryPolicyVersion
  toolsetVersion
  multimodalParserVersion
```

`projectId` 将同一会话树的多个 Thread 聚合为 Session，`threadId` 用于分支筛选。`assistantMessageId` 是已存在的幂等实体 ID；Trace ID 使用官方确定性 ID helper 派生，保证反馈可先后补、命令重放不产生新的逻辑 Trace。用户 ID 通过带服务端 salt 的 HMAC 形成稳定匿名值；不发送邮箱、昵称或认证 token。

`runGeneration` 在确认 owner-scoped Message/Thread 后进入根 active Trace，并把 active context 传入 `prepareGeneration`、UI Message pipeline、checkpoint 和 finalize。Trace 只有在终态 Message 已确定后结束。刷新或 SSE 断开不参与 Trace 生命周期；用户 Stop 映射为 abort/stopped；初始化或协议失败映射为 error/failed。

进程崩溃可能来不及 export 终态。部署启动时已有 orphan generation 收敛逻辑；实现增加一个轻量 reconciliation hook 或运维脚本，以相同确定性 Trace ID 为 abandoned Message 写入安全失败标记。它不是新状态源。

过渡期 `/api/chat` 没有规范化 assistant Message ID时，以 request ID 为 Trace seed、`linearThreadId` 为 session。AI SDK 全局 integration 立即提供模型/工具 span；外层请求 Trace 第一阶段允许在响应创建时结束，后续可显式携带 parent context 到 `after(consumeStream)`，直到 legacy route 退休。

**替代方案：**新增 `generationId`/Trace 映射表。它会重新制造规范化改造已经移除的第二身份与一致性问题，因此拒绝。

### D4. Trace 树按业务步骤命名，不记录隐藏推理

统一 Trace 结构：

```text
thread-chat.generation
├── research.route
├── research.plan
├── model.chat-answer
│   ├── step.*
│   └── tool.*
├── search.provider-attempt.*
├── persistence.checkpoint
└── generation.finalize
```

AI SDK integration 负责模型、step、tool 和 usage；应用自定义 span 只补足业务边界：generation、route/plan 的语义上下文、provider attempt、checkpoint/finalize。自定义 attributes 通过集中 schema builder 产生，Search change 中规划的 event emitter 适配为同一 observation sink，而不是并排输出另一种不可关联的生产事件。

每个 provider attempt 至少包含 correlation/Trace、provider、operation、route reason、attempt index、fallback count、outcome、duration、原始 usage unit/quantity 和安全错误分类。只保留 query fingerprint 和域名级信息；不保留完整 query、URL 或 response body。

公开给用户的 reasoning/data/tool UI parts 与遥测分开处理。遥测只记录 part 类型、数量、状态和允许的公开摘要；MiniMax `<think>` 提取出来的隐藏推理正文以及任何 provider chain-of-thought 均不得导出。

**替代方案：**把每个 UI stream chunk 都作为 span/event。它会显著增加 Cloud units、噪声和敏感内容风险，且不提升步骤级诊断，因此只记录聚合 checkpoint 指标，不记录 token/chunk 明细。

### D5. 生产内容采集采用集中策略与出口脱敏

建立一个 server-only telemetry policy，默认：

```text
recordInputs  = false
recordOutputs = false
recordMetadata/timing/usage/errors = true
sampling = 100% metadata-only（低流量初期）
```

只有 `evaluation`、明确 staging 开关或受控 production cohort 可以开启内容。cohort 判定先于模型调用，结果作为布尔策略传递，不把用户输入用作 exporter 规则。即使开启，Langfuse span processor 的 mask 函数仍是最后出口，递归处理 input/output/metadata，删除 auth、cookie、API key、secret、邮箱/手机号等配置规则、URL 查询参数、附件正文、页面正文和禁止字段。

首阶段不使用 head sampling，因为它可能在请求开始时丢弃后来才失败的 Trace；低流量下先全量记录 metadata。达到 Cloud units 边界后再根据实测 span 数量决定 trace-level sampling。若未来必须保证保留所有错误，再评估 tail sampling/collector，而不是承诺简单 head sampling 能做到。

**替代方案：**默认记录完整 prompt/output 后依赖人工删除。Cloud 免费层只有有限历史且数据已离开应用边界，风险不可接受。

### D6. 反馈先提交数据库，再异步幂等镜像

`setMessageFeedback` 的现有事务、所有权和 idempotent command 保持不变。同一事务在更新 `messages.feedback` 后 upsert 一条 `feedback_score_outbox`：每次新状态单调增加 `version`，保存 `up/down/cleared`、源更新时间、重试时间、租约 token 与已确认版本。handler 获得已提交结果后，用 Next.js `after(...)` 或等价 server-owned post-commit hook 唤醒 outbox drain；HTTP 成功只依赖数据库提交结果。

Score 设计：

```text
traceId   = createTraceId("thread-chat:" + messageId)
scoreId   = create deterministic id("user-feedback:" + messageId)
name      = "user-feedback"
dataType  = categorical
value     = "up" | "down" | "cleared"
metadata  = { source: "product", environment, updatedAt, sourceVersion }
```

实现用当前 Langfuse SDK 支持的 update/upsert 语义维持一个逻辑 Score；若 SDK 只能 create/delete，则 adapter 内先更新或替换同 ID，不能把多次点击累积为彼此矛盾的评分。Score adapter 返回结构化结果供日志和测试使用，但失败不得抛回产品请求。

drain 使用数据库行锁与 `SKIP LOCKED` 领取到期任务，并写入租约 token，允许多个 VPS/实例安全并发。远端成功后只在 `messageId + version + lease token` 仍匹配时确认；若投递期间用户又修改或清除反馈，旧 worker 只能释放新版本，不能把它误标为已送达。失败按持久化 attempt/next-at 重试，进程重启后可由运维 drain 命令继续处理。另保留可重复执行的 Message backfill，用于修复启用 outbox 前的数据或重建远端 Score。

**替代方案：**仅依赖 `after(...)` 内存任务或在反馈事务里同步请求 Langfuse。前者会在进程退出、多实例切换和 clear 事件后丢失状态，后者会把外部延迟和故障带进产品写路径；两者都不能满足可恢复投递边界。

### D7. 评测 case 以仓库为事实源，Langfuse Dataset 为运行副本

新增 `evals/agent/`：

```text
evals/agent/
├── cases/                 # JSONL 或类型安全 TS case，稳定 caseId
│   ├── core-answer.*
│   ├── search-routing.*
│   ├── memory-context.*
│   ├── multimodal.*
│   └── reliability.*
├── fixtures/              # 合成、可提交的图片/PDF/文本
├── scorers/               # 确定性 scorer；judge 单独目录
├── runner/                # config、执行、Langfuse experiment adapter
└── README.md              # 数据分级、运行和更新规则
```

仓库 case 包含稳定 ID、suite、tags、输入、fixture 引用、expected/rubric、敏感等级和 case schema version。Langfuse Dataset 使用同一 case ID 同步，用来可视化 experiments；Hosted Dataset 的当前版本行为不取代 Git revision。生产问题只能经人工脱敏后进入仓库；敏感附件用合成 fixture 或受保护外部 fixture，不能直接提交。

runner 使用现有 Node.js + `tsx`。内容质量 case 尽量调用与应用共用的 route/prompt/context/tool execution core；Thread Chat 状态机 case 在隔离测试数据库创建 Project/Thread/Message 后运行真实 `runGeneration` 并读取终态。runner 不通过公开生产 HTTP endpoint，也不写生产数据库。

**替代方案：**仅在 Langfuse UI 管理 prompt dataset。它适合单 prompt 实验，但不能版本固定完整 Agent fixtures，也不能可靠执行停止、分支、数据库终态和 provider fault 场景。

### D8. 评分先确定性、后模型裁判，并保留多维结果

统一 result envelope 保存：case ID、candidate、fingerprint、output、Trace ID、timing、usage、tool/provider attempts、terminal state、scores 和 error classification。配置指纹由稳定序列化对象与哈希生成，内容包括 proposal/spec 要求的所有版本，不包含 key 或完整环境变量。

评分分三层：

1. 确定性 scorer：执行成功、schema、预期 route/tool、citation URL/grounding、memory facts、no-leak、stop/retry 终态、latency、usage、fallback、empty/error。
2. 模型裁判：correctness、faithfulness、helpfulness、completeness、citation support；必须固定 judge model、prompt/rubric version，先用人工标注小集校准。
3. 产品反馈：Langfuse `user-feedback`，用于发现案例和分群，不自动作为 ground truth。

报告按 suite 展示 baseline/candidate delta 和 case 证据，不先合成一个总分。成本/延迟和质量并列展示。Search live cases标记 volatility/freshness；provider outage 单独归类但仍进入 reliability 指标。

**替代方案：**直接使用一个 LLM Judge 总分。它难以解释路由、泄漏、终态和成本回归，也容易受 judge 漂移影响。

### D9. 评测自动化分三档推进

命令与数据选择保持同一 runner：

- `smoke/local`：少量稳定、低成本 case，开发者手动运行。
- `ci`：在有基线后启用，优先阻断确定性 contract regression；不依赖高波动 live Web 作为硬门禁。
- `scheduled/release`：完整 Search、记忆、多模态、judge 和 live-provider 套件，产出 Langfuse experiment 链接及历史报告。

第一阶段只要求 local runner、Langfuse experiment 和保存基线；第二阶段接官方 experiment CI action。阈值保存在仓库配置中，按 suite 分开，必须有原因、基线日期和 owner。外部故障可人工 override，但必须留下报告和回滚说明。

CI/评测 Trace 使用独立 environment、experiment/case/candidate attributes，不使用生产 session/user ID。评测量也计入 Langfuse Cloud units，因此默认 smoke 小集，scheduled 频率在查看实际单位消耗后确定。

**替代方案：**第一天把全部 suite 设为 PR 必跑。它会放大模型成本、Web 波动和免费层消耗，在尚无基线时产生不可信门禁。

### D10. Loop Engineering 先人工策展，再逐步自动化

闭环如下：

```text
生产 Trace / error / down feedback
  -> Langfuse 中筛选与标注
  -> 人工脱敏并写入 project-owned case
  -> 同步 Langfuse Dataset
  -> baseline vs candidate experiment
  -> 确定性 + judge + 人工复核
  -> 小范围发布 / rollback
  -> 继续观测并回流新失败
```

初期不自动抓取生产正文，因为生产默认不记录内容且自动复制会破坏隐私边界。操作员可用 Message ID 在有权限的产品数据库中复盘，经人工生成最小化、去身份化 case。后续若内容 cohort 和治理成熟，可以增加“候选 case”队列，但仍需人工批准才能进入 committed suite。

### D11. Node.js 运行时先升级，部署采用可关闭的增量 Gate

在安装遥测依赖前，统一 `package.json` engines、类型、README、CI 和 VPS/Coolify 运行时到 Node.js 22 以上；建议选择一个已验证的固定 Node.js 24 镜像，但规范只强制不低于 22。先执行现有 typecheck、build 和 Thread Chat gates，确认升级没有行为回归。

所有远程观测由总开关控制。即使包和 instrumentation 已部署，也可以在不回滚数据库的情况下关闭 Langfuse export；本 change 不需要 schema migration。部署顺序见 Migration Plan。

## Risks / Trade-offs

- [后台流任务可能丢失 active context] → 根 Trace 显式包住 `runGeneration`，legacy `after(consumeStream)` 显式传递 parent context；增加断线后 Trace 仍到终态的集成测试。
- [开发热更新导致 telemetry 重复注册和重复 span] → 使用进程级 singleton/`Symbol.for` guard，并测试重复调用 register。
- [Langfuse 故障拖慢或破坏请求] → 批量 exporter、短超时、post-commit feedback、边界 catch；所有产品行为只依赖数据库和 Agent 结果。
- [生产 metadata 仍可关联用户] → user ID 使用 HMAC 匿名化；只发送必要的 opaque Message/Project/Thread IDs；建立集中 allowlist 与 mask 出口。
- [内容抽样泄漏敏感 prompt、附件或网页] → 默认关闭 input/output，显式 cohort，出口 mask，测试注入 credential/PII/URL/page content，禁止隐藏推理。
- [50k units 很快被多步 Agent 消耗] → 不记录 chunk/token 级事件，先测每次 Agent 平均 units，Cloud dashboard 定期检查；smoke 与 scheduled 分档，接近上限时再抽样/升级/自托管。
- [Hobby 30 天历史不足以长期回归] → 关键失败经脱敏进入 repo dataset；实验摘要和配置指纹可保存为 CI artifact/仓库允许的报告，不依赖无限 Trace 留存。
- [模型与 Web 结果非确定造成误报] → 稳定 contract 与 live Web 分组；相同 case IDs 比较；记录 provider failure；阈值按 suite 校准，不以单次 judge 总分阻断。
- [模型裁判自洽偏差] → judge 与 candidate 分离、rubric 版本化、人工标签校准、确定性失败优先。
- [现有 model-call log 与 Langfuse 重复] → 日志保持摘要且不重复完整 output；稳定后基于诊断价值决定是否缩减。
- [Langfuse SDK/API 版本变化] → 所有 vendor 调用收敛在 observability 和 evaluation adapter，业务编排依赖项目自有 context/result 类型；锁定直接依赖版本并添加合同测试。
- [进程崩溃前 span 未 flush] → 正常运行用批处理，短生命周期 eval/CLI 显式 flush；部署退出钩子 best-effort flush；数据库终态和恢复脚本仍是事实源。

## Migration Plan

1. **Gate 0—运行时与基线**：将本地、CI、VPS 固定到 Node.js 22+；记录升级前后 typecheck、build 与现有 Thread Chat gates；准备 Langfuse Cloud 独立 project/region 和 server-only secrets。
2. **Gate 1—本地 DevTools**：安装并注册官方 DevTools，忽略本地数据目录；验证开发模型、工具、embedding 可见，生产启动断言 DevTools 未启用。
3. **Gate 2—metadata-only 生产 Trace**：接入 Langfuse/OpenTelemetry，总开关初始关闭；先在 staging 验证身份、Trace 树、mask 和失败隔离，再对 production 小流量开启，之后逐步到 metadata-only 全量。
4. **Gate 3—完整 Thread Chat 与反馈**：根 Trace 包住 `runGeneration`，补 provider attempt/checkpoint/finalize；启用 post-commit feedback mirror 和幂等 backfill。验证 Stop、Retry、断线、初始化失败和重启恢复。
5. **Gate 4—评测基线**：建立五个小型 suite、合成 fixtures、runner、确定性 scorer、Langfuse Dataset 同步和 experiment；保存 AnySearch/当前 prompt/当前模型 baseline。模型裁判只在人工校准后启用。
6. **Gate 5—持续回归**：建立生产问题人工策展流程；根据 Cloud units 实测启用小型 CI action 和 scheduled/release suite；配置 suite-specific threshold 与 override/rollback。

回滚策略：

- 设置 telemetry 总开关关闭远程 export，应用继续依赖现有日志和数据库运行。
- DevTools、Langfuse integration 和自定义 span 均不得影响 Message schema；回滚代码不需要数据库迁移。
- feedback mirror 关闭后，产品反馈继续写数据库；恢复时执行幂等 backfill。
- evaluation runner/CI gate 可独立关闭，不影响生产 Agent；候选配置未达门槛时回退到记录的 baseline fingerprint。

## Open Questions

- Langfuse Cloud 选择欧洲、美国或日本 region；在 apply 前根据 VPS 位置、延迟和数据要求选择，只影响 base URL 与数据驻留说明。
- 第一个模型裁判使用哪一模型、抽多少人工标签以及各 suite 的阻断阈值；在 Gate 4 跑出 baseline 后决定，不改变 runner 与评分分层。
- metadata-only 全量运行后的平均 units/Agent 与 scheduled suite 频率；用 Gate 2/4 实测决定是否需要 sampling 或付费计划。
