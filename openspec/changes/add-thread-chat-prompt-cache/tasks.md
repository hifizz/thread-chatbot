## 1. 数据库与输入契约

- [x] 1.1 定义并用 Zod 严格验证 `ThreadQuoteSourceV1`、`ThreadQuoteDataV1`、`ThreadQuotePartV1` 与只读 Legacy Quote 联合，保持 Quote 持久化在 `messages.parts` JSONB 且不新增 Quote 表
- [x] 1.2 将 `ThreadChatDataParts.quote` 升级为版本化 Quote 联合，并添加持久化 JSON、旧格式读取和 `text === anchor.quote.exact` 的类型与 Schema 测试
- [x] 1.3 定义 `ComposerQuoteDraft` 与 `ThreadComposerDraft`，明确本地 `localId`、来源、入口、只读快照、批注、删除和排序语义
- [x] 1.4 定义不含客户端临时字段的 `ThreadQuoteInputV1` 与共享 `MessageContentInput`，接入 Start、Send、Edit 和 Fork First Turn 命令 Schema
- [x] 1.5 实现 Composer 草稿到命令输入、命令输入到有序 Message Parts 的唯一投影，保证 Quote、文本和文件顺序不被按类型重排
- [x] 1.6 定义 `ModelVisibleQuote` 最小投影，只允许 `text` 与可选 `comment` 进入模型，不暴露来源、Anchor 或客户端状态
- [x] 1.7 定义固定生成模式、Provider 线路、缓存策略和 `PromptCacheObservation` 类型，确保 `undefined` 与 `0` 可区分

## 2. Quote/Fork 前缀稳定化

- [x] 2.1 从 Thread Chat System 构造和所有调用点移除 `anchorText` / `forkAnchor` 的模型可见注入，确保没有 Quote Part 的 Child 不会从 Thread 字段合成引用内容
- [x] 2.2 让 Quote 只通过 User Message Parts 的确定性序列化入口进入模型，并保持 Quote、普通文本和文件的既有 Part 顺序
- [x] 2.3 删除 Child 继承历史的 `INHERITED_CHAR_BUDGET=6000`、`applyInheritedBudget` 和 `inherited-omitted` 伪消息逻辑
- [ ] 2.4 按 `forkContext` 的有序 Message ID 加载完整继承历史，再追加 Child 已完成历史和当前 User Message；超过模型真实上下文限制时沿用或补齐付费调用前的明确错误
- [ ] 2.5 添加无动态 PDF 场景的 Fork 上下文测试，覆盖超过 6000 字符的完整继承、无 Quote Child 和不同 Quote 兄弟分支的共同前缀

## 3. 固定生成模式与 Prompt Schema

- [x] 3.1 定义 Thread Chat Prompt Schema 版本常量，并将其接入生成计划结果和后续观测上下文
- [x] 3.2 建立以 `(researchMode, artifactRequested)` 合法组合为输入的固定生成模式注册表，集中定义稳定模式 ID、System 片段、工具名称与顺序、首步强制工具、推理设置和最大步骤
- [x] 3.3 重构 `generation-plan` 使用固定模式注册表，同时保持现有联网、研究、Artifact 权限、首步工具、推理和步骤行为不变
- [x] 3.4 保持 `researchPlan` 位于现有服务端 System 权威位置，并确保 `routeReason`、请求 ID、Generation ID 和缓存观测字段不进入模型可见固定前缀
- [ ] 3.5 添加固定模式合同测试，覆盖每个合法模式的 System、工具顺序与 Schema、首步规则、推理设置和最大步骤

## 4. Provider 缓存能力策略

- [x] 4.1 在模型解析结果中提供判断缓存资格所需的实际 Provider、协议、凭据组和上游模型身份，不使用展示名称或模型创建者进行推断
- [x] 4.2 建立单一 Provider 缓存能力表和策略入口，仅将 UMAPIS Anthropic 线路的 `claude-opus-5` 与 `claude-sonnet-5` 加入 V1 显式缓存白名单
- [x] 4.3 为白名单策略配置 Anthropic `ephemeral`、`5m` 缓存控制；确保 OpenRouter、OpenAI-compatible 和其他未验证线路不收到猜测性显式缓存参数
- [x] 4.4 添加缓存资格矩阵测试，覆盖两个白名单模型、同创建者但不同线路、UMAPIS GPT、OpenRouter 和其他 OpenAI-compatible 线路

