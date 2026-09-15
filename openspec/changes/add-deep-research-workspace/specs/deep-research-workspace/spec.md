## ADDED Requirements

### Requirement: 仅深度研究创建独立 Run
系统 SHALL 仅在联网路由最终解析为 `research` 时，为当前 assistant message 创建一条一对一的 Research Run；`answer`、`fetch` 和 `search` SHALL 继续使用既有消息与内联联网行为。Research Run SHALL 以 assistant message 作为生命周期与权限归属，不得因重复启动或重放命令创建第二条 Run。

#### Scenario: research 路由创建 Run
- **WHEN** assistant 生成的最终联网路由为 `research`
- **THEN** 系统为该 assistant message 创建唯一 Research Run，并开始记录研究计划和活动

#### Scenario: 普通联网不创建 Run
- **WHEN** assistant 生成的最终联网路由为 `fetch` 或 `search`
- **THEN** 系统不得创建 Research Run，且既有 SearchTrace 行为保持不变

### Requirement: Run 与消息状态明确收口
系统 SHALL 区分整条 assistant message 的生成状态与 Research Run 的研究阶段。消息状态 SHALL 决定回答是否完成、停止或失败；Run 状态 SHALL 只描述 `planning`、`researching`、`synthesizing`、`completed`、`stopped`、`failed` 或 `interrupted`。非终态 Run 允许 `planning → researching`、`researching → synthesizing` 以及发现新证据缺口时的 `synthesizing → researching`，并允许从任一非终态进入 `completed`、`stopped`、`failed` 或 `interrupted`；终态后 SHALL NOT 接受新的普通活动或切换到其他终态。对存在 Run 的消息，最终解析后的 message 状态、Run 终态、唯一 terminal event、未结束工具与来源状态以及最终 Artifact SHALL 在同一数据库事务中收口。

#### Scenario: 正常完成研究
- **WHEN** 深度研究完成综合、最终响应通过有效内容检查且终态事务提交成功
- **THEN** message 状态为 `completed`，Run 状态为 `completed`，所有已开始工具均有唯一 terminal outcome，且记录完成时间和唯一 terminal event

#### Scenario: 空响应改判失败
- **WHEN** 请求完成但最终消息没有任何可展示内容而被既有 finalize 规则改判为失败
- **THEN** 同一事务把 message 和 Run 均写为失败终态，不得提前保留 `run=completed`

#### Scenario: 用户停止研究
- **WHEN** 用户通过既有停止命令终止正在运行的深度研究
- **THEN** 同一事务把 message 和 Run 写为 `stopped`，关闭未结束工具和 reading 来源，并保留已提交的事件与来源

#### Scenario: 服务进程中断研究
- **WHEN** 服务进程重启导致生成无法继续
- **THEN** 同一恢复事务把 message 按既有规则写为失败、Run 写为 `interrupted`，关闭未结束工具和 reading 来源，并追加唯一 terminal event

#### Scenario: 终态事务失败
- **WHEN** message、Run、terminal event、来源收口或 Artifact 写入中的任一步失败
- **THEN** 整个终态事务回滚，不得暴露部分完成的互相矛盾状态

### Requirement: 研究事件形成只追加时间线
系统 SHALL 为初始计划、计划调整、搜索、网页读取、公开过程摘要、阶段性发现、开始综合和 Run 终态保存按 Run 连续递增的研究事件。事件 SHALL 只追加，不得以完成状态覆盖开始事件。每个 search/read toolCall SHALL 最多拥有一个 `completed`、`failed`、`stopped` 或 `denied` terminal outcome；所有 terminal outcome SHALL 共用同一业务幂等身份。同一幂等事件被重复处理时 SHALL NOT 消耗新序号、创建重复记录或重复增加计数。

#### Scenario: 搜索生命周期完整保留
- **WHEN** 一次 webSearch 从开始进入成功、失败、拒绝或停止终态
- **THEN** 时间线按顺序保留 start event 和唯一 terminal event，并通过同一 tool call identity 关联

#### Scenario: 并行工具完成
- **WHEN** 多个搜索或读取工具并行完成
- **THEN** 系统锁定 Run 后为每条已提交事件分配唯一连续序号，客户端按该序号稳定显示活动

