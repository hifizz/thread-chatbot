## 1. 运行时、依赖与实施基线

- [x] 1.1 在实施当日重新核对 AI SDK v7、AI SDK DevTools、Langfuse Vercel AI SDK/OpenTelemetry 和 Next.js instrumentation 的项目内类型或官方文档，记录最终采用的包名、版本与 Node.js 要求
- [x] 1.2 记录当前 Node.js/pnpm 版本，以及 `typecheck`、`build`、现有 Thread Chat Gate 测试和 OpenSpec 校验的实施前基线结果
- [x] 1.3 将 `package.json` engines、`@types/node`、README、CI 和 VPS/Coolify 运行镜像统一到 Node.js 22 以上，并选定一个通过现有基线的固定运行时版本
- [x] 1.4 安装并锁定 AI SDK DevTools、AI SDK OpenTelemetry、Langfuse client/Vercel AI SDK/OpenTelemetry 和 OpenTelemetry SDK 的直接依赖，确认每个子路径 import 都有对应直接依赖
- [x] 1.5 增加 server-only 遥测环境变量契约和示例，覆盖总开关、DevTools、Langfuse key/base URL/region、environment、release、内容策略和匿名 ID salt，且不暴露为 `NEXT_PUBLIC_`
- [x] 1.6 将 `.devtools/` 和本地评测临时输出加入 `.gitignore`，同时保留允许提交的 case、fixture、基线摘要和阈值配置
- [x] 1.7 在 Node.js 运行时升级和依赖安装后再次运行实施前基线，修复本 change 引入的兼容问题再进入遥测接线

## 2. 遥测注册、隐私策略与本地 DevTools

- [x] 2.1 在 `constants/` 和 `lib/observability/` 定义稳定的环境、Trace/Observation 名称、attribute allowlist、错误类别和应用自有遥测上下文类型
- [x] 2.2 实现 assistant Message/request 到确定性 Trace ID、feedback Score ID 和带 salt HMAC 用户匿名 ID 的 server-only helper，并增加稳定性与不泄漏原始用户 ID 的测试
- [x] 2.3 实现集中 telemetry policy，默认 production `recordInputs=false`、`recordOutputs=false`，只允许 evaluation、staging 或显式 cohort 开启内容
- [x] 2.4 实现 Langfuse 出口 mask，递归清除 credential、Authorization、Cookie、secret、个人信息、完整敏感 query/URL、附件/网页正文、原始 provider payload 和隐藏推理字段
- [x] 2.5 增加根级 Next.js `instrumentation.ts` 与 Node.js 专用初始化模块，以进程级 singleton 防止开发热更新或测试重复注册
- [x] 2.6 在 development 条件注册官方 AI SDK DevTools，提供本地启动/查看命令，并加入生产环境不得初始化 DevTools 的显式保护
- [x] 2.7 在配置完整时注册 Langfuse Vercel AI SDK integration、span processor 和批量 exporter；配置缺失或初始化失败时安全降级到现有服务端摘要日志
- [x] 2.8 实现共享 AI SDK telemetry option builder，统一 `functionId`、内容记录策略、environment/release 和 runtime context，避免各模型调用散落不同设置
- [x] 2.9 将回答、研究路由、研究计划、标题、附件洞察、embedding batch/query 等现有 AI SDK 调用接到共享 telemetry option builder
- [x] 2.10 让 `withModelCallLogging` 复用新的关联上下文与 attribute 命名，同时继续只输出结构摘要，不输出 prompt/output 正文
- [x] 2.11 增加注册合同测试，覆盖重复 register、development、test、production、缺失 Langfuse 凭据、远程初始化异常和 production DevTools 禁用
- [x] 2.12 增加脱敏测试，注入 API key、Authorization、Cookie、邮箱/手机号、完整 URL/query、附件/页面正文、原始 provider error 和 `<think>` 内容，确认 exporter 只能收到允许字段

## 3. 规范化 Thread Chat 与过渡入口 Trace

