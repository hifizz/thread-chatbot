# 从 AI 回复直接开启分叉聊天

## 行为

- 在当前时间线中已完成的 AI 回复下显示“开启分叉聊天”，列模式和画布模式共用入口。
- 点击创建空分支，继承父分支已有的历史和截至来源消息（含来源消息）的当前消息 ID；不包含来源之后的消息。
- 保留来源 Thread、来源 Message、分支层级与编号；不附加引用文本、不创建选区锚点、不伪造用户消息。
- 新分支输入框为空。用户输入自己的问题并发送后，复用现有发送与模型生成流程。
- Thread 锚点不进入系统提示；Quote 仅由用户消息的 parts 进入模型，已有历史按 main 的上下文策略继承。
- 新分支暂用“新分支”作标题，首次提问后复用按用户问题生成标题的能力。
- 来源消息下展示已创建的无选区分支入口，刷新后仍可回访。
- 正在生成、停止、失败的回复和用户消息不提供直接分叉入口；服务端同时校验来源权限、当前时间线和完成状态。

## 数据契约

复用现有分叉接口。`sourceMessageId` 必填，`anchor` 与 `anchorText` 同时提供或同时省略，也支持两者均为 `null`。提供选区时，文本必须与 `anchor.quote.exact` 一致。持久化时，无引用分支的 `forkAnchor` 和 `anchorText` 均为 `null`。

不新增 Thread 类型、Quote 表或额外模型调用。原有划选分叉继续保存引用文本和锚点，并支持携带首问。

## 验证

- `node --import tsx e2e/thread-chat/message-fork.test.mjs`：契约配对、历史截止、空创建、刷新恢复及按钮展示条件。
- `node --import tsx e2e/thread-chat/normalized-client-store.test.mjs`：现有客户端命令与划选分叉回归。
- `pnpm typecheck`：类型检查。
- `pnpm test:thread-chat:gate1-db`：真实数据库覆盖空分叉保存、幂等、权限、来源状态、无引用发送与模型上下文。

## 发布前置条件

`threads_root_or_fork_shape` 允许两个锚点字段同时为空，继续保留来源消息、父分支、编号和历史非空的约束。

迁移 `0008_motionless_wong.sql` 已在本地 `develop` 集成分支通过 `corepack pnpm db:generate` 生成，连同 snapshot、journal 纳入本次集成提交。SQL 只替换 CHECK 约束，不改写现有记录。远端没有 `develop` 分支；此处没有向远端创建或发布 `develop`。

已用 PGlite 0.5.8（PostgreSQL 18.3 WASM）验证从旧迁移 0004 中的原始 threads 建表 SQL 升级到 0008：旧约束拒绝无选区分叉，新约束接受；原有主线和划选分支数据不变；半套锚点、缺来源、空继承历史和非法主线继续被拒绝。验证范围是独立 threads 表及 CHECK 约束，没有执行完整迁移链、外键或真实应用事务。

已在 GitHub Actions 的独立 PostgreSQL 17 环境完成真实数据库验收：[运行记录](https://github.com/hifizz/thread-chatbot/actions/runs/34260452154)，受测提交 `cbd2eee`。`message-fork-migration-db.test.mjs` 执行完整旧迁移链，保存真实主线和划选分支，再应用新迁移；验证旧数据不变、旧约束拒绝直接分叉、新约束允许、失败事务重试、幂等和重复迁移。`pnpm test:thread-chat:gate1-db` 与 `fork-quote-db.test.mjs` 均通过。此结果验证隔离测试库，不表示线上数据库已经应用迁移；迁移仍必须先于新入口发布。

真实浏览器验收未完成：本地服务访问返回 `ERR_BLOCKED_BY_CLIENT`；PR 预览的 Vercel 部署失败，日志需要登录。浏览器已进入 GitHub 登录后的手机二次验证，但该验证超时，尚未取得 Vercel 登录态。提供可访问且连接隔离测试库的验收环境后，需要覆盖列/画布入口、请求失败提示与重试、创建后刷新恢复、历史截止、划选 Quote 编辑/删除。保持草稿状态。

## 维护边界

分叉来源规则集中在 `lib/thread-chat/domain/fork-origin.ts`：

- `isConsistentForkSelection`：接口边界检查引用和锚点配对、原文一致。
- `resolveForkOrigin`：返回 message / selection 判别联合，统一持久化空值；服务端、客户端乐观更新和 mock 共用。
- `hasSelectedForkText`：用于已校验 Thread 的来源展示和标题策略。
- `isMessageFork`：适配旧视图的空字符串表示；有文本但缺锚点的旧划选不会被误认成整条消息分叉。

Quote 内容由消息 parts 管理，Thread 来源只负责定位与展示。不要用 Thread 来源判断用户是否保留了 Quote。

共享 `handleFork` 返回失败的 Promise；消息按钮负责局部错误和重试，划选入口在自己的调用边界显示 Toast。两条 UI 路径各自处理错误，避免共享函数吞错导致上层误判成功。

## Rebase 到 main（b3dae83）

沿用 main 的完整有序内容契约及新版 Composer，不恢复已被替代的引用修复提交。分叉命令通过可选 `firstTurn.parts` 携带首问；无引用首问不构造 Quote。发送和编辑按用户提交的内容保存，不从 Thread 自动补回已删除的引用。保留 main 的划选工具条、生成设置、Artifact 引用和提示缓存实现。

验证包含无引用空分叉、无引用带首问及失败回滚，并复用 main 的 Quote 和客户端状态回归。数据库迁移的隔离验收已完成；部署应用迁移与真实浏览器验收仍为发布前置事项。
