# add-snapshot-sharing — 设计

## Context

用户已确认：一期 Project 与 Document 匿名只读分享；内容与首屏布局一起冻结；有效期 3/7/30 天或无限，默认无限；Document 分享只冻结"当前版本"；Project 快照中文档只展示"分享时当前版"，不做版本导航；尺寸上限取宽松值，超限明确失败而不是崩溃或截断。

当前实现依据（已对照代码核实）：

- `lib/db/schema.ts`：Project/Thread/Message/Artifact 分表；`documents` + `document_revisions` 提供持续文档身份，每版映射一个不可变 Artifact（`documentRevisions.artifactId`），`documents.currentRevisionId` 是可变 head。
- `lib/thread-chat/contracts/dto.ts`：`ProjectBootstrapDTO` 含 `project`（含 `target`/`instructions` 私有字段）、`files`、`threads`、`messages`、`artifacts`、`documents`、`activeGenerationIds`，不能直接作为公开响应。`ThreadDTO` 有 `forkMessageId`/`forkArtifactId`/`forkContext`/`forkAnchor`；`ArtifactSummaryDTO` 有 `document?: {id, revisionId, revisionNumber}`。
- `lib/thread-chat/persistence/mappers.ts`：`toMessageDTO` 已把 `documentToolParts` 合并进 `parts`（`restoreDocumentToolParts`），白名单在 DTO 层处理即可，无需单独读列。
- `lib/thread-chat/contracts/ui-message.ts`：part 全集 = 标准 `text`/`reasoning`/`file`/`source-url`/`step-start` + data parts（`quote`、`artifact-reference`、`research-activity`/`route`/`plan`、`artifact-progress`、`project-document-updates`、`document-update-notices`）+ 工具 parts（`webSearch`、`readUrl`、`createMarkdownArtifact`、`find/read/updateProjectDocument`）。
- `app/thread-chat/core/types.ts`：`ConversationStore.workspace` 是布局权威（view/openThreadIds/columnSlots/columnWidths/forceColumns/placementMode/selectedThreadId/recents/canvas{pins,viewport}/panelSizes/expandedNodes），columns hook 持续回写；打开的 Artifact 在 `use-workspace-overlays`（activeArtifactId/drawerOpen），与 workspace 分离。
- `constants/attachment.ts`：附件稳定路径前缀 `/api/attachments/`；`lib/storage/r2.ts` 有 R2 签名地址，均不得进快照。
- `proxy.ts`：页面级 cookie 乐观门禁，`publicPages` 是精确匹配 `Set`，`/share/{token}` 需要前缀放行；`app/thread-chat/layout.tsx` 另有真实登录校验。
- API 约定：`/api/thread-chat/v1/*` route → `server/handlers.ts` → `withThreadChatRoute`（`requireThreadChatUser`）；命令走 zod strict schema + `commandId`（uuid）+ `conversationCommands` 幂等收据；响应统一 `jsonNoCache`（`Cache-Control: private, no-store`）。
- 测试约定：`e2e/thread-chat/*.test.mjs` 用 `node --import tsx` 直跑，浏览器验收用 playwright-core 脚本。

## Goals / Non-Goals

**Goals:**

- 分享者安排好布局后创建链接，匿名读者打开同一份内容，能完整浏览网状对话与文档而不会触发写操作。
- 单独分享文档当前版本，不连带开放来源对话。
- 服务端完成一致快照、白名单输出、有效期与撤销校验，保持私有 API 权限不变。
- 复用现有 store/视图层实现阅读壳；只建设本期必需的数据和组件。

**Non-Goals:**

- 实时同步、覆盖旧快照、版本树、差异比较、后台快照任务。
- Thread/Message 独立分享、指定历史版本分享、手动隐藏 Thread、正文打码与自动脱敏。
- 附件公开、Memory/Instructions 展示、HTML/Custom Visual 分享、写协作、密码、邀请、访问统计、速率限制。
- 改变原 Project 的 Fork/Quote/缓存语义，或在此功能分支生成数据库 migration。

## Decisions

### 1. 一张分享表，快照内嵌 JSONB

新增 `shares`，内容与初始布局放在同一份不可修改的 `snapshot` 中：

