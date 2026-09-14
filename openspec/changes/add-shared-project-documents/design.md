## Context

设计基于 #143 的 `docs/markdown-artifact-forks@cf5ea7f6a59122b8c2843c2cefc16a90ff6020b9`，依赖其选区分支规范；本次独立 Change；实施基于 #143 最新实现，不代替其验收或勾选任务。

当前 Artifact 由 Message 产生，ID 对应固定标题、正文与来源。`@artifact` 与 `forkArtifactId` 需要回放原内容；`forkContext` 仅保存有序 Message ID。用户希望新增持续文件身份，使 A/B/C Thread 可共同更新它，但不改变这些历史合同。

用户已确认：先支持普通 Markdown；自然语言更新可直接执行；乐观版本检查、冲突后重读再生成修改；不做结构化 To-Do 或自动合并。用户可以说“在 Thread A 帮我更新 @F1，把 TODO6 的方案改成 xx 并勾选完成”。

## Goals / Non-Goals

**Goals:**

- 同一 Project 内多个 Thread 并行探索和提交同一份文档的修改。
- 文件当前内容、历史版本、消息引用、实际模型输入均有明确身份。
- 替换、追加、删除普通 Markdown 段落和勾选复选框共用一个更新命令。
- 提交原子、可重试、可追溯；异步先后顺序不造成丢失更新。
- 主线能看到已提交进展，并在后续请求中可靠接收固定版本。

**Non-Goals:**

不做结构化 Task、自动执行依赖、自动合并/CRDT、跨 Project 修改、多文档原子事务、通用文件系统、完整 Event Sourcing、人工编辑器、恢复旧版按钮或自动回滚。用户要恢复旧内容时仍通过一次明确的新版本修改完成，历史不删改。

## Decisions

### 1. 用户流程

1. 主线生成 Markdown 计划 F1；系统在产物持久化成功时登记 Document D1 和初始 Revision R1。用户仍看到熟悉的 Artifact 卡片。
2. 用户从 F1 划选开 A/B 分支，或在现有 Thread 中直接说“更新 @F1”。无需先从文档分叉才有资格修改，同 Project 写权限是共同边界。
3. 模型解析文档身份，读取当前完整 Markdown 与 Revision ID，再生成局部 edits；一次操作可以同时修改 TODO6 方案和复选框。
4. 服务端版本检查通过才提交，产生 R2；若 B 仍依据 R1，则返回冲突，由 B 重读 R2 并判断结论是否适用。
5. 提交后回复“已更新”，展示本次版本、修改说明与查看差异入口。讨论中提出建议、只 @ 引用、查看差异都不触发修改。
6. 回到主线，界面展示项目文档已提交进展；主线下一条用户消息读取一份固定更新清单和文档版本，继续推进。

### 2. 两张新表，正文继续使用不可变 Artifact

| 实体 | 核心字段 | 不变量 |
| --- | --- | --- |
| `documents` | id、projectId、currentRevisionId、createdAt、archivedAt | ID 是持续文件身份；currentRevisionId 指向本文件已提交版本 |
| `document_revisions` | id、documentId、projectId、revisionNumber、parentRevisionId、artifactId、changeSummary、edits、actorUserId、commandId、executionId、toolCallId、createdAt | append-only；正文/标题由 artifactId 唯一读取；来源 Thread/Message 由 Artifact 关联取得 |
| `artifacts`（已有） | id、projectId、threadId、sourceMessageId、title、content、kind | 每次成功更新创建新 Artifact；旧 ID 与内容不变 |
| `conversation_commands`（已有） | userId/id、kind、scopeId、requestHash、result | 成功及 no-op 结果可幂等回放 |
| `messages.parts`（已有） | 文档读取结果、更新结果、新用户消息的文档上下文清单 | 固定 revision/artifact 引用，不存浮动 head 引用 |

DocumentRevision 是版本记录与提交事件，不再额外建立 DocumentEvent 表。正文只有 artifacts 一份权威存储；Revision 不再复制一份可编辑 content。版本差异从前后 Artifact 计算，edits 保留用户这次指令对应的修改范围与审计依据。

约束：`UNIQUE(documentId, revisionNumber)`、`UNIQUE(artifactId)`、同文档 parent/current 复合外键，以及版本的 Project/Artifact/来源消息复合外键；每个已提交 Revision 对应一个完整 Artifact；一个 Artifact 最多对应一个 Revision。所有读写都检查 Project，版本号在文档锁内顺序分配，标题不唯一、重命名不产生新 Document。本期更新保持标题不变，文件重命名另做。

