## 1. 版本契约与数据模型

- [x] 1.1 在改代码前阅读 `node_modules/next/dist/docs/` 中与 Route Handlers、`after`、流式响应和请求取消相关的 Next 16 文档，并核对本项目 AI SDK v7 `createUIMessageStream`、`consumeSseStream`、`onEnd/onAbort` 的安装版源码签名
- [x] 1.2 在 `lib/db/schema.ts` 增加 `branch_trees.user_id` 迁移态所有者字段及 owner 查询索引，并让新树可引用认证用户
- [x] 1.3 新增 `branch_generations` schema：身份/attempt/current 部分唯一约束、生命周期状态、turn snapshot、版本化 result、billing 状态、heartbeat/终态时间及 owner/tree/status 查询索引
- [x] 1.4 为 `usage_records` 增加 nullable `app_generation_id` 与唯一索引，保持普通线性聊天的 null 记录兼容
- [x] 1.5 生成并人工审阅 Drizzle migration：单用户库自动回填历史 branch tree owner，多用户库保留无主树待精确 URL 认领；确认 FK、部分唯一索引与回滚风险符合 design
- [x] 1.6 应用本地 migration，并用只读 SQL 验证 schema、索引、单用户回填和多条 null `app_generation_id` 共存行为

## 2. Generation 状态机与持久化仓储

- [x] 2.1 在 `constants/` 定义 generation 状态、轮询/heartbeat/lease 时间和用户错误文案，避免 API/客户端重复 magic strings
- [x] 2.2 定义版本化 `GenerationResultV1`、generation summary、turn identity/turn snapshot 与状态转换类型，明确 generation-owned Message 字段
- [x] 2.3 实现 owner-scoped generation repository：创建/重放、锁定 assistant slot、current attempt 切换、查询、Stop CAS、heartbeat、终态 CAS 与 stale lease 收敛
- [x] 2.4 实现严格 start 校验：锁定 tree、核对 owner/thread/user message/assistant placeholder/generationId/位置后保存服务端 turn snapshot，失败时不留下可调用模型的 generation
- [x] 2.5 实现树删除保护与终态级联规则：`running/stop_requested` 返回 409，terminal tree 删除后 generation 可清理
- [x] 2.6 为 repository/state machine 添加纯数据库验证脚本或可重复测试，覆盖重复 start、并发 current、Stop-vs-complete、supersede、stale 与越权 404

## 3. 结构化结果投影与树合并

- [x] 3.1 抽取共享纯函数，把 AI SDK 最终/partial `UIMessage` 与服务端研究上下文投影为 `GenerationResultV1`，覆盖正文、空回复、错误、Markdown tool input、联网活动/来源、route/plan 与 usage metadata
- [x] 3.2 为 generation Artifact 生成基于 generationId + toolCallId 的确定性 opaque id，并实现重复投影/重复合并不产生重复 Artifact
- [x] 3.3 实现 generation patch → `ThreadTreeState` 合并器：只覆盖 generation-owned 字段，保留 forks，清理被替换的旧 Artifact，并在目标消息缺失时用已验证 turn snapshot 读修复
- [x] 3.4 实现 current-attempt CAS：terminal patch、轮询响应或旧 Function 晚到时，只有当前 generationId 能更新对应 assistant message
- [x] 3.5 调整 `sanitizeLoadedState`，让有服务端 `running/stop_requested` 证明的 pending/streaming 消息保持忙碌；无 generation 的旧僵尸继续按原规则收敛
- [x] 3.6 增加 `node --experimental-strip-types` 纯函数测试，覆盖文本/Artifact/研究结果、partial error、空回复、保留 forks、缺消息读修复、patch 重放及旧 attempt 不覆盖

## 4. 分支树所有权与加载 API

- [x] 4.1 给 `/api/branch-trees` 与 `/api/branch-trees/[treeId]` 的全部方法接入真实 session 和 owner 条件，未登录返回 401、非 owner 统一 404
- [x] 4.2 实现历史无主树精确 URL 原子认领；列表不枚举无主树，已认领树不可被第二个用户再次认领
- [x] 4.3 扩展树 GET：先收敛 stale generation，再把当前 terminal patch 合并进 state，并返回当前 generation summaries 与 customTitle
- [x] 4.4 确保树 PUT 不能改 owner，旧客户端或陈旧整树快照也不能覆盖 generation sidecar；running generation 删除返回 409
- [ ] 4.5 添加 branch-tree API 级验证，覆盖 owner CRUD、越权不泄露、单次认领、terminal merge 和 running 删除保护

## 5. 计费幂等与 Generation 最终事务

- [x] 5.1 把现有 `chargeUsage` 核心重构成可接受外层 transaction 的 `chargeUsageOnce(appGenerationId, ...)`，只有首次幂等插入 usage 时才扣余额
- [x] 5.2 保持普通线性聊天现有计费调用兼容，并让 thread-chat 正常完成传入应用 generation id、threadId 与 assistantMessageId
- [x] 5.3 实现单一 `finalizeGeneration` transaction：锁定 generation、判定 completed/stopped/failed/superseded、保存 result、幂等计费并写 billing/finished 状态
- [x] 5.4 捕获 `streamText.onEnd` 的完整 usage/provider metadata/steps 与 `onAbort` 的已完成 steps；Stop 当前步骤 usage 不可得时记录 `usage_unavailable`，不写伪零成功账单
- [x] 5.5 为 finalize/charge 添加回调重入测试，验证同一 generation 多次 finalize 只产生一条 usage、一笔余额变动，旧 superseded attempt 的账单可审计但结果不合并

## 6. `/api/chat` 服务端流所有权