| 字段 | 约束与语义 |
| --- | --- |
| `id` | 内部管理 ID（uuid） |
| `token` | 服务端密码学安全随机生成，至少 128 位熵，唯一索引；不得使用源资源 ID |
| `ownerId` | 归属用户外键，删除用户级联移除 |
| `sourceProjectId` | 来源 Project 外键，删除 Project 级联清理；不作为匿名查询条件 |
| `resourceType` | 本期仅 `project` 或 `document` |
| `resourceId` | 来源对象 ID；创建时验证归属与类型 |
| `snapshot` | 公开数据加布局；不可通过更新接口修改 |
| `schemaVersion` | 数据格式版本，从 1 开始；不是内容 Revision |
| `createdAt / expiresAt / revokedAt` | 服务端时间；`expiresAt=null` 表示无限；撤销不可恢复 |

索引：token 唯一、`(ownerId, resourceType, resourceId)` 管理索引。删除来源 Project 时级联删除分享记录，所有者删除确认文案应告知关联分享失效。

**Document 分享的锚定**：`resourceId=documentId`，快照内 pin `{documentId, revisionId, revisionNumber, artifactId, title, content, createdAt}`。创建时读取 `documents.currentRevisionId` 对应版本；之后文档提交新版本不改变快照。Artifact 本身不可变，正文直接复制进快照而非引用，保证"快照即全部"。

### 2. 创建时只信任服务端正文，在同一事务内冻结

创建请求为判别联合，仅接受 `commandId`、资源标识、有效期枚举，以及 Project 类型的布局白名单。服务端拒绝客户端传入正文、owner、token、时间或自定义字段。

流程：真实登录校验 → `REPEATABLE READ` 事务内验证所有权、读取全部所需实体、构造白名单快照、计算 expiresAt、原子写入。同一事务一致读取避免拼贴不同时点；失败不产生半份快照。

复用 `conversationCommands` 幂等机制：重放同 commandId+同输入返回首次记录，不重读正文、不重发 token、不重算期限；同 ID 不同输入拒绝冲突。注意不让幂等包装的默认事务级别破坏一致读取。

### 3. Project 快照的数据范围与分支闭包

快照内容（结构对齐 `ProjectBootstrapDTO` 的公开子集，便于直接 hydrate `ConversationStore`）：

- `project`：仅 `id`、`rootThreadId`、显示标题（`coalesce(customTitle, autoTitle)` 计算为单个 `title`）。
- `threads`：全部 Thread 的公开字段——`id/parentId/forkMessageId/forkArtifactId/forkContext/forkAnchor/anchorText/footnote/depth/显示标题`。剔除 `modelId`（内部配置）、`titleGenerationAttempted/Generated`（内部状态）。
- `messages`：当前时间线消息 ∪ 各 `forkContext`/`forkMessageId` 引用的已替换消息 ∪ Artifact/Document 来源链所需消息（去重并集）。所有引用必须闭合且属于同一 Project；跨 Project 或缺失引用 → 创建失败。
- `artifacts`：项目全部 Artifact（`ArtifactSummaryDTO` 公开字段 + `content`）。它们全部不可变，全量纳入使 `artifact-reference`/`forkArtifactId` 天然闭包，比"按来源反推最小集"更简单且不漏。
- `documents`：`DocumentListItemDTO` 公开字段 + pin 的 `revisionId/revisionNumber`；内容经 artifact 获得，不另存。只给"分享时当前版"，不复制历史版本列表，阅读壳不做版本切换。
- `layout`：初始布局白名单（见 §5）。

被替换的旧消息只在阅读闭包需要时进入，标识 `supersededAt`，不重新插回父 Thread 当前时间线，也不暴露无关历史版本。

生成中消息保留位置和"分享时尚未完成"静态标记；stopped/failed 保留已持久化可见正文和简洁状态，不复制内部 error、瞬态流、工具原始输入。

### 4. 公开数据白名单与 parts 裁决

独立定义 `PublicProjectSnapshot`/`PublicDocumentSnapshot` 公开契约，禁止 `Omit`+对象展开作为安全边界。白名单在持久化前执行，公开响应再按固定契约序列化；源码新增私有字段不自动进入分享。

**字段级排除**：`project.target/instructions/contractVersion`、`message.feedback/error/providerUsage/documentContextUsed`、`thread.modelId/titleGeneration*`、`projectFiles/attachments` 整组、账号/计费/调试字段、未识别 part 与 metadata。