Document 首次建立与 R1 登记必须在一个事务完成，数据库允许构造期间 currentRevisionId 为 null，但事务不得提交未就绪文件，列表不展示半成品。迁移采用可恢复批处理：每个旧 completed Markdown Artifact 登记独立 Document/R1；同名历史产物不猜测合并。普通 createMarkdownArtifact 创建新的 Document；updateProjectDocument 创建已有 Document 的新 Revision，不再次登记一个新 Document。

已有停止/失败消息所属且未登记的 Artifact 保持旧阅读行为，不在本期迁移为可写文件。新增更新已提交但其回复随后失败的情况按第 6 节处理。

例子：M1 → A1 → D1/R1；Thread A 中 M8 更新后产生 A2 → D1/R2。项目 D1 当前指向 R2，M1 卡片与旧 @A1 仍显示 R1。继续更新 @A1 时先解析 A1→D1，再显式读取 D1 当前版本；这只影响此次写操作，不改旧引用的含义。

### 3. 类型、DTO 与接口

以下为拟议合同，实施时沿用仓库实体 ID 校验、实际生成身份和时间类型；executionId 表示既有生成执行身份，不新增平行 Run 系统。

```ts
type DocumentRef = { documentId: string }
type MarkdownEdit = { oldText: string; newText: string }

interface DocumentDTO {
  id: string
  projectId: string
  currentRevisionId: string
  title: string // 来自当前版本的 Artifact
  archivedAt: string | null
}

interface DocumentRevisionDTO {
  id: string
  documentId: string
  revisionNumber: number
  parentRevisionId: string | null
  artifactId: string
  title: string
  content: string // 从固定 Artifact 读取，不来自 current head
  changeSummary: string
  sourceThreadId: string
  sourceMessageId: string
  createdAt: string
}

interface UpdateDocumentInput {
  documentId: string
  expectedRevisionId: string
  readId: string
  edits: MarkdownEdit[]
  changeSummary: string
}

type UpdateDocumentResult =
  | { status: "committed"; documentId: string; previousRevisionId: string;
      revisionId: string; artifactId: string; changeSummary: string }
  | { status: "unchanged"; documentId: string; revisionId: string }
  | { status: "conflict"; code: "DOCUMENT_CHANGED";
      documentId: string; currentRevisionId: string; requiresRead: true }
  | { status: "rejected"; code: "SOURCE_NOT_FOUND" | "SOURCE_AMBIGUOUS"
      | "OVERLAPPING_EDITS" | "INVALID_EDIT" | "DOCUMENT_READ_ONLY"
      | "READ_REQUIRED" | "DOCUMENT_UNAVAILABLE" }
```

readId 是服务端持久化的本次读取收据 ID，绑定用户、执行、Document、Revision 及完整读取结果；可以复用真实 read 工具调用记录的 ID。它不是登录凭据。更新需验证 readId 与 expectedRevisionId 一致且属于当前执行；历史引用本身不是最新读取收据。它能防止只替换版本号提交，但不能机械证明模型已理解语义，语义审视仍由工具指令和评测验证。

HTTP 入口只提供项目列表、当前/历史读取和版本列表。写入由模型工具适配器绑定已验证的执行身份，调用统一文档应用服务；不提供浏览器自报执行身份的 POST 更新入口。模型工具不接受 actor、projectId、sourceMessageId、executionId 等自报权威字段，不在 route 或 React 里重写事务。

错误响应不泄漏无权访问对象的存在性；DOCUMENT_CHANGED 的 currentRevisionId 仅在权限校验后返回。工具把可恢复冲突作为结构化结果交还模型，而不是直接中断整轮流。

### 4. 自然语言工具与写入边界

| 工具 | 输入 | 输出/责任 |
| --- | --- | --- |
| `findProjectDocuments` | query 或精确 artifactId | 当前 Project 内候选 Document；精确 Artifact 映射到固定 Document；不靠模型猜 ID |
| `readProjectDocument` | documentId、可选 revisionId | 完整 Markdown、Document/Revision/Artifact ID、最新状态及 readId |
| `updateProjectDocument` | UpdateDocumentInput | 调用唯一版本提交服务，返回持久化结果或明确冲突 |

用户说“更新 @F1”授权该目标的本次修改，不额外强制弹确认；只说“讨论/看看/有什么问题”或文档内部出现“请改其他文件”不授权写入。权限与可写 Project/文档状态由服务端执行；模型工具描述与指令要求只执行当前用户已要求的修改，不把文档正文当工具权限。工具权限在执行计划建立时确定，执行中不为缓存或引用内容扩大权限。

