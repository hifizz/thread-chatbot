## Context

`app/api/chat/route.ts` 已用 AI SDK v7 `streamText` 运行工具循环，但当前模式互斥：`deepResearch=true` 才挂载 `webSearch/readUrl`，`threadChat` 则只挂载 `createMarkdownArtifact`。Thread Chat 请求体没有搜索策略，`prepareStep.activeTools` 也会把其他工具排除；`app/thread-chat/net/ui-stream.ts` 会静默丢弃 Markdown 以外的工具事件。

现有搜索实现可作为验证基线，但默认使用 Tavily `advanced + include_answer + 5 results`，单次 2 credits，且 `readUrl({url})` 接受任意 URL。计费只覆盖模型 token。实测 GLM-5.2 能稳定进行中英双语工具决策，但 system 缺少可信当前日期时会把查询年份写成旧年份；一次真实 Next.js 问题出现 3 个模型 step + 3 次 advanced search，证明只限制 step 数不能限制同一步的并行工具调用，也证明当前配置不适合默认开启。

本 change 是搜索型 MVP。它复用已配置的 Tavily 凭据来降低验证成本，但把 Auto Search 与 Deep Research 的参数、预算和产品语义分开。

## Research / ADR Index

- 四批 Roadmap 总索引：[research/roadmap-index.md](research/roadmap-index.md)
- 调研证据、项目实测与成本计算：[research/README.md](research/README.md)
- 架构决策记录：[adrs/README.md](adrs/README.md)
- ADR 状态在 OpenSpec 批准前为 `Proposed`；实施批准后改为 `Accepted`。后续改变通过新 ADR supersede，不删除原始理由。

## Goals / Non-Goals

**Goals:**

- 让 Thread Chat 默认由 GLM-5.2 主动判断何时搜索，并允许用户强制开启或关闭。
- 用一次为主、两次封顶的轻量搜索改善最新编程知识回答。
- 让搜索过程、来源、费用和失败对用户及运维可见。
- 通过服务端硬预算、严格结果归一化和灰度开关达到可控上线标准。
- 用可重复评测证明收益，而不是仅凭个别演示判断。

**Non-Goals:**

- 不迁移或重写现有显式 Deep Research。
- 不提供网页全文抓取、任意 URL 访问、浏览器自动化、登录态网页或下载。
- 不在本批次建立多 provider fallback、缓存或复杂调度。
- 不承诺搜索能消除幻觉；没有来源支持时必须披露不确定性。

## Decisions

### D1. 默认 `auto`，用户拥有 `always` 与 `off` 覆盖权

请求体增加服务端严格校验的 `webSearchMode: "auto" | "always" | "off"`，Thread Chat 新会话默认 `auto`。`auto` 把工具暴露给 GLM-5.2 并使用 `toolChoice: "auto"`；`always` 仅在第一步强制一次 `webSearch`，随后恢复自动；`off` 完全不向模型暴露搜索工具。

选择模型主动决策而不是额外分类模型，是因为现有 GLM-5.2 A/B 已显示工具判定足够稳定，额外分类会增加延迟、费用和一处新故障。保留用户覆盖权用于隐私、成本和可重复性需求。

**实施期修正（2026-08-05，见 ADR-0006）：** 真实 64-case 评测证明 Ark GLM-5.2 会忽略 forced `tool_choice`，因此 `always` 改由服务端在首个模型 step 前确定性执行一次搜索，并把标准 tool-call/result 注入上下文和 UI；完成后本轮不再开放第二次搜索。`auto/off` 产品语义不变。

### D2. System prompt 注入服务端当前日期和最小搜索政策

每次请求由服务端生成 ISO 日期与时区提示。政策把问题分为三类：明确最新/当前/版本依赖/用户要求核验的内容必须搜索；纯创作、只处理用户已给文本、稳定基础概念默认不搜索；模型对关键事实不确定时允许搜索。编程问题优先官方文档、规范、发布说明、源码仓库和论文等一手来源。

搜索结果与网页文本明确标记为不可信数据，绝不能覆盖 system/user 指令。最终回答只能把实际工具结果中的 URL 当作事实来源；搜索不足时说明限制。日期放在 system 而不是用户消息中，避免被历史上下文覆盖。

**实施期强化（2026-08-05，见 ADR-0007）：** system 约束不足以阻止模型改写或补造 URL。服务端在流结束前使用本轮工具结果建立 URL allowlist，阻断其它外部链接，并追加由真实结果生成的来源标签。来源有效性与答案正确性作为两个独立 gate。

