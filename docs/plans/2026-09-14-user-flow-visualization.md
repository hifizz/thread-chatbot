# ThreadChat 用户流程可视化功能方案

> 本分支用于后续实现完整功能，目标合入 `main`。当前提交先固化方案，不依赖 PR #143。

## 1. 目标

为 ThreadChat 增加一种类似 Mermaid 的用户流程图能力。用户只需要用自然语言表达“帮我画一下这个流程”，主对话模型负责判断是否需要可视化并调用专用 Tool；Tool 内部使用固定的低成本模型生成结构化 `FlowSpec`，经过确定性校验和有限次数 repair 后，再作为结构化 message part 返回前端渲染。

核心约束：

- 用户无需学习新的图表 DSL。
- 主模型不直接生成 SVG / HTML。
- 图表生成模型与用户当前聊天模型解耦，可独立使用低成本模型。
- 生成结果必须经过 verify 后才能渲染。
- 数据存储复用现有 Message parts，不新增独立 visualization 业务表。
- 前端尽量复用现有 Mermaid 的预览 / 源码 / Fit / Zoom / Reset 外壳。
- V1 只做 User Flow，不提前设计万能 Visualization DSL。
- `FlowSpec` 必须是 ThreadChat 自己稳定的领域中间表示（IR），不能绑定 React Flow、ELK、Dagre、SVG、Canvas 或其他具体图库的数据结构。
- 数据、布局、渲染、具体图库适配必须分层；以后替换画图库时，原则上只允许修改 Adapter / Renderer 层，不应影响消息存储、Tool DTO、历史数据和生成模型输出格式。

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

- 只存 `FlowSpec`，不存最终 SVG。
- 不存 React Flow nodes/edges、ELK graph、Dagre coordinates 等具体图库格式。
- `FlowSpec` 属于 Message，因此 Thread、Fork、Share、Snapshot 沿用现有 Message 生命周期。
- 前端重新渲染老消息时，根据当前 Adapter / Renderer 将 FlowSpec 转成具体图库输入，再渲染成 SVG / Canvas。
- 未来视觉样式升级或替换图库不需要数据库 migration。
- 如果未来 `FlowSpec` 本身需要升级，通过 `version` 做领域 schema 演进，而不是把图库版本泄露进持久化格式。

换句话说，数据库保存的是“这张图表达什么”，不是“某个图库如何画这张图”。

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
GenerateVisualizationResult
    ↓
assistant message data-visualization part
    ↓
VisualizationBlock
    ↓
Flow Renderer Adapter
    ↓
具体 Layout / Rendering Engine
    ↓
用户看到的流程图
```

这一层级必须长期保持：

```text
自然语言
  ↓
FlowSpec（稳定 IR）
  ↓
Renderer Adapter
  ↓
第三方图库 / Layout Engine
```

禁止改成：

```text
自然语言
  ↓
React Flow / ELK / Dagre 专用 schema
  ↓
直接持久化
```

## 5. 模块怎么分

### 后端

```text
lib/visualization/
├── types.ts
├── schema.ts
├── generate-flow.ts
├── verify-flow.ts
└── generate-visualization.ts

lib/ai/tools/
└── generate-visualization.ts
```

职责：

- `types.ts`：定义 ThreadChat 自己的 FlowSpec 领域 IR。
- `schema.ts`：Zod schema，既用于模型结构化输出，也用于 runtime validation。
- `generate-flow.ts`：调用固定低成本模型生成 FlowSpec；需要 repair 时也在这里处理。
- `verify-flow.ts`：只验证领域图结构，不依赖具体图库。
- `generate-visualization.ts`：串联 generate → verify → repair，并输出 Tool result。
- `lib/ai/tools/generate-visualization.ts`：向主模型注册 Tool。

### 前端

```text
components/visualization/
├── visualization-block.tsx
├── visualization-toolbar.tsx
├── flow-canvas.tsx
├── flow-node.tsx
└── flow-edge.tsx

lib/visualization/rendering/
├── types.ts
├── flow-renderer-adapter.ts
└── adapters/
    └── <implementation>.ts
