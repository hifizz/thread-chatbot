本 Change 仅完成规划交付，以下任务全部未执行。建议路径：`openspec/changes/isolate-document-edit-drafts/tasks.md`。不得将文档生成、静态审阅或未运行的命令记为实现及验收完成。进入实施需要用户另行授权。

## 1. 规范落库与依赖核对

- [ ] 1.1 重读 AGENTS.md 与完整 CLAUDE.md；明确 AGENTS.md 优先，禁止手工运行 Prettier、pnpm format 或其他格式化命令。
- [ ] 1.2 使用仓库安装版 OpenSpec CLI 创建 `isolate-document-edit-drafts`，生成真实 `.openspec.yaml`；不伪造 CLI 版本、创建日期或状态输出。
- [ ] 1.3 读取该 Change 的 status/instructions，核对 spec-driven 所需 proposal、specs、design、tasks 模板和实际路径，将本包文档分别落入对应文件。
- [ ] 1.4 核对 add-shared-project-documents 的最新代码、规范和验收状态；登记三个 MODIFIED 能力的未归档依赖，禁止先归档本 Change，不替依赖勾选未完成任务。
- [ ] 1.5 确认 proposal、design、四份 spec 和本任务清单一致，包含 edited/no_change 与最终 unchanged 的区别，以及总失败预算 6 次、冲突重新准备最多 2 次。

## 2. 实施前代码与消费端核查

- [ ] 2.1 搜索所有 updateProjectDocument、DocumentReadResult、Revision.edits、文档工具名称及工具 Part 消费端，列出保留历史兼容和退出新写入口的位置。
- [ ] 2.2 核查当前 schema、Project 删除、Message 替代和所有终态更新路径；补齐 Stop/finalize/孤儿失败之外需要关闭草稿的入口。
- [ ] 2.3 阅读安装版 AI SDK v7 类型，确认 execute 前参数错误的原始事件、执行身份和可等待的失败持久化接入点；用模拟事件证明参数错误能被捕获，不仅在 UI onError 记录。
- [ ] 2.4 核查底部 Artifact 卡片、工具结果卡片、客户端消息读取及目录同步链，确定最终交付唯一入口，避免只在单个组件内去重。
- [ ] 2.5 编写新的 Next.js 路由前阅读安装版 node_modules/next/dist/docs/ 相关文档；使用现有认证、只读响应和组件规范，不依赖旧版本知识。

## 3. 合同、常量与数据模型

- [ ] 3.1 扩展 contracts/document.ts：草稿/检查点 DTO、正式与草稿读取联合、edit/commit/reset 输入和结构化错误；旧读取结果在兼容边界解析。
- [ ] 3.2 扩展 contracts/ui-message.ts，保留旧 updateProjectDocument 类型，增加新工具类型及只读恢复所需状态。
- [ ] 3.3 在 constants/project-documents.ts 集中定义新工具名、命令类型、状态文案及失败预算，避免魔法字符串和循环运行时依赖。
- [ ] 3.4 增加 document_drafts：同轮同文档唯一、状态/序号约束、Message/Document/Project 归属约束、基础和提交 Revision 归属约束。
- [ ] 3.5 增加 document_checkpoints：完整快照、edit/reset 类型、基础版本、调用身份及序号唯一约束。
- [ ] 3.6 为 document_revisions 增加可空 sourceDraftId 唯一关联，验证同文档及真实执行来源；历史行保持 null，不对历史 executionId/documentId 直接加唯一约束。
- [ ] 3.7 在独立功能数据库执行 pnpm db:push，验证约束、循环外键和 Project 删除；不修改 drizzle/ 中任何文件。
- [ ] 3.8 运行 pnpm typecheck，修复本批合同与 schema 的类型问题。

## 4. 草稿仓储与读取服务

- [ ] 4.1 新增 persistence/documents/drafts.ts，实现归属查询、锁定、唯一建立工作副本、追加检查点和终态更新。
- [ ] 4.2 将新命令统一为命令预留 → Project → Message → Document → Draft，读取建立草稿也遵循一致顺序。
- [ ] 4.3 实现默认读取本轮草稿、首次 sequence 0 准备、显式 Revision 历史读取；写入关闭/项目只读仍可读正式内容，不创建可编辑草稿。
- [ ] 4.4 扩展 readId 验证，绑定用户、执行、文档、草稿与序号；拒绝旧读取、跨执行收据和仅替换 expectedDraftSequence。
- [ ] 4.5 保存固定读取快照及独立工具结果，继续使用 restoreDocumentToolParts 的标准恢复入口。
- [ ] 4.6 验证并发首次读取只建立一份草稿，显式历史读取不改变基础，HTTP 正式文档读取与目录语义不变。
- [ ] 4.7 运行 pnpm typecheck 及相应读取/恢复测试。

