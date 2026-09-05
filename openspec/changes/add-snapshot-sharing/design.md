## Context

本设计基于 `main@490841c1e8598ba34f2c38377f2402ef09861c6a`。用户已确认：一期 Project 与 Markdown Artifact 匿名只读分享；内容与首屏布局一起冻结；有效期 3/7/30 天或无限，默认无限；不公开 Memory、Instructions、附件或内部数据；更新内容创建新链接。

当前实现依据：

- `lib/db/schema.ts`、`lib/thread-chat/contracts/dto.ts`：Project、Thread、Message、Artifact 已分表；Artifact 保存 `projectId/threadId/sourceMessageId`。不沿用旧整树 JSON 数据模型。
- `lib/thread-chat/application/queries.ts`：完整 Bootstrap 包含 Files、Instructions、全部消息及生成状态，不能直接作为公开响应。
- `lib/thread-chat/persistence/message-repository.ts`、`domain/timeline.ts`：数据库保留被替换的消息，界面默认只读当前时间线；分支的 `forkContext` 保存冻结消息 ID。
- `app/thread-chat/core/types.ts`、`orchestration/workspace/use-normalized-workspace.ts`：已有列/画布状态。`use-workspace-overlays.ts` 的当前 Artifact 状态与 workspace 分离；画布 pins 还有独立宿主，不能假设 localStorage 已包含实际首屏的一切。
- `app/thread-chat/chat/message/markdown-body.tsx`：Markdown 渲染可独立复用，已有代码复制、表格局部滚动。
- `proxy.ts` 在页面入口进行 cookie 检查，`app/thread-chat/layout.tsx` 再做真实登录校验。公开分享页必须在两层门禁之外独立落地；仅新增页面并不能实现匿名访问。

## Goals / Non-Goals

**Goals:**

- 分享者安排好布局后创建链接，匿名读者打开同一份内容，能完整浏览网状对话而不会触发写操作。
- 单独分享 Markdown 成果不连带开放来源对话。
- 服务端完成一致快照、白名单输出、有效期与撤销校验，保持私有 API 的权限不变。
- 复用现有阅读能力；只建设本期必需的数据和组件，不引入通用发布系统。

**Non-Goals:**

- 实时同步、覆盖旧快照、版本树、差异比较、同步队列或后台快照任务。
- Thread/Message 独立分享、手动隐藏 Thread/Artifact、任意正文打码与自动脱敏。
- 附件公开/复制、Memory/Instructions 展示、HTML/Custom Visual 分享、写协作、密码、邀请和访问统计。
- 改变原 Project 的 Fork/Quote/缓存语义，或在此功能分支生成数据库 migration。

## Decisions

### 1. 一张分享表，快照内嵌 JSONB

新增 `shares`，内容与初始布局放在同一份不可修改的 `snapshot` 中。字段草案：

| 字段 | 约束与语义 |
| --- | --- |
| `id` | 内部管理 ID |
| `token` | 服务端密码学安全随机生成，至少 128 位随机熵，唯一索引；不得使用源资源 ID 作为 token |
| `ownerId` | 归属用户外键，删除用户时级联移除 |
| `sourceProjectId` | 来源 Project 外键，便于所有者管理与删除 Project 时级联清理；不作为匿名查询条件 |
| `resourceType` | 本期仅接受 `project` 或 `artifact`，不提前注册其他处理器 |
| `resourceId` | 来源对象 ID；创建时验证归属与类型，Project 类型必须等于 `sourceProjectId` |
| `snapshot` | 公开数据加布局；不可通过更新接口修改 |
| `schemaVersion` | 数据格式版本，从 1 开始；不是内容 Revision |
| `createdAt / expiresAt / revokedAt` | 服务端时间；`expiresAt=null` 表示无限；撤销不可恢复 |

保存所有者/来源管理索引、token 唯一索引以及类型/时间约束。Artifact 来源必须同时验证 owner、Project、Thread、Message 关系，不能只判断传入 ID 存在。

选择内嵌快照而非复制 Project/Thread/Message 数据库行，避免副本混入私有列表或被生成逻辑误用。选择一个简单类型分支而非 ShareProvider/权限注册表；未来扩充新的分享粒度时再增加对应契约。

删除来源 Project 时，外键级联删除其分享记录；所有者界面应告知删除会使相关分享失效。归档、编辑、重命名、重新生成不改变既有快照。该删除规则是本设计的保守生命周期选择，并非让公开读取回查源数据。

