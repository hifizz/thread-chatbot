## Why

ThreadChat 已支持 Mermaid，但用户流程、产品流程和 Agent workflow 需要一种更适合产品语义、可长期演进且可替换渲染实现的结构化可视化能力。主聊天模型不应直接生成 SVG/HTML，也不应与具体图库 schema 绑定；生成结果需要由低成本专用模型生成、经过确定性校验后再进入消息与前端渲染链路。

## What Changes

- 新增 `generate_visualization` Tool，V1 仅支持 `user-flow`。
- 主模型只描述“要画什么”；Tool 内部使用固定低成本模型将自然语言转换为 `FlowSpec`。
- `FlowSpec` 被定义为 ThreadChat 自有、稳定、与具体图库无关的领域中间表示（IR）。
- 可视化数据作为 assistant message 的 `data-visualization` part 持久化；保存 `FlowSpec`，不保存 SVG、HTML 或第三方图库 schema。
- 生成结果必须经过 Zod Schema Verify 与 deterministic Graph Verify；失败时允许有限次数 repair，总 attempts 不超过 3。
- 前端通过 renderer adapter 将 `FlowSpec` 转换为具体 layout / renderer 所需结构；第三方库字段不得进入 `FlowSpec`、Tool DTO 或持久化格式。
- 前端复用现有 Mermaid 的 Preview / Source / Fit / Zoom / Reset 交互外壳，并新增 User Flow renderer。
- V1 不要求 LLM Semantic Verify；Render Verify 与 Semantic Verify 作为后续增强，但不得破坏 IR/Adapter 边界。
- 记录 generation / verify / repair 的基础观测指标，为后续比较低成本模型的成功率、延迟和成本提供依据。

## Capabilities

### New Capabilities

- `user-flow-visualization`: 定义自然语言生成 User Flow、稳定 FlowSpec IR、校验/repair、message part 持久化、可替换 renderer adapter、前端交互与演进兼容的行为契约。

### Modified Capabilities

无。

## Impact

- Agent：新增一个可被主模型调用的可视化 Tool，并新增独立的低成本模型路由配置。
- Message：新增 `data-visualization` typed part；不新增独立 visualization 业务表。
- 前端：新增 VisualizationBlock、Flow renderer 与 renderer adapter，尽量复用 Mermaid 的图表 shell/toolbar。
- 数据兼容：历史消息只依赖版本化 `FlowSpec`；替换 React Flow、ELK、Dagre、自研 SVG/Canvas 等实现时不得要求迁移业务消息数据。
- 架构约束：具体图库的 position、handle、style、node type、layout option 等实现字段只能存在于 Adapter/Renderer 内部。
