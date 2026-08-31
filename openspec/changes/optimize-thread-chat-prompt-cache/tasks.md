## 1. 实施基线与已确认产品决定

- [ ] 1.1 记录最新 Base 的 `typecheck`、`build`、Thread Chat Gate、observability tests、agent eval CI 和 OpenSpec strict validation 基线
- [ ] 1.2 将以下产品决定写入常量、Spec 和测试，禁止在实施时重新解释：
  - [ ] Quote 来源只允许 `completed` assistant Message；`generating / stopped / failed` 一律拒绝
  - [ ] 每条用户 Message 最多 50 个 Quote
  - [ ] 空问题开分支只创建 Thread，不创建 B1/BA1，不调用模型
  - [ ] branch-origin Quote 在第一轮 Composer 中必需并由服务端持久化
  - [ ] Markdown 批量批注聚合到 Composer，一次发送只产生一次 assistant attempt
  - [ ] Claude 首条 Probe 使用当前 UMAPIS Claude 路线
  - [ ] 首阶段仅使用短时缓存；1 小时 Extended TTL 关闭
- [ ] 1.3 在 `constants/` 定义 Quote Protocol、Quote Model Format、Quote Budget Policy、Prompt Compiler、Agent Kernel、Tool Profile、Cache Profile 与 Routing Policy 版本
- [ ] 1.4 在实施当日重新核对锁定版本 AI SDK、Anthropic Adapter、OpenRouter Provider、Vercel Gateway 和 UMAPIS 的类型与官方文档

## 2. Quote 类型、来源与 Parts 协议

- [ ] 2.1 定义 `MessageSelectionSourceInput`、`ArtifactSelectionSourceInput` 和 `QuoteSourceInput` 联合类型
- [ ] 2.2 定义 `MessageQuoteSourceV1`、`ArtifactQuoteSourceV1`、`ThreadQuoteDataV1`、Legacy 类型和 `NormalizedThreadQuote`
- [ ] 2.3 在 Quote V1 中加入可选 `comment`，用于保持 Markdown 批量批注的 quote ↔ comment 对应关系
- [ ] 2.4 将 `ThreadChatDataParts.quote` 更新为 `ThreadQuoteData`，保持历史 `{ text }` 读取兼容，新写入只产生 V1
- [ ] 2.5 定义新写入 Parts 合同：`data-quote 0..50 -> text 0..1 -> file 0..20`
- [ ] 2.6 定义有效用户意图：非空总文本，或至少一个非空 Quote comment；只有无 comment 的 Quote Draft 不允许发送
- [ ] 2.7 实现 `parseThreadQuoteData()`，所有 JSONB 读取路径必须经过 Parser，不得直接类型断言
- [ ] 2.8 增加类型和 Parser 测试，覆盖 message/artifact source、comment、legacy、缺失字段、非法 Anchor 与未知版本

## 3. Composer Draft 领域合同

- [ ] 3.1 定义 `ComposerQuoteDraftItem` 与 `ThreadComposerDraft`，支持 0..50 Quote、总文本、附件、comment、required origin 和有序列表
- [ ] 3.2 定义 Draft 去重键：来源类型 + 来源实体 + TextAnchor；重复添加聚焦已有 Block
- [ ] 3.3 定义 `composerDraftToSubmission()` 纯函数，保留普通 Quote 的顺序、来源、Anchor 和 comment
- [ ] 3.4 明确 branch-origin 只在 Draft 展示，Submission 不伪造持久化 origin；服务端首轮自动注入
- [ ] 3.5 定义空问题 Fork 的状态流：创建 Thread → 打开 Thread → 从 Fork 字段重建 required Quote Block → 不调用模型
- [ ] 3.6 定义“开新分支”和“引用到当前 Thread”两种选择动作，共用 Quote Draft Item
- [ ] 3.7 定义跨分栏引用仍使用同一 `QuoteSourceInput`，不得建立另一套 `@` 消息协议
- [ ] 3.8 定义 Markdown 批量批注转换：每条选区/comment → Artifact Quote Draft Item，批量进入目标 Composer，一次发送
- [ ] 3.9 增加 Draft 纯函数测试：0/1/2/50 Quote、重复、排序、删除、required origin、annotation-only、无意图禁止发送
- [ ] 3.10 本阶段只完成 Draft 合同和测试；具体 React Composer 技术选型另做前端 Research/Spec