**parts 逐类型裁决**（作用于 `toMessageDTO` 合并后的 parts）：

| part | 处理 |
| --- | --- |
| `text` / `reasoning` / `step-start` | 保留；正文过链接清洗 |
| `quote` | 保留可见正文+锚点；锚点仅解析快照内对象，悬空则降级为纯文本 |
| `source-url` | 保留安全外部 http(s) |
| `artifact-reference` | 目标在快照内 → 改写为快照内导航；否则剔除 |
| `research-activity`/`route`/`plan` | 只保留展示字段（查询词、步骤描述、来源 URL），丢弃原始负载 |
| `webSearch` | 保留 `query` + `results{title,url,snippet}`，过链接清洗 |
| `readUrl` | 保留 `url`，丢弃 `content`（外部抓取全文，体积大且非必要） |
| `createMarkdownArtifact` | 指向快照内 artifact 的静态卡片 |
| `find/read/updateProjectDocument` | 折叠为静态操作记录（工具名+文档标题+状态），不带 output 全文 |
| `project-document-updates` / `document-update-notices` | 剔除（内部同步回执） |
| `artifact-progress` / `file` / `dynamic-tool` / 未知 | 剔除；`file` 位置给"附件未分享"占位（不带文件名） |

**链接清洗**：对进入快照的 Markdown/text/quote/研究摘要/source URL 统一做 AST 级处理（用项目已用的 remark 管线，不用正则）：

- 剔除 `/api/attachments/*`（含相对与绝对形式）、已配置 R2 公开/签名地址、`javascript:`/`data:`/`vbscript:` 等危险协议；原位给安全占位。
- 覆盖 inline、reference-style、autolink、image、纯文本 URL 形态。
- 外部 http(s) 保留，渲染时 `rel="noreferrer"` 且响应头 `Referrer-Policy: no-referrer`；不自动加载外部图片（占位处理），不执行 HTML/脚本/Custom Visual。
- 这是结构隔离，不是语义脱敏：正文里已有的敏感文字本期不识别，弹窗文案要求分享者自查。

### 5. 首屏布局：从权威 store 现取，快照即首屏

捕获时点为**弹窗内点击"创建"那一刻**，数据源为 `store.getState().workspace`（columns hook 持续回写，已是权威）+ overlay 的 `activeArtifactId`/`drawerOpen`。不读 localStorage。

白名单字段：`view`、`columnSlots`（顺序+folded）、`columnWidths`、`forceColumns`、`placementMode`、`selectedThreadId`、`canvas.pins`、`canvas.viewport`、`panelSizes`、`expandedNodes`、`activeArtifactId`、`drawerOpen`。剔除 `recents`（使用记录）、草稿、模型设置、临时菜单/选区。

服务端校验：所有 ID 必须属于快照内实体、数值有限且有界、结构尺寸不超上限；失效引用规范化为安全默认值而不是拒绝（布局不是内容，可降级）。读者操作只改本地临时状态；重开链接恢复快照布局；移动端压缩列数保顺序/焦点，不追求像素一致。

### 6. 公开路由与所有者管理分离

| 接口 | 权限与行为 |
| --- | --- |
| `POST /api/thread-chat/v1/shares` | 所有者创建；`{commandId, resource:{type:"project",projectId,layout}|{type:"document",documentId}, expiresIn}` |
| `GET /api/thread-chat/v1/shares?resourceType=..&resourceId=..` | 所有者列出该对象分享（id、token→链接、createdAt/expiresAt/revokedAt、状态），不回传快照 |
| `DELETE /api/thread-chat/v1/shares/{shareId}` | 所有者幂等撤销，置 `revokedAt` |
| `GET /api/share/{token}` | 匿名读取快照 JSON；无效/过期/撤销统一 `404 不可用`，不区分原因 |
| `GET /share/{token}` | RSC 页面直出同一有效性检查 + 快照，渲染只读壳 |

有效性 = `revokedAt==null && (expiresAt==null || now<expiresAt)`，每请求校验，无定时清理任务。页面 `force-dynamic`、JSON 与 metadata 均 `no-store`、`noindex`、不进 sitemap、`Referrer-Policy: no-referrer`。日志不记录完整 token 或快照正文。