- [x] 6.1 扩展 thread-chat 请求体，强校验 treeId/threadId/userMessageId/assistantMessageId/generationId；线性 assistant-ui 请求保持兼容
- [x] 6.2 在调用 `streamText` 前完成 generation start transaction；重复 generation 返回既有状态，屏障/身份校验失败时绝不调用模型
- [x] 6.3 用稳定 assistant message id 的顶层 `createUIMessageStream` 包装研究 data parts 与模型 UI stream，并在顶层 `onEnd` 调用结构化投影和 `finalizeGeneration`
- [x] 6.4 用 `createUIMessageStreamResponse.consumeSseStream` + Next `after(consumeStream)` 建立服务端独立消费者，移除仅消费 `result` 的旧双轨 `after(result.consumeStream())`
- [x] 6.5 创建服务端 `AbortController`，只把该 signal 传给 `streamText`；不得传 `req.signal`，浏览器断连不得触发模型 abort
- [x] 6.6 实现同实例 AbortController registry + 跨实例 DB 取消观察器，约 1 秒响应 `stop_requested/superseded`，约 10 秒 heartbeat，并在所有终态清理 timer/registry
- [x] 6.7 捕获模型/工具/流错误与空输出，把 partial 结果收敛为 failed patch；finalize 的可重试 DB 错误在 `after` 生命周期内做有界重试并留结构化日志

## 7. Generation 查询与 Stop API

- [x] 7.1 新增 owner-scoped `GET /api/branch-generations/[generationId]`，返回 current/status/updatedAt，terminal 时返回版本化 patch，并在查询前执行 stale lease 收敛
- [x] 7.2 新增幂等 `POST /api/branch-generations/[generationId]/stop`，实现 `running → stop_requested` CAS；terminal 返回原状态，非 owner 404
- [x] 7.3 定义 Stop/查询 API 的 401、404、409 与错误 body 契约，并接入现有客户端 401 自愈
- [ ] 7.4 添加 API 验证，覆盖 Stop 自然完成竞态、重复 Stop、跨用户 Stop、stale failed 与 current/superseded 查询

## 8. 客户端发送屏障、Stop 与 Retry

- [x] 8.1 让 chat controller 接收 treeId 与严格存盘依赖；send 时保存 userMessageId、创建 generationId、把 generationId 绑定到 pending assistant，并保持乐观 UI
- [x] 8.2 在模型 POST 前通过 per-tree 写链执行可抛错的立即存盘；失败时把 placeholder 标为“未调用模型”的可重试错误，且不发送 `/api/chat`
- [x] 8.3 将组件卸载清理改为仅 detach/abort 本地 fetch，不调用服务端 Stop；同步修正文档注释与变量命名，避免再次把 disconnect 和 cancel 混淆
- [x] 8.4 Stop 按钮先调用服务端 Stop API，确认后再关闭本地流；Stop 失败时保持运行状态并提示，不得假装已停止
- [x] 8.5 Retry 对运行 attempt 执行明确 supersede/Stop，复位同一 assistant message、清理旧 generation-owned Artifact，生成新 generationId 并重新走持久化屏障
- [x] 8.6 防止同一 thread 有当前 running/stop_requested generation 时再次发送；不同 thread 仍可并行生成

## 9. 刷新加载与终态轮询

- [x] 9.1 扩展 `loadTree` 类型与启动顺序：读取 state + generation summaries，先 reconcile current patch，再 generation-aware sanitize，最后创建 store
- [x] 9.2 页面加载到 `running/stop_requested` 时保留 partial/placeholder，展示“正在后台生成，完成后显示”语义并保持同 thread busy
- [x] 9.3 实现 owner-scoped generation 轮询：前台约 2 秒、页面隐藏时降频；terminal patch 以 generationId CAS 应用后停止轮询并触发现有整树保存
- [x] 9.4 处理轮询 401/404/stale/failed 与组件卸载，清理 timer，失败显示可重试终态且不永久转圈
- [x] 9.5 确保刷新后完成的 Markdown Artifact、联网来源、研究计划与 forks 均正确显示，且重复加载/轮询不会重复 Artifact 或回退到 partial

## 10. 验收与收尾

- [x] 10.1 用可控慢流/测试模型验证：输出中刷新或关闭页面，服务端继续运行并只计费一次；完成后同页轮询自动出现完整答案，数分钟后新上下文直接访问也能恢复
- [x] 10.2 验证明确 Stop：服务端模型实际收到 abort、partial 持久化、无输出显示可重试错误、重复 Stop 幂等；普通刷新不产生 stopped
- [ ] 10.3 验证 Retry/竞态：旧 attempt 后到不覆盖新回复、不重复扣费；Stop-vs-complete 只有一个终态；running tree 删除被阻止
- [ ] 10.4 验证所有权：两个测试用户的树/list/generation/Stop 完全隔离，历史无主树只可认领一次；使用 `ego-browser nodejs` 完成所有浏览器交互验收
- [x] 10.5 验证 hard-failure：构造过期 heartbeat，刷新后收敛 failed 而非永久 pending；记录 P0 不恢复执行的预期限制
- [ ] 10.6 运行全部新增纯函数/API/数据库脚本、`pnpm typecheck`、`pnpm lint`、`pnpm build` 与 `pnpm openspec:validate`，修复所有失败
- [x] 10.7 更新 `e2e/thread-chat/README.md`、项目 `CLAUDE.md` 的持久化说明及部署迁移说明，记录 generation sidecar、disconnect/Stop 语义、历史树认领和 P1 实时续流边界
- [ ] 10.8 按项目规则只在提交前对本 change 触及的文件执行格式化，复查 magic strings/重复逻辑并确认没有改动用户无关工作树内容
