## 实施状态

本次基于 #145 最新 `d4de322` 实现后台通知；此前接收面板/范围选择已经移除，下方早期记录作为历史证据保留，以末节和最新 Spec 为准。

已 rebase 到 #143 的 `afc83d2`，保留 Artifact Quote 定位与多级父链全文继承。实现落在 #145，合入目标仍是 #143。用户补充确认的版本选择使用标题旁 Dropdown；切换只改变阅读版本，不回滚文档。

已实现 Document/Revision 表、纯 Markdown edits、读收据与幂等更新、生成工具、提交恢复、主线固定输入、版本 Dropdown/差异、主线范围选择，以及旧产物登记脚本。

执行身份沿用 assistant Message ID；`messages.document_tool_parts` 独立保存已落库工具结果，防止流 checkpoint 丢失或覆盖提交收据；`messages.document_context_used` 记录实际提供商请求使用的文档清单。正文仍只保存在 Artifact。

更新只由绑定服务端执行身份的模型工具进入。没有开放允许浏览器自报 assistant/执行身份的更新 HTTP 入口。读取 API 提供文档、版本历史和主线待接收进展。

数据库外键使用版本表的复合 UNIQUE 约束支持空库建表。删除整个 Project 时，在同一事务先解除文档 head、删除文档版本链，再删除 Project；普通消息操作不删除版本。死锁仅在 PostgreSQL 已整笔回滚时有限重试，不重试未知网络提交。

## 已执行验证

- TypeScript 检查通过；新增核心模块及组件 ESLint 检查通过。
- `document-edit.test.mjs`：12 项，含双修改、缺失、重复/重叠、删除/追加、大小、no-op。
- `shared-project-documents-db.test.mjs`：31 项，覆盖登记幂等、CAS、重新读取、同命令回放、错误收据、原子性、隔离、Stop、归档、回复失败保留提交、固定输入/使用收据、跨文档外键和 Project 删除。
- 数据库测试通过 PGlite 和 Drizzle 的 pushSchema 在空的独立内存数据库运行，使用实际文档 Schema 与应用服务。没有创建 migration SQL、snapshot 或 journal。
- 现有 AI SDK v7 UI Message pipeline、StreamSession、提示词缓存合同回归通过。
- OpenSpec 全量严格校验：38 项通过。

PGlite 的连接事务是串行执行的，这组测试不能替代原生 PostgreSQL 多连接锁竞争。保留真实数据库执行入口：准备独立测试库并 `db:push` 后，设置 DATABASE_URL 运行数据库测试。

## 交接时尚未通过的发布门槛（本地进展见末节）

1. 原生 PostgreSQL 多连接竞争、旧库登记/升级演练。用户决定在 macOS 本地验收；本轮未操作 Neon。
2. 真实模型自然语言工具序列验收；样例保存在 `e2e/thread-chat/document-update-cases.json`，交由用户使用 macOS 本地配置运行。
3. 桌面/手机交互与截图。开发服务可启动，但 agent-browser daemon 启动失败，且本环境无法连接本地服务端口；开发专用页面 `/thread-chat-gate-3-harness/documents` 已提供可复验的真实组件 fixture，不对生产环境开放。
4. develop 单一集成任务生成并验证迁移。功能分支不生成迁移，尚不可直接发布。

## 运行与回退

- `node --import tsx e2e/thread-chat/document-edit.test.mjs`
- 在已应用 Schema 的隔离库：`node --env-file=.env.local --import tsx e2e/thread-chat/shared-project-documents-db.test.mjs`。
- 旧产物登记：`node --env-file=.env.local --import tsx scripts/documents/backfill.ts`；每个 completed Markdown 独立事务，可重复执行，同名不合并。
- `THREAD_CHAT_DOCUMENT_WRITES=false` 关闭更新工具并在服务端拒绝新写入；读取、固定上下文与已提交收据继续可用。
- 先完成数据库集成迁移，再上线兼容服务端、执行登记、启用工具与客户端。发布前不得归档本 Change 为全部验收完成。

