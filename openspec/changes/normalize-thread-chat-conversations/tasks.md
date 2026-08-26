## 1. Gate 0 — 契约、边界与回归安全网

- [x] 1.1 建立本 change 的实现分支基线，列出 `/thread-chat` 当前列视图、画布、Composer、模型选择、选择分叉、Artifact 抽屉、标题、反馈、Stop、Retry 和本地工作区状态的可见验收清单，并明确 variant picker 是唯一允许移除的 UI。
- [x] 1.2 按 `design.md` 创建 `lib/thread-chat/domain`、`contracts`、`persistence`、`application`、`streaming`、`server` 模块目录与只读依赖出口，确保尚未接线到生产请求。
- [x] 1.3 定义 `ThreadChatUIMessage`、typed data parts、typed tools、`ProjectDTO/ThreadDTO/MessageDTO/ArtifactDTO/ProjectBootstrapDTO`，直接引用当前 `ai@7` 类型并用类型测试覆盖 text/reasoning/source/file/tool/data parts。
- [x] 1.4 为 start/send/fork/edit/retry/stop/feedback/rename/archive/delete 定义 Zod v4 strict command schemas、稳定 API error codes、`CommandResponse` 与 `StreamEvent` 契约，覆盖未知字段和同 ID 异义重放错误。
- [x] 1.5 实现纯领域状态机、当前时间线、latest turn、soft-supersede 可执行性和 frozen fork context 构造/校验函数，不引用 React、DB 或计费模块。
- [x] 1.6 增加 Node assert 契约测试，覆盖 A failed→Retry B→B failed→Retry C、终态不可逆、重复 command、Edit 仅最新 turn、旧来源分支 context 不迁移以及 superseded Message 仍可查。
- [x] 1.7 增加依赖边界扫描，禁止新 v1 API/application/streaming/title 模块 import `lib/billing/*`、`lib/payments/*`、`lib/chat/usage-store.ts`、旧 generation billing 类型或旧整树 persistence 模块。
- [x] 1.8 检查 Next.js 16 本地 Route Handler 文档和安装版 AI SDK v7 类型，将 params Promise、Web API Response、非废弃 `toUIMessageStream`/`readUIMessageStream` 用法固化为源码级测试或注释引用。
- [x] 1.9 运行 Gate 0 的 Node 测试、`pnpm typecheck` 与依赖扫描；只有契约、状态机和计费隔离全部通过才进入 Gate 1。

## 2. Gate 1 — 规范化数据库与应用命令