### D3. Auto Search 使用独立轻量参数与规范化结果

MVP 继续使用现有 Tavily REST 接入，但 Auto Search 固定为 basic/fast 等价档、`include_answer=false`、每次最多 3 条结果、每条正文快照 600–1000 字符；Deep Research 原有参数暂不改。工具输入只接受 trim 后非空且有限长度的单个 `query`。

服务端只返回规范化的 `sourceId/title/url/snippet`。URL 必须是公开 HTTP(S)，不得含用户名/密码、非标准危险 scheme、环回/私网/link-local IP literal；重复 canonical URL 去重。对编程问题可通过查询提示偏好官方域，但不能把通用搜索锁死成固定 allowlist。弃用 provider `answer`，因为它增加成本且会成为无法逐条核验的第二个模型答案。

### D4. 调用预算在工具执行器内硬限制，step 数只作第二道保险

每个响应创建请求内预算对象，Auto Search 最多成功启动 2 次 provider 请求，目标平均 1–1.5 次；计数在发起网络请求前原子递增，因此同一步并行 tool calls 也不能越界。超预算的调用返回结构化 `budget_exhausted`，不再访问 provider。

`prepareStep` 根据模式和 step 组合 `webSearch` 与 `createMarkdownArtifact` 的 `activeTools`，不能沿用当前只允许 Markdown 工具的实现。总 step 上限保留为有限值，但不把它当作 provider 调用上限。`always` 只强制首步一次，避免每步强制。工具参数错误通过严格 schema 与一次受控 repair/可读错误处理，不能以无限重试修复。

**实施期修正（2026-08-05，见 ADR-0006）：** 请求级硬上限 2 之外增加“每个 model step 最多启动 1 次”约束，阻止同一步并行查询把典型成本直接推到 2 次；第二次搜索只能在后续 step 发生。

**测试期修正（2026-08-10，见 ADR-0010）：** 为观察 GLM-5.2 在 `auto` 模式下的自然检索行为，非生产环境可显式将上限提高到最多 10 次串行搜索，并将工具 step 上限同步提高到最多 11（为最终回答预留一步）。该覆盖默认关闭，生产环境一律忽略并维持 2 次上限；每个 step 仍至多启动一次 provider 请求。

### D5. 搜索故障降级为已有知识回答，不让整轮失败

provider 未配置时，`auto` 返回不搜索的普通回答并在需要最新信息时说明无法核验；`always` 显示明确不可用状态。超时、429、5xx、无结果和结果全被过滤均转成结构化工具错误，模型不得伪造来源。MVP 不自动切换 provider，也不因失败追加超过预算的重试。

### D6. 工具活动瞬时展示，来源链接随回答持久化

Thread Chat 流消费器窄解析 `webSearch` 的 start/input/output/error 事件，显示查询词、结果数、耗时和失败状态；未知工具事件仍忽略。最初实现将全部搜索活动视为当前生成过程状态，不写入树 JSON；最终回答中的 Markdown 来源链接随正文照常持久化。第二批 `add-controlled-web-fetch` 再引入结构化来源账本和消息级来源对象。

MVP 的正文来源呈现为服务端生成的末尾 `信息源` 标签，搜索活动卡也展示相同的安全外链；外链在新标签页打开并带 `noopener noreferrer`。逐段或实体级 inline citation 需要稳定的结构化 source ledger，明确留给第二批，避免用模型生成 Markdown 猜测引用位置。

**实施期修正（2026-08-05，见 ADR-0008）：** 搜索活动不逐个渲染模型的内部 tool call，而是按 assistant 消息汇总为最终状态卡。只要已有可用来源，随后被预算拒绝或参数无效的冗余调用不显示为失败；只有零成功来源时才显示失败。卡片保持在正文之后，表达本条回答最终使用的联网状态。为避免 GLM-5.2 在额度耗尽后输出同名工具导致 AI SDK `NoSuchToolError`，已用过的 schema 留在后续 step 中，但执行器只返回零网络访问的结构化 budget 结果。

**展示位置修正（2026-08-05，见 ADR-0009）：** 卡片不固定在正文之后。第一个搜索事件到达时先 flush 已缓冲的 text delta，记录字符 offset，并把单一聚合卡插入该位置；所以开头/中途/结尾调用分别出现在对应的真实流顺序。offset 与活动数据均为 transient state。开发构建只显示灰色内部调用统计，不显示预算或参数失败详情。

