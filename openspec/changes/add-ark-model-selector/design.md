## Context

Thread Chat 已经复用全站 `/api/chat` 与 AI SDK 7 的 `UIMessage`/`ModelMessage` 转换链路，但它没有把模型选择写入 Thread 领域状态，也没有随请求发送 `modelId`，因此所有列实际上都会落到默认模型。项目已有统一模型注册表、OpenAI-compatible provider 和按 token 计费链路，本次需要在不新增 SDK 依赖的前提下接入火山方舟 Coding Plan。

当前 Thread Chat 只把文本和项目自己的 artifact 上下文序列化给模型，不会把某个供应商的原始请求体直接转交给另一个供应商。AI SDK 的通用 message part 降低了跨模型传递历史消息的风险，但不能保证所有供应商都支持同一组工具、附件、reasoning 或 provider-specific metadata。因此 MVP 采用保守的 Thread 级模型归属：主线可以切换，新分支只继承且锁定。

## Goals / Non-Goals

**Goals:**

- 通过 Ark Coding Plan 专用的 OpenAI-compatible endpoint 调用文档列出的模型，并以 glm-5.2 跑通流式聊天。
- 把 `modelId` 作为 Thread 的持久化领域状态，使请求路由和 UI 展示始终以当前 Thread 为准。
- 主线提供可控模型选择器；新分支继承父 Thread 模型并禁用选择器。
- 兼容已有 localStorage 树数据，并在服务端拒绝伪造或过期的模型 id。
- 继续沿用现有计费机制，不让新增模型因为缺少价格配置被按 0 元处理。

**Non-Goals:**

- MVP 不允许分支独立切换模型，也不实现分支模型重置或批量迁移。
- 不为不同模型动态裁剪工具、附件或 message part；当前 Thread Chat 仍只发送现有的文本/artifact 上下文。
- 不实现自动 fallback、模型能力协商、跨模型兼容性矩阵或 provider-specific 消息回放。
- 不处理 Coding Plan 商业转售条款或正式商业化容量规划。
- 不修改普通单列聊天页现有的全局模型选择行为。

## Decisions

### D1：Ark 作为统一模型注册表中的独立 provider

`constants/model.ts` 增加 `ark` provider 和 Ark 文档列出的模型，每个条目继续使用全站唯一 `id`、展示信息与 `upstreamModel`。`lib/ai/ark.ts` 负责创建 `@ai-sdk/openai-compatible` provider，默认 Base URL 固定为 `https://ark.cn-beijing.volces.com/api/coding/v3`，只允许通过服务端 `ARK_CODING_API_KEY` 鉴权；可选的 `ARK_CODING_BASE_URL` 仅用于环境覆盖。

这样可以复用 AI SDK 7 已有的流式文本、reasoning、tool call 与 usage 转换，不引入新的 provider SDK，也不会误用 Ark 普通按量 API 的 `/api/v3` endpoint。

弃选把 Ark 模型伪装成现有 MiniMax/DeepSeek provider：这会让密钥检查、endpoint 选择和计费来源变得含混，也无法保证请求确实走 Coding Plan。

### D2：模型归属 Thread，而不是消息或列组件

`Thread` 增加必填 `modelId`。根 Thread 创建时使用 `DEFAULT_MODEL_ID`；`fork` 创建子 Thread 时复制父 Thread 的 `modelId`；持久化加载时对缺失或已失效的值回填默认模型。模型选择只通过 store action 更新，UI 不维护第二份本地 model state。

模型放在 Thread 上可以让重载、分叉和请求重试都得到同一个选择结果，也符合“每列对应一个 Thread”的现有领域边界。

弃选消息级模型归属：它更适合审计历史，但不能直接决定下一次请求用哪个模型，并会让 MVP 的切换规则和持久化迁移复杂化。消息级 provenance 可在后续版本单独增加。

### D3：主线可切换，分支继承并永久锁定

根 Thread（`parentId === null`）的 selector 在空闲时可用；任何分支 Thread 的 selector 都显示其继承模型但保持 disabled。顶层 `ModelSelector` 增加外部 `disabled` 入参，Thread Chat 以 `isBranch || isGenerating` 控制它，避免把禁用规则藏进通用组件。

主线切换后只影响后续请求，不重写历史消息。虽然这仍可能把旧模型生成的文本带给新模型，但当前上下文是 AI SDK 规范化后的文本/artifact，而不是供应商原始 message；MVP 接受这一受控风险。分支锁定则避免在更复杂的继承路径里继续放大模型组合数量。

弃选分支自由切换：它会立即引入能力不对称、历史工具调用兼容和回放失败等未验证路径，不符合本次“先验证模型效果”的范围。

### D4：请求按 Thread 即时读取 modelId，服务端严格校验

Thread Chat 的 request builder 每次发送都从当前 Thread 读取 `modelId` 并加入 `/api/chat` 请求体。服务端对缺失值使用默认模型以兼容旧客户端；对非字符串或不在注册表内的显式值返回 400，不再静默回退。合法但缺少 provider key 时继续返回清晰的配置错误。

即时读取而不是在 controller 创建时捕获，可以保证用户切换主线模型后下一次发送立即生效。

### D5：Ark 模型使用现有保守计费口径

`MODEL_COST` 为所有 Ark 模型配置非零的按量付费代理成本，继续遵循项目既有“官网 pay-as-you-go 标价作为订阅套餐的保守代理成本”决策。Coding Plan 实际月费摊销不进入即时扣费链路。

若某个模型没有可核实的独立按量价，不把它默认为免费；实施时应使用该模型官方对应按量模型的价格或明确的保守同档估值，并在常量旁注明来源/口径，待商业化前复核。

## Risks / Trade-offs

- **[AI SDK 通用消息不等于模型能力完全兼容]** → MVP 仅发送现有文本/artifact 上下文，分支禁止切换；未来引入工具、附件或多模态后再增加 capability filtering。
- **[主线切换仍会混合不同模型的文本历史]** → 文本历史通常可移植，切换只影响未来回复；后续可增加“切换模型时新建上下文”选项。
- **[Ark 文档模型上下线或别名变化]** → 注册表是唯一事实来源，服务端严格校验；更新模型只需改注册表与对应价格。
- **[Coding Plan 的 reasoning 消耗大量输出 token]** → 保留现有较高的 `MAX_OUTPUT_TOKENS`，验证不使用过小输出上限；UI 继续消费 AI SDK 标准流。
- **[订阅套餐的真实单位成本与代理成本不同]** → 沿用按量标价的保守计费口径，商业化前另行核验成本和条款。

## Migration Plan

1. 先部署代码与 `ARK_CODING_API_KEY` 环境变量；没有 Ark key 时现有非 Ark 模型仍可工作。
2. localStorage 树在读取时补齐 `modelId`，不做破坏性 schema 清空或一次性数据迁移。
3. 发布后用 glm-5.2 验证主线发送、切换、刷新持久化和分支继承/锁定。
4. 回滚时可移除 Ark 模型和 selector；旧树中多出的 `modelId` 字段会被旧代码忽略。

## Open Questions

- 正式商业化前，需要重新确认 Coding Plan 的使用条款、并发限制和 Ark 各模型的最新按量计价。
- 后续若开放分支独立模型，应先定义工具/附件/provider metadata 的能力协商，以及模型切换时是否截断或转换历史上下文。