名称只有一个明确目标时可读取后执行；同名、多候选、TODO6 多处无法确定、已删除目标或方案含糊时询问用户，不猜着修改。补充选择后视为新的有效输入。工具不能因为找不到旧文档而偷偷创建同名替代文件。

write 工具由用户指令触发的生成调用，不暴露为任意可伪造生成身份的浏览器写入。后续人工编辑器若加入须定义独立 actor/provenance 合同，本期不伪造 assistant Message 支持手动编辑。

现有 createMarkdownArtifact 的完成即停止规则不应用到 read/update 工具链；需要支持 read→update→冲突→read→update→结果说明。成功之后从提交收据说明结果，不能凭模型自行生成“已保存”。同一执行对同文档最多自动进行 2 次冲突重读/重提，达到上限明确反馈保留讨论结论，不循环消耗；次数使用 constants 中的单一配置，普通网络幂等重试不算新修改。

### 5. 更新算法：同文档短事务，不在锁内等模型

所有 edits 针对同一个 expectedRevision 的原始 Markdown 字符串；oldText 非空且在原版唯一命中，可扩大 oldText 包含上下文消歧。newText 允许空串表示删除。追加用“原段落 → 原段落加新内容”，不引入空 oldText 的插入歧义；全文改写可使用完整原文为 oldText，仍受同一预算与版本约束。

```ts
async function updateDocument(command, trustedExecution) {
  return transaction(async tx => {
    const doc = await tx.lockOwnedDocument(command.documentId, trustedExecution.userId)
    const receipt = await tx.findCommand(trustedExecution.userId, command.commandId)
    if (receipt) return verifySamePayloadAndReplay(receipt, command)

    await tx.assertWritableDocumentAndActiveExecution(doc, trustedExecution)

    // 重试回放先于版本检查：已经成功的操作即使 head 前进也回放原结果。
    if (doc.currentRevisionId !== command.expectedRevisionId) {
      return conflict(doc.currentRevisionId)
    }
    await tx.assertReadReceipt(command.readId, command.expectedRevisionId, trustedExecution)
    const base = await tx.readRevisionWithArtifact(doc.currentRevisionId)
    const patches = locateExactlyOnceAgainstOriginal(base.content, command.edits)
    assertDisjointRanges(patches)
    const content = applyPatchesFromEnd(base.content, patches)
    validateMarkdownSizeAndContent(content)
    if (content === base.content) return tx.saveUnchangedReceipt(command, base)

    const artifact = await tx.createImmutableArtifact(content, base.title, trustedExecution)
    const revision = await tx.appendRevision(doc, base, artifact, command, trustedExecution)
    await tx.advanceHead(doc.id, base.id, revision.id)
    return tx.saveSuccessReceipt(command, revision)
  })
}
```

新 Artifact、Revision、head 和成功收据同一事务提交；任一 edit 失败则全部回滚，TODO6 方案和复选框不会只改一半。文档内 edits 按原始坐标校验重叠，倒序应用避免位置漂移。限制 edit 数量、输入总长度、最终 Markdown 非空/大小，复用现有产物限制并集中配置，不依赖 prompt 保证。

同一文档写入由行锁串行，第二个提交等待第一事务结束后读最新 head，旧版返回冲突；不同文档允许独立写入，不新增全项目长锁或任务队列。现有权限/生成锁如需组合，遵循统一锁顺序并覆盖死锁重试。所有能够改变 head、归档或写权限的操作遵守相同协调约定。

网络重试同 commandId/同 requestHash 回放；同 ID 不同内容拒绝。重新读取后生成的新修改使用新 commandId，旧失败结果不能复用为新提交。commandId 由服务端执行适配器绑定逻辑工具调用生成，模型不自行指定；生成重试中若 read 后发现目标已经满足，则返回 unchanged 或直接说明，无需新增版本。

### 6. 冲突、删除、异步生命周期

| 情况 | 处理 |
| --- | --- |
| A/B 基于 R1 改不同段落，A 先提交 R2 | B 仍返回 DOCUMENT_CHANGED；本期不做自动合并 |
| B 重读 R2 后发现 TODO6 已删除 | 不恢复、不写其他同名段落，向用户说明并保留研究成果 |
| 标题/同句重复导致目标不明确 | 扩大原文范围或询问，不取第一处 |
| 相关需求被改变但原文仍存在 | 模型必须复核原目标和新内容；服务端版本检查不等于语义正确性保证 |
| 完整请求只有部分 edits 可应用 | 全部失败，head 不动 |
| 提交成功后响应丢失 | 同命令重试返回已提交版本 |
| 提交成功后模型回复失败、停止或被重生 | 文档提交保留；版本历史/工具结果显示已提交事实，不依赖“completed”回复判断提交成功 |

