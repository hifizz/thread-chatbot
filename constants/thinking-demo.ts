// 本地演示脚本，不代表真实模型输出或实际联网请求。
export type DemoMode = "reasoning" | "search" | "research"
export type DemoSource = { title: string; domain: string; url: string; note: string }
export type DemoStep = {
  title: string
  summary: string
  duration: number
  tool?: { kind: "search" | "read"; input: string; sourceIds: number[] }
}
export type DemoScenario = { label: string; description: string; prompt: string; steps: DemoStep[]; answer: string }
export const DEMO_TICK_MS = 100
export const DEMO_ANSWER_MS = 5000
export const DEMO_SOURCES: DemoSource[] = [
  { title: "流式呈现与渐进反馈", domain: "ai-sdk.dev", url: "https://ai-sdk.dev/docs/ai-sdk-ui/overview", note: "示例来源 · 用于演示流式回答的资料卡片。" },
  { title: "工具调用与多步骤任务", domain: "ai-sdk.dev", url: "https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling", note: "示例来源 · 展示搜索、读取和后续推理之间的关系。" },
  { title: "可折叠的任务过程", domain: "beautifului.dev", url: "https://www.beautifului.dev/", note: "示例来源 · 本页 ThinkingState 的视觉参考。" },
]
export const DEMO_SCENARIOS: Record<DemoMode, DemoScenario> = {
  reasoning: {
    label: "普通推理", description: "分析问题，逐步组织回答", prompt: "AI 回答需要等待时，怎样让用户更清楚它正在做什么？",
    steps: [
      { title: "理解问题", summary: "将等待体验分为三个部分：当前在做什么、已经完成什么，以及何时可以看到结果。", duration: 4000 },
      { title: "比较展示方式", summary: "短任务只需要轻量状态；长任务可以展开过程。已完成的步骤保留，避免用户反复寻找上下文。", duration: 5000 },
      { title: "检查建议的边界", summary: "进度应该来自实际发生的事件。无法预估耗时的任务，不展示虚构的完成百分比。", duration: 4000 },
    ],
    answer: "让等待变得可理解，比让加载动画更热闹更有帮助。\n\n短任务展示一句当前状态；长任务展开可折叠的过程，逐步补充已完成的工作。用户随时可以收起、查看详情或停止。\n\n回答开始生成后，将视觉重点交还给正文，过程仍可展开回看。",
  },
  search: {
    label: "联网搜索", description: "搜索资料，核对来源后回答", prompt: "帮我查一下，AI 产品通常怎样展示联网搜索的过程？",
    steps: [
      { title: "明确检索范围", summary: "先查找流式反馈与工具调用的资料，再查看可折叠过程的界面示例。", duration: 3000 },
      { title: "搜索相关资料", summary: "检索与问题直接相关的文档，保留可打开的原始来源。", duration: 5000, tool: { kind: "search", input: "AI 搜索体验 · 流式反馈 · 工具调用", sourceIds: [0, 1, 2] } },
      { title: "阅读并核对", summary: "区分搜索命中和实际读取。找到链接不等于已经验证链接中的内容。", duration: 5000, tool: { kind: "read", input: "ai-sdk.dev / 工具调用与多步骤任务", sourceIds: [1] } },
      { title: "整理可用结论", summary: "将查询、来源和回答连接起来；不把所有请求细节都塞进正文。", duration: 3000 },
    ],
    answer: "联网搜索可以展示成一段连贯的过程：明确问题 → 搜索 → 阅读 → 整理答案。\n\n搜索词放在工具卡片中，来源可点击查看；读取状态单独显示，让用户分清“找到”和“读过”。\n\n这是交互演示中的示例结论，来源卡片没有在本次演示中被实际抓取。",
  },
  research: {
    label: "深度研究", description: "规划、检索、复核与补充研究", prompt: "研究一下：我们应该如何设计 AI 的等待体验，让思考、搜索和反思连成一个完整过程？",
    steps: [
      { title: "制定研究计划", summary: "从即时反馈、工具透明度和结果呈现三个方向研究。先收集资料，再检查遗漏，最后整理建议。", duration: 4000 },
      { title: "检索第一批资料", summary: "优先查找流式交互和工具调用的文档，建立可追溯的资料列表。", duration: 5000, tool: { kind: "search", input: "AI 等待体验 · 流式输出 · 研究进度", sourceIds: [0, 1] } },
      { title: "阅读关键来源", summary: "阅读工具调用部分，检查思考与工具执行是否能交替展示。", duration: 5000, tool: { kind: "read", input: "ai-sdk.dev / 工具调用与多步骤任务", sourceIds: [1] } },
      { title: "复核与发现遗漏", summary: "现有材料覆盖了正常流程，还需要补充长时间等待、失败重试与用户主动停止的体验。", duration: 4000 },
      { title: "补充检索交互示例", summary: "围绕可折叠过程补充界面参考，并将新的工具调用放回当前研究上下文。", duration: 5000, tool: { kind: "search", input: "可折叠任务过程 · 工具状态 · 中断恢复", sourceIds: [2] } },
      { title: "综合研究结果", summary: "形成三个层级：一句当前状态、一条可展开的过程、独立的最终回答。把来源留在需要核查的地方。", duration: 4000 },
    ],
    answer: "让等待过程成为回答的一部分。\n\n建议用一条连续的过程时间线，把推理摘要、搜索、阅读和复核放在同一个上下文里。工具嵌在对应步骤下，用户不必在多个状态面板之间来回切换。\n\n默认展开正在进行的工作；完成后收起过程，把空间留给答案。保留来源入口，也保留失败和中断的真实状态。\n\n这份示例展示的是交互方向；正式接入时，每个步骤都应由模型或工具实际返回的事件驱动。",
  },
}