- [x] 2.1 在 `lib/db/schema.ts` 定义 `projects`、`threads`、`messages`、`artifacts`、`conversation_commands` 的 Drizzle schema、check/unique/partial indexes 和关系类型，不改现有 billing/payment 表。
- [x] 2.2 生成并人工审查 Drizzle migration，验证 `user.id`/所有新 ID 均为 text、FK 删除策略正确、根线程与脚注唯一约束正确，且此 Gate 尚不 rename/drop 旧表。
- [x] 2.3 实现 owner-scoped Project/Thread/Message/Artifact 查询仓储和 DTO mapper，确保跨用户与不存在资源统一返回不泄露信息的 404 语义。
- [x] 2.4 实现 Project bootstrap/list/message/artifact queries，返回 superseded 历史实体但由 DTO 明确标识，并为合法未落库 Project URL 返回空工作台投影。
- [x] 2.5 实现 `conversation_commands` 收据仓储：规范化请求哈希、事务内首次插入、并发唯一冲突后的回读、相同语义 replay 和异义 `COMMAND_ID_CONFLICT`。
- [x] 2.6 实现 Thread `next_sequence` 的原子 UPDATE RETURNING 分配器与 Project `next_footnote` 分配器，支持一次分配 1 或 2 个连续序号且禁止 `max(sequence)+1` 读改写。
- [x] 2.7 实现创建 Project + 根 Thread + 首轮 user/assistant 的 `start-project` 命令事务，确保失败时零部分记录、成功时 assistant 为 generating。
- [x] 2.8 实现普通 `send-message` 命令事务，验证模型 ID、附件所有权、当前 Thread 状态和两个连续 sequence，并返回权威 accepted DTO。
- [x] 2.9 实现 `fork-thread` 命令事务：校验来源、原子脚注、父子同 Project、完整 TextAnchor、`parent.fork_context + parent 当前路径至 source` 冻结数组，以及可选首轮的原子创建。
- [x] 2.10 实现 `retry-message` 命令事务：仅允许最新活跃终态 assistant，创建新 Message、设置 `replaces_message_id` 和旧行 `superseded_at`，不修改旧 status/parts/Artifact。
- [x] 2.11 实现 `edit-turn` 命令事务：仅允许最新活跃 user turn，soft-supersede 旧 user/assistant 并追加新 user/assistant；暴露需在 commit 后 abort 的旧 generation ID。
- [x] 2.12 实现 Stop 请求登记、反馈 set/switch/clear、Project rename/archive/delete、Thread model/title 更新，并确保每个写命令都使用 owner lock、strict schema 和 command receipt。
- [x] 2.13 实现 `compile-model-context`：按 frozen ID 顺序批量加载历史 `parts[]`、追加本 Thread 当前时间线、应用现有 prompt budget，并由服务端单独注入 system prompt。
- [x] 2.14 实现无计费依赖的双轨 title service 与“一次尝试”CAS，保持 MainThread 自定义标题同时作用于 Project 导航标题的现有展示优先级。
- [x] 2.15 增加数据库测试，覆盖 owner isolation、跨 Project FK 伪造、并发 sequence/footnote、重复 start/send/fork、Retry 竞态、Edit 原子性、删除竞态与 command 异义冲突；每个脚本使用随机用户并在 finally 清理。
- [x] 2.16 增加持久化协议测试，往 Message 写入包含 text/reasoning/source/file/tool/data parts 的完整 UI Message，读取后做结构等价断言，并验证 transient data parts 不落库。
- [x] 2.17 在空开发数据库执行 migrate up、约束负例、全量 Gate 1 DB 脚本和 `pnpm typecheck`；通过后记录 schema 快照与 Gate 出场证据。

## 3. Gate 2 — 独立 Stream Session、AI SDK v7 pipeline 与 v1 API