- [x] 3.1 将 Project ID、Thread ID、assistant Message ID、model ID、匿名用户 ID 和发布/策略版本加入规范化生成的观测上下文，不改变现有命令或 Message DTO 契约
- [x] 3.2 用 Message 派生的确定性 Trace 包住 `runGeneration` 的完整后台生命周期，并以 Project 作为 session、Thread 作为可搜索分支属性
- [x] 3.3 为 research route、research plan 和正式回答补齐稳定 purpose、结果摘要、耗时、错误类别与父子关联，避免重复记录输入正文
- [x] 3.4 为 checkpoint 聚合和 finalize 建立自定义 Observation，只记录次数/字节或 parts 数量、终态、finish reason、provider usage 和安全错误
- [x] 3.5 让 AI SDK 自动生成的模型 step/tool Observations 继承根 active context，并验证多步 Search/Fetch/Artifact 工具调用仍位于同一 Trace
- [x] 3.6 将 completed、stopped、failed、abort、初始化错误和协议错误映射为一致的 Trace outcome/status，确保数据库终态提交后才结束根 Trace
- [x] 3.7 增加断开测试，证明 SSE/浏览器消费者离开后根 Trace 仍跟随后台任务直到终态，而不是在 HTTP response 返回时提前成功
- [x] 3.8 增加 Retry/Regenerate 与 command replay 测试，证明新 assistant Message 产生新 Trace、相同 Message 重放保持同一 Trace 且不新增 generation 实体
- [x] 3.9 为进程重启后的 orphan Message 收敛增加可重复 reconciliation hook 或运维脚本，以相同 Trace ID 记录安全失败结果并保持数据库为事实源
- [x] 3.10 为过渡期 `/api/chat` 增加 request-scoped 根 Trace、linear thread session 和模型/工具关联；显式标记为 legacy，且让 `after(consumeStream)` 的错误/终态可关联
- [x] 3.11 使用可注入的内存/fake telemetry integration 增加端到端测试，断言 Trace 树、身份、顺序、usage、终态和 error attributes，而不依赖真实 Langfuse 网络

## 4. Search provider attempt 统一观测

- [ ] 4.1 定义共享 provider attempt observation schema，覆盖 correlation、provider、operation、route reason、attempt index、fallback count、outcome、duration、原始 usage unit/quantity 和安全错误类别
- [ ] 4.2 实现共享 observation sink，使开发日志和 Langfuse child Observation 消费同一事件，而不是维护两套不一致字段
- [ ] 4.3 将当前 AnySearch Search/Extract 的每次实际调用接入共享 sink，保留开发环境可见的 provider/operation 摘要
- [ ] 4.4 为 `add-web-search-provider-routing` 的 Attempt Engine/adapter 预留并接入同一 sink，确保后续 Parallel、Firecrawl 或其他 provider 无需再建遥测系统
- [ ] 4.5 增加 Search/Fetch 成功、timeout、429、5xx、auth、empty/unusable、取消、预算耗尽和 fallback 链路测试，验证每个 attempt 都关联到同一 Agent Trace
- [ ] 4.6 增加 provider 观测隐私测试，证明只输出 query fingerprint/域名级信息，不输出完整 query、URL、页面正文、响应体、Authorization 或 key

## 5. 产品反馈幂等镜像

- [ ] 5.1 建立 Langfuse feedback Score adapter，使用 Message 派生 Trace ID、确定性 Score ID、categorical `up/down/cleared` 和 product source metadata
- [ ] 5.2 在现有 feedback 数据库事务提交后通过 `after(...)` 或等价 post-commit hook 调用 mirror，保证 HTTP 成功与产品状态只依赖数据库
- [ ] 5.3 实现 feedback 从 up/down 互换与清除时的 update/upsert/replace 语义，确认远端只保留一个当前逻辑评分而非矛盾历史评分
- [ ] 5.4 实现支持 dry-run、批次和最终 flush 的 feedback backfill 脚本，可由现有 Message 数据重放到相同 Trace/Score ID
- [ ] 5.5 增加 feedback 测试，覆盖首次写入、重复 command、修改、清除、Langfuse timeout/异常、Score 先于 Trace 和 backfill 重放
- [ ] 5.6 更新反馈运维文档，说明数据库事实源、远程延迟一致性、失败诊断和 backfill 操作，不承诺外部 Score 强一致

## 6. Langfuse Cloud 验证与渐进发布