## 4. Command DTO 与服务端 Quote Resolver

- [ ] 4.1 新增 `QuoteSelectionInput { source, comment? }` 与严格 Zod Schema
- [ ] 4.2 `SendMessageCommand` 增加 `quotes[]`，最大 50；总文本允许为空，但必须满足有效用户意图
- [ ] 4.3 `ForkThreadCommand.firstTurn` 增加 `additionalQuotes[]`，最大 49；自动 origin 占第一项
- [ ] 4.4 `StartProjectCommand` 不支持 Quote；跨 Project 引用留待独立权限设计
- [ ] 4.5 `EditLatestTurnCommand` 第一阶段不允许增删、换源、重排或修改 Quote comment，只编辑总文本与附件
- [ ] 4.6 实现 `resolveQuoteSelections()`，批量加载来源并避免 N+1
- [ ] 4.7 验证来源归属、同 Project、Thread/Message/Artifact 关系与 owner 权限
- [ ] 4.8 强制来源为 `completed` assistant Message；为 generating/stopped/failed 建立拒绝测试
- [ ] 4.9 Artifact Quote 必须验证 Artifact 属于目标 Project，且 source Message 为 completed
- [ ] 4.10 服务端生成 quoteId、kind、冻结正文与完整 source；客户端预览正文不可信
- [ ] 4.11 对相同来源 + Anchor 保序去重；合并自动 origin 后重新校验 50 上限
- [ ] 4.12 在创建 User/Assistant Message 与正式模型调用前完成全部验证和预算预检

## 5. 数据库、B1 两条路径与编辑语义

- [ ] 5.1 保持 `threads` Fork 字段为拓扑事实，`messages.parts` JSONB 为 Message Quote Snapshot 事实；不新增 Quote 表和顶层 DTO 字段
- [ ] 5.2 更新 `buildUserParts({ text?, files, quotes? })`，只接受服务端已解析 Quote
- [ ] 5.3 直接带问 Fork：同一事务创建 Thread、origin Quote、额外 Quote、B1 与 BA1
- [ ] 5.4 空 Fork：不创建 Message；第一次 `sendMessage` 时从 Thread Fork 字段自动构造 origin Quote
- [ ] 5.5 增加两条 B1 路径模型等价测试，相同输入产生相同有序 Parts 与模型文本
- [ ] 5.6 后续分支轮次不重复注入 origin
- [ ] 5.7 Edit 替代 User Message 时保留全部 Quote ID、kind、text、comment、source 与顺序
- [ ] 5.8 Retry 只创建新 assistant Message，继续读取同一 User Message
- [ ] 5.9 历史 Fork B1 无 Quote 时生成 model-only origin 兼容视图，不立即回写
- [ ] 5.10 记录未来 `message_quote_refs` 只作为派生索引的触发条件，不提前建表

## 6. Quote Budget 与钱包保护

- [ ] 6.1 定义 `QuotePromptBudgetPolicy`：`maxQuoteCount=50`、单份字符上限、当前 Quote Token 上限、总输入 Token 上限和版本
- [ ] 6.2 Quote 数量和 Token 成本分开校验；数量未超 50 不代表允许无上限全文
- [ ] 6.3 使用所选 Route 对应 Token 估算/保守预算，在付费回答调用前执行 Preflight
- [ ] 6.4 超预算返回稳定错误码与可读提示，不静默截断、删除、重排或自动摘要
- [ ] 6.5 Tokenizer/估算失败采用安全失败或保守上限，不绕过预算
- [ ] 6.6 增加 50 个短批注通过、少量超长 Quote 拒绝、模型切换重新预算的测试
- [ ] 6.7 下一阶段 Composer Research 需要设计数量、预计 Token/成本和超预算反馈，但本阶段不实现视觉组件