`proxy.ts` 在 `publicPages` 精确匹配之外增加 `pathname.startsWith("/share/")` 放行；`/api/share/` 不需要（proxy 对 `/api/*` 本就不拦）。

### 7. 分享页 = 同一个页面组件 + ShareRuntime（stub commands）

`useConversationRuntime(projectId)` 返回 `{store, client, commands, status}`，`NormalizedThreadChat` 仅消费该 prop——runtime 本就是注入点。所有副作用（localStorage workspace 读写、后台生成轮询/恢复、订阅）都集中在 `bootConversationProject`，store 与组件树本身不含网络逻辑。

`/share/{token}` 因此直接复用同一组件树，替换的只有 runtime：

```
useShareRuntime(token) → {
  store:    createConversationStore({ workspace: snapshot.layout })
            + hydrateProject(snapshot)          // 公开 DTO 是私有 DTO 结构子集
  readOnly: true                               // 贯穿组件树的禁用状态位
  commands: 同名 stub —— 写方法不发起任何网络请求（兜底空转）
  client:   仅 GET /api/share/{token}
  status:   "loading" → "ready"                 // 复用页面现成加载态
}
```

只读语义 = **禁用态**，不是"可输入再报错"：组件树读取 `readOnly` 状态位，写控件（Composer、消息操作、Fork/Retry/Edit/Stop、反馈、重命名、上传、文档更新入口）渲染为禁用态或省略；导航/折叠/拖动/缩放/引用定位/复制等纯本地操作照常。stub commands 作为不可见兜底：任何绕过禁用位的写路径也到不了网络。

写能力在构造时缺席（fail-closed），而不是"发送后由后端拒绝"（fail-open）：

- 私有写接口本就按 session+ownership 拒绝匿名者，token 不增加拦截力；
- 已登录所有者打开自己的分享页时 session 有效，"带 token 后端拒"防不住真实写入，只有客户端不发才防得住；
- 服务端零改动：写请求真到达也按现有鉴权报错，服务端不认识也不需要认识 share token。

仍需隔离/替换的少量边缘（"几乎同一页面"的 10%）：

- 不调用 `bootConversationProject`：localStorage workspace、生成恢复、轮询、订阅随之全部缺席；
- 左侧项目列表依赖 `/v1/projects`（匿名 401）→ 分享页隐藏或喂空；
- 顶栏 AccountButton/私有导航 → 替换为"只读快照"徽标与创建时间；
- 以 `treeId` 为 key 的 localStorage 作用域（ScrollMemory、ComposerDraft）→ 改用 `share:{token}` 命名空间；
- 引用/锚点只在快照内解析；读者操作仅改本地状态，重开链接恢复快照布局。

URL 保持 `/share/{token}` 单一不可猜测定位符，不用 `/thread-chat/{projectId}?share=` 形式（不泄 projectId、不可组合探测）；UI 复用在路由内部完成，与 URL 设计解耦。Document 分享页更轻：同一 Markdown 阅读组件 + 安全链接策略，无需列/画布壳。

### 8. 宽松上限，失败不截断

`constants/sharing.ts` 集中定义：`snapshot ≤ 16MB`（JSONB 字符串化后字节数）、`messages ≤ 5000`、`layout ≤ 512KB`、布局数组/字符串有界。超限返回明确错误码和可理解提示，不截断、不降级为部分分享、不转后台任务。量级按"打市场先用起来"设定，真实触发再调。

### 9. 最小模块边界

```
constants/sharing.ts                       有效期枚举、token 格式、上限、文案
lib/thread-chat/sharing/
  contracts.ts                             zod 创建命令判别联合、公开快照契约、ShareDTO
  snapshot.ts                              闭包选取 + 同 Project 校验 + 生成态静态化
  whitelist.ts                             parts 裁决 + 字段级剔除
  sanitize-links.ts                        Markdown AST 链接清洗
  layout.ts                                布局白名单规范化
lib/thread-chat/persistence/share-repository.ts   REPEATABLE READ 创建、token/资源查询、幂等撤销
lib/thread-chat/application/sharing.ts     createShare / listShares / revokeShare / getPublicShare
lib/thread-chat/server/handlers.ts         +4 个 handler（3 私有走 withThreadChatRoute，1 公开）
app/api/thread-chat/v1/shares/…            管理面路由
app/api/share/[token]/route.ts             匿名 JSON
app/share/[token]/                         页面 + useShareRuntime + stub commands（复用 NormalizedThreadChat）
app/thread-chat/orchestration/sharing/     分享弹窗、入口接线、布局捕获
proxy.ts                                   /share/ 前缀放行
e2e/thread-chat/snapshot-sharing-*.mjs     纯函数/DB/浏览器验收
```