- [x] 3.1 在 `constants/` 定义 Session terminal TTL、cleanup 周期、heartbeat、checkpoint 节流和客户端轮询退避常量，附用途注释并消除旧 generation 常量复用。
- [x] 3.2 实现 `StreamSession` 类型和 `globalThis` 单例 `SessionStore`，包含 Map、AbortController、完整 UI Message snapshot、event sequence、subscriber Set、finishedAt 与已 catch 的 task Promise。
- [x] 3.3 实现 Session 创建幂等和“先注册 subscriber→发送 snapshot/throughSeq→发送后续 chunk”的原子订阅路径，保证同一 Message 不启动第二个 task。
- [x] 3.4 实现 cleanup timer，只清理超过 TTL 且无订阅者的终态 Session，调用 `unref()`，并用 fake clock 覆盖活跃 Session 不误删和终态 Session 不泄漏。
- [x] 3.5 实现 AI SDK v7 pipeline：`streamText().stream` → 独立 `toUIMessageStream` → `readUIMessageStream`，固定 response Message ID，启用 reasoning/sources，先更新 snapshot 再编号广播标准 chunk。
- [x] 3.6 将现有 Markdown Artifact、联网搜索/深读和引用进度映射为 typed tool/data parts，删除新 pipeline 中的纯 `textStream` 拼接与临时旁路消息字段。
- [x] 3.7 实现 generating Message 的非 transient `parts[]` 节流 checkpoint，使用 `status='generating'` CAS、跳过无变化快照，并在 finalize 前强制 flush。
- [x] 3.8 实现唯一 finalize service：根据 AI SDK `onEnd` 的 responseMessage/isAborted/finishReason 或捕获异常决定 completed/stopped/failed，条件更新 Message，并在同一事务写最终 Artifact 和 provider raw usage。
- [x] 3.9 实现 `run-generation` orchestration，在 DB commit 后先登记 Session 再启动模型任务；不使用 request.signal，不依赖 Route Handler/`after()` 持有任务，所有异常都回到 finalize。
- [x] 3.10 将 Stop application command 接到 Session abort；验证 Stop 不直接写 stopped、重复 Stop 幂等、Stop-vs-complete 恰有一个终态，Session 丢失时收敛为 failed 而非伪造 stopped。
- [x] 3.11 实现一次性 runtime initialization Promise，在进程接受 v1 ThreadChat 请求前把旧进程遗留 generating 行条件更新为 `failed/PROCESS_RESTARTED`，保留 checkpoint parts。
- [x] 3.12 实现 `/api/thread-chat/v1` 的 auth、owner resolution、strict parse、错误映射与 no-cache route utilities；动态路由使用 `await ctx.params`。
- [x] 3.13 实现 Project list/bootstrap、Message poll、Artifact read、Project/Thread mutation 的薄 Route Handlers，并验证响应只返回 DTO、不泄露 DB row 或 error stack。
- [x] 3.14 实现 start/send/fork/edit/retry/stop/feedback 命令 Route Handlers，确保只有 `replayed:false` 的新生成结果尝试 `SessionStore.start()`，replay 只返回原结果。
- [x] 3.15 实现 Message stream Route Handler 和 SSE encoder，发送 snapshot/chunk/terminal/heartbeat，设置 no-cache/no-transform/X-Accel-Buffering headers，并在连接取消时仅注销 subscriber。
- [x] 3.16 用可控 fake model stream 增加协议测试，覆盖 text、reasoning、sources、files、tool input delta/output、data parts、Artifact-only、partial error、abort 与空回复的最终 `parts[]`。
- [x] 3.17 增加 Session 竞态测试，覆盖 POST 后立即订阅、chunk 与订阅并发、两个订阅者、最后订阅者断开后继续完成、迟到订阅终态快照、TTL cleanup 和重复启动。
- [x] 3.18 增加 API/DB 集成测试，覆盖认证/404、strict body、幂等 replay 不重复模型、SSE 不可用仍可 poll、checkpoint、Stop/完成竞态、进程重启 sweep 与 Artifact 原子落库。
- [x] 3.18a 增加 v1 Route Handler + Better Auth + 专用测试 PostgreSQL 集成测试：携带真实签名 session cookie 调用 Route Handler，以可控 fake generation 替代上游模型但不 mock application/repository/DB，覆盖首发、Send、SSE 断开、poll、Stop、Retry、Edit、Fork、Artifact、owner isolation、strict body、命令重放、标题/反馈和级联删除。
- [x] 3.19 运行 Gate 2 全部纯测试/DB 测试、依赖扫描和 `pnpm typecheck`；确认无新代码访问 balance/credits/billing/cost 后才允许前端接线。

## 4. Gate 3 — 规范化前端 Store 与既有组件适配