## 7. Quote-to-model 与稳定 Agent Kernel

- [ ] 7.1 实现 `quoteContentToModelText({ quote, comment? })`、`quoteTextToModelText(text)` 和 `threadQuotePartToModelText(data)`
- [ ] 7.2 使用版本化 `<thread_quote>` + JSON 编码，保证换行、引号、代码和标签样式正文确定性安全
- [ ] 7.3 多 Quote 按 Parts 顺序逐份转换，comment 与对应 Quote 在同一模型 Block 内
- [ ] 7.4 类型和测试证明 quoteId/kind/source IDs/TextAnchor/UI/Trace 信息永远不进入模型文本
- [ ] 7.5 将 Agent Kernel 改为稳定规则：Quote 是数据、comment 是用户意见、总文本是总请求、多 Quote 按顺序综合
- [ ] 7.6 删除具体 `anchorText` 的前置 System 拼接；具体 origin 只作为 B1 Quote
- [ ] 7.7 Quote Model Format 变化必须升级版本，并视为预期冷启动

## 8. 两阶段 Prompt Compiler 与系统性缓存分类

- [ ] 8.1 定义 `CacheStability` 四类与缓存稳定性矩阵
- [ ] 8.2 把 `compileModelContext()` 拆为 `compilePromptBase()` 与 `finalizeGenerationPrompt()`
- [ ] 8.3 Segment 固定为 Agent Kernel、Project Contract、Inherited History、Branch History、Runtime Control、Current User
- [ ] 8.4 明确排除 Branch Genesis；branch-origin 已进入 Current User Quote
- [ ] 8.5 Current User 排除在稳定历史之外；未发送 Composer Draft 完全不进入 Prompt
- [ ] 8.6 Research mode/plan、动态记忆和本轮控制进入 Runtime Control，不进入前置 System
- [ ] 8.7 当前 Quote/comment/Text/File 只在 Current User 尾部出现
- [ ] 8.8 定义 `kernel-end / inherited-end / branch-history-end` 候选边界
- [ ] 8.9 实现稳定序列化、Segment Hash、Fork Hash、Tool Hash、Stable Prefix Hash 和 Full Shape Hash
- [ ] 8.10 Prompt Manifest 增加 Quote Protocol/Format/Budget 版本、Quote 数量/长度/Token 估算
- [ ] 8.11 增加 sibling fork、空 Draft、Quote 排序、B2 续聊和父消息 supersede 的 Hash 测试

## 9. Tool Profile 与实际模型路线

- [ ] 9.1 定义最小 Tool Profile 集合，固定工具名、描述、Schema 与顺序
- [ ] 9.2 动态 Message ID、route reason、query 和当前 Project/Thread 只存在于 execute closure
- [ ] 9.3 Tool Profile 变化记录为有意缓存分区，不扩大工具权限
- [ ] 9.4 将 `resolveChatModel()` 扩展为 `ResolvedChatModel`，包含实际 Adapter、Gateway、upstream、routeId、routing policy 和 cache capability
- [ ] 9.5 能力注册表以 Adapter + Gateway + Upstream Model Family 为键
- [ ] 9.6 未验证 compatible endpoint 保持 `probe-required`，不得盲发专属字段
- [ ] 9.7 Provider 拒绝缓存选项时安全降级到普通模型请求

## 10. Claude Probe 与短 TTL 发布

- [ ] 10.1 从当前模型注册表选择一条实际 UMAPIS Claude Route 作为首条 Probe
- [ ] 10.2 验证 cache marker/option 是否透传、cache creation/read Usage 是否返回、字段是否稳定
- [ ] 10.3 验证最小前缀、Breakpoint、错误降级、Route Drift 与真实成本
- [ ] 10.4 若 UMAPIS 无法证明缓存，保持 `probe-required`，不得宣传已启用
- [ ] 10.5 使用直接 Anthropic 参考 Route 运行同 Prompt Probe，区分 Prompt 架构与代理能力问题
- [ ] 10.6 Private Relay、Ark、MiniMax、Cloudflare compatible 和其他代理分别 Probe，不继承 UMAPIS/Anthropic 结论
- [ ] 10.7 首阶段只启用 Provider 默认短时缓存；支持时按约 5 分钟验证
- [ ] 10.8 1 小时 Extended TTL 保持关闭；只有会话停顿、成本摊销、ZDR/region/retention 审查通过后另行启用
- [ ] 10.9 OpenRouter/Gateway affinity 使用服务端 HMAC，隔离用户、Project、模型和 Cache Profile