#### Scenario: 工具终态竞争
- **WHEN** 同一 toolCall 的成功、失败或停止结果因竞态被并发提交
- **THEN** 系统只接受第一个已提交 terminal outcome，其余提交幂等返回且不得改变来源或计数

#### Scenario: 重复事件重放
- **WHEN** 相同幂等键的研究事件因重试被再次提交
- **THEN** 系统返回现有结果，且 Run 序号、计数、来源状态和事件总数均不得重复变化

#### Scenario: Run 终态后的迟到事件
- **WHEN** 普通 search/read/progress event 在 Run 已进入终态后到达
- **THEN** 系统拒绝追加该事件，Run 状态、最后事件序号和来源均保持不变

### Requirement: 计划版本与研究轮次可核对
系统 SHALL 保存初始结构化 ResearchPlan 及其版本。初始计划 SHALL 建立 plan version 1 和 round 1；只有通过 schema 校验的完整 `plan_revised` 才能同时令 plan version 和 round 各增加 1。`strategy_updated` SHALL 只记录当前轮次中的公开方向摘要，不改变 plan version 或 round。重复幂等更新不得推进版本或轮次，已完成的历史计划与活动不得被静默改写。

#### Scenario: 初始计划建立
- **WHEN** planner 为 Research Run 生成有效计划
- **THEN** Run 保存 plan version 1、round 1，并追加包含该版本和轮次的 `plan_created` event

#### Scenario: 完整计划修订
- **WHEN** 模型通过受约束的公开过程更新提交完整且有效的新计划
- **THEN** 系统在同一事务中替换 current plan、增加 plan version 和 round，并追加包含新版本与轮次的 `plan_revised` event

#### Scenario: 当前轮次策略更新
- **WHEN** 模型只提交公开的 strategy update 而没有有效 revised plan
- **THEN** 系统在当前 round 追加 `strategy_updated` event，plan version 与 round 保持不变

### Requirement: 公开过程摘要来源受限且有界
系统 SHALL NOT 从 raw reasoning、模型草稿、网页正文或未裁剪工具响应自动提取公开摘要。公开策略更新和阶段性发现 SHALL 只能通过专用结构化工具提交，并经过严格 schema、300 字摘要上限、最多 8 个来源引用、来源归属和已知敏感字段模式校验；通过后的 summary SHALL 作为纯文本而非 HTML 渲染。校验失败的更新 SHALL NOT 持久化或发送到客户端，且缺失公开摘要不得阻断搜索、读取或最终综合。

#### Scenario: 记录阶段性发现
- **WHEN** 模型通过专用工具提交符合 schema、长度限制且只引用当前 Run 已知来源的 finding
- **THEN** 系统追加 `finding_recorded` event 并更新最新公开发现摘要

#### Scenario: 拒绝越界过程内容
- **WHEN** 过程更新超过 300 字、引用超过 8 个来源、类型未知、命中已知敏感字段模式或引用不属于当前 Run 的来源
- **THEN** 系统拒绝该更新，不持久化、不发送客户端，也不影响主研究流程

#### Scenario: 网页提示诱导泄露
- **WHEN** 读取到的网页内容要求模型复述系统提示、隐藏指令或完整工具输出
- **THEN** 网页内容不得绕过专用工具 schema 与服务端校验；无法通过校验的公开更新被丢弃并保持纯文本边界

### Requirement: 来源按 Run 去重并保存当前状态
系统 SHALL 为 Research Run 维护独立来源目录，按规范化 URL 在 Run 内去重，并保存 URL、标题、域名、最多 2,000 字的摘要、当前读取状态以及首次和最近出现的事件序号。来源状态 SHALL 使用 `discovered`、`reading`、`read`、`failed` 或 `cancelled`；`failed/cancelled → reading → read` 的重试合法，`read` SHALL NOT 退回其他状态。每次读取尝试的历史 SHALL 由事件时间线保留，Run 进入终态后 SHALL NOT 遗留 `reading` 来源。

#### Scenario: 多次搜索发现同一来源
- **WHEN** 不同搜索活动返回规范化后相同的 URL
- **THEN** 来源目录只保留一条 source，更新最近出现序号，并让对应事件引用同一 source identity

