## Context

ThreadChat 需要一种比 Mermaid 更适合产品用户流程、Agent workflow 和业务流程的可视化能力。V1 仅实现 User Flow，但必须从一开始避免把数据层与具体画图库绑定，否则后续替换 React Flow / ELK / Dagre / SVG / Canvas 时会牵动 Message 存储、历史数据、Tool DTO 和生成模型。

## Goals

- 用户通过自然语言直接请求生成流程图。
- 主模型只负责决定是否调用 Tool，不直接生成图形实现代码。
- 专用低成本模型输出稳定的 `FlowSpec`。
- `FlowSpec` 经过确定性校验后才可进入消息持久化和渲染。
- `FlowSpec` 是 ThreadChat 自有领域 IR，不携带任何具体 renderer/layout library 的实现字段。
- 替换画图库时，原则上只修改 Adapter / Renderer / Render Verify，不修改存储格式、Tool DTO、生成 prompt 或历史消息。

## Non-Goals

- V1 不做通用万能 diagram DSL。
- V1 不一次支持 Sankey / Network / Architecture 等图类型。
- 不生成或持久化 HTML / SVG。
- 不持久化第三方图库 schema。
- 不允许 renderer-specific position/style/layout options 进入 `FlowSpec`。
- 不实现无限 repair loop。

## Architecture

```text
User request
    ↓
Main chat model
    ↓ tool_call
GenerateVisualizationInput
    ↓
Low-cost visualization model
    ↓
FlowSpec (stable domain IR)
    ↓
Schema Verify
    ↓
Graph Verify
    ↓ fail → bounded Repair → Verify
    ↓ pass
DataVisualizationPart
    ↓
VisualizationBlock
    ↓
FlowRendererAdapter
    ↓
Library-specific graph/layout model
    ↓
Renderer
```

关键边界：

```text
Domain data      Layout/Library data       Rendering
FlowSpec      -> Adapter output          -> SVG/Canvas/React UI
```

只有左侧 `FlowSpec` 可以进入 Message 持久化。中间和右侧均为可替换实现细节。

## FlowSpec as Stable IR

V1 领域类型示例：

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

禁止进入 `FlowSpec` 的典型字段包括：

- `x` / `y` / `position`
- `sourceHandle` / `targetHandle`
- `className` / `style`
- `reactFlowNodeType`
- `dagreRank`
- `elkOptions`
- 任何具体 renderer/layout library 的内部 enum 或 options

如果未来确实需要用户显式保存手工布局，必须作为单独的可选 presentation/layout layer 设计，不得污染语义 IR。

## Tool DTO

主模型输入：

```ts
export interface GenerateVisualizationInput {
  kind: "user-flow";
  prompt: string;
  direction?: "LR" | "TB";
}
```

Tool 结果：

```ts
export interface GenerateVisualizationResult {
  visualization: {
    kind: "user-flow";
    spec: FlowSpec;
  };
  verification: {
    schema: "passed";
    graph: "passed";
    semantic: "passed" | "skipped";
  };
}
```

主模型永远不传第三方图库 nodes/edges，也不接触 layout 坐标。

## Message Storage

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

存储 `FlowSpec`，不存 renderer 输出。这使 Thread/Fork/Share/Snapshot 能继续沿用现有 Message 生命周期，并保证 renderer 更换不触发业务数据 migration。

## Verification

### Schema Verify

使用 Zod 保证：

- `version`、`direction`、nodes、edges、groups 结构合法。
- 节点和边数量有上限。
- enum、必填字段和字符串约束合法。

### Graph Verify

必须 deterministic，至少检查：

- node id 唯一。
- edge id 唯一。
- edge.from / edge.to 均引用存在的 node。
- group.nodeIds 均存在。
- 默认禁止 self-loop。
- 禁止完全重复 edge。

### Repair

Verify 失败后将 `FlowSpec + errors` 交给同一低成本模型修复。最多两次 repair，总 attempts ≤ 3。

### Render Verify

后续可加入，但它属于 renderer-specific 层。替换图库时允许替换 Render Verify 实现，不能反向修改领域 IR 以适配某个 renderer。

### Semantic Verify

后续按需增加，用原始用户需求 + FlowSpec 检查关键业务步骤是否遗漏。它不能替代 Schema / Graph Verify。

## Renderer Adapter

Renderer 必须通过 adapter 接受 `FlowSpec`：

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

Adapter 可以生成：

- positions
- handles
- renderer node types
- edge routing options
- layout configuration
- visual metadata

这些内容不得回写到 `FlowSpec` 或 Message part。

## Renderer Replacement Contract

当未来替换具体画图实现时：

允许修改：

- `FlowRendererAdapter`
- renderer component
- layout engine integration
- renderer-specific interaction details
- Render Verify

原则上不得修改：

- `FlowSpec` 的既有语义字段
- 已持久化 `data-visualization` part
- `GenerateVisualizationInput`
- 低成本模型的职责边界
- Schema Verify / Graph Verify 的领域语义
- 历史 Message 数据

如果新 renderer 缺少某个展示能力，应优先在 Adapter/Renderer 做降级，而不是给领域 IR 塞入第三方字段。

## Module Boundaries

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

## Testing Strategy

必须覆盖：

1. FlowSpec schema validation。
2. Graph verify 的非法引用、重复 ID、自环、非法 group。
3. repair 次数上限。
4. Message part 序列化/反序列化。
5. adapter contract：同一 FlowSpec 可被不同 adapter 转换，而无需改动 spec。
6. mock renderer replacement test：使用第二个 mock adapter 替换默认实现，确认 Tool、存储、历史数据和 domain tests 不需要修改。
7. UI：Preview / Source / Fit / Zoom / Reset 基础交互。

## Observability

建议记录：

- generation model
- first-pass success
- repair count
- final verify outcome
- generation latency
- token / cost
- renderer/layout failure（后续）

## Evolution

未来可将顶层演进为：

```ts
type VisualizationSpec =
  | UserFlowSpec
  | SankeySpec
  | NetworkSpec;
```

但每种 spec 都必须保持领域语义与具体图库解耦，不能把某个第三方 library schema 直接当作产品持久化格式。