```

职责：

- `VisualizationBlock`：识别 visualization kind，负责 Preview / Source 与容器层。
- `VisualizationToolbar`：复用 Mermaid 风格的 Fit / Zoom / Reset 操作。
- `FlowCanvas`：消费 renderer adapter 的统一输出，不直接理解第三方图库 schema。
- `FlowNode`：节点视觉。
- `FlowEdge`：连接线视觉。
- `flow-renderer-adapter.ts`：定义 FlowSpec → 当前图库输入 / layout result 的唯一适配边界。
- `adapters/<implementation>.ts`：React Flow、ELK、Dagre 或其他具体实现只能存在于这里及其直接 renderer 内部。

必须保持：

```text
领域数据
  ≠
布局
  ≠
渲染
  ≠
第三方图库 schema
```

## 6. FlowSpec：稳定领域 IR

`FlowSpec` 只描述流程的业务语义，不描述任何图库的实现细节。

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

### FlowSpec 中明确禁止出现的字段

除非未来它们成为产品层面的真正业务语义，否则以下类型字段不能进入 FlowSpec：

```ts
// ❌ renderer / layout implementation detail
x
y
position
width
height
handle
sourceHandle
targetHandle
className
style
reactFlowNodeType
dagreRank
elkOptions
```

原因：一旦这些字段进入持久化 FlowSpec，历史消息就会绑定当前图库，实现替换会演变成数据迁移和兼容问题。

### 正确的转换方向

例如未来采用 React Flow：

```ts
function toReactFlow(spec: FlowSpec): ReactFlowGraph {
  // FlowSpec -> React Flow specific nodes / edges
}
```

未来切换 ELK：

```ts
function toElkGraph(spec: FlowSpec): ElkGraph {
  // FlowSpec -> ELK specific graph
}
```

此时以下模块都不应该修改：

- Tool Input DTO
- Tool Result DTO
- FlowSpec 存储格式
- Message Part
- 低成本模型生成逻辑
- Schema Verify
- Graph Verify
- 历史数据

## 7. DTO 定义

主模型只描述“要画什么”，不直接传 nodes / edges，更不能传某个图库的专用 schema：

```ts
export interface GenerateVisualizationInput {
  kind: "user-flow";
  prompt: string;
  direction?: "LR" | "TB";
}
```

Tool 返回稳定领域数据：

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

V1 中 `semantic` 可以先固定为 `skipped`，等确定性 verify 跑稳定后再加入 LLM semantic verifier。

## 8. Schema Verify

使用 Zod 对 `FlowSpec` 做结构校验，限制节点和边数量，并校验枚举和必填字段。

```ts
export const flowSpecSchema = z.object({
  version: z.literal(1),
  direction: z.enum(["LR", "TB"]),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string().optional(),
      kind: z.enum(["start", "end", "action", "decision", "screen", "system"]).optional(),
    }),
  ).min(1).max(50),
  edges: z.array(
    z.object({
      id: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
      label: z.string().optional(),
    }),
  ).max(100),
  groups: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      nodeIds: z.array(z.string()),
    }),
  ).optional(),
});
```

Schema Verify 只验证领域 IR，不验证第三方图库 schema。

## 9. Graph Verify

Graph Verify 必须 deterministic，不依赖 LLM，也不依赖当前 renderer。至少检查：

- node id 唯一。
- edge id 唯一。
- 每个 `edge.from` / `edge.to` 都引用已存在 node。
- 默认禁止 self-loop。
- group 中的 nodeIds 必须存在。
- 避免完全重复 edge。

```ts
export function verifyFlowGraph(spec: FlowSpec) {
  const errors: string[] = [];
  const nodeIds = new Set(spec.nodes.map((node) => node.id));

  if (nodeIds.size !== spec.nodes.length) {
    errors.push("Duplicate node ids");
  }

  for (const edge of spec.edges) {
    if (!nodeIds.has(edge.from)) errors.push(`Unknown edge source: ${edge.from}`);
    if (!nodeIds.has(edge.to)) errors.push(`Unknown edge target: ${edge.to}`);
    if (edge.from === edge.to) errors.push(`Self loop is not allowed: ${edge.from}`);
  }

  return { valid: errors.length === 0, errors };
}
```

## 10. 低成本模型生成

生成模型必须与用户当前聊天模型解耦：

```ts
const visualizationModel = getModel(VISUALIZATION_MODEL_ID);
```

可以配置为 Luna 或其他低成本模型。

模型唯一职责是：

```text
自然语言 → ThreadChat FlowSpec
```

模型不能直接输出：

- SVG
- HTML
- React
- Mermaid source
- React Flow schema
- ELK graph
- Dagre layout data
- 任何第三方图库专用结构

这保证了生成模型也不会被具体 renderer 锁死。

## 11. Repair 策略

Graph Verify 失败后，把当前 spec + errors 重新发给同一个低成本模型修复。最多两次 repair，总 attempts ≤ 3，禁止无限 agent loop。

```ts
const MAX_ATTEMPTS = 3;
```

Repair 仍然只能返回 FlowSpec，不能返回图库专用数据。

## 12. Tool 注册

```ts
export const generateVisualizationTool = tool({
  description: `Generate a verified visual diagram. Use this tool when a diagram would make a process, user flow, or workflow easier to understand.`,
  inputSchema: z.object({
    kind: z.literal("user-flow"),
    prompt: z.string().min(1),
    direction: z.enum(["LR", "TB"]).optional(),
  }),
  execute: async (input) => generateVerifiedFlow(input),
});
```

加入现有 tool registry。

Tool 层完全不知道最终使用 React Flow、ELK、Dagre、SVG 还是其他实现。

## 13. Renderer Adapter 与可替换性

这是本需求从 V1 开始必须建立的架构边界。

### 目标

替换画图实现时，改动范围应收敛在：

```text
Flow Renderer Adapter
+
具体 renderer / layout integration
```

而不是修改整个可视化链路。

### Adapter 接口示意

不要求第一版严格照搬以下接口，但边界必须等价：

```ts
export interface FlowRendererAdapter<TRenderGraph> {
  toRenderGraph(spec: FlowSpec): TRenderGraph;
}
```

例如：

```ts
export const reactFlowAdapter: FlowRendererAdapter<ReactFlowGraph> = {
  toRenderGraph(spec) {
    return {
      nodes: spec.nodes.map(/* ... */),
      edges: spec.edges.map(/* ... */),
    };
  },
};
```

未来换成 ELK：

```ts
export const elkAdapter: FlowRendererAdapter<ElkGraph> = {
  toRenderGraph(spec) {
    return {
      id: "root",
      children: spec.nodes.map(/* ... */),
      edges: spec.edges.map(/* ... */),
    };
  },
};
```

### 替换图库时预期不改的模块

- Message 数据结构
- 数据库内容
- `FlowSpec`
- `GenerateVisualizationInput`
- `GenerateVisualizationResult`
- Tool registration
- Generator prompt contract
- Schema Verify
- Graph Verify
- 已有历史消息

### 替换图库时允许修改的模块

- `flow-renderer-adapter.ts`
- `adapters/<implementation>.ts`
- 当前图库相关 renderer component
- layout options
- viewport / zoom integration
- Render Verify 中与具体 renderer 有关的检查

这应该成为验收标准之一：如果替换 renderer 需要改 Tool、消息存储或迁移历史 FlowSpec，说明实现已经错误地把第三方图库 schema 泄露到了领域层。

## 14. 前端渲染

`VisualizationBlock` 根据 kind 路由 renderer：

```tsx
function VisualizationBlock({ visualization }: Props) {
  switch (visualization.kind) {
    case "user-flow":
      return <FlowCanvas spec={visualization.spec} />;
  }
}
```

`FlowCanvas` 不应该直接把 FlowSpec 当成某个图库的 native schema 使用，而是经过 Adapter：

```tsx
function FlowCanvas({ spec }: { spec: FlowSpec }) {
  const renderGraph = flowRendererAdapter.toRenderGraph(spec);

  return <CurrentFlowRenderer graph={renderGraph} />;
}
```

如果当前图库还需要独立布局阶段，则：

```text
FlowSpec
  ↓