## 本轮补齐

- rebase 到 #143 最新代码，保留其可见 Markdown 解析、移动端 Drawer 层级与分叉后关闭面板修复。
- 数据库复合外键约束 Document/Revision/Artifact 的 Project 和真实来源消息；仍无正式 migration。
- 主线进展轮询同步最新固定 Artifact 和版本元数据，保留正在阅读的历史内容、选区及草稿；版本快速切换以最后一次请求为准。文档范围在本轮发送成功后复位。
- 旧 Markdown 登记分页执行、逐份提交、幂等恢复，只登记 completed assistant 来源；未登记目标和失败来源不被偷偷转换。
- 提供商仅返回初始化/上下文错误不消费文档进展。后续新消息不补发旧失败轮次从未使用的计划全文；重试原消息仍保持原清单，已使用历史不丢弃。
- 当前选定版本可导出或通过系统文件分享；不生成公开分享链接，后续 head 变化不改变文件内容。
- 增加 macOS 独立库验收入口及原生锁竞争屏障：必须观察到 A/B 两条连接同时等待文档锁后放行，不能仅以 Promise.all 当作多连接证据。

本轮验证：TypeScript、相关 ESLint、Markdown 修改 12 项、文档数据库检查 31 项、使用收据/失败计划/固定导出测试、预算错误测试、Markdown 可见文字、Quote 合同、StreamSession、提示词缓存和 #143 Artifact fork 数据库/SDK 上下文回归通过。数据库结果来自 PGlite；不代表原生多连接、真实模型或浏览器已通过。OpenSpec 全量严格校验 38 项通过。

本地运行按 [macOS 验收清单](macos-acceptance.md)。仍未归档或发布。模型目录没有可信的完整请求 tokenizer/context window，因此生产预算保持 unknown；保留提供商超限反馈和范围缩减流程，不能声称已实现所有模型的精确调用前计量。

## 2026-09-15 代码质量修复与本地复验

- 将 application、persistence、domain、streaming 各层文档功能放入各自 documents 目录；维持层间边界，不用全局 utils 汇集业务规则。
- 统一工具选择、步骤预算、写入开关、来源资格与固定上下文展开规则。应用服务保留事务编排，SQL 与收据解析进入专门仓储。
- 历史列表只返回元数据；差异展开时再读取固定正文。版本选择、差异、导出分别维护操作状态；显式传递提问状态，异步导航失效后不得覆盖当前视图。
- EGO 发现并修复版本菜单层级、重复 React key，以及持久化文档清单被误当用户编辑内容造成刷新崩溃的问题。
- 独立本机数据库 wt_pr145_quality 完成 db:push、seed，原生应用服务检查 35 项通过。实际观察 A/B 双连接等待同一文档锁，并验证持有 F1 锁期间另一份文档成功提交；无 migration、snapshot、journal 变更。
- GPT-5.6 Luna 通过真实 @artifact 执行 readProjectDocument → updateProjectDocument，一次提交方案和复选框；一个 Document、两个版本，刷新后正文、来源和 committed 收据保留。
- EGO 完成桌面差异、V1 切换/导出、390×844 手机展示、分享失败重试、真实提问状态禁用版本切换。分享失败使用 fixture 注入，不能视为系统分享成功。

详见 [本地修复验收记录](../../../docs/acceptance/pr-145-quality-review.md)。tasks 仅新增勾选 2.1、3.2。真实 A/B/C 全流程、完整边界模型案例、系统分享、主题/焦点矩阵、关闭写入后重启及旧生产库迁移仍待验收。完整请求预算保持 unknown。

## 本次修订：所有 Thread 后台通知（基于 d4de322）