## 5. 编辑、重置和显式提交

- [ ] 5.1 实现 editProjectDocument：权限、活跃执行、草稿状态、序号、readId、预算检查，复用 applyDocumentEdits。
- [ ] 5.2 原子保存有变化编辑的检查点、正文、序号和调用结果；失败无正文副作用；no_change 不结束草稿。
- [ ] 5.3 实现 resetProjectDocumentDraft：新正式读取收据与 head 校验、替换基础及正文、追加 reset 检查点、递增序号，不自动合并。
- [ ] 5.4 实现 commitProjectDocument：权限校验、终态收据回放、执行与序号检查、基础 head 冲突、最终无变化终态。
- [ ] 5.5 改造 appendDocumentRevision：接受最终正文和 sourceDraftId；Artifact、Revision、head、草稿终态、成功收据在同一事务提交。
- [ ] 5.6 区分工具调用幂等和草稿提交唯一性；验证换 toolCallId、迟到请求及并发 commit 只产生一个版本。
- [ ] 5.7 新协议 Revision.edits 使用空数组并明确 sourceDraftId 的审计语义；更新已识别消费端，旧数据保持原样。
- [ ] 5.8 删除旧 updateProjectDocument 的新写能力；保留历史展示和必要的授权收据回放，不能通过旧服务绕过新约束。
- [ ] 5.9 运行 pnpm typecheck 与编辑/提交数据库测试。

## 6. 失败记录与生成调度

- [ ] 6.1 结构化业务拒绝正常保存命令结果；事务异常回滚后独立记录失败，检查已有成功收据，禁止迟到失败覆盖成功。
- [ ] 6.2 接入 SDK 参数错误适配，在通用错误文案转换前保存已观察到的文档工具错误；不记录敏感原始异常堆栈到用户结果。
- [ ] 6.3 实现持久化总失败预算和冲突重新准备预算；同调用重放不重复计数，非法 documentId 不猜测归属。
- [ ] 6.4 失败记录无法持久化时关闭本轮文档写能力，避免无预算继续；保留运维错误证据。
- [ ] 6.5 在 streaming/documents/tools.ts 注册 read/edit/commit/reset 工具并绑定可信身份，新执行不注册旧即时工具。
- [ ] 6.6 调整 generation-plan.ts 的未提交提醒和末步策略，区分创建新文档与修改已有文档；不自动 commit，不强制新建同名替代文件。
- [ ] 6.7 修改系统指令和错误文案，只有 committed 声明新增正式版本；某文档终结不关闭其他文档的写能力。
- [ ] 6.8 运行 pnpm typecheck、模拟参数错误、重复失败和末步策略回归。

## 7. 生命周期和模型上下文

- [ ] 7.1 requestMessageStop 在消息协调事务内设置停止标记并关闭 editing 草稿；保留 committed/unchanged。
- [ ] 7.2 finalizeGeneration 关闭未提交草稿而不发布；普通产物收集器不再次收集 commit 结果。
- [ ] 7.3 failOrphanedGeneratingMessage 改为协调事务，消息失败与草稿关闭一致完成。
- [ ] 7.4 将其他执行终止/替代入口接入共享关闭函数；不得反向获取锁或在事务中等待模型。
- [ ] 7.5 区分纯读取 sequence 0 与实际编辑未提交，不将回复 completed 解释成文档提交完成。
- [ ] 7.6 修改 application/documents/model-context.ts：草稿读取不消费基础 Artifact 全文去重身份，旧读取兼容，历史快照不动态刷新。
- [ ] 7.7 验证草稿、reset、失败和 unchanged 不进入正式通知/目录，commit 后沿用既有正式版本通知。
- [ ] 7.8 运行 pnpm typecheck、生成终态、上下文和历史恢复回归。

## 8. 只读恢复接口与用户界面