Adapter
  ↓
Layout Engine
  ↓
Renderer
```

前端必须保持：

```text
FlowSpec 数据
  ≠
图库专用数据
  ≠
Layout Result
  ≠
最终 Renderer
```

## 15. 与 Mermaid 的关系

V1 不替代 Mermaid：

- Mermaid：sequence、ER、state、class、简单 flowchart。
- User Flow：产品用户流程、Agent workflow、业务流程。

前端可以逐步抽取 Mermaid 和 Flow 共用的 `DiagramShell` / `DiagramToolbar`，先复用交互，不要求第一版一次性重构现有 Mermaid。

Mermaid 仍然是 Mermaid 自己的 DSL；User Flow 使用 ThreadChat 自己的 FlowSpec IR。不要为了“统一”而强行把两者都塞进同一第三方图库 schema。

## 16. Verify 分阶段策略

### V1 必须实现

1. Schema Verify
2. Graph Verify
3. 最多两次 repair（总 attempts ≤ 3）

这些 verify 都针对稳定领域 FlowSpec，因此替换 renderer 不影响它们。

### V1.1 建议加入

Render Verify：使用最终生产 renderer / layout engine 检查 layout 是否成功、节点是否明显重叠、是否 clip / overflow、bounding box 是否异常。

Render Verify 是 renderer-specific，可以随着画图库替换一起更换，不应污染 FlowSpec schema。

### 后续按需加入

Semantic Verify：把原始用户需求 + FlowSpec 发给低成本模型，检查流程是否遗漏关键分支。Semantic Verify 不替代确定性校验，只补充“结构合法但业务语义错误”的情况。

Semantic Verify 只理解 FlowSpec，不理解具体图库 schema。

## 17. Observability / Eval

建议记录完整 trace：generation、schema verify、graph verify、repair，以及后续的 render verify / semantic verify。

关键指标：first-pass success rate、repair success rate、final failure rate、attempts distribution、P50/P95 latency、平均 token/cost、不同 generator model 的通过率。

如果未来替换 renderer，应额外比较：

- layout success rate
- overlap rate
- render failure rate
- P95 render latency
- 同一批 FlowSpec 在新旧 renderer 下的视觉验收结果

这样 renderer 替换可以作为独立技术决策评测，不影响 generator / domain 层指标。

## 18. V1 明确不做

- 不设计通用万能 diagram DSL。
- 不生成或持久化 HTML。
- 不持久化 SVG。
- 不持久化 React Flow / ELK / Dagre 等第三方图库 schema。
- 不在 FlowSpec 中存 x/y/position/style/handle 等 renderer implementation detail。
- 不新增 visualization 独立数据库表。
- 不允许用户直接拖拽节点并持久化；如果未来支持手工布局，需要单独设计“用户布局偏好”层，不能污染 FlowSpec 的业务语义。
- 不自己实现 graph layout engine。
- 不一次支持 Sankey / Network / Architecture 等多种图。
- 不做无限 repair loop。
- 不要求每张图都走 LLM semantic verify。

## 19. 推荐实施顺序

1. 定义稳定领域 `FlowSpec` + Zod schema，并明确禁止第三方图库字段。
2. 实现 `verifyFlowGraph`。
3. 定义 `FlowRendererAdapter` 边界。
4. 选择 V1 renderer / layout engine，并只在 Adapter 后接入。
5. 实现固定低成本模型的 `generateFlow`。
6. 实现 repair + attempts 限制。
7. 注册 `generate_visualization` Tool。
8. 新增 `data-visualization` message part，只持久化 FlowSpec。
9. 实现 `VisualizationBlock` + `FlowCanvas`。
10. 复用 Mermaid 的 Preview / Source / Fit / Zoom / Reset UI。
11. 加入基础 trace / metrics。
12. 再评估 Render Verify 和 Semantic Verify。
13. 用“替换一个 mock renderer 是否只改 Adapter 层”做一次架构验收，防止图库 schema 泄露到领域层。

## 20. 最终工程定义

ThreadChat 新增一种 `data-visualization` message part；主模型通过 `generate_visualization` Tool 将自然语言交给固定的低成本模型生成稳定领域 IR `FlowSpec`，经过 schema + graph verification 和有限 repair 后返回；前端通过 `FlowRendererAdapter` 把 FlowSpec 转换成当前画图库需要的数据，再由具体 renderer 渲染，并尽量复用现有 Mermaid 的预览 / 源码 / Fit / Zoom / Reset 外壳。

V1 只解决一件事：可靠地把自然语言用户流程转换成经过验证、可长期存储、可重新渲染、且不绑定任何具体画图库的结构化 FlowSpec。

从第一版开始，`FlowSpec` 就必须被视为 ThreadChat 的稳定领域协议，而画图库只是可替换实现细节。