#### Scenario: 直接读取尚未发现的来源
- **WHEN** 有效 readUrl input 指向当前 Run 中尚不存在的 URL
- **THEN** 系统在记录 `read_started` 前创建或取得 source identity，并把 source 更新为 `reading`

#### Scenario: 读取输入在 URL 有效前被拒绝
- **WHEN** readUrl input 在产生有效且通过安全校验的 URL 前进入 denied
- **THEN** 系统记录不含 source identity 的 `read_denied` terminal event，不创建 Research Source

#### Scenario: 已开始读取后输出被拒绝
- **WHEN** source 已进入 `reading` 且该 toolCall 随后收到 output-denied
- **THEN** 系统在同一事务追加唯一 `read_denied` terminal event，并把 source 更新为 `cancelled`

#### Scenario: 来源读取失败后成功
- **WHEN** 某来源第一次读取失败、后续读取成功
- **THEN** source 当前状态为 `read`，同时事件时间线保留失败和成功两次尝试

#### Scenario: 并行读取成功后又收到失败
- **WHEN** 同一来源的一个读取尝试已写为 `read`，另一个并行尝试随后失败
- **THEN** source 当前状态保持 `read`，失败尝试只追加对应 terminal event

#### Scenario: Run 停止时来源仍在读取
- **WHEN** Run 进入 stopped、failed 或 interrupted 且存在 `reading` 来源
- **THEN** 同一终态事务把这些来源收口为 `cancelled`，不得留下非终态来源状态

### Requirement: 完整网页正文不得进入消息和研究历史
系统 SHALL 允许当前模型工具循环消费网页正文，但 SHALL 在公开 UI reducer、Session 与 SSE 形成前把 Deep Research 的 readUrl 结果重构为 source identity、URL、字符数和安全状态。完整网页正文 SHALL NOT 进入 SSE、Session snapshot、Session replay、checkpoint、terminal `messages.parts`、Research Event/Source、内容型 telemetry、开发工具记录、应用日志或序列化错误对象。`source-document` 和 provider metadata SHALL 经过字段白名单与容量限制。recorder、裁剪或持久化失败时系统 SHALL fail closed：研究进入安全失败路径，且不得回退为发送原始工具输出。

#### Scenario: 深度研究读取长网页
- **WHEN** readUrl 为当前研究返回完整网页正文
- **THEN** 模型可以在本次执行中使用正文，而 reducer、客户端、Session、数据库和 observability 只收到裁剪后的公开结果与来源元数据

#### Scenario: recorder 写入失败
- **WHEN** 完整 readUrl result 已产生但 Research recorder 无法提交 Event/Source/Run 事务
- **THEN** 系统停止该研究并返回安全错误，完整正文不得继续进入公开 stream 或错误详情

#### Scenario: 读取完成与停止并发
- **WHEN** stop/abort 在 readUrl output 到达期间发生
- **THEN** 无论最终 tool outcome 为 completed 或 stopped，完整正文都不得进入公开或持久化边界

#### Scenario: source-document 或 metadata 携带大内容
- **WHEN** provider source-document 或 metadata 包含正文、未受限 payload 或敏感字段
- **THEN** 系统只按公开字段白名单和容量限制发送，超出边界的内容被移除或拒绝

#### Scenario: 普通 fetch 读取网页
- **WHEN** 路由模式为 `fetch` 或 `search`
- **THEN** Deep Research 专用 sidecar 与公开裁剪不得改变既有普通联网路径

### Requirement: Deep Research 在聊天中只显示一个摘要入口
系统 SHALL 为已知存在 Research sidecar 的 assistant message 生成与 UIMessage parts 数量无关的 synthetic compact entry，并保证每条 message 最多一个 entry。sidecar existence SHALL 与 summary 是否已加载或可解析分开表达：sidecar 已知存在时 SHALL NOT 渲染 legacy inline traces；未知 contract version 或详情加载失败时 entry SHALL 显示兼容/加载错误。entry SHALL 展示主状态、当前阶段、研究轮次和可用计数，并提供打开面板的原生按钮；最终 text、source citation、file、附件和 Artifact 交付内容 SHALL 继续按原顺序显示，非研究工具不得被误隐藏。

#### Scenario: 研究运行中
- **WHEN** Research Run 处于 planning、researching 或 synthesizing
- **THEN** 聊天显示一张持续原位更新的摘要卡，不逐条追加活动和来源