## 关键环节（Key Flows）

以下为各核心环节的代码级草图，说明接缝位置而非完整实现。

### A. `useShareRuntime`：与 `useConversationRuntime` 同形替换

```ts
// app/share/[token]/use-share-runtime.ts
function useShareRuntime(token: string) {
  const runtime = useMemo(() => ({
    store: createConversationStore(),
    commands: createReadOnlyCommands(),   // 同名 stub，见 C
    readOnly: true as const,              // 禁用状态位，见 D
  }), [])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((snap: PublicProjectSnapshot) => {
        const s = runtime.store.getState()
        s.setWorkspace(snap.layout)       // 首屏布局：列/画布/面板/焦点
        s.hydrateProject(snap.entities)   // 与 ProjectBootstrapDTO 同形的公开子集
        setStatus("ready")
      })
      .catch(() => setStatus("error"))
  }, [token, runtime])

  return { ...runtime, status }
}
```

关键点：`NormalizedThreadChat` 只在 `status === "ready"` 后挂载，`useNormalizedWorkspace` 挂载时读到的 `workspace.columnSlots/canvas.pins` 已是快照值——与私有页"boot 填充空 store 再翻 ready"完全同构，视图层零改动。`snapshot.entities` 刻意对齐 `ProjectBootstrapDTO` 结构（`{project, files:[], threads, messages, artifacts, documents, activeGenerationIds:[]}`），`hydrateProject` 无需适配器；公开 `project` 字段比 `ProjectDTO` 少（无 target/instructions），通过放宽 hydrate 入参类型解决——类型收窄本身就是白名单的编译期证明。

页面挂载：

```tsx
// app/share/[token]/page.tsx（client 组件）
const runtime = useShareRuntime(token)
if (runtime.status !== "ready") return <BootLoading />        // 复用现有加载态
return <NormalizedThreadChat treeId={`share:${token}`} runtime={runtime} />
//       └─ localStorage 命名空间隔离；不挂 GenerationSettingsProvider 也可
```

### B. `shares` 表与创建事务

```ts
// lib/db/schema.ts
export const shares = dbSchema.table("shares", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),                    // crypto 随机 ≥128bit
  ownerId: text("owner_id").notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sourceProjectId: text("source_project_id").notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").$type<"project" | "document">().notNull(),
  resourceId: text("resource_id").notNull(),
  snapshot: jsonb("snapshot").$type<PublicSnapshot>().notNull(),  // 内容+布局一体
  schemaVersion: integer("schema_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),     // null = 无限
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  unique("shares_token_uq").on(t.token),
  index("shares_owner_resource_idx").on(t.ownerId, t.resourceType, t.resourceId),
])
```

```ts
// application/sharing.ts —— 一致读事务；幂等由外层 commandId 收据包装
const createShare = (userId, cmd) =>
  db.transaction({ isolationLevel: "repeatable read" }, async (tx) => {
    const res = await loadOwnedResource(tx, userId, cmd.resource)      // 归属+类型，失败 403/404
    const snapshot = buildSnapshot(tx, res, cmd.layout)                // §3 闭包 → §4 白名单 → §5 布局
    assertSnapshotBounds(snapshot)                                      // §8 上限，超限 throw
    return insertShare(tx, { token: cryptoToken(), expiresAt: expiry(cmd.expiresIn), ... })
  })
```

`loadOwnedResource` 对 `document` 类型沿 `documents → projects.ownerId` 校验归属，并读 `currentRevisionId` pin 版本；对 `project` 校验 `projects.ownerId`。白名单构造全部发生在 `buildSnapshot`（纯函数，可脱离事务测试——事务只保证读取时点一致）。

### C. stub commands：同接口，零网络

