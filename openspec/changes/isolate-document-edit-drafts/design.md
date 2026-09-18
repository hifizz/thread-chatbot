## Context

建议保存路径：`openspec/changes/isolate-document-edit-drafts/design.md`。

本设计依据 Issue #160 方案 C，以及固定提交 `a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5` 的实际代码。现有 `updateProjectDocument` 按工具调用做幂等，应用 edits 后立即创建正式版本。已有 `Project → Message` 锁、`isActiveDocumentExecution`、编辑纯函数、独立工具结果持久化和消息恢复入口可以复用。

当前代码事实与本文件中的拟议结构应区分：草稿表、新工具、只读草稿接口和新终态均为本 Change 要实现的能力。

## Goals / Non-Goals

**Goals**

- 同轮同文档多次编辑、最多一个正式版本。
- 参数或 patch 失败不改变正文；所有已观察到的操作有可恢复结果。
- 中断不自动发布；成功提交不因后续回复失败被撤销。
- 并发提交、重复工具调用、旧序号和跨会话更新都由服务端约束。
- 保留历史版本、旧工具结果和固定引用，避免重构通用生成平台。

**Non-Goals**

- 自动合并、跨轮继续编辑、检查点压缩或通用事件溯源。
- 人工编辑器、浏览器提交 API、多文档事务、修改标题。
- 通过提示词保证内容完整，或把线上具体参数错误视为已证实根因。

## Decisions

### 1. 工作副本与正式内容分层

新增 `document_drafts`，建议字段：

```ts
interface DocumentDraft {
  id: string
  projectId: string
  messageId: string
  documentId: string
  baseRevisionId: string
  content: string
  sequence: number
  status: "editing" | "committed" | "unchanged" | "abandoned"
  committedRevisionId: string | null
  finalReceipt: DocumentFinalReceipt | null
  closeReason: string | null
  createdAt: Date
  updatedAt: Date
}
```

约束：`UNIQUE(messageId, documentId)`、序号非负、状态检查，以及草稿与 Message/Document 的 Project 归属一致、基础与提交 Revision 属于该 Document 的复合外键。ID 沿用现有 `text` 存储与 UUID 输入验证，不引入不同的 ID 类型。

`committed` 必须有提交 Revision 和最终收据；`unchanged` 有最终收据但不关联新建 Revision；`abandoned` 保留正文，不代表删除。所有终态禁止编辑和 reset。

新增 `document_checkpoints`：`id, draftId, sequence, toolCallId, kind(edit|reset), baseRevisionId, edits, content, createdAt`。`(draftId, sequence)` 唯一，完整快照只追加。初始 sequence 0 的正文可由基础 Revision 恢复；首次编辑生成 sequence 1。reset 递增序号，不从零重用。

失败和无变化调用写收据，不生成空检查点。不同时间的检查点保存各自 baseRevisionId，确保重置前后的审计不会混淆。

在 `document_revisions` 增加可空 `sourceDraftId`，对非空值建立唯一约束并校验来源 Document/执行一致。历史行保持 null；不得直接增加会与旧数据冲突的 `(executionId, documentId)` 全历史唯一约束。实现时检查循环外键和 Project 级删除顺序，加入删除回归。

### 2. 新工具合同与读取兼容

新生成注册：`findProjectDocuments`、`readProjectDocument`、`editProjectDocument`、`commitProjectDocument`、`resetProjectDocumentDraft`。

`readProjectDocument` 不传 revisionId 时：本轮有草稿则读取草稿；没有草稿且执行允许准备工作副本时，基于当前正式 head 建立 sequence 0 草稿。只读项目或写入关闭时仍可读取正式内容，但不创建可编辑工作副本。单纯读过文档不代表用户授权修改。

显式传 revisionId 永远读取固定正式版本，不改变草稿。HTTP 文档当前读取和项目目录不读取草稿。

读取 DTO 增加 `source: revision | draft` 判别。正式结果包含固定 Revision；草稿结果包含 draftId、baseRevisionId、sequence、status 和完整 content。不得把草稿伪装成一个正式 Revision。无 source 的历史读取结果仅在兼容边界按旧正式结果解析。

编辑输入：

