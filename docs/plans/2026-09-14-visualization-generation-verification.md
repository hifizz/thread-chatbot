# ThreadChat 可视化生成与校验方案

## 1. 目标

为 ThreadChat 增加一种类似 Mermaid 的可视化能力，第一阶段只支持用户流程图（User Flow）。用户只需要用自然语言表达“帮我画一下这个流程”，主对话模型负责判断是否需要可视化并调用专用 Tool；Tool 内部使用固定的低成本模型生成结构化 FlowSpec，经过确定性校验和有限次数 repair 后，再作为结构化 message part 返回前端渲染。

本方案的核心目标：

- 用户无需学习新的图表 DSL。
- 主模型不直接生成 SVG / HTML。
- 图表生成模型与用户当前聊天模型解耦，可独立使用低成本模型。
- 生成结果必须经过 verify 后才能渲染。
- 数据存储复用现有 Message parts，不新增独立 visualization 业务表。
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

用户不感知内部使用了专用模型和 verify。

最终 AI 回复中直接出现一个可交互流程图，交互与 Mermaid 保持一致：

- 图表 / 源码切换
- Fit
- Zoom Out
- Zoom In
- Reset

用户后续可以继续说：

> Fork 后应该先选择引用内容，再创建分支，帮我修改图。

主模型再次调用 `generate_visualization`，生成新的 FlowSpec。

## 3. 数据怎么存

V1 不新增 `visualizations` 表。

可视化作为 assistant message 中的一种结构化 data part 存储：

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

示例：

```json
{
  "role": "assistant",
  "parts": [
    {
      "type": "text",
      "text": "下面是对应的用户流程："
    },
    {
      "type": "data-visualization",
      "id": "viz_123",
      "visualization": {
        "kind": "user-flow",
        "spec": {
          "version": 1,
          "direction": "LR",
          "nodes": [],
          "edges": []
        }
      }
    }
  ]
}
```

存储原则：

- 存 `FlowSpec`，不存最终 SVG。
- FlowSpec 属于 Message，因此 Thread、Fork、Share、Snapshot 沿用现有 Message 生命周期。
- 前端重新渲染老消息时，根据当前 renderer 将 FlowSpec 转成 SVG / Canvas。
- 未来视觉样式升级不需要数据库 migration。

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
FlowSpec
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
FlowCanvas
```

## 5. 模块怎么分

V1 只拆必要模块，不做过度抽象。

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

- `types.ts`：FlowSpec 领域类型。
- `schema.ts`：Zod schema，既用于模型结构化输出，也用于 runtime validation。
- `generate-flow.ts`：调用固定低成本模型生成 FlowSpec；需要 repair 时也在这里处理。
- `verify-flow.ts`：确定性 graph validation。
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
```

职责：

- `VisualizationBlock`：识别 visualization kind，负责 Preview / Source 与容器层。
- `VisualizationToolbar`：复用 Mermaid 风格的 Fit / Zoom / Reset 操作。
- `FlowCanvas`：负责布局结果与画布渲染。
- `FlowNode`：节点视觉。
- `FlowEdge`：连接线视觉。

不要把 layout、数据和渲染混在同一个组件里。

## 6. 类型定义

V1 只定义 User Flow，不设计万能 DSL。

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

## 7. DTO 定义

### Tool Input DTO

主模型只描述“要画什么”，不直接传 nodes / edges：

```ts
export interface GenerateVisualizationInput {
  kind: "user-flow";
  prompt: string;
  direction?: "LR" | "TB";
}
```

### Tool Result DTO

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

## 8. Schema 校验

使用 Zod：

```ts
import { z } from "zod";

export const flowNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  kind: z
    .enum(["start", "end", "action", "decision", "screen", "system"])
    .optional(),
});

export const flowEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

export const flowGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  nodeIds: z.array(z.string()),
});

export const flowSpecSchema = z.object({
  version: z.literal(1),
  direction: z.enum(["LR", "TB"]),
  nodes: z.array(flowNodeSchema).min(1).max(50),
  edges: z.array(flowEdgeSchema).max(100),
  groups: z.array(flowGroupSchema).optional(),
});
```