文档工具只在验证后的活跃执行中可写；Stop 已先于提交生效时拒绝尚未提交的写入。Stop 与提交通过现有执行状态的事务协调确定先后：提交先完成则保留，Stop 先完成则不新增版本。刷新页面继续沿用已有服务端生成生命周期。

提交成功的更新 Artifact 不等待整条 assistant 消息完成才可由 Document 服务读取；此处以 Revision 已提交为依据。新建普通 @artifact Quote/Fork 的来源 completed 规则暂不放宽：生成中提示稍后再开分支，若来源最终 stopped/failed，文档仍可读/更新，旧来源创建分支入口明确不可用。不得伪造 completed 状态。该限制属于 #143 合同衔接，独立扩大来源资格需后续规范。

成功工具结果/版本收据应在客户端刷新后可查询恢复；若最终生成的通用 Artifact 收集器再次处理该工具，不重复创建 Artifact/Document，也不删除已提交的产物。删除或替换消息不隐式撤销项目副作用。版本记录以“已提交修改”表述，不将整份文档或其他任务推断成全部完成。

### 7. 当前文档、固定引用与 #143 的衔接

- 项目 Document 入口读取 currentRevisionId；显示当前版本号。历史消息卡片、@artifact、Quote 和 forkArtifactId 仍按原 Artifact ID 读取固定内容。
- 在旧 Artifact 阅读页可显式“查看最新版”，跳转 Document 当前版本；显示新版本不是改写历史卡片。
- 在最新版里划选，使用它实际对应的 Artifact ID 和来源 Message。因此 R2 若由 Thread A 产生，新 Fork 的父节点是 A；在旧 R1 内划选仍按原来源主线。Document 的创建 Thread 不强制成为所有版本分支的父节点。
- 按标题搜索、点击当前文档或生成回复期间收到新版本时，不自动改变已经捕获的选区根/Artifact ID；有活跃选区或草稿时提示更新，显式切换前保护草稿。
- 分享/导出在创建时冻结被选版本与内容。当前采用 Markdown 文件导出和浏览器系统文件分享；不支持文件分享时提示导出。不引入公开分享链接；未来公开入口也不得动态读 head 或开放写工具。

### 8. 主线进展与实际输入固定

DocumentRevision 就是权威变更事件，列表按文档 revisionNumber 表达因果顺序，多文档时间仅用于展示。主线进展视图查询已提交的新版本，展示文件、版本变化、修改说明、来源 Thread；浏览/打开视图不代表模型已经接收。

接受主线下一条用户消息时，在数据库中获取一致的已提交版本清单，比较该主线之前持久化接收的版本，为改变的文档固定“当前 Revision + 未接收的提交说明”。在新用户 Message Parts 保存服务端生成的 `data-project-document-updates`，包含 schemaVersion、按固定顺序排列的 documentId/revisionId/artifactId 与相关提交 ID；客户端不能自报或篡改这份清单。

读取全部 manifest 的快照需一致：使用单一数据库快照查询（如同一 SQL/REPEATABLE READ 的短事务），不边遍历文档边动态追 head。新增文档也纳入清单；首次接收用当前已提交版本，不猜测用户读过就等于模型读过。清单先表示本轮计划输入；通过预算并实际发出模型请求后，在既有生成执行记录保存该清单的使用收据。进展位置由固定 Parts 与真实使用收据共同确定，生成前失败不推进；不用一个可变的全 Project“已读”布尔值，也不声称使用收据能证明模型已理解内容。

上下文编译在该新消息位置展开固定全文和提交说明；仅 ID/摘要不算模型已读全文，去重只认同一 Artifact 实际完整内容，R1/R2 不能按 Document ID 混为一次。不能为了加入新版而重写旧消息或删除旧全文；总请求超限时明确失败/提示减少本轮范围，不推进到未进入请求的版本。若需减少范围，由用户在可见进展入口选择本轮文档范围后提交新消息，不静默丢弃更新。

清单始终持久化，但此前从未收到有效提供商响应、没有使用收据的历史计划，不在后续新用户消息中补发全文；这允许用户缩小范围后重新提交。用户正文、Quote 和已实际使用的历史不删除或改写。