- 移除主线待接收面板、范围复选框、恢复默认、documentScope 请求/状态与已固定输入提示；也不添加可见通知分隔线。
- send/edit/fork firstTurn 共用 appendDocumentNotices，在接受消息的事务中以单一 SQL 快照保存新 Part。每文档最近 10 条未通知摘要、当前版本及省略数量；不加载正文，不把长事件链交给 AI 重建状态。
- 所有 Thread 通知位置独立；document_context_used 兼容旧 commitIds 收据与新 revisionNumber 收据，仅有效提供商响应推进。全文读取仍用已有固定工具结果/readId。
- 新通知、历史读取结果按原顺序保留，新版本只追加；旧全文 Part 的模型展开合同保持兼容。增加新通知专用快捷编译路径，无旧格式时不查询文档正文。
- 目录 API 只返回 documents；useProjectDocumentSync 保留原轮询、固定 Artifact/head 同步和历史选区/草稿保护，失败提示与 AI 通知无关。
- 修正预算超限文案，去除已不存在的范围选择建议。升级需要刷新前端，服务端不再接收 documentScope。此次无新增数据库列、迁移或 Neon 操作。

本次自动验证：TypeScript、变更 TypeScript/React 文件 ESLint、git diff --check；新通知最终模型消息前缀、固定全文追加、编辑过滤、旧格式兼容、预算错误、Artifact 引用上下文及提示词缓存回归通过。PGlite 使用实际 Schema/应用服务，38 项通过，新增覆盖独立 Thread 收据、接受消息后 head 前进、固定重试、分叉首轮、编辑新快照，以及连续 12 次提交后的摘要上限和通知位置。

PGlite 不替代原生多连接测试。本次未执行 macOS 浏览器或真实模型验收，旧 Mac 证据不能算作新行为已通过。请按 macos-acceptance.md 第 5 节重新验收，tasks 5.5、8.1、8.2 保持待验收。长对话全文依然累积，不承诺无限上下文或固定缓存命中率。

## 二次质量审查修复

- 当前条目从服务端 Document 目录按 currentArtifactId 查询；Artifact 元数据仅保留固定版本身份，不再携带可变 head。
- 项目运行时持有目录轮询生命周期，来源回复状态每次刷新；不依赖 Drawer，不更换当前阅读版本或草稿。未变化目录保留 store 引用。
- ProjectBootstrapDTO.artifacts 和目录接口只提供 ArtifactSummaryDTO；全文通过固定 Artifact API 读取并进入独立缓存。历史卡片及 Fork 来源元数据保持；未加载正文明确为 null，不能作为空内容交给模型。
- 通知查询在单次 SQL 中汇总 Thread 收据、过滤已消费提交并计算每文档最近 10 条及省略数量；兼容不连续旧 commitIds，不将其错误解释成连续版本游标。
- application/documents/model-context.ts 持有文档格式与文档上下文类型；通用引用编译保持单遍有序展开、共享去重集合，原序列化文本不变。
- 原生独立 PostgreSQL 41 项通过，包含 A/B 同时等待文档锁、不同文档独立提交、Bootstrap 无正文及历史全文按 ID 读取。真实 EGO 验证桌面/390×844 下的历史及最新阅读；真实模型全场景和系统分享仍未补齐，不据此提升发布状态。

## 三次审查修复：锁协议与目录一致性（2026-09-15）