```ts
{
  documentId, draftId, expectedDraftSequence, readId,
  edits: Array<{ oldText: string; newText: string }>
}
```

readId 必须绑定用户、执行、文档、草稿及实际读取序号。初版在每次有变化编辑后要求重读草稿再继续编辑。成功返回 `edited`、新序号和 checkpointId；无变化返回 `no_change`，不结束草稿。都明确 `committed: false`，不返回新 Artifact。

提交输入：`documentId, draftId, expectedDraftSequence, changeSummary`。返回 `committed | unchanged | conflict | rejected`。`unchanged` 在此表示最终无变化并结束草稿，不与编辑的 `no_change` 混用。

reset 输入：`documentId, draftId, expectedDraftSequence, revisionId, readId`。模型先读取冲突后的正式版本，再以匹配收据显式 reset；服务检查该版本仍是 head，替换基础和正文、保存 reset 检查点、递增序号。旧检查点不删除，旧草稿内容不自动套到新基础。

### 3. 调用幂等与最终发布唯一性分开

复用 `executeIdempotentCommand`，命令身份按 `messageId + 操作类型 + toolCallId` 派生；相同调用及相同参数回放，相同调用不同参数拒绝。

不能把所有提交尝试都绑定一个 draftId 命令并永久回放：第一次 conflict 会阻塞重新准备后的有效提交，变动 payload 也会触发哈希冲突。

最终唯一性由草稿锁、终态及 `sourceDraftId` 唯一约束保证。不同调用提交同一终态草稿时返回它的最终收据，保存本次调用记录，但不新增版本。草稿已完成后回放的是既有事实，不表示晚到的不同参数生效。

### 4. 事务与锁顺序

所有新写路径统一按：调用命令预留 → Project SHARE → Message UPDATE → Document UPDATE → Draft UPDATE。首次建立草稿的读取也遵守同样顺序，避免复制现有读取路径先持业务锁再预留命令的混合顺序。

编辑事务：校验所有权与可信执行 → 判断调用回放 → 锁执行/文档/草稿 → 可写状态及草稿序号/读取收据检查 → 应用现有编辑纯函数 → 原子保存检查点、更新草稿、保存结果。任何 patch 失败都不改变草稿和序号。

提交事务：

1. 校验所有权和草稿与当前执行的归属；调用级回放仍校验访问权限。
2. 取得一致的业务锁；若草稿为 committed/unchanged，返回既有最终收据。
3. 校验执行活跃、写入开关、Project 可写、草稿 editing、序号及预算。
4. 检查正式 head 等于 baseRevisionId；不相等则返回冲突，保持草稿。
5. 读取基础内容；最终正文相同则写 unchanged 终态及收据。
6. 否则原子写 Artifact、Revision、head、草稿 committed 状态和所有成功收据。

已完成结果回放先于新写权限/执行状态判断，但必须在所有权验证之后。冲突检查先于最终无变化判断。锁内不得等待模型或外部网络。

Stop 和最终化只需要沿既有 Project → Message 协调后关闭草稿；关闭草稿时不再反向获取 Document 锁。批量关闭草稿按稳定顺序执行。不同执行修改不同文档不新增全项目排他长锁；同 Message 内操作允许被消息锁串行化。

### 5. 正式写入和审计

将 `appendDocumentRevision` 从 `UpdateDocumentInput` 解耦，接受基础 Revision、最终正文、changeSummary、sourceDraftId 和可信调用来源。

跨检查点 edits 针对不同中间正文，不能拼成一个针对基础版本的单次 patch。新协议提交的 `Revision.edits` 保存空数组，逐步 edits 以 sourceDraftId 对应的检查点为权威审计；旧 Revision.edits 原样保留。消费者通过 sourceDraftId 区分语义，不能把空数组解释成没有变化。实现前检查全部 edits 消费者，正式差异按固定 Artifact 正文计算。

普通 `createMarkdownArtifact` 的登记、固定引用和版本阅读不变。finalize 的通用收集器不新增识别 commit 工具的重复写入逻辑。

### 6. 停止、生成结束和进程恢复

复用 `isActiveDocumentExecution`：`generating` 之外，还必须检查 stopRequestedAt 和 supersededAt。

