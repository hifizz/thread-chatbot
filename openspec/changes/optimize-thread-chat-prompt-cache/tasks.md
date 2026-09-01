## 1. 实施基线与已确认产品决定

- [ ] 1.1 记录最新 Base 的 `typecheck`、`build`、Thread Chat Gate、observability tests、agent eval CI 和 OpenSpec strict validation 基线
- [ ] 1.2 将以下产品决定写入常量、Spec 和测试，禁止实施时重新解释：
  - [ ] Quote 来源只允许 `completed` assistant Message；`generating / stopped / failed` 一律拒绝
  - [ ] 每条用户 Message 最多 50 个 Quote
  - [ ] 普通 Quote 只允许来自目标 Composer 所属当前 Thread
  - [ ] 当前 Thread Markdown Artifact 批注只能回填 Artifact 来源 Thread Composer
  - [ ] 任意跨 Thread、跨分栏和 `@Thread` 引用不属于 v1
  - [ ] Fork 的 branch-origin 是唯一父 Thread 来源例外，由服务端自动生成
  - [ ] 空问题开分支只创建 Thread，不创建 B1/BA1，不调用模型
  - [ ] branch-origin Quote 在第一轮 Composer 中必需并排第一
  - [ ] 缓存和 Route 选择以“质量不变差前提下真实总成本最低”为目标
  - [ ] 第一阶段使用 Provider 默认短时缓存；1 小时 Extended TTL 默认关闭
- [ ] 1.3 对当前实现记录模型请求顺序、动态 System 变体、工具组合、继承历史长度、Claude 实际 Route 和现有 Usage 字段

## 2. Quote 类型、常量与兼容 Parser

- [ ] 2.1 在 `constants/` 定义 Quote Schema、Quote Model Format、Quote Budget Policy、最大 Quote 数 50、comment 长度和相关版本常量
- [ ] 2.2 定义 `MessageSelectionInput`、`ArtifactSelectionInput`、`QuoteSelectionInput`；客户端输入中不提供 `sourceThreadId`
- [ ] 2.3 定义 `ThreadQuoteDataV1`、Message/Artifact source 联合类型、`branch-origin | selection` kind 和可选 comment
- [ ] 2.4 扩展 `ThreadChatDataParts.quote`，继续兼容历史 `{ text }` payload
- [ ] 2.5 实现 `parseThreadQuoteData()`，所有 JSONB 读取路径必须经过 Parser，禁止直接断言为 V1
- [ ] 2.6 增加类型和 Parser 测试，覆盖 V1、legacy、缺字段、错误 Anchor、未知版本和非法 comment

## 3. 当前 Thread-only 来源验证

- [ ] 3.1 实现批量 `resolveQuoteSelections()`，输入包含目标 Project/Thread，并避免 N+1
- [ ] 3.2 Message Selection 必须验证 owner、同 Project、`source.threadId === destinationThreadId`、assistant、completed 和 Anchor
- [ ] 3.3 Artifact Selection 必须验证 Artifact 属于目标 Project、source Message 为 completed assistant，且 source Message 属于 destination Thread
- [ ] 3.4 明确拒绝其他 Thread、其他分栏、其他 Project、generating、stopped、failed 和实体关系不一致
- [ ] 3.5 实现 source + Anchor 保序去重，并在合并 branch-origin 后重新校验 50 上限
- [ ] 3.6 增加越权和绕过测试：向 Thread A API 提交 Thread B Message/Artifact ID 必须在写入和模型调用前失败

## 4. Fork branch-origin 与两条 B1 路径

- [ ] 4.1 实现 `buildBranchOriginQuote()`，只从已验证的 Thread Fork 字段生成
- [ ] 4.2 `forkThread(firstTurn)` 同一事务创建 Thread、branch-origin Quote、B1 和 BA1
- [ ] 4.3 `forkThread` 无 firstTurn 时只创建 Thread，不创建 Message、Trace 或模型调用
- [ ] 4.4 新 Thread Composer 可以从 Fork 字段重建 required branch-origin Draft Quote
- [ ] 4.5 `sendMessage()` 检测空 ForkedThread 第一轮，自动把 branch-origin 放在 B1 第一项
- [ ] 4.6 两条 B1 路径增加模型文本等价测试
- [ ] 4.7 客户端伪造父 Thread 或其他 Thread普通 Quote 时必须拒绝，不能借 branch-origin 放宽来源限制

## 5. User Message Parts、Edit 与 Retry