- 会话写入口 `lockOwnedThread` 先锁 Project，再锁 Thread；编辑/重试通过 `lockOwnedMessageTurn` 继续锁 Message。Stop、反馈和文档执行使用 Project 共享锁。生成收尾也先锁父级，避免插入 Artifact 的外键检查逆序获取父锁。删除全局死锁事务重试，原生测试不靠重试掩盖锁升级。
- `startProjectDocumentSync` 是运行时唯一的目录请求/写入入口。生成结束和打开面板使用 store 失效通知；未完成请求收到通知后不落地旧响应，合并补发一次请求。普通定时轮询不反复取消慢请求。打开面板不再用完整 Bootstrap 覆盖会话状态。
- `listOwnedProjectArtifactCatalog` 一次关联查询返回匹配的当前 Document 与 Artifact 元数据；Bootstrap 和目录 API 复用。历史版本不再进入每五秒的目录响应。
- `/threads/:threadId/artifacts` 按所有权返回该 Thread 的固定历史元数据，不含正文。运行时仅为已打开的 Thread 加载，消息状态未变时不重复请求；失败可重试。历史缓存不能更新 Document head，来源终态不能被旧生成中状态覆盖；正文仍按固定 Artifact ID 加载。
- wt_pr145_quality 原生数据库 43 项通过，含原有文档锁竞争、不同文档独立提交、新的 Project 锁竞争与并发目录快照检查。真实三版本项目的 Bootstrap/目录均返回 1 个 Document + 1 个 Artifact，打开主线按需返回 3 条历史元数据。
- EGO 在已有「PR 143 本地验收」空间验证桌面 V1、390×844 手机 V1/最新阅读、列表计数 1、@ 单一候选，并实际检查截图。测试草稿已清除，用户原标签保留；未发送真实模型请求。完整模型、系统分享与迁移验收仍保持待完成。

## 四次审查：生产边界与收据身份

- 核对后保留 `GET /documents/:documentId` 与 `getProjectDocument`：按 Document 读取当前版本是 proposal/spec 明确要求的服务契约；历史卡片按固定 Artifact 读取是另一种语义，不因当前客户端未调用而删除契约。
- 已退役的 `pendingDocumentUpdates` 全文清单生成器移至 e2e 夹具。生产只生成摘要通知，但仍兼容已持久化的旧全文清单和收据。
- 删除没有入口的 Document 独立归档字段、DTO 字段与判断，文档写权限继续继承 Project 归档。更新设计文件；没有运行 db:push/db:generate 或任何删列 SQL，独立库遗留空列不影响代码，正式迁移仍由 develop 单独集成。
- `DocumentContextReceipt` 改成带 `kind: updates | notices` 的判别联合。消息 Part 格式保持不变，生成入口从 Part 类型明确创建带标签收据，新写入严格校验。仅持久化读取边界允许无标签 v1 兼容；未知 kind/schemaVersion（包括显式 null kind）不推进 SQL 通知游标。
- 旧全文计划使用文档、固定 Revision/Artifact 及 commitIds 集合组成的语义身份匹配；不再比较整段 JSON。键序、文档顺序和提交集合顺序不影响匹配，不同版本/Artifact/不完整提交集合不能冒充已使用记录，摘要收据不能证明全文已使用。没有旧全文 Part 时不扫描收据。
- 类型检查、相关 ESLint、文档专项、引用上下文、提示词缓存和原生 PostgreSQL 44 项通过。原生覆盖新旧两类收据、未知协议拒绝、Project 归档及原有锁竞争。未重跑真实模型/浏览器全场景，不提高发布验收状态。

## 当前决策：稳定工具集合与完成事件刷新

按用户选择保留文档工具常驻，不增加空项目判定查询；完整 DOCUMENT_INSTRUCTIONS 仅在 system 出现，更新工具使用独立短描述。schema 与 CLAUDE.md 明确 restoreDocumentToolParts 为展示/上下文恢复入口；匹配调用原位替换，未匹配调用末尾追加是防丢失兜底，不承诺完整时序。本期不新增排序协议。

目录删除五秒定时器和对应常量、启动后的重复请求、打开面板的刷新回调。Bootstrap 提供初始目录，本地生成完成（含恢复跟踪的生成终态）通知同一协调器刷新。同步失败文案改为要求刷新页面，不再声称自动重试；其他浏览器的新文档可暂时不可见，用户刷新页面后加载。已打开历史正文不受目录刷新影响；按需历史/正文查询保留。

TypeScript、相关 ESLint、文档专项、客户端 store、提示词缓存、OpenSpec strict 与 diff 检查通过；新增无后台定时器/无重复初始目录请求及恢复顺序兜底回归。没有本轮真实模型、浏览器或新数据库验收证据，不替代原有未完成门槛。