- [ ] 6.1 由操作员创建独立 Langfuse Cloud Hobby project，按 VPS 位置和数据要求选择 region，并把 public/secret key 仅配置到 server-side secret store
- [ ] 6.2 在 staging 以 metadata-only 和 telemetry 总开关关闭为初始状态部署，确认无凭据日志、无 DevTools、无 prompt/output 正文
- [ ] 6.3 开启 staging telemetry，分别运行普通回答、研究路由、Search/Fetch、工具、Stop、Retry 和失败场景，人工核对 Langfuse Trace 树、session、usage、终态和匿名用户属性
- [ ] 6.4 进行 Langfuse endpoint 不可达、401、429、超时和 exporter flush 失败演练，确认 Agent 响应、后台生成、终态落库与 feedback 保存不受影响
- [ ] 6.5 记录 metadata-only 场景的平均/高位 units 每次 Agent、ingestion 速率和历史窗口需求，并编写接近 50k units、30 天或 2 用户边界时的检查与决策清单
- [ ] 6.6 先对 production 小范围开启，再逐步到低流量 metadata-only 全量；记录开关、release、验证证据和一键关闭 remote export 的回滚步骤
- [ ] 6.7 用非生产兼容 endpoint 或配置测试验证 Cloud base URL 可替换，且切换不改变 Agent 编排、Trace seed、Message schema 或 feedback 事实源

## 7. 项目自有评测基础设施

- [ ] 7.1 在 `evals/agent/` 建立 cases、fixtures、scorers、runner 和文档结构，定义可验证的 case、suite、tag、sensitivity 和 schema version 类型
- [ ] 7.2 实现稳定 case ID 和仓库 dataset revision，确保 Hosted Dataset 的最新版本行为不会取代 Git revision 的可复现性
- [ ] 7.3 实现配置指纹生成器，覆盖 candidate、model、prompt、Search policy/provider、memory/context、toolset、multimodal parser、release/commit、environment 和 evaluator version，并排除 secrets
- [ ] 7.4 定义统一 experiment result envelope，包含 output、Trace ID、timing、usage、tool/provider attempts、terminal state、scores 和 error classification
- [ ] 7.5 实现按 suite/tag/case ID 选择的 Node.js + `tsx` runner，支持 smoke、ci、scheduled/release 模式和明确的并发/超时预算
- [ ] 7.6 抽取或复用生产 route/prompt/context/tool execution core，让内容质量 case 运行代表性 Agent 逻辑而不是仅调用 prompt playground
- [ ] 7.7 为生命周期 case 建立隔离测试数据库执行器，创建测试 Project/Thread/Message、调用真实 `runGeneration`、读取终态并清理测试数据，禁止连接生产数据库
- [ ] 7.8 实现 repo case 到 Langfuse Dataset 的幂等同步，保持稳定 item ID、suite/tags、expected/rubric 和 sensitivity 约束
- [ ] 7.9 实现 Langfuse Experiment adapter，把 case、candidate、fingerprint、Trace 和 scores 关联到同一 run，并在短生命周期 CLI 结束前显式 flush
- [ ] 7.10 增加 `package.json` 评测命令、server-only 环境隔离和安全启动检查，明确 evaluation traffic 不使用 production user/session/analytics identity
- [ ] 7.11 为 case schema、fingerprint 稳定性、selection、result envelope、Dataset 重放、remote failure 和 flush 增加不依赖真实模型的合同测试

## 8. 初始评测集与评分器