- `requestMessageStop`：在消息锁内设置 stopRequestedAt，并关闭未提交草稿；提交先完成的版本保留。
- `finalizeGeneration`：结束仍 editing 的草稿，保留过程，不发布；正常流结束和步骤耗尽也一样。
- `failOrphanedGeneratingMessage`：从单独 Message 更新改为按统一锁顺序协调的事务，同时关闭草稿。
- 审查其他把执行置为终态或替代消息的路径，避免遗漏；新增终态辅助函数复用，不在多个地方复制状态逻辑。

回复 completed 只表示回复终止，不表示文档任务已提交。sequence 0 且从未修改的只读工作副本不显示“有未保存修改”；有编辑历史但未提交则显示准确状态。

### 7. 失败留痕与预算

业务失败作为结构化结果提交，避免抛异常把失败记录一起回滚。事务异常回滚后以独立幂等路径记录错误；记录前检查是否已有成功收据，禁止迟到错误覆盖成功事实。

SDK 在工具 execute 前拒绝的输入，也要在原始 TextStreamPart 进入通用 UI 错误转换前捕获并持久化。接入点为 generation-plan / run-generation / ui-message-pipeline 之间的文档工具适配层。事件名称和结构以安装版 AI SDK v7 类型为准，先用模拟事件测试核对，不凭旧版本 API 编写。

建议初值：本轮文档工具总失败预算 6 次，同文档冲突后最多 2 次重新准备，全部放 `constants/project-documents.ts`。这是新增设计值，不是当前默认值。总预算覆盖有效工具调用中的结构化失败及 SDK 参数失败；同 toolCallId 重放只计一次。无法解析 documentId 的失败按执行统计，不猜测目标。

本次只要求可观察到的调用结果持久化，不承诺进程在收到错误后、写入前崩溃时仍实现零丢失；若失败记录持久化失败，应结束本轮文档写能力并记录运维错误，不继续无预算重试。

### 8. 生成计划和兼容旧工具

新生成移除即时 update 工具；历史类型、DTO 和渲染保留。删除旧的新写入口，或仅保留鉴权后的旧收据回放，禁止用旧工具绕过草稿唯一性。

prepareStep 应提示未终结草稿、预留结果说明，不自动 commit，不在步骤耗尽时强制发布。现有末步强制 createMarkdownArtifact 逻辑必须区分“创建新产物”和“修改已有文档”；进入修改流程不能因此补建同名文件，单纯读取也不能取消用户另行要求的新文档交付。

按文档终态收束编辑由服务端保证，不因一份文档提交而关闭其他文档。系统指令只根据权威收据声明正式保存；不承诺能够机械识别模型文字里的所有虚假成功表述。

### 9. 恢复、只读接口与 UI

工具结果继续写 messages.documentToolParts，展示与模型上下文必须经 restoreDocumentToolParts 合并。合并缺失结果的追加顺序不是真实执行顺序，文档编辑顺序以检查点 sequence 为准。

建议新增只读接口：

- `GET /api/thread-chat/v1/messages/{messageId}/document-drafts`：草稿摘要。
- `GET /api/thread-chat/v1/document-drafts/{draftId}/checkpoints`：检查点目录，分页且不批量返回全文。
- `GET /api/thread-chat/v1/document-drafts/{draftId}/checkpoints/{sequence}`：固定快照。

接口逐次校验所有权和 Project 归属，终态草稿可查看但不能恢复写入。不得直接依赖模型工具的活跃执行读取实现来提供历史 UI 查询。

工具 UI 按 draftId 分组过程，编辑显示“草稿已更新，未正式提交”，commit 成功显示一张最终版本卡片。同 revisionId 的重复提交调用保留为事件但不重复交付。旧协议的多个真实版本不删、不合并。

同时审查消息底部 Artifact 卡片来源，明确新文档提交只由一个交付入口负责，不能只在文档工具组件内去重。草稿正文只读展示，不伪造 Artifact ID，不作为 Quote/Fork 的正式来源。

### 10. 模型上下文与通知

