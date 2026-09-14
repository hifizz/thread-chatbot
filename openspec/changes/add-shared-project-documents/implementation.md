## 实施状态

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

## 尚未通过的发布门槛

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