该清单跟随本轮历史保存：重试/重生复用原清单，提交后的 R3 不污染正在使用 R2 的请求。模型显式调用 readProjectDocument 读取更晚的 R3 时，工具结果另存固定 R3/readId。子 Thread 不自动注入其他分支全文，只接收正常继承、用户实际引用和工具读取结果；不更改 forkContext 或恢复已删除 Quote。

### 9. 模块与组件拆分

| 模块 | 责任 |
| --- | --- |
| `lib/thread-chat/contracts/document.ts`（新增） | DTO、只读/写入输入、错误联合、固定上下文 Part 校验 |
| `lib/thread-chat/domain/document-edit.ts`（新增） | 原文匹配、重叠检查、倒序应用等纯函数；不操作 DB、不调用模型 |
| `lib/thread-chat/persistence/documents/`（新增） | Document/Revision 查询、锁、head 更新及版本约束 |
| `lib/thread-chat/application/` | resolve/read/update-document 应用服务；权限、收据、事务、来源审计；统一编译固定版本 |
| `lib/thread-chat/streaming/` | 工具注册/结果持久化、执行身份与 Stop 协调、最终化去重、冲突重试预算 |
| `app/thread-chat/orchestration/artifacts/` | 文档列表、当前/历史版本、差异和来源导航 |
| `app/thread-chat/net/` | 请求、DTO 状态更新、按 Revision 失效缓存、刷新恢复 |
| `constants/` | 工具名、限制、重试次数和文案的单一入口 |

组件：ProjectDocumentList 按 Document 展示一份文件；DocumentView 管理所选 Revision/当前版本提示；ArtifactDetail/MarkdownBody/SelectionSurface 复用 #143 阅读与划选；DocumentVersionHistory 展示版本与来源；DocumentDiff 使用现有 diff 库提供只读差异；DocumentUpdateTool 展示读取、提交、冲突重读、已提交、失败；ProjectDocumentUpdates 展示主线未接收进展与本轮范围选择。

组件只展示 DTO/派发命令，不执行 patch 或决定是否能写。已提交卡片以服务端收据为准；桌面与手机复用现有布局、Drawer 和主题 token，不自建编辑器或第二套分支导航。

## Risks / Trade-offs

- 整篇 CAS 会让不同段落也冲突 → 先保证不丢更新，限制自动重试，未来单独评估自动合并。
- 版本锁不能识别逻辑矛盾 → 重读全文和语义审视，评测覆盖目标删除、需求变更；不声称已保证内容正确。
- 每版保存完整 Artifact 会增长存储 → 第一版保留完整内容便于可靠回放，后续优化不能破坏固定 ID。
- 已提交更新的来源回复可能失败 → Document 以提交收据为准，保留操作事实，既有 Fork completed 限制明确展示。
- 主线更新过多导致上下文超限 → 可见范围选择、固定输入与明确预算失败，不静默摘要/丢弃。
- 现有 Artifact 收集与新提交服务重复落库 → 单一登记入口和幂等收据，终态恢复测试覆盖。

## Migration Plan

1. 本 PR 基于 #143 实施；tasks 按实际证据勾选，macOS 验收见 macos-acceptance.md。功能分支不生成 migration。
2. 实施前确认 #143 契约与代码状态；在功能分支新增 Schema 并用独立 DB 的 db:push 验证。
3. develop 单一集成任务生成 additive migration，验证外键、原数据读取、项目删除及 nullable 初建过程，不在功能分支产生 drizzle 文件。
4. 使用幂等登记过程为 eligible 旧 Markdown 建立 Document/R1，保留旧 Artifact ID，无同名自动合并；提供进度、失败恢复及重复执行验证。
5. 先部署数据库与兼容读取，再完成登记与工具/客户端启用。未登记目标明确反馈不可更新或要求登记任务恢复，不伪造文档。
6. 回退时停用写工具/新入口，保留表、版本读取、已提交结果和新 Part 编译以回放历史，不删除 Revision 或倒退 head。
7. 通过场景验收后 archive/sync 当前 capability，保持依赖顺序，不把未实现文档标记为功能完成。

## Open Questions

无阻塞产品问题。具体 HTTP 文件路径、readId 复用的生成记录字段和现有 Part 渲染注册点由实施时核对，但必须满足本文身份、持久化、Stop 协调及预算合同。自动合并、人工编辑、版本恢复 UI 和失败消息产物可分叉资格属于后续独立需求。