- [ ] 5.1 将 `buildUserParts(text, files)` 改为结构化输入，顺序固定为 `Quote* -> optional Text -> File*`
- [ ] 5.2 `SendMessageCommand` 增加最多 50 个 `quotes`；发送条件为总文本非空或至少一个 Quote comment 非空
- [ ] 5.3 `ForkThreadCommand.firstTurn` 保持问题文本必填，额外 Quote 上限为 49；前端 v1 可以不暴露额外 Quote UI
- [ ] 5.4 `EditLatestTurn` 保留原 Quote IDs、正文、comment、来源和顺序，只替换 Text/File
- [ ] 5.5 `RetryMessage` 继续使用同一个 User Message，不复制 Quote
- [ ] 5.6 `MessageDTO.parts` 继续是唯一传输入口，不新增顶层 `quotes`
- [ ] 5.7 确认 `messages.parts` JSONB 足以承载 V1，不生成数据库迁移或 Quote 表

## 6. Composer Draft 行为合同测试

- [ ] 6.1 定义 `ThreadComposerDraft`、`ComposerQuoteDraftItem`、required branch-origin 和 canonical `composerDraftToSubmission()`
- [ ] 6.2 覆盖最多 50 个 Quote、去重、排序、删除非 required Quote、Quote comment 和总文本
- [ ] 6.3 当前 Thread 划选“引用到当前输入框”只修改 Draft，不创建 Thread、Message 或模型调用
- [ ] 6.4 不展示目标 Thread/分栏选择器；另一 Thread 的选择不能加入当前 Composer
- [ ] 6.5 Markdown 批量批注只回填 Artifact 来源 Thread Composer，一次发送只创建一条 User Message和一次 assistant attempt
- [ ] 6.6 Quote-only 且没有总问题/comment 时禁用发送
- [ ] 6.7 具体 React 编辑器、Quote Block 组件、视觉、拖拽和 Draft 持久化留给下一阶段 Frontend Research

## 7. Quote-to-model 与稳定 Agent Kernel

- [ ] 7.1 实现 `quoteContentToModelText()`、`quoteTextToModelText()` 和 `threadQuotePartToModelText()` 唯一入口
- [ ] 7.2 使用确定性 JSON 编码正文/comment，覆盖换行、引号、代码和 delimiter-like 内容
- [ ] 7.3 多 Quote 按 Parts 顺序转换；只发送正文和 comment
- [ ] 7.4 测试证明 quoteId、kind、Project/Thread/Message/Artifact ID、TextAnchor、标题、脚注、Draft/Trace ID 永不进入 Prompt
- [ ] 7.5 稳定 Agent Kernel 定义 Quote 是上下文数据、comment 是局部要求、普通文本是总请求；具体 Quote 正文不得进入 System
- [ ] 7.6 历史 Fork B1 无 Quote 时，根据 Thread Fork 字段生成 deterministic model-only 兼容 Quote

## 8. Quote/Input Budget

- [ ] 8.1 实现写入前 Quote 数量、单项安全长度、comment 和粗略 Token 预算校验
- [ ] 8.2 Prompt Compiler 根据实际 Model Route 检查稳定历史、Runtime、Current User、附件和预留输出的完整窗口预算
- [ ] 8.3 超预算在任何付费模型调用前终止，返回 `INPUT_BUDGET_EXCEEDED`；不静默截断、删除或摘要
- [ ] 8.4 记录 Quote Budget Policy Version 到 Prompt Manifest 和评测 Candidate Fingerprint

## 9. Prompt Compiler、Segment 与 Hash

- [ ] 9.1 定义 Agent Kernel、Project Contract、Inherited History、Branch History、Runtime Control、Current User Segment
- [ ] 9.2 拆分 `compilePromptBase()` 与 `finalizeGenerationPrompt()`，正式 `streamText()` 只消费统一编译结果
- [ ] 9.3 从 System 移除具体 `anchorText`、Research plan、Request ID、时间戳和其他动态内容
- [ ] 9.4 当前 Quote/Text/File 只位于稳定历史后的 Current User；历史 Quote 在下一轮进入 Branch History
- [ ] 9.5 实现稳定序列化、`forkContextHash`、`toolProfileHash`、`stableRequestPrefixHash` 和 Prompt Manifest
- [ ] 9.6 测试兄弟分支 inherited Prefix Hash 相同，首次差异只在各自 B1 Quote
- [ ] 9.7 测试 UI metadata、Quote source metadata 和 Composer Draft 变化不影响稳定 Prefix Hash