- [ ] 8.1 增加所有者可访问的消息草稿摘要、分页检查点目录和固定快照只读接口；目录不携带所有全文，不提供浏览器写入或跨轮继续接口。
- [ ] 8.2 扩展客户端合同与按需加载，项目切换、请求失败和迟到响应不泄漏或覆盖其他项目草稿。
- [ ] 8.3 工具 UI 按 draftId 归集过程，以检查点 sequence 展示编辑顺序；失败结果可查看但不虚构全局精确执行顺序。
- [ ] 8.4 实现 edited/no_change、committed、最终 unchanged、conflict/rejected、abandoned 状态文案与进度入口。
- [ ] 8.5 统一最终卡片来源，重复提交收据只交付一张正式版本卡片；不按标题合并旧真实版本。
- [ ] 8.6 草稿快照只读展示且标为非正式，不伪造 Artifact ID 或放宽 Quote/Fork 来源规则。
- [ ] 8.7 刷新恢复复用 restoreDocumentToolParts，验证 toolCallId 原位替换和缺失追加，不直接把原始 messages.parts 当完整消息。
- [ ] 8.8 桌面/手机复用现有 Drawer、焦点和样式 token；遵守 .tc 作用域，不新增无必要依赖。
- [ ] 8.9 运行 pnpm typecheck 和 UI/客户端回归。

## 9. 自动化和真实并发验收

- [ ] 9.1 新增 document-drafts-db.test.mjs 并接入 package.json 测试脚本；保留现有文档测试中的授权、来源、固定引用和并发保护。
- [ ] 9.2 验证多次编辑仅产生检查点，commit 才新增一对 Artifact/Revision；修改后恢复基础正文最终不新增版本。
- [ ] 9.3 验证同调用重放、同调用不同参数、旧 sequence 编辑/提交、不同调用重复 commit 和同草稿并发 commit。
- [ ] 9.4 原生 PostgreSQL 多连接验证跨会话提交冲突、不同文档独立写入、Stop/Commit 两种先后及归档竞争；不能以 PGlite 串行连接代替。
- [ ] 9.5 故障注入验证 Artifact/Revision/head/草稿终态/成功收据无部分提交，失败记录不覆盖成功。
- [ ] 9.6 验证 SDK execute 前参数错误、失败去重、达到预算、失败落库异常关闭写入。
- [ ] 9.7 验证 finalize、孤儿失败、消息替代和刷新，不发布未提交草稿，不撤销已提交事实。
- [ ] 9.8 验证旧工具结果、旧 Revision.edits、无 source 读取结果、新旧上下文和写入关闭后的只读恢复。
- [ ] 9.9 运行 pnpm test:thread-chat:documents、pnpm test:thread-chat:documents-db、pnpm test:thread-chat:gate2-pipeline 及受影响回归，逐项保留结果；测试环境与命令若有更新，以仓库当前脚本为准。

## 10. 浏览器、模型和发布门槛

- [ ] 10.1 真实模型复现参数失败 → 小范围草稿测试 → 继续编辑 → 最终 commit，检查真实调用序列和数据库版本数，而非只看模型自述。
- [ ] 10.2 验收步骤耗尽不自动发布、冲突后重新准备、仅讨论不修改、同轮多文档互不错误禁用；内容完整性单独评估。
- [ ] 10.3 桌面/手机验收过程展开、固定检查点、唯一最终卡片、停止和刷新恢复，保存截图及失败证据。
- [ ] 10.4 运行 pnpm typecheck、受影响文件 lint、必要构建及 pnpm openspec:validate；不手工运行 format，不声称未执行的检查通过。
- [ ] 10.5 根据真实结果更新 tasks，明确未验收项和依赖规范状态；只有必要文档存在不代表 apply 或发布门槛已满足。
- [ ] 10.6 develop 单一集成任务生成 migration，审查非预期结构变化，在上一版本数据库执行迁移验证；功能分支不执行 db:generate。
- [ ] 10.7 按数据库 → 兼容服务端/恢复 → 新工具/客户端发布，排空旧执行或拒绝旧协议新写，验证不并存两个发布入口。
- [ ] 10.8 验证关闭写入的安全回退；草稿、历史版本和收据仍可授权读取，不删表、不恢复旧即时写能力。
- [ ] 10.9 确认 add-shared-project-documents 具备真实归档条件并先建立能力基线，再同步/归档本 Change 的 MODIFIED 规范；不得修改依赖任务来伪造完成。