### 2. 创建时只信任服务端正文，在同一事务内冻结

创建请求采用判别联合，仅接受 `commandId`、资源类型/ID、有效期，以及 Project 的布局白名单。服务端拒绝客户端传入正文、owner、token、创建时间、任意 metadata 或自定义截止时间。

创建流程：

1. 真实登录校验，验证 ID、类型、有效期枚举与布局参数。
2. 使用数据库 `REPEATABLE READ` 事务，在同一一致读取中验证所有权、读取 Thread/Message/Artifact 并写入分享记录；必要的串行化冲突返回可重试错误，不建设任务恢复系统。
3. 根据阅读关系选取需要的实体，再生成严格的公开白名单结构并清理链接；不得浅复制 Bootstrap 后只删少量字段。
4. 从当前组件状态捕获的布局中保留快照内有效 ID；校验数值范围、结构尺寸，丢弃无效焦点。正文缺失/跨 Project 的关联必须拒绝创建，不靠回查私有接口补全。
5. 以服务端创建时间计算到期时间并原子保存；创建成功才返回链接。失败时不产生可访问的半份快照。

复用已有 `commandId` 幂等机制，但不要让其默认事务设置破坏一致读取。重放同一命令不得重新读取新内容、生成新 token 或重算到期时间；同 ID 不同输入拒绝。独立的新分享使用新 `commandId`。

### 3. 快照的数据范围与分支闭包

Project 快照只包含公开标题、根 Thread ID、Thread 拓扑/显示标题/脚注/必要锚点、消息阅读内容、Markdown Artifact 和初始布局。

- 保存全部 Thread，不以当前打开的列决定分享范围。
- 消息集合为当前时间线消息，加所有分支 `forkMessageId/forkContext` 与纳入 Artifact 来源所需消息的去重并集；所有引用都必须在快照内闭合并属于同一 Project。
- 旧消息只有在上述阅读关系需要时进入快照，标识其来源已被替换；不能把它重新插入父 Thread 的当前时间线，也不能暴露无关的完整版本历史。
- 分支上下文中的 `data-quote` 保留可见正文，锚点/引用定位只能解析到快照内对象。普通 Quote 可为空，不新增 required Quote 约束。
- Project 中纳入来源已 completed 的 Markdown Artifact；未完成的 Artifact 显示不提供预览的说明，不复制生成中的工具输入。
- 正在生成的消息保留位置和“分享时尚未完成”静态标记，不复制瞬态流、不等待模型、不恢复订阅。stopped/failed 消息可保留已持久化可见正文和简洁状态，但不得复制内部错误详情。

独立 Artifact 快照只包含标题、Markdown 正文和产物时间等必要展示字段。默认不输出来源 Project/Thread 标题、ID 或导航入口，避免单份成果泄露对话目录；不会自动寻找、复用或创建 Project 分享授权。

选择复用现有阅读语义并补齐依赖，而非复制所有历史或只取未被替换的消息：前者扩大公开范围，后者会断开已有分支。

### 4. 公开数据白名单与链接处理

独立定义 `PublicProjectSnapshot` / `PublicArtifactSnapshot`，禁止以现有 DTO 的 `Omit` 加对象展开作为安全边界。白名单在持久化前执行，公共响应再次按固定公开契约序列化；源码新增私有字段不自动进入分享。

| 数据 | 处理 |
| --- | --- |
| Project 名称、Thread 阅读结构、可见消息 text/quote | 逐字段保留并处理链接 |
| 界面可见 reasoning、外部来源引用、工具阅读摘要 | 只保留经过审查的展示字段；不含 provider metadata、原始参数、原始检索全文或内部配置；无白名单处理器则不输出 |
| Markdown Artifact | 保存已持久化标题/正文；不复制任意 metadata 或生成工具原始输入 |
| Project Memory、Contract（含 target/instructions）、系统提示词、模型配置、账号/计费/调试数据 | 不读取或不纳入快照 |
| Files、file parts、R2 key、文件摘要/解析结果、签名 URL、附件文件名等元信息 | 不公开；原有附件位置可显示不带详情的“附件未分享”占位 |
| 未识别 data/tool parts | 默认排除，不通用透传 |

对进入快照的 Markdown/text/quote/reading summary/source URL 统一处理地址：