#### Scenario: 无正文的失败或停止 Run
- **WHEN** sidecar 已知存在，但 stopped、failed 或 interrupted message 没有任何最终 text 或 legacy research part
- **THEN** render plan 仍输出唯一 compact entry，并显示对应终态

#### Scenario: 研究完成并包含交付物
- **WHEN** message 与 Run 均进入完成终态，且消息包含多段 text、citation、file、附件或 Artifact reference
- **THEN** 摘要卡显示完成状态和最终计数，所有非研究交付 part 按原顺序正常渲染且不重复

#### Scenario: sidecar 版本未知
- **WHEN** bootstrap 表明 sidecar 存在但客户端不认识其 contract version
- **THEN** 系统显示唯一兼容错误 entry，不得回退并同时展示 legacy research traces

#### Scenario: 旧研究消息没有 Run
- **WHEN** 历史 assistant message 明确不存在 Research sidecar 且含旧 research parts
- **THEN** 系统继续使用旧内联轨迹，不得同时显示新摘要卡

### Requirement: 右侧面板收纳研究工作区
系统 SHALL 提供独立 Deep Research 右侧面板，通过“概览、活动、来源”三个区域展示 Run 当前阶段、只读计划、最新发现、限制、按轮次分组的事件和来源目录。面板 SHALL 复用 thread-chat 现有右侧 drawer 的视觉几何，但 SHALL NOT 与 ProjectPanel 共用业务状态；同一时刻只允许一个右侧工作面板打开。

#### Scenario: 从摘要卡打开面板
- **WHEN** 用户激活某条 Deep Research compact entry
- **THEN** 系统打开并选中对应 assistant message 的 Research Run，把焦点移入面板，并关闭已打开的 ProjectPanel

#### Scenario: 从 ProjectPanel 切换
- **WHEN** Research Panel 已打开且用户打开 ProjectPanel 或 Artifact
- **THEN** 系统关闭 Research Panel 并只保留新选择的右侧工作面板

#### Scenario: 面板关闭
- **WHEN** 用户关闭 Research Panel
- **THEN** 焦点返回打开它的控件，详情刷新停止，但后台研究任务继续运行

### Requirement: 面板覆盖完整产品状态
Research Panel SHALL 提供 loading、empty、running、completed、stopped、failed、interrupted 和局部来源失败状态。错误文案 SHALL 区分面板加载失败与研究任务失败，并说明当前结果是否保留。面板关闭不得等同于停止；停止 SHALL 使用明确、幂等的现有停止命令。

#### Scenario: 面板详情加载失败
- **WHEN** Research detail API 请求失败但 message 仍处于 generating
- **THEN** 面板显示“无法加载任务详情，任务可能仍在运行”及重试操作，不得宣称研究任务失败

#### Scenario: 研究失败但部分数据已保存
- **WHEN** Run 进入 failed 或 interrupted 且已存在事件或来源
- **THEN** 面板保留可查看内容，并显示失败原因、保留数量和可用恢复操作

### Requirement: 事件详情支持增量追赶
系统 SHALL 提供 owner-scoped Research detail API，使用排他的 `afterSeq` 和 1–200 的 `limit` 按 `seq ASC` 返回事件，同时返回 Run summary、与该读取时点一致或更新的 `latestSeq`、下一游标和 `hasMore`。返回的首条事件 SHALL 为 `afterSeq + 1`，批次内部 SHALL 连续；检测到持久 seq 缺口时 API SHALL 返回数据一致性错误而不是跳过。客户端 SHALL 按 `(assistantMessageId, seq)` 去重和隔离请求，在积压追平前连续请求，并仅在 Run terminal 且已获取至 `latestSeq` 后停止刷新。

#### Scenario: 面板打开时存在事件积压
- **WHEN** 客户端以 `afterSeq=N` 请求且剩余事件超过单次上限
- **THEN** API 返回从 `N+1` 开始的连续事件和 `hasMore=true`，客户端立即继续请求而不等待常规轮询间隔

#### Scenario: 实时摘要领先详情 API
- **WHEN** transient summary 的 `lastEventSeq` 高于客户端已加载的连续事件序号
- **THEN** 客户端从最后连续序号请求缺失事件，不得跳过中间时间线