```ts
// 与 createConversationCommands 返回类型一致
function createReadOnlyCommands(): ConversationCommands {
  const deny = () =>
    Promise.reject(new ConversationApplicationError("READ_ONLY", "只读快照，内容已冻结"))
  return {
    sendMessage: deny, forkThread: deny, retryMessage: deny,
    editLatestTurn: deny, requestStop: deny, setFeedback: deny,
    updateThread: deny, renameProject: deny, deleteProject: deny,
    updateProjectContract: deny, addProjectFile: deny,
    removeProjectFile: deny, setProjectArchived: deny, startProject: deny,
    dispose() {},
  }
}
```

正常路径下控件已被 `readOnly` 禁用，deny 不会被触发；它只保证"绕过 UI 的路径也到不了网络"。

### D. `readOnly` 传递：一个 Context + 各控件认一个开关

```tsx
// NormalizedThreadChat 顶部；私有 runtime 无 readOnly 字段 → 恒 false，零行为变化
<ReadOnlyContext.Provider value={runtime.readOnly === true}>
  …现有组件树…
</ReadOnlyContext.Provider>

// 写控件只多认一个开关（示意）
const ro = useReadOnly()
<Composer disabled={ro} … />
buildMessageActionViewState({ …, readOnly: ro })   // readOnly 时不产出写动作
```

需要认 `readOnly` 的触点（即"私有组件只多认一个禁用状态"的全部落点）：

- Composer：输入框/发送/附件按钮 disabled
- 消息操作条：`buildMessageActionViewState` 产出空写动作集（Fork/Retry/Edit/feedback 不渲染）
- `thread-chat-topbar`：重命名/分享/归档/删除入口 disabled 或省略
- Document/Artifact 详情：文档更新入口、分享入口（分享页内不再嵌套分享）
- 快捷键分派：触发 `runtime.commands.*` 的键位短路
- 项目列表侧栏 + AccountButton：分享页不渲染（`/v1/projects` 匿名 401），顶栏换"只读快照"徽标

### E. 公开端点：一个函数，两种消费者

```ts
// lib/thread-chat/sharing/public.ts —— 页面 RSC 与 API 共用
async function getPublicShare(token: string) {
  const row = await findShareByToken(token)
  if (!row || row.revokedAt || (row.expiresAt && Date.now() >= +row.expiresAt))
    return null                                             // 统一不可用，不分原因
  return serializePublic(row.snapshot)                      // 固定公开契约再序列化
}

// GET /api/share/[token] → getPublicShare ? jsonNoCache(data) : jsonNoCache(404)
// GET /share/{token}     → getPublicShare ? <SharePage snapshot/> : <Unavailable/>（不跳登录）
```

token 是唯一授权输入：不校验 session、不接受额外参数、不回查源表。

## Risks / Trade-offs

- [快照重复存储正文占空间] → JSONB 单份、幂等不重复生成、宽松上限明确失败；不上对象存储。
- [并发修改拼贴时点] → 单事务一致读，正文只信服务端。
- [白名单漏新 part/字段] → 默认拒绝 + 哨兵测试覆盖 JSON/HTML/RSC/DOM；每新增 part 类型必须显式裁决。
- [Document 与旧 artifact 双身份混淆] → 分享一律锚 documentId+revisionId，正文复制进快照，不依赖可变 head。
- [阅读壳复用私有组件带回写口] → readOnly 禁用位 + stub commands 双保险；浏览器测试验证无写请求。
- [有效期误解为收回已复制内容] → 文案明示；禁缓存防绕过。
- [公开端点无滥用防护] → v1 接受 token 不可猜测为唯一边界；noindex+no-referrer 降暴露面。

## Migration Plan

1. 功能分支只改 `lib/db/schema.ts` 源码，独立本地库 `db:push` 验证，不动 `drizzle/`。
2. `develop` 集成任务统一 `db:generate` + 审查 SQL + 在上一版结构库 `db:migrate` 验证。
3. 部署后 smoke：匿名读取、到期/撤销、私有权限不回归。
4. 回滚先关 `/share/*` 路由与创建入口，保留 `shares` 表；不动原会话数据。

## Open Questions

无阻塞项。各 part 类型展示字段的取舍在实现时按真实组件 props 微调，不改变公开范围与快照语义。