- [x] 4.1 将 `app/thread-chat/core/store.ts` 改为 `zustand/vanilla` 规范化实体 store，建立 conversation/workspace slices、optimistic patch 记录与 React `useStore` 绑定，禁止把业务实体写入 localStorage。
- [x] 4.2 实现 visible messages、全部历史实体、树拓扑、lineage/children、fork marker/source provenance、Artifact、标题、busy/可执行动作 selectors，visible timeline 默认过滤 superseded Message。
- [x] 4.3 实现 Project bootstrap 与空 URL boot：hydrate 规范化 DTO、恢复本地 workspace、对 generating Message 直接标 background 并启动 poll，不恢复 SSE。
- [x] 4.4 实现 v1 JSON client 和统一错误处理，所有写请求生成/保留 command ID 与实体 UUID，网络重试必须复用原 ID 和原语义负载。
- [x] 4.5 实现 fetch-SSE client 与 `StreamEvent` decoder，用 AI SDK v7 reducer归并 snapshot/chunk；断开时禁止自动 reconnect/Last-Event-ID，并清理 reader/subscription。
- [x] 4.6 实现 terminal poller 与退避：保留较新的内存 live snapshot，不被旧 generating checkpoint 回退；收到 completed/stopped/failed 后用权威 DTO 原子收敛并停止轮询。
- [x] 4.7 实现 start/send/stop 命令 orchestration：乐观 user/assistant、成功 DTO 校正、一次 stream 连接、失败精确回滚及现有 toast/busy/stop 文案保持。
- [x] 4.8 实现 Fork 命令 orchestration：客户端 UUID 乐观新列/画布节点、服务端 footnote/context 校正、失败只移除临时分支，留空与带问分支流程保持现状。
- [x] 4.9 实现 Edit/Retry/feedback/model/title/archive/delete 命令 orchestration，确保 A/B/C soft-supersede、反馈乐观回滚和标题双轨不改变现有操作流程。
- [x] 4.10 改造 `ChatView`/`ConversationMessage` 的数据适配，以完整 `parts[]` 渲染正文、reasoning、source、file、tool/data 内容，并保持现有 Markdown、研究面板与消息 toolbar DOM/CSS 契约。
- [x] 4.11 改造列视图、画布、tree list、thread switcher 和 workspace runtime 只消费规范化 selectors；验证节点/边、LRU 列槽、最近访问和本地展开状态不依赖整树业务 JSON。
- [x] 4.12 改造选择锚点与 source provenance：ForkedThread 使用持久化 TextAnchor/anchorText/footnote，来源 Message supersede 后子分支仍能在树/画布打开且说明不迁移到新回复。
- [x] 4.13 改造 Artifact card/drawer 和 web research overlays，从 tool/data parts + ArtifactDTO 投影现有 UI，保持 Artifact-only 回复、抽屉来源、代码高亮和刷新恢复行为。
- [x] 4.14 保留 Project 级 localStorage 工作区 schema（视图、打开列、画布、面板尺寸、折叠/展开），增加 sanitize/version 测试并删除其中任何会话内容/active-leaf 权威字段。
- [x] 4.15 删除 `turn-variant-picker.tsx`、variant/active-leaf command、版本计数与切换 selector/样式引用；保留 superseded 实体供 frozen branch/source 查询，但不提供切回入口。
- [x] 4.16 改写纯 Node 客户端测试，覆盖 bootstrap、Store merge、chunk parts、terminal poll、断流不重连、optimistic rollback、A→B→C、旧分支可达、Artifact/research 和本地工作区隔离。
- [x] 4.17 建立仅用于 Gate 3 验收的 normalized runtime 测试 harness：复用现有列视图、画布、Composer、消息、Artifact 和 workspace 组件，注入 mock v1 API/SSE；不得替换正式 `/thread-chat` 入口、不得读写旧整树 API，也不得形成生产双轨运行路径。
- [x] 4.18 使用 `ego-browser nodejs` 在 localhost 操作 4.17 的测试 harness，覆盖正常流、POST 后迟到 SSE、半途中断后只轮询不重连、刷新后 background poll、Stop/Retry/Edit、留空与带问 Fork、嵌套分支、Artifact/research、标题/反馈/归档/删除、本地布局恢复和 variant 消失；逐项比对 Gate 0 清单。若除 variant 外发现无法等价保持的 UX/UI 冲突，停止对应任务并提交用户决策。
- [x] 4.19 运行 Gate 3 全部纯测试、`pnpm typecheck`、`pnpm lint`、依赖边界扫描、OpenSpec strict validation 和 UI 回归；记录 Gate 3 evidence。只有列/画布/Composer/分叉/Artifact/标题/Stop/Retry 均保持且 variant 已移除，才逐项勾选 4.1–4.19，并按用户要求创建独立的 Gate 3 完成 commit 后进入 cutover。

## 5. Gate 4 — 一次性 cutover 与旧运行路径退役