`application/documents/model-context.ts` 目前直接使用读取结果的 revision.artifactId。新分支只在实际读取正式版本且内容匹配时标记该 Artifact 全文已出现；草稿全文不能消费基础 Artifact 的去重身份。

历史读取快照保持固定，不在后续编译时替换为最新草稿或 head。草稿、检查点、reset、失败和 unchanged 终态不产生正式版本通知；只有已提交 Revision 进入既有通知链。

## Alternatives Considered

- 仅合并 UI 卡片：不能阻止中间版本，拒绝。
- 同轮第一次成功更新后禁止再写：容易发布 Test edit，仅符合方案 B，拒绝作为最终方案。
- 流完成时自动提交：无法区分预算耗尽与任务完成，拒绝。
- 通用 Run 平台或事件溯源：超出需求，复用 messageId 和现有收据。
- 每次读取重新绑定最新正式版本：会丢弃或误覆盖本轮草稿，采用显式 reset。

## Risks / Trade-offs

- 完整快照增加存储；首版以正确恢复为先，沿用正文限制和生成步数边界，不立即增加压缩。
- 每次编辑后重读增加上下文与步骤；不得靠删除历史正文隐藏成本，真实模型验收评估是否需要后续协议优化。
- 新工具不能直接修复提供商参数格式问题；必须独立验证错误适配与失败预算。
- 草稿终态不证明内容语义完整；commit 仍代表模型明确交付的内容。
- 依赖规范未归档；必须先协调 add-shared-project-documents 的合同与归档顺序。

## Migration Plan

1. 只生成规划文档；经评审并收到单独实施授权后开始代码修改。
2. 功能分支改 schema，在独立数据库 db:push；不创建或改动 drizzle 文件。
3. 先完成服务、并发、恢复及历史兼容，再统一启用新工具，避免旧即时工具与新工具同时写入同一执行。
4. develop 单一集成任务生成 migration，检查意外删除、重命名和类型变化，在上一版本数据库验证升级与项目删除。
5. 发布顺序为数据库 → 兼容服务端/恢复入口 → 新工具与客户端；切换时排空旧生成或拒绝旧协议的新写入。
6. 回退优先关闭文档写入并保留新结构的只读兼容，不直接回退到仍会即时发布的旧写路径，不删除新表。

## Validation

覆盖编辑原子性、序号竞争、重复提交、真实双连接锁竞争、Stop 两种先后、提交部分写入故障、无变化终态、冲突 reset、SDK 参数失败、孤儿终态、只读恢复、旧数据与模型上下文兼容。PGlite 不能代替原生 PostgreSQL 锁竞争验收。

每批代码改动后执行 pnpm typecheck；文档/管线回归、OpenSpec 严格校验和浏览器/真实模型结果分别留证，不把静态通过等同发布完成。AGENTS.md 优先于 CLAUDE.md 的格式化描述：不得手工执行 Prettier、pnpm format 或其他格式化命令。

## Open Questions / Implementation Gates

- 尚未运行 CLI 获取当前安装版本的模板和状态；落库时按仓库版本核对，不声称本包已校验通过。
- SDK 参数错误的真实事件类型、所有旧工具与 Revision.edits 消费者，以及其他执行终态路径，作为实施第一阶段代码核查门槛；发现额外影响必须更新设计，不静默扩大范围。
- 依赖 Change 未完成的验收不得由本 Change 代为勾选；同步或归档前明确负责人和顺序。

## Code References

- [更新与正式提交路径](https://github.com/hifizz/thread-chatbot/blob/a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5/lib/thread-chat/application/documents/service.ts#L68-L111)
- [调用幂等及 payload 校验](https://github.com/hifizz/thread-chatbot/blob/a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5/lib/thread-chat/persistence/command-repository.ts#L23-L86)
- [停止协调](https://github.com/hifizz/thread-chatbot/blob/a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5/lib/thread-chat/application/stop-message.ts#L15-L40)
- [最终化与孤儿失败](https://github.com/hifizz/thread-chatbot/blob/a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5/lib/thread-chat/streaming/finalize.ts#L67-L140)
- [模型上下文的正式全文去重](https://github.com/hifizz/thread-chatbot/blob/a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5/lib/thread-chat/application/documents/model-context.ts#L11-L24)