#### Scenario: terminal 时仍有事件积压
- **WHEN** Run summary 已是 terminal 但客户端 afterSeq 小于 latestSeq
- **THEN** 客户端继续追赶直至连续读取 latestSeq 后才停止详情刷新

#### Scenario: 切换当前 Research Run
- **WHEN** message A 的详情请求未完成时面板切换到 message B
- **THEN** 系统取消或隔离 A 请求，迟到的 A 响应不得写入 B 的详情状态

#### Scenario: 数据库事件存在缺口
- **WHEN** API 发现下一条持久事件不是 `afterSeq + 1`
- **THEN** API 返回 `409 STATE_CONFLICT`，客户端保留已加载事件并显示可重试错误

### Requirement: 来源支持稳定分页与筛选
系统 SHALL 提供 owner-scoped Research sources API，默认每页 25 条、允许 1–100，并使用绑定 contract version、assistant message identity、筛选指纹、`firstSeenSeq` 和 source ID 的 opaque cursor。来源页 SHALL 支持最长 200 字的标题/域名/摘要搜索、allowlist 读取状态和最长 253 字的精确域名过滤；服务端 SHALL 把搜索通配字符按字面处理。筛选变化后 SHALL 清空 cursor 并回到第一页。第一版 SHALL NOT 宣称支持来源可信度评分、最终引用关系或跨轮次精确筛选。

#### Scenario: 浏览 277 个来源
- **WHEN** Research Run 拥有 277 个去重来源
- **THEN** 面板只渲染当前页，显示总数和当前范围，并使用稳定 cursor 浏览后续页面

#### Scenario: 运行中新增来源
- **WHEN** 用户已经翻到后续页且 Run 继续新增 firstSeenSeq 更大的来源
- **THEN** 现有 cursor 顺序保持稳定，已浏览条目不得因新增来源在下一页重复出现

#### Scenario: cursor 用于其他筛选或消息
- **WHEN** 客户端把一个 cursor 用于不同 assistant message、q、status 或 domain
- **THEN** 服务端拒绝该 cursor，不得将其解码结果直接用于数据库查询

#### Scenario: 来源过滤无结果
- **WHEN** 当前搜索或过滤条件没有匹配来源
- **THEN** 面板显示可恢复的空状态和清除搜索/过滤操作，不得显示整个 Run 没有来源

### Requirement: 研究状态可在刷新和终态读取后恢复
Project bootstrap 和单条 message GET SHALL 返回同一种必有但可为 null 的 `MessageDTO.researchRun` 字段；非 null envelope SHALL 至少包含 `exists=true`、数值 contract version 和 summary payload，使客户端即使不认识 payload 版本也能确定 sidecar 存在。客户端 SHALL 在一次 store 更新中合并 message 与可识别 Run summary，并在面板打开时按需加载事件与来源。数据库响应是恢复和纠错依据；实时 summary 仅用于低延迟缓存，未知版本、序号缺口或较旧响应不得让状态倒退。

#### Scenario: 运行中刷新页面
- **WHEN** 页面刷新且数据库中存在 generating message 与非终态 Research Run
- **THEN** bootstrap message envelope 恢复唯一 compact entry，并通过既有后台轮询与 Research detail API 继续更新

#### Scenario: 终态 message 收口
- **WHEN** 客户端通过既有 message GET 取得 terminal assistant message
- **THEN** 同一 DTO 携带对应 Research Run envelope，store 原子合并 message 与 summary，不需要依赖最后一个 transient chunk 猜测终态

#### Scenario: 未知 contract version
- **WHEN** 客户端收到 `exists=true` 但不认识 contract version 的 envelope
- **THEN** 客户端保留 sidecar-known 状态并显示兼容错误 entry，不解析未知 payload，也不回退到 legacy inline traces

#### Scenario: 迟到响应覆盖风险
- **WHEN** 较旧 API 响应晚于较新的实时 summary 到达
- **THEN** 客户端比较 event seq、plan version 和合法状态迁移，拒绝让 Run 回退