- [ ] 5.1 建立旧路径退役清单，映射 `branch_trees`、`branch_generations`、active-leaf/variant、generation reconciliation、整树 PUT/save gate、旧 `/api/chat` threadChat mode 和 billing settlement 的每个生产引用及对应新模块。
- [ ] 5.2 编写维护窗口与数据库备份 runbook，记录备份验证、应用停写、migration、空新表检查、应用切换、smoke 和运维级 rollback 命令；不得把旧数据迁入新表。
- [ ] 5.3 编写 cutover migration：将旧 `branch_trees`、`branch_generations`、`branch_message_feedback` rename 为明确 legacy backup 表名，新应用 schema 不 export 它们；不 drop 备份、不建兼容 view、不双写。
- [ ] 5.4 将 `/thread-chat` 唯一接线到 v1 bootstrap/normalized store/session pipeline，移除对旧整树 GET/PUT、旧 generation poll 和旧 `/api/chat` threadChat mode 的运行时调用。
- [ ] 5.5 删除或隔离旧 `lib/thread-chat-generation`、generation reconciliation、tree persistence/save gate、active-leaf/variant contracts 与已无消费者代码，保留与新架构复用的纯 TextAnchor、prompt policy、Artifact 和研究逻辑。
- [ ] 5.6 从旧 `/api/chat` 或共享工具中抽取仍需复用的无计费 model/tool 配置，确保 v1 生成和 title 路径不经过 generation settlement、credits、balance、cost evidence 或 billing routes。
- [ ] 5.7 删除/改写宣称整树、generation sidecar、variant switching 或一次扣费为正确行为的旧测试；保留 CSS/布局/锚点/Artifact/研究等仍适用回归，避免假阳性。
- [ ] 5.8 增加静态扫描与运行时 spy，证明 `/thread-chat` 请求只访问新表/API，旧 legacy backup 表零读取/零写入，billing functions 零调用。
- [ ] 5.9 在一次性空 schema 演练中执行完整 cutover：旧表含种子历史、新表为空；migration 后旧 URL 不 fallback、首条消息只写新表、旧历史不可见且没有双写。
- [ ] 5.10 运行全量 Node/DB 脚本、`pnpm typecheck`、`pnpm lint`、`pnpm build` 与 `pnpm openspec:validate`，审查无未提交生成代码和无意 UI/CSS diff。
- [ ] 5.11 完成 Gate 4 出场审查：新模型为唯一权威、旧数据未迁移、旧计费未调用、legacy 表仅运维备份、rollback runbook 可执行后才允许部署。

## 6. Gate 5 — VPS 部署、故障演练与验收

- [ ] 6.1 在部署前检查 Coolify/进程管理配置固定 `replicas=1`、单 Next.js Node 进程且未启用 PM2 cluster/多 worker；不满足即阻断上线。
- [ ] 6.2 检查 VPS 反向代理的 SSE 配置：关闭 buffering/compression transform、允许长连接、传递 no-cache/X-Accel-Buffering，并验证 heartbeat 不被吞掉。
- [ ] 6.3 对生产数据库执行可恢复备份并验证可读，进入维护停写，应用 Gate 4 migration，确认新规范化表为空、legacy backup 表行数与切换前一致。
- [ ] 6.4 部署新应用并执行数据库/认证/API smoke：空项目 URL、首发、列表、bootstrap、owner 404、Message poll、Artifact read 和 command replay 均通过。
- [ ] 6.5 使用 `ego-browser nodejs` 验收现有列视图、画布、Composer、模型选择、留空/带问分叉、嵌套分支、Artifact 抽屉、研究来源、标题、反馈、归档/删除与本地布局，除 variant 移除外不得有 UX/UI 变化。
- [ ] 6.6 做真实慢流断开演练：生成中关闭 SSE/刷新页面，确认模型不 abort、页面显示后台生成、不重连流、轮询后自动展示完整 `parts[]`。
- [ ] 6.7 做 Stop/Retry 演练：Stop 与完成竞争只出现一个终态；failed A Retry 创建 B 且 A 不变；B 再失败 Retry 创建 C；相同 command replay 不重复调用模型。
- [ ] 6.8 做旧来源分支演练：从 A 创建 X 后以 B supersede A，确认 X 的 context/source/Artifact 仍指向 A、X 可继续生成，且 X 不迁移到 B。
- [ ] 6.9 做受控进程重启演练：生成中重启唯一 Next.js 进程，确认 checkpoint 保留、遗留 Message 收敛 `failed/PROCESS_RESTARTED`、页面轮询停止并可 Retry。
- [ ] 6.10 检查运行日志和数据库，确认每条生成一个 Session/一个模型调用/一个终态，checkpoint 写入受节流，Session TTL 清理生效，无余额/credits/cost/billing 调用。
- [ ] 6.11 在观察窗口监控进程内存、活跃 Session 数、Postgres 写频率、SSE 断开率和终态分布；仅在不改变行为契约的范围内调整 TTL/checkpoint/heartbeat/poll 常量。
- [ ] 6.12 根据 runbook 演练一次非生产 rollback 或恢复验证，确认 legacy backup 可用于恢复旧应用，但新会话不承诺回写旧格式。
- [ ] 6.13 完成 Gate 5 总验收并记录证据；确认所有 OpenSpec tasks、strict validation、构建、DB、浏览器和故障演练通过后，才将该 change 标记完成。