**来源收敛修正（2026-08-11，见 ADR-0011）：** 活动卡和 assistant 正文中的可信外链使用站点/发布者短名胶囊，长 query 与来源标题不得撑破父容器。服务端只在正文没有任何可信来源 URL 时追加一次 fallback `信息源`；若模型已经生成内联引用或参考来源列表，不再追加重复 footer。

**持久化修正（2026-08-11，见 ADR-0012）：** 聚合卡是已完成 assistant 消息的一部分，刷新后不能消失。`completed/failed` 活动及第一个搜索事件的正文 offset 随 branch tree 持久化；`starting/searching` 仍是连接级临时态，在存盘和加载时剥离。加载时同时将 offset 限制在正文长度内，防止损坏或旧数据破坏渲染顺序。

### D7. 外部工具用量使用独立流水并按真实调用收费

不把搜索伪装成模型 token。新增外部工具用量流水，至少记录 user/thread/response、provider、operation、status、units、provider cost、user price、latency、result count、query fingerprint 和时间；默认不长期保存完整敏感查询。成功的 Tavily Basic Search 按 1 credit 计，MVP 以 PAYG 上限 `$0.008/credit` 作为保守成本，再走现有 `USD_TO_CNY` 与 `priceFromCost`，即成本约 ¥0.0584、最低用户价约 ¥0.0834/次（汇率 7.3 时）。失败尝试记录但仅在确认产生 provider credits 时收费。

扣费与流水必须在同一事务；搜索费用汇总到本次 assistant 消息/账单展示。即使使用免费 credits 也记录用量和影子成本，避免免费额度耗尽后突然出现不可见成本。

### D8. GLM-5.2 先过路由、质量、成本和安全门槛再灰度

建立至少 60 条中英双语路由集，覆盖必须搜索、不应搜索、歧义、显式 always/off、工具参数异常；另用至少 20 条版本敏感编程问题做真实搜索回答对比。上线门槛：必须搜索召回率和不应搜索精确率均不低于 90%，来源 URL 来自工具结果的比例 100%，任何响应搜索调用不超过 2，Auto 的中位数不超过 1，p95 不超过 2；版本敏感答案相对无搜索基线不得退化并应有可审计提升；费用与额外延迟必须在发布记录中披露。

先在开发/内部 flag 启用，再小比例用户灰度，观察触发率、错误率、每轮调用数、成本和反馈后扩大。GLM-5.2 是必过模型，其他模型不阻塞 MVP。

**2026-08-05 gate 结果：** 64 条路由集和来源 provenance/调用上限通过；20 条真实编程集的保守人工对比仍有版本状态过度推断，未满足“相对无搜索基线不得退化”。因此生产默认保持关闭，不进入比例灰度，直到修复后重跑同一评测集。

## Risks / Trade-offs

- **[Auto 误触发增加费用和延迟]** → 默认 basic、硬上限 2、评测假阳性、用户 `off`、灰度监控。
- **[不搜索导致旧知识回答]** → 注入真实日期、版本/当前类必须搜索政策，并追踪 must-search 漏检。
- **[搜索结果低质或 SEO 污染]** → 优先一手来源、结果归一化、回答披露冲突，不使用 provider 聚合 answer。
- **[同一步并行调用绕过 step 上限]** → 在 execute 前使用请求内硬预算，而不是只依赖 `isStepCount`。
- **[Tavily 成本未进入现有账单]** → 外部用量独立记账并把成功调用费用聚合到消息级展示。
- **[搜索片段提示注入]** → 结果标记为数据、system 明确优先级；本批次不执行页面动作或访问结果 URL。
- **[Thread Chat 工具组合回归 Markdown Artifact]** → 组合 `activeTools` 并增加搜索/Artifact 同轮回归用例。

## Migration Plan

1. 先落数据结构、价格常量与外部调用记录，但保持功能 flag 关闭。
2. 分离 Auto Search 与 Deep Research 配置，完成纯函数、预算、URL 归一化和 mock provider 验证。
3. 接入 Thread Chat system/tool loop/UI，运行类型检查、构建和离线 GLM-5.2 路由集。
4. 在开发环境用真实 Tavily + GLM-5.2 运行 live 集，核对账单与来源。
5. 内部开启 `auto`，再按小比例灰度；指标越界可立即关闭 flag，普通对话和 Deep Research 不受影响。

## Open Questions

- MVP 灰度后根据真实分布决定默认搜索用户价是逐次精确显示还是以“联网附加费”聚合展示；无论 UI 形式如何，底层必须逐次记账。
- Tavily Basic 的实际套餐折扣只用于后续运营优化；MVP 计费继续按 PAYG 上限保守估值，避免低估成本。