- 禁止私有 `/api/attachments` 等附件路由、已配置私有对象存储/签名下载地址和不安全协议进入快照；覆盖相对/绝对 URL、引用式 Markdown、自动链接及已知私有地址的纯文本形式。解析 Markdown 结构，不靠单个正则替换完成全部语法处理。
- 快照内的导航仅指向快照中存在的实体；不把原私有工作台路径转换成可访问的源对象读取接口。
- 不内联、下载或代签私有图片/文件，不开放附件鉴权。外部普通 HTTPS/HTTP 资料链接可保留并明确属于外部页面，其内容不在本次冻结范围内。
- 一期公开阅读页不自动加载外部图片或主动内容，图片位置显示安全占位，避免匿名页面加载第三方追踪资源；不执行 HTML、脚本或 Custom Visual。Markdown 的标题、列表、表格、代码和安全链接保持阅读能力。
- 外链使用无 referrer 打开；响应设置 `Referrer-Policy: no-referrer`。安全链接渲染策略需独立于正文解析校验。

这是结构与已知私有资源地址隔离，不是任意语义脱敏。若敏感文字已经在消息正文或 Artifact 中出现，本期不会自动判断其来源，分享者仍需检查正文。公开界面明确这一限制。

### 5. 首屏布局是快照的一部分，读者操作只在本地生效

从真实工作台状态捕获布局，不直接复制 localStorage：

- `view`、`columnSlots`（顺序、折叠）、`columnWidths`、列数/布局模式、当前聚焦 Thread。
- 画布 `pins`、当前 viewport（x/y/zoom）；注意当前 pins 宿主与 store 的同步。
- 当前打开的 Artifact、面板打开状态/尺寸；独立于 `useWorkspaceOverlays` 内部状态采集。
- 若页面已有可靠阅读定位，保留每列消息锚点及偏移；不保存草稿、历史最近使用记录、模型设置、临时菜单或选区提问框。

服务端只接受有限数值、有界尺寸及快照内对象引用，防止异常布局造成页面不可用。默认布局持久化到 Share，不塞入长 URL；一期 `/share/{token}` 无需查询参数即可恢复首屏，未来定位参数只能选择快照内内容，不能扩大权限。

读者可以打开/关闭/折叠 Thread、调整列宽、拖动画布节点、缩放、定位引用和阅读 Artifact，这些都是阅读布局变化，不允许写入源数据或共享布局。分享页不复用按 Project ID 保存的私有 workspace 缓存；每次重新打开链接先恢复分享初始状态，可提供“恢复初始布局”。移动端按屏幕压缩列数，保留顺序/焦点并允许访问剩余 Thread，不保证不同屏幕像素级一致。

### 6. 公开路由与所有者管理分离

计划的最小接口：

| 接口 | 权限与行为 |
| --- | --- |
| `POST /api/thread-chat/v1/shares` | 所有者创建 Project/Artifact 快照，使用幂等 command |
| `GET /api/thread-chat/v1/shares?resourceType=...&resourceId=...` | 所有者列出该对象已有分享，返回时间、状态和复制链接所需数据，不重复传快照 |
| `DELETE /api/thread-chat/v1/shares/{shareId}` | 所有者幂等撤销，更新 revokedAt，不接受 token 作为管理凭据 |
| `GET /api/share/{token}` | 匿名读取有效分享的白名单内容，不接受源对象 ID 或任意字段展开参数 |
| `GET /share/{token}` | 独立公开页面，与上方接口调用同一有效性检查和序列化逻辑 |

公开状态检查为 `revokedAt == null && (expiresAt == null || now < expiresAt)`，到期时刻起立即拒绝新的内容读取。无效、过期、撤销使用统一不可用响应，不泄露资源标题或所有者。以访问时校验取代定时删除任务。

页面、HTML/RSC、JSON 及 metadata 不得缓存或绕过检查返回正文；使用动态读取与 `Cache-Control: private, no-store`，不做静态公开正文/永久 JSON 文件。默认 `noindex`、不加入 sitemap；链接可转发给任何人，noindex 不等于身份认证。日志不记录完整 bearer token 或快照正文。

公开界面自身不得发送业务写请求，包括已登录的所有者从分享页访问时。私有写 API 继续按真实登录与源资源所有权授权；分享 token 不提供写权限，也不能作为附件访问授权。已加载/复制的内容无法从读者设备追回，本期不做持续轮询驱逐，但后续请求必须拒绝。