## 10. Tool Profile 与模型线路能力

- [ ] 10.1 定义有限、版本化的 answer/artifact/web Tool Profile，固定工具名、描述、Schema 和顺序
- [ ] 10.2 动态 Message ID、query 和 route reason 只能存在 execute closure，不进入 Provider-visible Schema
- [ ] 10.3 将 `resolveChatModel()` 扩展为 `ResolvedChatModel`，暴露 Adapter、Gateway、upstream、routeId、routing policy 和 cache capability
- [ ] 10.4 为 Vercel、OpenRouter、UMAPIS、Private Relay、Ark、MiniMax、Cloudflare compatible 建立 Route Probe 表；未验证保持 `probe-required`
- [ ] 10.5 缓存字段被拒绝时安全降级为普通模型调用，不改变成功回答和 Message 终态

## 11. Claude 成本与 TTL 验证

- [ ] 11.1 首先对当前 UMAPIS Claude Route 验证缓存参数透传、cache write/read Usage、TTFT、回答质量、工具行为和真实总成本
- [ ] 11.2 有 Anthropic 直连凭据时运行参考 Probe，用于判断代理是否隐藏或改变缓存，不要求生产立即切换
- [ ] 11.3 成本比较包含 uncached input、cache write、cache read、output、Gateway/Relay 费用和路由漂移
- [ ] 11.4 只有质量/工具/安全/终态无回归且真实总成本下降的 Route 才可启用
- [ ] 11.5 第一阶段使用 Provider 默认短时缓存；支持时验证约 5 分钟
- [ ] 11.6 1 小时 Extended TTL 默认关闭，只有会话间隔和读写费用证明净节省且通过 retention/ZDR 后才能按 Route 启用

## 12. Breakpoint、Usage 与可观测性

- [ ] 12.1 Prompt Manifest 生成 `kernel-end / inherited-end / branch-history-end` 候选边界
- [ ] 12.2 显式缓存优先 inherited-end，其次 branch-history-end，再次 kernel-end，并服从最小长度和上限
- [ ] 12.3 区分 eligible、cold-start、partial-warm、provider-hit、provider-miss、usage-unavailable、route-drift 和 ttl-expired
- [ ] 12.4 实现每个 Model Step 的 `PromptCacheUsage` 归一化，缺失字段保持 `undefined`
- [ ] 12.5 记录 Route、cache read/write、TTFT、实际成本、Tool Profile、Prefix Hash 和 reason code，不记录用户正文
- [ ] 12.6 Telemetry/Usage 解析失败不能让成功生成变成 failed

## 13. Agent Eval 与发布

- [ ] 13.1 增加 0、1、2、50 Quote、当前 Thread成功、其他 Thread拒绝、Artifact Thread限制、completed-only、Edit/Retry 和 Quote metadata 排除 fixtures
- [ ] 13.2 增加空 Fork 无模型调用、两条 B1 模型等价、兄弟分支 Prefix equality 和同分支续聊 fixtures
- [ ] 13.3 Scheduled/release 对批准 Route 先 warm-up 再复用，使用 Provider Usage 与实际成本证明收益
- [ ] 13.4 质量、安全、隔离、工具和终态 hard regression 一律阻断，即使成本更低
- [ ] 13.5 实现 `off / observe / enabled` Route 级开关；observe 不改变发送 Prompt
- [ ] 13.6 首个 Route 小 cohort 启用后监测命中、TTFT、实际成本、质量与 fallback，并支持一键回到 off

## 14. 最终验证与交接

- [ ] 14.1 运行 `pnpm typecheck`、`pnpm lint`、`pnpm build`、Thread Chat Gates、observability tests、agent eval 和 `pnpm openspec:validate`
- [ ] 14.2 更新开发文档，使用产品语言解释当前 Thread-only Quote、Fork 唯一例外、短缓存和成本/质量门禁
- [ ] 14.3 记录每个启用 Route 的 Probe 日期、包版本、上游模型、TTL、Usage 字段、真实成本和已知限制
- [ ] 14.4 为下一阶段 Frontend Research 输出稳定输入：Draft 类型、Quote Selection、50 上限、required origin、同 Thread限制和 canonical submission
- [ ] 14.5 任意跨 Thread、跨分栏、`@Thread` 和 Thread Merge 进入独立 Research，不在本 change 顺手扩展