## 11. Model Attempt、Trace 与 Agent Eval

- [ ] 11.1 扩展 observability allowlist，加入 Compiler/Kernel/Quote/Budget/Cache/Tool/Route 版本和稳定 Prefix Hash
- [ ] 11.2 实现每个模型 Step 的 `PromptCacheUsage` 归一化，缺失保持 `undefined`
- [ ] 11.3 新增 Model Attempt Collector，记录 Route、Token、cache read/write、finish reason、TTFT、Profile、资格与 outcome
- [ ] 11.4 生产 metadata-only：禁止导出 Prompt、Quote、comment、source IDs、TextAnchor、网页、附件正文和隐藏推理
- [ ] 11.5 扩展 Agent Eval Result 与 fingerprint，加入 Quote Protocol/Format/Budget、Prompt Compiler、Tool Profile 和 Route
- [ ] 11.6 增加 Quote/Composer Fixture：空分支无调用、当前 Thread 引用无调用、50 批注一次发送一次 attempt
- [ ] 11.7 增加 completed-only 来源测试和越权/关系不匹配测试
- [ ] 11.8 增加 Prompt Cache Fixture：sibling prefix、B2 续聊、Tool/Route/TTL 分区、cold/partial-warm/usage-unavailable
- [ ] 11.9 Scheduled/Release 执行 UMAPIS/直接 Anthropic warm-up + reuse Probe；CI 不依赖外部缓存
- [ ] 11.10 任何安全、隔离、工具、终态或回答质量 hard regression 阻断缓存启用

## 12. 渐进发布与前端下一阶段

- [ ] 12.1 实现 server-only `off / observe / enabled`；observe 只影子计算新 Prompt、Quote Budget、Manifest 和资格
- [ ] 12.2 staging 先观察 Quote 数量、预算、Prefix 长度、Tool Profile 和 Route 分布
- [ ] 12.3 只对通过 Probe 的 Claude Route 小范围启用短时 L1 Cache
- [ ] 12.4 建立按 Route 一键回到 off 的回滚步骤
- [ ] 12.5 定义 Noop/Fake `CompiledSegmentCache`，L2 默认关闭
- [ ] 12.6 只有数据库读取或编译 CPU 形成实测瓶颈后才实现进程 LRU；分布式 L2 另做数据安全审查
- [ ] 12.7 明确禁止普通聊天 Exact Response Cache
- [ ] 12.8 下一阶段发起前端 Composer Research，比较 textarea + Quote Rail、Lexical/ProseMirror、自定义 Block Composer 等实现
- [ ] 12.9 前端方案必须消费本 change 的 `ThreadComposerDraft`、`QuoteSelectionInput[]`、required origin、comment、50 上限和一次提交合同
- [ ] 12.10 前端调研覆盖：Quote Block 显示、删除/排序、批量批注导入、当前/新 Thread 动作、来源导航、Draft 跨刷新和移动端交互

## 13. 最终验证

- [ ] 13.1 运行 `pnpm typecheck`、`pnpm lint`、`pnpm build`
- [ ] 13.2 运行全部 Thread Chat Gate、observability tests 与 agent eval CI
- [ ] 13.3 运行 `pnpm openspec:validate`
- [ ] 13.4 保存 metadata-only 验收证据：Quote 路径、Message Parts、Prefix Hash、Provider Usage、TTFT、成本和回滚
- [ ] 13.5 文档明确：50 是数量上限，不是无限 Token；短 TTL 是默认；UMAPIS 必须 Probe；Prefix Hash 相同不等于 Provider 命中
