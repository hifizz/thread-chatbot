## Purpose

延续统一 Search/Fetch 能力，保留 AnySearch 开发兼容；生产只使用经采购、计量与项目评测批准的付费主备路径。

## ADDED Requirements

### Requirement: Provider-neutral Search and Fetch contract

系统 SHALL 仅向模型暴露 webSearch/readUrl 的语义工具，凭据、provider 模式、计费和路由由服务端控制，切换 provider 不改变历史消息和来源 UI。

#### Scenario: Provider changes
- **WHEN** 管理员切换已批准主供应商
- **THEN** 模型工具、前端活动和已有来源链接仍兼容

### Requirement: Separate development access from production readiness

系统 SHALL 允许显式开发策略使用 AnySearch 匿名能力，但生产候选 MUST 具备有效凭据、采购容量、价格、数据政策和项目验收证据。

#### Scenario: Production has no purchased eligible provider
- **WHEN** 生产缺少已批准付费候选
- **THEN** 返回有界不可用结果，不自动把匿名访问视为可靠生产容量

#### Scenario: Development without AnySearch key
- **WHEN** 环境为开发且显式允许匿名 AnySearch
- **THEN** 兼容现有 demo 行为并标注其非生产资格

### Requirement: Select only eligible operation-specific providers

系统 SHALL 从启用、支持 operation、凭据有效、健康且预算可用的候选构建有序主备；模型不能覆盖策略。

#### Scenario: Search-only provider used for Fetch
- **WHEN** 候选仅支持 Search
- **THEN** 不将其用于 Fetch

#### Scenario: Model supplies provider override
- **WHEN** 模型输入包含任意 provider/key/计费模式
- **THEN** 拒绝或忽略该字段并沿用服务端政策

### Requirement: Bound fallback and unify effective deadlines

系统 SHALL 统一 Generation、tool、lease 的有效 deadline，按错误分类执行有界重试与备用，并预留最终答复空间。

#### Scenario: Temporary provider failure
- **WHEN** 主 provider 超时且预算仍足够
- **THEN** 记录失败 attempt，在有效 deadline 内尝试一次受控重试或已批准备用，不形成循环

#### Scenario: Invalid URL
- **WHEN** URL 或安全策略不允许请求
- **THEN** 不调用主服务或备用，不产生额外收费请求

#### Scenario: Browser disconnects
- **WHEN** 浏览器刷新或断开而未发出 Stop
- **THEN** 不把 socket 断连当业务取消，服务端沿用 Generation 恢复契约

#### Scenario: Explicit stop
- **WHEN** 用户明确停止 Generation
- **THEN** 在途模型与工具收到统一取消信号并记录真实已产生的费用

### Requirement: Meter real attempts and preserve billing units

系统 SHALL 记录每个成功或失败 attempt 的原始单位、证据和价格快照，并交由统一 billing 结算，不另建用户扣费源。

#### Scenario: Batch queries and failed fallback
- **WHEN** 一批查询按多个单位计费且备用也产生费用
- **THEN** 分别保留实际单位和成本，不能全部记作一次搜索

#### Scenario: Usage missing on timeout
- **WHEN** 超时响应不能确定真实费用
- **THEN** 标为 unknown/estimated 并待对账，不当作已核实免费

### Requirement: Govern capacity across instances and accounts

系统 SHALL 同时约束 attempt、Generation、用户与供应商账户预算/QPS，多 key 不得作为独立配额池。

#### Scenario: Concurrent instances share one account
- **WHEN** 两实例争用相同 provider 的最后预算或速率窗口
- **THEN** 使用共享准入，不因各自内存计数而重复放行

#### Scenario: Global budget reached
- **WHEN** 账户预算被已消费和已预占占满
- **THEN** 阻止新的未预占工作，已预占工作不因同一金额被重复判断而取消

### Requirement: Reuse evidence without losing freshness or ownership

系统 SHALL 去重等价请求、尊重新鲜度，并使跨实例续读 cursor 绑定用户与快照；缓存续读不伪造新付费请求。

#### Scenario: Continue on another machine
- **WHEN** readUrl 的下一页请求路由到另一实例
- **THEN** 同一用户可读有效共享快照，不重新购买同一页正文

#### Scenario: Cursor from another user
- **WHEN** 用户提交不属于自己的 cursor
- **THEN** 拒绝读取，不能泄露缓存正文

#### Scenario: Freshness required
- **WHEN** 用户明确要求最新而缓存不满足边界
- **THEN** 绕过缓存并在预算内重新检索

### Requirement: Treat URLs and content as untrusted

系统 MUST 检查协议、凭据、地址、DNS/redirect、内容类型、大小与时间，并将网页内容作为不能覆盖系统指令的证据。

#### Scenario: Redirect to private address
- **WHEN** 公网地址重定向到私网或保留地址
- **THEN** 在继续抓取前拒绝该路径

#### Scenario: Page contains hostile instructions
- **WHEN** 页面要求修改任务、工具策略或泄漏密钥
- **THEN** 不执行这些指令，路由与凭据处理不变

### Requirement: Observe attempts without leaking sensitive data

系统 SHALL 在开发/生产记录真实 provider、operation、结果、用量和关联 ID，普通日志与分析 MUST NOT 默认包含密钥、完整 query/URL/正文。

#### Scenario: Failed provider call
- **WHEN** 一个真实请求失败
- **THEN** Axiom/Langfuse 与 billing 可按 attempt/Generation 关联，错误中不泄露凭据

### Requirement: Preserve existing research orchestration

系统 SHALL 保留 answer/fetch/search/research、Planner、活动和持久化，URL 请求先 readUrl，必要时沿用现有安全备用搜索行为。

#### Scenario: Historical research reopened
- **WHEN** 用户重新打开旧联网消息
- **THEN** 来源与活动无需 provider-specific 数据迁移

### Requirement: Validate production defaults on project workloads

新主备策略 MUST 通过项目固定中英文 case、真实付费调用、故障和预算测试后才可启用，外部榜单不能自动改变默认。

#### Scenario: Candidate lacks live evidence
- **WHEN** adapter mock 测试通过但未验证真实额度或主备调用
- **THEN** 仍保持生产关闭，不将 HTTP 合约通过冒充 Beta 就绪