- [ ] 8.1 建立 `core-answer` 初始 case，覆盖不联网回答、中英文、指令遵循、结构化/Artifact 输出和无需工具的问题
- [ ] 8.2 建立 `search-routing` 初始 case，覆盖 answer/fetch/search/research、最新事实、引用、provider fallback、空结果、timeout/429 和工具调用预算
- [ ] 8.3 建立 `memory-context` 初始 case，覆盖同线程事实、长上下文、冲突、冻结分支、retrieval/embedding 和跨 Project 不泄漏
- [ ] 8.4 建立 `multimodal` 初始 case 与可提交合成图片/PDF/文本 fixture，覆盖 grounding、页/内容依据、损坏、不支持和大小边界
- [ ] 8.5 建立 `reliability` 初始 case，覆盖 Stop、Retry、command replay、SSE 断开、初始化/协议失败、provider 故障和进程重启收敛
- [ ] 8.6 实现 success、schema、expected route/tool、tool count、fallback、empty/error 和 terminal-state 确定性 scorer
- [ ] 8.7 实现 citation presence、URL/来源匹配、可验证 grounding 与 freshness-aware Search scorer，并将 live Web 波动标记为独立维度
- [ ] 8.8 实现 memory fact、contradiction 和 cross-Project no-leak scorer，保证泄漏失败不能被高主观质量分覆盖
- [ ] 8.9 实现 p50/p95 latency、provider/model usage、工具次数、fallback 率、错误率、空结果率和可用估算成本聚合器
- [ ] 8.10 实现可选模型裁判 adapter，版本化 judge model 与 rubric，并用一小组人工标签校准 correctness、faithfulness、helpfulness、completeness 和 citation support
- [ ] 8.11 增加 scorer 自测与固定样例，证明确定性失败优先、用户 feedback 保持独立信号、报告不压缩为一个不可解释总分

## 9. Baseline、生产回流与持续实验

- [ ] 9.1 在相同 case IDs 上运行并保存当前模型、prompt、AnySearch、记忆与多模态配置的 baseline fingerprint、分项结果和 Langfuse Experiment 链接
- [ ] 9.2 实现 baseline/candidate 比较报告，按 suite 展示 case delta、确定性失败、judge 差异、p50/p95、usage/成本、provider 故障和配置差异
- [ ] 9.3 编写生产 Trace/错误/down feedback 筛选、授权复盘、脱敏、最小化、fixture 替换和加入 repo dataset 的人工策展流程
- [ ] 9.4 从一个已知非敏感问题完成一次端到端演练：Trace 定位、脱敏 case、Dataset 同步、baseline/candidate 实验、修复验证和回滚记录
- [ ] 9.5 配置快速本地 smoke subset，确保常见 prompt/工具改动可以低成本获得 case-level 结果和 candidate fingerprint
- [ ] 9.6 在 baseline 校准后接入官方 Langfuse experiment CI action 或等价官方 runner，只对稳定小集和明确确定性阈值启用 PR 阻断
- [ ] 9.7 配置 broader scheduled/release workflow，运行 Search、记忆、多模态、可靠性和可选 judge 套件，并将报告链接/摘要保存为可追溯 artifact
- [ ] 9.8 将 CI 与 scheduled Trace 标记为 evaluation environment/experiment/case/candidate，验证不会混入 production session、用户反馈或产品分析
- [ ] 9.9 根据真实 Cloud units 调整 smoke 数量和 scheduled 频率；任何 sampling、付费升级或 OSS 迁移决策都记录触发指标和回滚方案

## 10. 完整验收与文档

- [ ] 10.1 运行所有 observability、privacy、Trace identity、background lifecycle、Search attempt、feedback mirror 和 evaluation 合同测试并修复本 change 引入的问题
- [ ] 10.2 运行现有 Thread Chat 数据库、Session、UI Message pipeline、API、client store 和 cutover gates，证明遥测不会改变会话状态机和用户行为
- [ ] 10.3 运行 local smoke 和至少一次 baseline/candidate Experiment，确认 case、Trace、scores、fingerprint、报告和 final flush 完整
- [ ] 10.4 运行 `pnpm typecheck`、`pnpm lint` 和适用生产 build；若存在无关既有失败，单独记录基线且不掩盖新增失败
- [ ] 10.5 在本地实际查看 DevTools 的普通回答与多步工具运行，在 Langfuse staging 实际查看 metadata-only Trace、反馈 Score 和 Experiment，并保存无敏感内容的验收证据
- [ ] 10.6 完成开发、环境变量、Cloud region/额度、隐私策略、故障处置、feedback backfill、评测数据维护、CI override、生产回流和 Cloud→OSS 切换文档
- [ ] 10.7 运行 `git diff --check` 与 `openspec validate add-agent-observability-and-evaluation --strict`，确认所有 capability scenarios 均有实现或明确的分 Gate 验收证据