### 7. 复用阅读组件，不实例化完整会话运行时

新增公开阅读壳层，输入只包含快照与本地布局状态。复用 Markdown、消息阅读、引用锚点、Thread 列/画布展示，按需要抽取纯阅读 props；不调用 `useConversationRuntime`、私有 Bootstrap、自动标题生成、模型会话恢复或流式订阅。

阅读壳层不装配 Composer、Fork/Retry/Edit/Stop、反馈、上传、Contract、Memory、批注提交等写入口；共享组件通过明确只读模式缺失写 callbacks，不能仅靠 CSS 藏按钮。也不构建通用 RBAC 系统。

Project 顶栏和 completed Markdown Artifact 详情提供分享弹窗；显示四个有效期选项、创建/复制链接、已有分享及撤销入口，支持键盘操作和移动端。状态文案归 `constants/sharing.ts`，沿用 `.tc` 语义样式 token。

提示文案基准：

> 此链接保存创建时的内容与布局，后续修改不会同步。任何持有链接的人均可在有效期内阅读。Memory、Instructions 和附件不会分享，但已出现在对话或文档正文中的敏感内容不会自动打码，请检查后再分享。

### 8. 最小模块边界

- `constants/sharing.ts`：有效期选项、文案与校验上限。
- `lib/thread-chat/sharing/`：公开契约、消息/Markdown 白名单处理、布局筛选、快照构造；纯函数部分可独立测试。
- 现有 `application/persistence/server` 对应层新增分享命令、仓储和 handler；复用事务、登录与幂等设施。
- `app/share/`：公开读取页面/客户端阅读壳；`app/thread-chat/orchestration/sharing/`：所有者分享弹窗和入口。
- 只按实际复用需要抽出既有阅读组件，不建立第二套业务状态机或复制完整私有页面。

## Risks / Trade-offs

- [快照包含重复正文、占用额外空间] → JSONB 单份保存、同命令重放不重复生成；配置合理请求/快照尺寸上限，超过上限明确拒绝且不截断后声称完整成功。不引入对象存储与异步分片。
- [并发修改导致混合时点] → 同一事务一致读取与原子保存；客户端只负责布局，正文只信任服务端。
- [布局看似已持久化但实际状态分散] → 从当前列、画布和 overlay 捕获，浏览器测试验证 pins、viewport、Artifact 面板。
- [raw parts 或 Markdown 地址泄露] → 持久化与响应都用白名单，用秘密哨兵检测 JSON、HTML/RSC、DOM、链接及网络请求，不把隐藏 UI 当作授权。
- [老消息被错误删除或多公开] → 测试父消息替换后的分支来源和继承历史，以及无关被替换消息不进入快照。
- [跨屏无法像素一致] → 保持语义顺序与焦点，桌面还原列宽，移动端响应式阅读。
- [有效期被误解为可以收回所有副本] → 提示只限制后续服务端访问，不承诺回收已经复制的内容；禁止公开响应缓存。
- [源 Project 删除后的孤立分享] → 以来源 Project 外键级联失效，不给访客回查源数据。
- [白名单不等于语义脱敏] → 清晰文案要求用户检查正文，任意打码和脱敏留二期。

## Migration Plan

1. 本提案仅新增 `openspec/changes/add-snapshot-sharing/` 文档，所有实现任务保持未完成。
2. Apply 时基于确认基线开发，先阅读安装版 Next 文档；功能分支仅修改 schema 源码，在独立本地数据库 `db:push` 验证，不运行 `db:generate`、不修改 `drizzle/`。
3. 完成契约、后端、所有者弹窗、公开阅读及测试，再交由明确的 `develop` 集成任务统一生成 migration，检查 SQL 并在上一版本结构上验证升级。
4. 迁移验证成功后部署数据库结构和应用，执行匿名读取、到期/撤销和私有权限 smoke。旧 Project 默认不公开，不自动补建分享记录。
5. 回滚应用时先关闭公开分享路由并隐藏创建入口，保留新增表以便恢复，不删除原会话数据；不得回退到将私有 Bootstrap 公开的实现。

## Open Questions

无阻塞本期提案的问题。源码中尚无完整 Memory 模块，公开契约从一开始不包含 Memory；之后合入相关功能也不能自动扩大快照字段。具体上限和组件抽取范围在实现时以真实数据/组件签名确认，不改变本提案的公开范围与快照语义。
