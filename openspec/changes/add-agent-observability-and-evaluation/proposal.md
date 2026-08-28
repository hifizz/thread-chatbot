## Why

当前 Agent 已包含多步模型调用、Search/Fetch、研究规划、记忆上下文、附件处理、后台流式生成和用户反馈，但缺少一条能同时覆盖本地调试、线上问题追踪与可重复评测的统一链路。现在需要优先使用 AI SDK 与 Langfuse 的官方能力建立一个可逐步扩展的观测—反馈—评测闭环，让线上失败能够沉淀为回归用例，而不是继续增加彼此孤立的日志和脚本。

## What Changes

- 在开发环境接入 AI SDK DevTools，本地查看每次 Agent 运行的模型步骤、工具调用、输入输出、usage、耗时与错误；开发数据不提交版本库，生产环境不得启用 DevTools。
- 通过 AI SDK v7 稳定遥测接口与 OpenTelemetry 建立统一服务端遥测注册，并以 Langfuse Cloud Hobby 作为第一阶段生产后端；集成保持标准协议和官方 SDK 边界，允许未来切换 Langfuse OSS 自托管而不重写 Agent。
- 为规范化 Thread Chat、过渡期 Linear Chat、研究路由、模型调用、工具执行、Search provider attempt、持久化收尾和失败状态建立可关联的 Trace/Observation 契约；现有精简服务端日志继续作为降级诊断通道。
- 使用 Project、Thread 和 assistant Message 的现有身份建立确定性 Trace：一个 assistant Message 表示一次生成尝试，不新增 generation 实体或第二套业务权威源。
- 将现有点赞/点踩继续先写入产品数据库，提交成功后以幂等 Score 镜像到 Langfuse；外部写入失败不回滚产品反馈，并支持后续补偿同步。
- 建立版本化评测集和可重复实验运行器，覆盖基础回答、Search 路由与引用、记忆与分支隔离、多模态附件、停止/重试/断线/上游故障等可靠性场景。
- 为 prompt、模型、Search policy/provider、记忆上下文编译器、工具集、多模态解析器和发布版本记录配置指纹；以确定性指标为主、模型裁判和人工反馈为辅，对 baseline 与 candidate 做可比较实验。
- 建立生产问题进入评测集、候选配置运行实验、小型 CI 回归门禁、上线后继续观测的 Loop Engineering 流程；不要求第一阶段一次性实现全量自动化。
- 生产环境默认只记录结构、耗时、usage、工具名、错误分类和脱敏元数据；输入输出内容默认关闭，只允许在明确的 staging、评测或受控抽样场景记录脱敏内容，禁止记录凭据、授权头、完整敏感查询/URL、原始网页正文和隐藏思维链。
- **BREAKING**：统一开发、CI 与 VPS 的 Node.js 运行时为 AI SDK v7 当前遥测/DevTools 依赖支持的 Node.js 22 以上；部署前必须验证并更新运行时约束。

## Capabilities

### New Capabilities

- `agent-observability`: 定义本地 DevTools、生产 Langfuse Cloud、Trace 身份与生命周期、工具/Search 子步骤、反馈镜像、隐私脱敏、故障降级和可替换后端的行为契约。
- `agent-evaluation`: 定义版本化评测集、配置指纹、确定性与模型评分、baseline/candidate 实验、生产问题回流和渐进式 CI 回归门禁。

### Modified Capabilities

无。

## Impact

- 运行环境：Node.js 约束、VPS/CI 镜像和部署环境变量需要更新；Langfuse Cloud Hobby 第一阶段提供 50k units/月、30 天数据访问和 2 位用户，达到额度或留存边界前再决定升级或迁移 OSS，自身免费额度不是无限容量承诺。
- 依赖与启动：增加 AI SDK DevTools、AI SDK OpenTelemetry、Langfuse Vercel AI SDK/OpenTelemetry 和必要的 OpenTelemetry 直接依赖；新增根级 Next.js instrumentation 及仅 Node.js 运行时加载的注册模块。
- Agent 服务端：影响 `lib/thread-chat/streaming/` 的完整生成边界、`app/api/chat/route.ts` 过渡入口、研究路由/规划、模型调用 middleware、Search provider attempt 和相关常量/上下文类型，但不重写现有流式与工具编排。
- 数据与反馈：不新增生成业务表；现有 Message/Project/Thread/feedback 继续是事实源，只增加外部遥测关联、幂等 Score 镜像和补偿同步能力。
- 评测与运维：新增项目内评测数据、运行器、评分器、实验报告、CI 小样本门禁和观测运维文档；与 `add-web-search-provider-routing` 中尚未实施的可观测性及评测任务共用事件和实验基础设施，避免建立重复系统。
- 前端：第一阶段不引入第二套聊天 UI 或暴露隐藏推理；AI Elements 仅作为未来基于既有 typed message parts 构建公开 Agent 活动时间线的可选参考，不属于本 change 的实施范围。
