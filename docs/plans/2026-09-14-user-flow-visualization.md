# ThreadChat 用户流程可视化功能方案

> 本分支用于后续实现完整功能，目标合入 `main`。当前方案的权威跟踪与验收约束已迁移到 OpenSpec：`openspec/changes/add-user-flow-visualization/`。本文件保留为设计讨论摘要；若与 OpenSpec 冲突，以 OpenSpec 为准。

## 1. 目标

为 ThreadChat 增加一种类似 Mermaid 的用户流程图能力。用户只需要用自然语言表达“帮我画一下这个流程”，主对话模型负责判断是否需要可视化并调用专用 Tool；Tool 内部使用固定的低成本模型生成结构化 `FlowSpec`，经过确定性校验和有限次数 repair 后，再作为结构化 message part 返回前端渲染。

核心约束：

- 用户无需学习新的图表 DSL。
- 主模型不直接生成 SVG / HTML。
- 图表生成模型与用户当前聊天模型解耦，可独立使用低成本模型。
- 生成结果必须经过 verify 后才能渲染。
- 数据存储复用现有 Message parts，不新增独立 visualization 业务表。
- `FlowSpec` 是 ThreadChat 自有稳定领域 IR，只描述“图表达什么”，不得承载具体 renderer/layout library 的实现字段。
- 具体画图库通过 Adapter 消费 `FlowSpec`；替换画图实现时原则上只改 Adapter / Renderer / Render Verify，不改 Tool、持久化格式和历史数据。
- 前端尽量复用现有 Mermaid 的预览 / 源码 / Fit / Zoom / Reset 外壳。
- V1 只做 User Flow，不提前设计万能 Visualization DSL。

## 2. 用户怎么用

用户直接在 Thread 中说：

> 帮我画一下 ThreadChat 从首页到创建 Thread，再到 Fork 分支的用户流程。

主模型识别这是一个流程可视化请求，调用：

```ts
generate_visualization({
  kind: "user-flow",
  prompt: "ThreadChat 从首页开始，用户创建 Thread，发送问题，可以继续主线程或者 Fork 新分支。",
  direction: "LR",
});
```

用户不感知内部使用了专用模型和 verify。最终 AI 回复中直接出现一个可交互流程图，交互与 Mermaid 保持一致：图表 / 源码切换、Fit、Zoom Out、Zoom In、Reset。

用户后续可以继续说：

> Fork 后应该先选择引用内容，再创建分支，帮我修改图。

主模型再次调用 `generate_visualization`，生成新的 `FlowSpec`。

## 3. 数据怎么存

V1 不新增 `visualizations` 表。可视化作为 assistant message 中的一种结构化 data part 存储：

```ts
export type VisualizationPart = {
  type: "data-visualization";
  id: string;
  visualization: {
    kind: "user-flow";
    spec: FlowSpec;
  };
};
```

存储原则：

- 存 `FlowSpec`，不存最终 SVG。
- 不持久化 React Flow / ELK / Dagre 等第三方图库 schema。
- FlowSpec 属于 Message，因此 Thread、Fork、Share、Snapshot 沿用现有 Message 生命周期。
- 前端重新渲染老消息时，根据当前 renderer 将 FlowSpec 转成 SVG / Canvas。
- 未来视觉样式或画图库升级不需要数据库 migration。

## 4. 整体数据流

```text
用户自然语言
    ↓
ThreadChat 主模型
    ↓
tool_call: generate_visualization
    ↓
GenerateVisualizationInput
    ↓
低成本生成模型
    ↓
FlowSpec（稳定领域 IR）
    ↓
Schema Verify
    ↓
Graph Verify
    ↓
失败 → Repair → 再 Verify
    ↓
verified FlowSpec
    ↓
assistant message data-visualization part
    ↓
VisualizationBlock
    ↓
FlowRendererAdapter
    ↓
具体图库 / Layout Engine
```

## 5. 模块边界

```text
lib/visualization/
├── types.ts
├── schema.ts
├── generate-flow.ts
├── verify-flow.ts
├── generate-visualization.ts
└── renderer/
    ├── adapter.ts
    └── <implementation>-adapter.ts

lib/ai/tools/
└── generate-visualization.ts

components/visualization/
├── visualization-block.tsx
├── visualization-toolbar.tsx
├── flow-canvas.tsx
├── flow-node.tsx
└── flow-edge.tsx
```

必须保持：领域数据、图库布局数据、渲染三层分离。

## 6. FlowSpec 作为稳定 IR

```ts
export type FlowDirection = "LR" | "TB";

export type FlowNodeKind =
  | "start"
  | "end"
  | "action"
  | "decision"
  | "screen"
  | "system";

export interface FlowNode {
  id: string;
  label: string;
  description?: string;
  kind?: FlowNodeKind;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface FlowGroup {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface FlowSpec {
  version: 1;
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups?: FlowGroup[];
}
```

不得进入 `FlowSpec` 的典型字段：`x/y/position`、handle、style、renderer node type、Dagre rank、ELK options 等。若未来需要持久化手工布局，应作为独立 presentation/layout layer 设计。

## 7. Renderer Adapter

```ts
export interface FlowRendererAdapter<TGraph> {
  toGraph(spec: FlowSpec): TGraph;
}
```

例如：

```ts
toReactFlowGraph(spec)
toElkGraph(spec)
toDagreGraph(spec)
```

替换画图库时允许修改 Adapter、Renderer、Layout 和 Render Verify；原则上不得修改 `FlowSpec` 既有语义、Tool DTO、Message 持久化和历史数据。

## 8. DTO 与 Verify

主模型只描述“要画什么”，不直接传 nodes / edges：

```ts
export interface GenerateVisualizationInput {
  kind: "user-flow";
  prompt: string;
  direction?: "LR" | "TB";
}
```

V1 必须实现：

1. Zod Schema Verify。
2. renderer-independent Graph Verify。
3. 最多两次 repair，总 attempts ≤ 3。

后续可增加 Render Verify 和 Semantic Verify，但不得反向污染领域 IR。

## 9. 与 Mermaid 的关系

V1 不替代 Mermaid：

- Mermaid：sequence、ER、state、class、简单 flowchart。
- User Flow：产品用户流程、Agent workflow、业务流程。

前端可以逐步抽取 Mermaid 和 Flow 共用的 `DiagramShell` / `DiagramToolbar`，先复用交互，不要求第一版一次性重构现有 Mermaid。

## 10. OpenSpec

完整需求、场景、任务与验收标准见：

- `openspec/changes/add-user-flow-visualization/proposal.md`
- `openspec/changes/add-user-flow-visualization/design.md`
- `openspec/changes/add-user-flow-visualization/specs/user-flow-visualization/spec.md`
- `openspec/changes/add-user-flow-visualization/tasks.md`

后续实现进度以 `tasks.md` 为准；实现行为以 `spec.md` 的 SHALL/MUST 和 Scenario 为验收依据。