## 5. 缓存边界与请求装饰

- [x] 5.1 扩展 Provider 中立的 Prompt 编译结果，表达稳定服务端指令末尾和当前 User Message 之前最后一条稳定历史末尾两个语义边界
- [x] 5.2 实现 Provider 缓存装饰层，将白名单线路的稳定指令边界转换为 AI SDK v7 `SystemModelMessage.providerOptions.anthropic.cacheControl`
- [x] 5.3 将共同历史边界转换为最后一条稳定历史 Message 或其最后一个合法 Part 的 Anthropic 缓存断点，并确保当前 User Message 位于断点之后
- [x] 5.4 处理无共同历史、字符串或 Part 数组内容及无合法历史断点的请求，不插入模型可见占位消息且单次请求不超过四个断点
- [x] 5.5 将缓存装饰接入 `streamText` 调用，保证非白名单线路和关闭装饰时保持原请求结构
- [ ] 5.6 添加缓存装饰不变性测试，移除 Provider Options 后逐项比较 instructions、messages、工具、推理、步骤和输出限制完全一致

## 6. 缓存用量与三态观测

- [x] 6.1 在 `LanguageModelUsage` JSON 序列化前读取字段存在性，构造 `hit | miss | unknown` 标准化缓存观测摘要，保留缺失字段而不补零
- [x] 6.2 在观测摘要中记录实际 Provider、上游模型、固定生成模式、Prompt Schema 版本、Project Contract 版本、显式缓存状态及输入、未缓存、读取、写入和输出 Token
- [x] 6.3 保留现有 generation `providerUsage` 中的标准和原始 Provider 用量，并将标准化摘要接入现有 Langfuse generation/trace metadata
- [x] 6.4 将同一份非敏感摘要写入服务端结构化日志，确保不记录完整 Prompt、研究计划、用户正文、Quote、附件正文、API Key 或 Provider 原始请求
- [x] 6.5 隔离 Langfuse 与日志观测失败，确保上报异常不改变回答流、模型路由、计费处理、消息持久化或消息终态
- [ ] 6.6 添加 usage 单元测试，覆盖缓存读取、缓存写入但未读取、字段为零、字段缺失、Provider 忽略缓存和观测上报失败

## 7. 缓存指标口径

- [x] 7.1 实现完整明细下的 Token 命中率 `cacheReadTokens / (noCacheTokens + cacheReadTokens + cacheWriteTokens)`，并处理分母为零的情况
- [x] 7.2 实现仅有 `inputTokens` 与 `cacheReadTokens` 时的降级覆盖率，并为每个结果记录完整或降级公式口径
- [x] 7.3 实现请求命中率、缓存写入率和未知率聚合，确保未知请求不进入命中率分母
- [x] 7.4 按实际 Provider、上游模型、固定生成模式和 Prompt Schema 版本输出可聚合维度，将 Project Contract 版本保留为按需排障字段
- [x] 7.5 添加指标测试，覆盖完整明细、降级明细、混合未知请求和零分母窗口

## 8. 端到端合同验证

- [ ] 8.1 添加相同 Provider、上游模型、固定模式、Project Contract 和共同历史产生逐字相同当前 User Message 前缀的确定性测试
- [ ] 8.2 添加仅请求 ID、Generation ID、观测身份或 `routeReason` 变化时固定模型可见内容不变的测试
- [ ] 8.3 添加缓存未命中、字段未知或缓存观测失败仍完成正常回答和持久化流程的集成测试
- [x] 8.4 运行项目要求的格式、lint、类型检查和相关单元/集成测试，并修复本 change 引入的失败
- [ ] 8.5 使用唯一合成长前缀对 UMAPIS Sonnet 5 和 Opus 5 执行受控发布验证，确认请求接受 `cache_control` 且至少观察到缓存读取或写入字段；不将付费、TTL 或固定命中率检查加入普通 CI
- [ ] 8.6 记录受控验证的模型、时间、标准 usage、原始缓存 usage 和异常，不记录项目文档、用户消息或业务数据