### Requirement: Research 数据必须按项目所有权访问
所有 Research Run、Event 和 Source 读取或写入 SHALL 通过所属 assistant message、thread、project 和当前用户验证所有权，并确认 Run 只关联 role 为 assistant 且关系一致的 message。客户端提供的 message ID、event seq、source ID、URL、状态或计数 SHALL NOT 被直接信任；source identity 和 finding 引用不得跨 Run。未知或无权访问的资源 SHALL 使用同一种未找到响应避免枚举，含研究详情的响应 SHALL 使用 `Cache-Control: private, no-store`。

#### Scenario: 跨项目读取研究详情
- **WHEN** 已登录用户请求不属于其 Project 的 assistant message Research detail
- **THEN** 系统返回 `404 NOT_FOUND`，不返回 Run、事件、来源、URL 或计数

#### Scenario: 跨 Run 引用来源
- **WHEN** 过程更新或详情请求引用属于其他 Research Run 的 source identity
- **THEN** 服务端拒绝该引用，不创建 Event，也不泄露目标来源是否存在

#### Scenario: 非法分页和过滤输入
- **WHEN** sources 或 detail 请求携带越界 limit、无效 cursor 或不在 allowlist 的状态值
- **THEN** 服务端返回 `400 VALIDATION_ERROR`，不得把任意值传入数据库查询

### Requirement: Research 联网读取必须保持服务端请求安全
Deep Research 的 search/read 路径 SHALL 保持或加强服务端 SSRF、重定向和资源预算保护。系统 SHALL 只允许无 userinfo 的 `http/https` URL，拒绝 loopback、RFC1918 私网、link-local、云 metadata、IPv6 本地/私网、非 HTTP(S) 重定向和解析或重定向后进入受限地址的目标；敏感 query 参数 SHALL 在长期保存前按大小写无关 denylist 删除，raw URL SHALL 只供当次 provider 调用且不得进入 Event、Source、日志或客户端。请求 SHALL 受连接时间、总时间、响应字节、解压后字节、重定向次数、每 Run 来源/事件/读取次数和累计元数据预算限制。

#### Scenario: 公网 URL 重定向到私网
- **WHEN** readUrl 初始地址为公网，但 DNS 解析或任一重定向目标进入私网、loopback、link-local 或 metadata 地址
- **THEN** 服务端终止读取，记录安全错误 terminal event，不保存或返回目标响应正文

#### Scenario: URL 包含身份信息或敏感参数
- **WHEN** 来源 URL 包含 userinfo、访问令牌、签名、session 参数或控制字符
- **THEN** 服务端拒绝危险 URL 或在保存前按大小写无关 denylist 删除敏感参数，面板不得展示凭据

#### Scenario: 响应超过资源预算
- **WHEN** 网页响应、解压后内容、重定向次数、Run 事件数或来源数超过服务端硬上限
- **THEN** 系统中止对应活动并记录稳定错误，不继续读取、解压或写入超额内容

#### Scenario: 安全外链渲染
- **WHEN** Research Panel 展示一个已验证来源
- **THEN** 标题和摘要按纯文本渲染，外链仅允许 `http/https` 且使用 `noopener noreferrer`，不得使用未经清洗的 HTML

### Requirement: 面板满足键盘、移动端和长内容要求
Research compact entry、tabs、折叠项、分页、关闭和停止操作 SHALL 使用原生可交互元素并提供可见焦点。桌面面板 SHALL 为非模态右侧工作区；移动端近全屏面板 SHALL 阻止背景误触。状态更新 SHALL 使用节流后的 polite announcement，不得逐来源抢占播报；界面 SHALL 在 320px、200% zoom 和 reduced-motion 下保留全部核心功能。

#### Scenario: 键盘打开并关闭面板
- **WHEN** 用户仅使用键盘激活 compact entry、切换页签并关闭面板
- **THEN** 所有操作均可完成，焦点顺序稳定，关闭后焦点返回 entry

#### Scenario: 移动端打开面板
- **WHEN** 视口进入 thread-chat 移动端断点并打开 Research Panel
- **THEN** 面板使用近全屏单栏结构、至少 44px 的主要触控区域，背景聊天不可误操作

#### Scenario: 高频来源更新
- **WHEN** 研究短时间内新增多条来源
- **THEN** 屏幕阅读器收到合并后的简短状态播报，事件列表不得抢焦点或强制滚动离开用户正在查看的位置