Schema verify 负责：

- JSON / structured output 格式正确。
- 必需字段存在。
- enum 合法。
- 节点 / 边数量受控。

## 9. Graph Verify

Graph verify 必须是 deterministic，不依赖 LLM。

至少检查：

- node id 唯一。
- edge id 唯一。
- 每个 `edge.from` 都引用已存在 node。
- 每个 `edge.to` 都引用已存在 node。
- 默认禁止 self-loop。
- group 中的 nodeIds 必须存在。
- 避免完全重复 edge。

示例：

```ts
export function verifyFlowGraph(spec: FlowSpec) {
  const errors: string[] = [];
  const nodeIds = new Set(spec.nodes.map((node) => node.id));

  if (nodeIds.size !== spec.nodes.length) {
    errors.push("Duplicate node ids");
  }

  for (const edge of spec.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Unknown edge source: ${edge.from}`);
    }

    if (!nodeIds.has(edge.to)) {
      errors.push(`Unknown edge target: ${edge.to}`);
    }

    if (edge.from === edge.to) {
      errors.push(`Self loop is not allowed: ${edge.from}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

## 10. 模型生成

生成模型必须与用户当前聊天模型解耦。

例如：

```ts
const visualizationModel = getModel(VISUALIZATION_MODEL_ID);
```

配置层可以先固定一个低成本模型，后续再允许环境变量或 admin 模型配置覆盖。

生成逻辑：

```ts
export async function generateFlow(
  input: GenerateVisualizationInput,
): Promise<FlowSpec> {
  const result = await generateObject({
    model: visualizationModel,
    schema: flowSpecSchema,
    prompt: `
Generate a clear user flow diagram.

User request:
${input.prompt}

Rules:
- Keep the diagram concise.
- Prefer 5-15 nodes.
- Node IDs must be stable kebab-case identifiers.
- Decision nodes should represent actual branches.
- Do not invent unnecessary steps.
- Every edge must reference existing nodes.
- Direction: ${input.direction ?? "LR"}.
`,
  });

  return result.object;
}
```

模型生成的唯一职责是：自然语言 → FlowSpec。

它不输出：

- SVG
- HTML
- React
- Mermaid source

## 11. Repair 策略

如果 Graph Verify 失败，将当前 spec + errors 重新发给同一低成本模型 repair。

```ts
async function repairFlow({
  spec,
  errors,
}: {
  spec: FlowSpec;
  errors: string[];
}) {
  const result = await generateObject({
    model: visualizationModel,
    schema: flowSpecSchema,
    prompt: `
Repair this flow graph.

Graph:
${JSON.stringify(spec)}

Validation errors:
${errors.join("\n")}

Only fix the errors.
Do not unnecessarily rewrite the graph.
`,
  });

  return result.object;
}
```

最大尝试次数：

```ts
const MAX_ATTEMPTS = 3;
```

禁止无限 agent loop。

## 12. 核心 pipeline

```ts
export async function generateVerifiedFlow(
  input: GenerateVisualizationInput,
): Promise<GenerateVisualizationResult> {
  let spec = await generateFlow(input);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    flowSpecSchema.parse(spec);

    const verification = verifyFlowGraph(spec);

    if (verification.valid) {
      return {
        visualization: {
          kind: "user-flow",
          spec,
        },
        verification: {
          schema: "passed",
          graph: "passed",
          semantic: "skipped",
        },
      };
    }

    spec = await repairFlow({
      spec,
      errors: verification.errors,
    });
  }

  throw new Error("VISUALIZATION_GENERATION_FAILED");
}
```

## 13. Tool 注册

```ts
export const generateVisualizationTool = tool({
  description: `
Generate a verified visual diagram.
Use this tool when a diagram would make a process, user flow, or workflow easier to understand.
`,
  inputSchema: z.object({
    kind: z.literal("user-flow"),
    prompt: z.string().min(1),
    direction: z.enum(["LR", "TB"]).optional(),
  }),
  execute: async (input) => {
    return generateVerifiedFlow(input);
  },
});
```

加入现有 tool registry：

```ts
tools: {
  webSearch,
  webFetch,
  generate_visualization: generateVisualizationTool,
}
```

## 14. 前端渲染

`VisualizationBlock` 负责根据 kind 路由 renderer：

```tsx
function VisualizationBlock({ visualization }: Props) {
  switch (visualization.kind) {
    case "user-flow":
      return <FlowCanvas spec={visualization.spec} />;
  }
}
```

`FlowCanvas` 不自己实现布局算法，而是调用成熟 layout engine，再负责绘制：

```tsx
function FlowCanvas({ spec }: { spec: FlowSpec }) {
  const layout = useFlowLayout(spec);

  return (
    <FlowViewport>
      <svg>
        <FlowEdges edges={layout.edges} />
        <FlowNodes nodes={layout.nodes} />
      </svg>
    </FlowViewport>
  );
}
```

边界必须保持：

```text
FlowSpec 数据
    ≠
Graph Layout
    ≠
Renderer
```

## 15. 与 Mermaid 的关系

V1 不替代 Mermaid。

职责建议：

- Mermaid：sequence、ER、state、class、简单 flowchart。
- User Flow：产品用户流程、Agent workflow、业务流程。

前端可以逐步抽取 Mermaid 和 Flow 共用的 `DiagramShell` / `DiagramToolbar`：

```text
DiagramShell
├── DiagramToolbar
├── MermaidRenderer
└── FlowRenderer
```

先复用交互，不要求第一版一次性重构现有 Mermaid。

## 16. Verify 分阶段策略

### V1：必须实现

1. Schema Verify
2. Graph Verify
3. 最多两次 repair（总 attempts ≤ 3）

### V1.1：建议加入

Render Verify：使用最终生产 renderer / layout engine 检查：

- layout 是否成功。
- 是否出现节点明显重叠。
- 是否发生 clip / overflow。
- bounding box 是否异常。

### 后续：按需加入

Semantic Verify：把原始用户需求 + FlowSpec 发给低成本模型，检查流程是否遗漏关键分支。

Semantic Verify 不替代确定性校验，只补充“结构合法但业务语义错误”的情况。

## 17. Observability / Eval

建议记录完整 visualization generation trace：

```text
visualization.generate
├── generation
├── schema_verify
├── graph_verify
├── repair
├── render_verify      # 后续
├── semantic_verify    # 后续
└── final
```

关键指标：

- first-pass success rate
- repair success rate
- final failure rate
- attempts distribution
- generation latency P50 / P95
- 每张图平均 token / cost
- 不同 generator model 的通过率

这些指标用于后续决定是否继续使用低成本模型，以及是否需要按复杂度动态路由更强模型。

## 18. V1 明确不做

- 不设计通用万能 diagram DSL。
- 不生成或持久化 HTML。
- 不持久化 SVG。
- 不新增 visualization 独立数据库表。
- 不允许用户直接拖拽节点并持久化。
- 不自己实现 graph layout engine。
- 不一次支持 Sankey / Network / Architecture 等多种图。
- 不做无限 repair loop。
- 不要求每张图都走 LLM semantic verify。

## 19. 推荐实施顺序

1. 定义 `FlowSpec` + Zod schema。
2. 实现 `verifyFlowGraph`。
3. 实现固定低成本模型的 `generateFlow`。
4. 实现 repair + attempts 限制。
5. 注册 `generate_visualization` Tool。
6. 新增 `data-visualization` message part。
7. 实现 `VisualizationBlock` + `FlowCanvas`。
8. 复用 Mermaid 的 Preview / Source / Fit / Zoom / Reset UI。
9. 加入基础 trace / metrics。
10. 再评估 Render Verify 和 Semantic Verify。

## 20. 最终工程定义

ThreadChat 新增一种 `data-visualization` message part；主模型通过 `generate_visualization` Tool 将自然语言交给固定的低成本模型生成 `FlowSpec`，经过 schema + graph verification 和有限 repair 后返回；前端使用 FlowRenderer 渲染，并尽量复用现有 Mermaid 的预览 / 源码 / Fit / Zoom / Reset 外壳。

V1 只解决一件事：可靠地把自然语言用户流程转换成经过验证、可长期存储和重新渲染的结构化 FlowSpec。
