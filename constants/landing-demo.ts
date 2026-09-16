/**
 * landing-demo —— 首页剧本演示的全部静态数据与类型。
 *
 * 剧本是纯数据：分栏、消息、锚点、章节步骤都在这里声明，
 * components/landing/demo/ 里的引擎按步骤折叠出确定状态，不调模型、不写库。
 *
 * 消息正文用轻量标记书写：
 *   **粗体**           → <strong>
 *   [[anchorId|文字]]   → 可划选片段（点击/播放到对应步骤时高亮并展开分支）
 *   \n\n               → 段落分隔
 */

export type ScenarioId =
  | "prd"
  | "tech"
  | "marketing"
  | "research"
  | "learn-ai"
  | "learn-company"

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "anchor"; anchorId: string; text: string }

export interface DemoArtifact {
  id: string
  title: string
  kind: string
}

export interface DemoMessage {
  id: string
  role: "user" | "assistant"
  /** 段落数组；每段是 inline 节点数组 */
  blocks: InlineNode[][]
  /** 用户消息顶部的引用条（分支首问回显划选来源） */
  quote?: string
  /** 助手消息完成后附带的 Artifact 卡片 */
  artifact?: DemoArtifact
  /** 用户消息里已发送的 @ 引用胶囊 */
  capsules?: DemoArtifact[]
}

export interface DemoColumn {
  id: string
  depth: 0 | 1 | 2
  /** 列头标题 */
  title: string
  /** 列头副标题 */
  sub: string
  /** 面包屑分段，最后一段高亮 */
  crumb: string[]
  /** 从哪个锚点开出（分支列才有）；主线为 undefined */
  sourceAnchor?: string
  /** 「继承的上文」条数 */
  inheritedCount?: number
  messages: DemoMessage[]
}

export interface DemoStep {
  id: string
  /** 章节名，显示在步进器 */
  label: string
  /** 本步内容播完后停留时长（默认 900ms；末步表示停在结果的时长） */
  holdMs?: number
  /** 模拟光标目标（data-cursor-target）；undefined 保持上一位置，null 隐藏 */
  cursor?: string | null

  /* —— 步骤开始即生效 —— */
  addColumn?: string
  showMessages?: string[]
  /** 提交划选：锚点获得下划线 + 脚注（列也随之开） */
  selectAnchor?: string
  /** 正处于「划选中」的锚点：本步内按打字进度逐字高亮，划满后浮出提问气泡；
      带 selecting 的后续步骤（提问/提交）保持选中态，不带则清除 */
  selecting?: string
  scrollTo?: "start" | "end"
  pickArtifact?: DemoArtifact

  /* —— 打字揭示 —— */
  revealMessage?: string
  revealComposer?: string
  /** 在划选气泡输入框里打字（该步需同时带 selecting） */
  bubbleText?: string

  /* —— 揭示完成后生效 —— */
  sendComposer?: string
  openPicker?: boolean
}

export interface DemoScenario {
  id: ScenarioId
  /** 主标签名 */
  tab: string
  /** 「专题学习」内的子标签名 */
  subTab?: string
  /** 标签行下方的剧本简介 */
  description: string
  /** 收尾一句话 */
  takeaway: string
  columns: DemoColumn[]
  steps: DemoStep[]
  /** @ 弹层列表项 */
  pickerItems?: DemoArtifact[]
}

/* ── 轻量正文解析 ── */

const INLINE_RE = /\*\*(.+?)\*\*|\[\[([a-z0-9-]+)\|(.+?)\]\]/g

/** 把一段标记文本解析成 inline 节点数组。 */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index ?? 0
    if (i > last) nodes.push({ kind: "text", text: text.slice(last, i) })
    if (m[1] !== undefined) nodes.push({ kind: "strong", text: m[1] })
    else nodes.push({ kind: "anchor", anchorId: m[2]!, text: m[3]! })
    last = i + m[0].length
  }
  if (last < text.length) nodes.push({ kind: "text", text: text.slice(last) })
  return nodes
}

/** 消息的纯文本长度（打字揭示的总量）。 */
export function messageTextLength(msg: DemoMessage): number {
  let n = 0
  for (const block of msg.blocks)
    for (const node of block) n += node.text.length
  return n
}

function msg(
  id: string,
  role: "user" | "assistant",
  text: string,
  extra?: Partial<DemoMessage>,
): DemoMessage {
  return {
    id,
    role,
    blocks: text.split("\n\n").map(parseInline),
    ...extra,
  }
}

/* ═══════════ A. 写 PRD ═══════════ */

const prd: DemoScenario = {
  id: "prd",
  tab: "写 PRD",
  description:
    "从用户为什么需要分叉，到交互规则，再到容易遗漏的边界。",
  takeaway: "把需求写清楚，也把边界问清楚。",
  columns: [
    {
      id: "main",
      depth: 0,
      title: "主线",
      sub: "设计 ThreadChat 的分叉功能",
      crumb: ["主线"],
      messages: [
        msg("m-u1", "user", "设计 ThreadChat 的分叉功能，明确用户流程、功能规则和验收标准。"),
        msg(
          "m-a1",
          "assistant",
          "可以把分叉拆成三层来定义。\n\n**用户流程**：阅读回复时划选任意片段，在弹出的气泡里确认问题，右侧随即开出一条新的分支列。\n\n**功能规则**：分支[[a-ctx|继承创建时的上下文]]，带着已有背景继续讨论；创建之后独立发展，[[a-edit|不跟随主线的后续编辑]]。\n\n**验收标准**：任意片段可划选；分支列能看到来源；分支树里能看到层级与数量。",
        ),
      ],
    },
    {
      id: "b1",
      depth: 1,
      title: "继承哪些上下文",
      sub: "来自主线的分叉",
      crumb: ["主线", "继承哪些上下文"],
      sourceAnchor: "a-ctx",
      inheritedCount: 2,
      messages: [
        msg("b1-u1", "user", "分叉时，应该继承哪些上下文？", {
          quote: "继承创建时的上下文",
        }),
        msg(
          "b1-a1",
          "assistant",
          "建议只继承**创建那一刻主线已有的内容**：从第一条消息到锚点所在消息的全部对话、主线里已引用的 Artifact、以及会话标题。\n\n锚点之后的消息、其他分支的讨论，都不进入新分支——背景够用，又不会把无关讨论带进去。",
        ),
      ],
    },
    {
      id: "b2",
      depth: 1,
      title: "主线编辑的影响",
      sub: "来自主线的分叉",
      crumb: ["主线", "主线编辑的影响"],
      sourceAnchor: "a-edit",
      inheritedCount: 2,
      messages: [
        msg("b2-u1", "user", "如果主线后来被编辑，已经创建的分支应该跟着变化吗？", {
          quote: "不跟随主线的后续编辑",
        }),
        msg(
          "b2-a1",
          "assistant",
          "不应该。**分支在创建时冻结继承的背景**，之后独立发展。\n\n主线编辑产生的是主线自己的新版本；分支仍保留它被划选出来时的那段上文。两条讨论各自演进，互不改写。",
        ),
      ],
    },
  ],
  steps: [
    {
      id: "ask",
      label: "提出问题",
      cursor: "composer",
      revealComposer: "设计 ThreadChat 的分叉功能，明确用户流程、功能规则和验收标准。",
      sendComposer: "m-u1",
      holdMs: 700,
    },
    { id: "answer", label: "主线回答", revealMessage: "m-a1", holdMs: 1200 },
    {
      id: "select",
      label: "划选片段",
      selecting: "a-ctx",
      cursor: "anchor-a-ctx",
      holdMs: 700,
    },
    {
      id: "q1",
      label: "气泡提问",
      selecting: "a-ctx",
      bubbleText: "分叉时，应该继承哪些上下文？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open",
      label: "展开分支",
      selecting: "a-ctx",
      selectAnchor: "a-ctx",
      addColumn: "b1",
      showMessages: ["b1-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 1100,
    },
    { id: "b1-answer", label: "分支回答", revealMessage: "b1-a1", cursor: null, holdMs: 1200 },
    {
      id: "select2",
      label: "再次划选",
      selecting: "a-edit",
      scrollTo: "start",
      cursor: "anchor-a-edit",
      holdMs: 700,
    },
    {
      id: "q2",
      label: "气泡提问",
      selecting: "a-edit",
      bubbleText: "如果主线后来被编辑，已经创建的分支应该跟着变化吗？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open2",
      label: "再开分支",
      selecting: "a-edit",
      selectAnchor: "a-edit",
      addColumn: "b2",
      showMessages: ["b2-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 1000,
    },
    { id: "b2-answer", label: "得到答案", revealMessage: "b2-a1", cursor: null, holdMs: 2600 },
  ],
}

/* ═══════════ B. 技术方案 ═══════════ */

const tech: DemoScenario = {
  id: "tech",
  tab: "技术方案",
  description: "细节在分支里讨论清楚后，如何让主线继续用上这些结论？",
  takeaway: "深入讨论，再把需要的结论带回来。",
  pickerItems: [
    { id: "art-1", title: "分支结论：@Artifact 引用设计", kind: "Markdown · 引用细节" },
    { id: "art-2", title: "分叉功能 PRD 草案", kind: "Markdown · 主线" },
  ],
  columns: [
    {
      id: "main",
      depth: 0,
      title: "主线",
      sub: "让子分支的结论回到主线",
      crumb: ["主线"],
      messages: [
        msg("m-u1", "user", "如何让子分支讨论出的结论，回到主线继续使用？"),
        msg(
          "m-a1",
          "assistant",
          "有三种典型做法，差别在**主动权在谁**。\n\n一是自动合并：把分支里所有消息塞回主线上下文——省事，但连中间的试错也一起带回去。\n\n二是手动复制：自己摘结论粘贴——可控，但丢了出处。\n\n三是[[t-art|把结论整理成 Artifact，再在主线用 @ 引用]]：带回的是被挑选过的结论，不是整段讨论。\n\n建议走第三种：引用是你的主动选择，主线只接收被确认的结论。",
        ),
        msg("m-u2", "user", "请基于这份结论，继续完善主线方案。", {
          capsules: [
            { id: "art-1", title: "分支结论：@Artifact 引用设计", kind: "markdown" },
          ],
        }),
        msg(
          "m-a2",
          "assistant",
          "已读取《分支结论：@Artifact 引用设计》。按这份结论，主线方案更新为：\n\n**消息侧**：用户消息只携带 artifactId 引用标记，服务端在组装上下文时解析成完整内容。\n\n**展示侧**：引用在消息里渲染为胶囊，点击可回看 Artifact 原文与来源分支。\n\n**边界**：引用由你逐条选择，分支不做自动合并；后续 Artifact 更新版本时，主线按引用时的版本展示。",
        ),
      ],
    },
    {
      id: "b1",
      depth: 1,
      title: "结论怎么回流",
      sub: "来自主线的分叉",
      crumb: ["主线", "结论怎么回流"],
      sourceAnchor: "t-art",
      inheritedCount: 2,
      messages: [
        msg("b1-u1", "user", "把结论整理成 Artifact，再在主线用 @ 引用，应该怎么设计？", {
          quote: "把结论整理成 Artifact，再在主线用 @ 引用",
        }),
        msg(
          "b1-a1",
          "assistant",
          "分两步走。\n\n**第一步，沉淀**：分支讨论收敛后，把结论写成一份有标题、有正文的 Artifact，它自带出处和版本。\n\n**第二步，引用**：回到主线输入框敲 @，列出可引用的 Artifact；选中后变成一个[[t-ref|引用胶囊]]，随下一条问题一起发送。",
        ),
      ],
    },
    {
      id: "b2",
      depth: 2,
      title: "引用传什么",
      sub: "来自「结论怎么回流」",
      crumb: ["主线", "结论怎么回流", "引用传什么"],
      sourceAnchor: "t-ref",
      inheritedCount: 2,
      messages: [
        msg("b2-u1", "user", "引用时传完整内容还是引用标记？已经在上下文中的内容，需要重复传吗？", {
          quote: "引用胶囊",
        }),
        msg(
          "b2-a1",
          "assistant",
          "传**引用标记**。用户消息里只保留一个 artifactId，由服务端在组装上下文时解析出完整内容——消息体积始终是轻量的。\n\n重复引用的处理属于服务端预算策略，方案里先约定接口：消息只认引用标记，注入与去重由服务端负责。\n\n结论我先整理成一份 Artifact，你可以直接在主线 @ 它。",
          {
            artifact: {
              id: "art-1",
              title: "分支结论：@Artifact 引用设计",
              kind: "Markdown",
            },
          },
        ),
      ],
    },
  ],
  steps: [
    {
      id: "ask",
      label: "提出问题",
      cursor: "composer",
      revealComposer: "如何让子分支讨论出的结论，回到主线继续使用？",
      sendComposer: "m-u1",
      holdMs: 700,
    },
    { id: "answer", label: "主线回答", revealMessage: "m-a1", holdMs: 1300 },
    {
      id: "select",
      label: "划选片段",
      selecting: "t-art",
      cursor: "anchor-t-art",
      holdMs: 700,
    },
    {
      id: "q1",
      label: "气泡提问",
      selecting: "t-art",
      bubbleText: "把结论整理成 Artifact，再在主线用 @ 引用，应该怎么设计？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open",
      label: "展开分支",
      selecting: "t-art",
      selectAnchor: "t-art",
      addColumn: "b1",
      showMessages: ["b1-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 1100,
    },
    { id: "b1-answer", label: "分支讨论", revealMessage: "b1-a1", cursor: null, holdMs: 1100 },
    {
      id: "select2",
      label: "再次划选",
      selecting: "t-ref",
      cursor: "anchor-t-ref",
      holdMs: 700,
    },
    {
      id: "q2",
      label: "气泡提问",
      selecting: "t-ref",
      bubbleText: "引用时传完整内容还是引用标记？已经在上下文中的内容，需要重复传吗？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open2",
      label: "再追一层",
      selecting: "t-ref",
      selectAnchor: "t-ref",
      addColumn: "b2",
      showMessages: ["b2-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 900,
    },
    { id: "conclude", label: "形成结论", revealMessage: "b2-a1", cursor: null, holdMs: 1600 },
    {
      id: "back",
      label: "回到主线",
      scrollTo: "start",
      cursor: "composer",
      holdMs: 1400,
    },
    {
      id: "mention",
      label: "输入 @",
      revealComposer: "@",
      openPicker: true,
      cursor: "composer",
      holdMs: 1500,
    },
    {
      id: "pick",
      label: "选择结论",
      pickArtifact: { id: "art-1", title: "分支结论：@Artifact 引用设计", kind: "markdown" },
      revealComposer: "请基于这份结论，继续完善主线方案。",
      cursor: "picker-item-0",
      holdMs: 800,
    },
    { id: "send", label: "带着引用发送", sendComposer: "m-u2", cursor: "send", holdMs: 800 },
    { id: "continue", label: "主线继续", revealMessage: "m-a2", cursor: null, holdMs: 2800 },
  ],
}

/* ═══════════ C. 营销方案 ═══════════ */

const marketing: DemoScenario = {
  id: "marketing",
  tab: "营销方案",
  description: "从获客计划，追问到购买理由，再把理由变成可以展示的内容。",
  takeaway: "把一句卖点，追问成一个可以验证的理由。",
  columns: [
    {
      id: "main",
      depth: 0,
      title: "主线",
      sub: "制定首月获客方案",
      crumb: ["主线"],
      messages: [
        msg("m-u1", "user", "为 ThreadChat 制定首月获客方案。"),
        msg(
          "m-a1",
          "assistant",
          "首月的重点不是铺开，而是**找到最痛的一批人**。\n\n**先想清楚谁最需要**：经常做调研、写方案、学新知识，并且一次会话要追问很多细节的用户。动手之前必须先回答[[m-why|为什么他们已经有 AI 了还需要 ThreadChat]]。\n\n**再决定怎么触达**：产品社区、AI 工具导航、深度使用者的口碑；其中最关键的是一段[[m-demo|能让人 30 秒看懂价值的演示]]。",
        ),
      ],
    },
    {
      id: "b1",
      depth: 1,
      title: "购买理由",
      sub: "来自主线的分叉",
      crumb: ["主线", "购买理由"],
      sourceAnchor: "m-why",
      inheritedCount: 2,
      messages: [
        msg("b1-u1", "user", "用户已经在用 AI，为什么还需要 ThreadChat？", {
          quote: "为什么他们已经有 AI 了还需要 ThreadChat",
        }),
        msg(
          "b1-a1",
          "assistant",
          "因为主流 AI 都是**一条线的对话**：一段回答里冒出三个疑问，要么混在同一条对话里互相干扰，要么另开聊天丢失背景。\n\nThreadChat 让每段追问有自己的分栏，讨论完还能把结论带回主线——这是线性对话在结构上给不了的。\n\n这个理由要打动的人，正是被「追问把对话搅乱」反复折磨过的深度用户。",
        ),
      ],
    },
    {
      id: "b2",
      depth: 1,
      title: "30 秒演示",
      sub: "来自主线的分叉",
      crumb: ["主线", "30 秒演示"],
      sourceAnchor: "m-demo",
      inheritedCount: 2,
      messages: [
        msg("b2-u1", "user", "怎样用一段 30 秒演示，让用户看懂这个价值？", {
          quote: "能让人 30 秒看懂价值的演示",
        }),
        msg(
          "b2-a1",
          "assistant",
          "用一个真实任务演完整闭环，不要念功能清单：\n\n**0–10 秒**：提出一个写方案的问题，得到一段有料的回答。\n\n**10–20 秒**：划选回答里的一个短语，旁边开出分支继续问。\n\n**20–30 秒**：分支讨论收敛成结论，在主线 @ 引用回来。\n\n旁白只需要一句：「问题是会分叉的，AI 也应该会。」",
        ),
      ],
    },
  ],
  steps: [
    {
      id: "ask",
      label: "提出问题",
      cursor: "composer",
      revealComposer: "为 ThreadChat 制定首月获客方案。",
      sendComposer: "m-u1",
      holdMs: 700,
    },
    { id: "answer", label: "主线回答", revealMessage: "m-a1", holdMs: 1200 },
    {
      id: "select",
      label: "划选片段",
      selecting: "m-why",
      cursor: "anchor-m-why",
      holdMs: 700,
    },
    {
      id: "q1",
      label: "气泡提问",
      selecting: "m-why",
      bubbleText: "用户已经在用 AI，为什么还需要 ThreadChat？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open",
      label: "展开分支",
      selecting: "m-why",
      selectAnchor: "m-why",
      addColumn: "b1",
      showMessages: ["b1-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 1100,
    },
    { id: "b1-answer", label: "分支回答", revealMessage: "b1-a1", cursor: null, holdMs: 1200 },
    {
      id: "select2",
      label: "再次划选",
      selecting: "m-demo",
      scrollTo: "start",
      cursor: "anchor-m-demo",
      holdMs: 700,
    },
    {
      id: "q2",
      label: "气泡提问",
      selecting: "m-demo",
      bubbleText: "怎样用一段 30 秒演示，让用户看懂这个价值？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open2",
      label: "再开分支",
      selecting: "m-demo",
      selectAnchor: "m-demo",
      addColumn: "b2",
      showMessages: ["b2-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 1000,
    },
    { id: "b2-answer", label: "得到答案", revealMessage: "b2-a1", cursor: null, holdMs: 2600 },
  ],
}

/* ═══════════ D. 深度调研 ═══════════ */

const research: DemoScenario = {
  id: "research",
  tab: "深度调研",
  description: "沿着一个产品判断，继续检查功能、证据与差异。",
  takeaway: "看到一个判断，继续问：依据是什么？",
  columns: [
    {
      id: "main",
      depth: 0,
      title: "主线",
      sub: "分析 WorkBuddy 与同类产品",
      crumb: ["主线"],
      messages: [
        msg("m-u1", "user", "分析 WorkBuddy 的目标用户、核心能力，以及与同类产品的差异。"),
        msg(
          "m-a1",
          "assistant",
          "先把调研拆成三层，再下结论：**事实**（官方资料可查）、**推断**（由事实得出）、**待验证**（只有说法、还没有证据）。\n\n对 WorkBuddy 的初步判断是它想做的不只是问答，但[[r-diff|和普通 AI 聊天工具的核心区别]]要靠功能清单来确认；官网表述里[[r-verify|哪些有功能支撑、哪些仍待验证]]，也应该分开记录。",
        ),
      ],
    },
    {
      id: "b1",
      depth: 1,
      title: "核心区别",
      sub: "来自主线的分叉",
      crumb: ["主线", "核心区别"],
      sourceAnchor: "r-diff",
      inheritedCount: 2,
      messages: [
        msg("b1-u1", "user", "它和普通 AI 聊天工具的核心区别是什么？", {
          quote: "和普通 AI 聊天工具的核心区别",
        }),
        msg(
          "b1-a1",
          "assistant",
          "如果它强调的是「把事做完」而不只是「把天聊完」，那区别在于**产出物**：聊天工具交付的是一段文字回答，任务型产品交付的是一个完成的结果。\n\n注意，这目前只是**推断**——需要看它是否真的在产品内完成交付、能否追踪任务历史，才能写成结论。",
        ),
      ],
    },
    {
      id: "b2",
      depth: 1,
      title: "验证清单",
      sub: "来自主线的分叉",
      crumb: ["主线", "验证清单"],
      sourceAnchor: "r-verify",
      inheritedCount: 2,
      messages: [
        msg("b2-u1", "user", "哪些实际功能能证明这个区别？哪些表述还需要验证？", {
          quote: "哪些有功能支撑、哪些仍待验证",
        }),
        msg(
          "b2-a1",
          "assistant",
          "列一张清单去逐条核对官方资料：能否产出文件、有没有真实可用的集成、任务记录是否可回看、是否有可复现的演示。\n\n**没有功能页或文档佐证的表述，先标记为待验证，不写进结论。**广告语可以指出方向，但不能当作证据。",
        ),
      ],
    },
  ],
  steps: [
    {
      id: "ask",
      label: "提出问题",
      cursor: "composer",
      revealComposer: "分析 WorkBuddy 的目标用户、核心能力，以及与同类产品的差异。",
      sendComposer: "m-u1",
      holdMs: 700,
    },
    { id: "answer", label: "主线回答", revealMessage: "m-a1", holdMs: 1200 },
    {
      id: "select",
      label: "划选片段",
      selecting: "r-diff",
      cursor: "anchor-r-diff",
      holdMs: 700,
    },
    {
      id: "q1",
      label: "气泡提问",
      selecting: "r-diff",
      bubbleText: "它和普通 AI 聊天工具的核心区别是什么？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open",
      label: "展开分支",
      selecting: "r-diff",
      selectAnchor: "r-diff",
      addColumn: "b1",
      showMessages: ["b1-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 1100,
    },
    { id: "b1-answer", label: "分支回答", revealMessage: "b1-a1", cursor: null, holdMs: 1200 },
    {
      id: "select2",
      label: "再次划选",
      selecting: "r-verify",
      scrollTo: "start",
      cursor: "anchor-r-verify",
      holdMs: 700,
    },
    {
      id: "q2",
      label: "气泡提问",
      selecting: "r-verify",
      bubbleText: "哪些实际功能能证明这个区别？哪些表述还需要验证？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open2",
      label: "再开分支",
      selecting: "r-verify",
      selectAnchor: "r-verify",
      addColumn: "b2",
      showMessages: ["b2-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 1000,
    },
    { id: "b2-answer", label: "得到答案", revealMessage: "b2-a1", cursor: null, holdMs: 2600 },
  ],
}

/* ═══════════ E. 专题学习：自学 AI ═══════════ */

const learnAi: DemoScenario = {
  id: "learn-ai",
  tab: "专题学习",
  subTab: "自学 AI",
  description: "沿着学习路线，把每个没懂的概念逐个问明白。",
  takeaway: "把不懂的概念问明白，再回到你的学习路线。",
  columns: [
    {
      id: "main",
      depth: 0,
      title: "主线",
      sub: "零基础自学 AI 的路线",
      crumb: ["主线"],
      messages: [
        msg("m-u1", "user", "零基础如何自学 AI？帮我梳理一条学习路线。"),
        msg(
          "m-a1",
          "assistant",
          "可以按「会用 → 懂原理 → 能动手」三层走。\n\n**第一层，会用**：每天用 AI 做一件真实的事，积累对它能力边界的直觉。\n\n**第二层，懂原理**：理解[[l-llm|大语言模型]]是怎么工作的，它是一切的底座。\n\n**第三层，能动手**：学一点 Python，跟着教程做一个小项目；再顺势了解 RAG、Agent、Embedding 这些常见概念。",
        ),
      ],
    },
    {
      id: "b1",
      depth: 1,
      title: "大语言模型",
      sub: "来自主线的分叉",
      crumb: ["主线", "大语言模型"],
      sourceAnchor: "l-llm",
      inheritedCount: 2,
      messages: [
        msg("b1-u1", "user", "它是怎么理解和生成文字的？", {
          quote: "大语言模型",
        }),
        msg(
          "b1-a1",
          "assistant",
          "简单说两步：**先切分，再预测**。\n\n模型先把文字切成一个个[[l-token|Token]]（可以理解成「字块」），再把上文转成数字、算出下一个最可能的 Token；循环往复，就生成了一段话。\n\n它的「理解」和人的理解不是一回事，但对自学者来说，这个类比足够用了。",
        ),
      ],
    },
    {
      id: "b2",
      depth: 2,
      title: "Token 是什么",
      sub: "来自「大语言模型」",
      crumb: ["主线", "大语言模型", "Token 是什么"],
      sourceAnchor: "l-token",
      inheritedCount: 2,
      messages: [
        msg("b2-u1", "user", "它和一个字、一个词有什么区别？", {
          quote: "Token",
        }),
        msg(
          "b2-a1",
          "assistant",
          "Token **不固定等于**一个汉字或一个单词。常见词可能整个是一个 Token，生僻词会被拆开；英文里 unbelievable 也可能被切成 un、believe、able 几段。\n\n粗略记：**一个 Token 大约是半个词到一个词**。想了解精确切法，可以找在线的 Tokenizer 工具亲手试。\n\n概念清楚了，回到学习路线，可以用同样的方式继续了解 RAG、Agent、Embedding。",
        ),
      ],
    },
  ],
  steps: [
    {
      id: "ask",
      label: "提出问题",
      cursor: "composer",
      revealComposer: "零基础如何自学 AI？帮我梳理一条学习路线。",
      sendComposer: "m-u1",
      holdMs: 700,
    },
    { id: "answer", label: "主线回答", revealMessage: "m-a1", holdMs: 1200 },
    {
      id: "select",
      label: "划选片段",
      selecting: "l-llm",
      cursor: "anchor-l-llm",
      holdMs: 700,
    },
    {
      id: "q1",
      label: "气泡提问",
      selecting: "l-llm",
      bubbleText: "它是怎么理解和生成文字的？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open",
      label: "展开分支",
      selecting: "l-llm",
      selectAnchor: "l-llm",
      addColumn: "b1",
      showMessages: ["b1-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 1100,
    },
    { id: "b1-answer", label: "分支回答", revealMessage: "b1-a1", cursor: null, holdMs: 1200 },
    {
      id: "select2",
      label: "再次划选",
      selecting: "l-token",
      cursor: "anchor-l-token",
      holdMs: 700,
    },
    {
      id: "q2",
      label: "气泡提问",
      selecting: "l-token",
      bubbleText: "它和一个字、一个词有什么区别？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open2",
      label: "再追一层",
      selecting: "l-token",
      selectAnchor: "l-token",
      addColumn: "b2",
      showMessages: ["b2-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 900,
    },
    { id: "b2-answer", label: "得到答案", revealMessage: "b2-a1", cursor: null, holdMs: 2600 },
  ],
}

/* ═══════════ F. 专题学习：看懂上市公司 ═══════════ */

const learnCompany: DemoScenario = {
  id: "learn-company",
  tab: "专题学习",
  subTab: "看懂上市公司",
  description: "从三张报表入手，追问到「利润」和「现金」的差别。",
  takeaway: "把不懂的概念问明白，再回到你的学习路线。",
  columns: [
    {
      id: "main",
      depth: 0,
      title: "主线",
      sub: "零基础看懂一家上市公司",
      crumb: ["主线"],
      messages: [
        msg("m-u1", "user", "零基础如何学习看懂一家上市公司？"),
        msg(
          "m-a1",
          "assistant",
          "抓住三张报表和一个核心问题：这家公司靠什么赚钱，赚到的钱是不是真的到手了。\n\n入门顺序建议：先读**利润表**，弄清收入从哪来；再读**现金流量表**，分清[[c-cash|利润和现金流的差别]]——很多新手就栽在这里；最后看资产负债表，了解家底。\n\n不用急着记公式，先把「赚的钱 ≠ 到手的钱」这件事想明白。",
        ),
      ],
    },
    {
      id: "b1",
      depth: 1,
      title: "利润与现金流",
      sub: "来自主线的分叉",
      crumb: ["主线", "利润与现金流"],
      sourceAnchor: "c-cash",
      inheritedCount: 2,
      messages: [
        msg("b1-u1", "user", "利润和现金流有什么区别？", {
          quote: "利润和现金流的差别",
        }),
        msg(
          "b1-a1",
          "assistant",
          "利润是**按记账规则算出来该赚的钱**，现金流是**实际进出账户的钱**。\n\n货发出去了、确认收入，利润表里就已经记上一笔；但客户可能三个月后才付款——所以会出现[[c-gap|公司盈利，账上却没有足够现金]]的情况。\n\n看公司要两张表对着看：利润看的是能力，现金流看的是安全。",
        ),
      ],
    },
    {
      id: "b2",
      depth: 2,
      title: "盈利与现金",
      sub: "来自「利润与现金流」",
      crumb: ["主线", "利润与现金流", "盈利与现金"],
      sourceAnchor: "c-gap",
      inheritedCount: 2,
      messages: [
        msg("b2-u1", "user", "为什么公司盈利，却可能没有足够现金？", {
          quote: "公司盈利，账上却没有足够现金",
        }),
        msg(
          "b2-a1",
          "assistant",
          "三个常见原因：\n\n**赊销**——货发了、利润入账，钱还没回来；**压库存**——现金变成了仓库里的货；**回款慢**——账期越长，利润和现金的时间差越大。\n\n所以利润回答「能不能赚」，现金流回答「撑不撑得住」，两个问题要分开问。",
        ),
      ],
    },
  ],
  steps: [
    {
      id: "ask",
      label: "提出问题",
      cursor: "composer",
      revealComposer: "零基础如何学习看懂一家上市公司？",
      sendComposer: "m-u1",
      holdMs: 700,
    },
    { id: "answer", label: "主线回答", revealMessage: "m-a1", holdMs: 1200 },
    {
      id: "select",
      label: "划选片段",
      selecting: "c-cash",
      cursor: "anchor-c-cash",
      holdMs: 700,
    },
    {
      id: "q1",
      label: "气泡提问",
      selecting: "c-cash",
      bubbleText: "利润和现金流有什么区别？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open",
      label: "展开分支",
      selecting: "c-cash",
      selectAnchor: "c-cash",
      addColumn: "b1",
      showMessages: ["b1-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 1100,
    },
    { id: "b1-answer", label: "分支回答", revealMessage: "b1-a1", cursor: null, holdMs: 1200 },
    {
      id: "select2",
      label: "再次划选",
      selecting: "c-gap",
      cursor: "anchor-c-gap",
      holdMs: 700,
    },
    {
      id: "q2",
      label: "气泡提问",
      selecting: "c-gap",
      bubbleText: "为什么公司盈利，却可能没有足够现金？",
      cursor: "bubble-input",
      holdMs: 700,
    },
    {
      id: "open2",
      label: "再追一层",
      selecting: "c-gap",
      selectAnchor: "c-gap",
      addColumn: "b2",
      showMessages: ["b2-u1"],
      scrollTo: "end",
      cursor: "bubble-submit",
      holdMs: 900,
    },
    { id: "b2-answer", label: "得到答案", revealMessage: "b2-a1", cursor: null, holdMs: 2600 },
  ],
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  prd,
  tech,
  marketing,
  research,
  learnAi,
  learnCompany,
]

export const DEMO_TABS: { tab: string; scenarios: ScenarioId[] }[] = [
  { tab: "写 PRD", scenarios: ["prd"] },
  { tab: "技术方案", scenarios: ["tech"] },
  { tab: "营销方案", scenarios: ["marketing"] },
  { tab: "深度调研", scenarios: ["research"] },
  { tab: "专题学习", scenarios: ["learn-ai", "learn-company"] },
]

/* ── 查询辅助 ── */

export function findAnchor(scenario: DemoScenario, anchorId: string) {
  for (const col of scenario.columns)
    for (const m of col.messages)
      for (const block of m.blocks)
        for (const node of block)
          if (node.kind === "anchor" && node.anchorId === anchorId)
            return { columnId: col.id, message: m, text: node.text }
  return undefined
}

export function findMessage(scenario: DemoScenario, messageId: string) {
  for (const col of scenario.columns) {
    const m = col.messages.find((x) => x.id === messageId)
    if (m) return { columnId: col.id, message: m }
  }
  return undefined
}

/** 锚点 → 它展开的分支列 id（branch.sourceAnchor === anchorId）。 */
export function branchOfAnchor(scenario: DemoScenario, anchorId: string) {
  return scenario.columns.find((c) => c.sourceAnchor === anchorId)
}

/** 某列的直接子分支（列头「子分支」按钮导航目标）。
    以面包屑前缀判父子：子列 crumb = 父列 crumb + 子列标题。 */
export function childrenOf(scenario: DemoScenario, columnId: string) {
  const col = scenario.columns.find((c) => c.id === columnId)
  if (!col) return []
  return scenario.columns.filter(
    (c) =>
      c.id !== columnId &&
      c.crumb.length === col.crumb.length + 1 &&
      c.crumb.slice(0, -1).every((seg, i) => seg === col.crumb[i]),
  )
}

export function childCountOf(scenario: DemoScenario, columnId: string) {
  return childrenOf(scenario, columnId).length
}

/** 同层兄弟分支（同父、同深度、不同 id），供列头「⇄ 切换」轮换。 */
export function siblingsOf(scenario: DemoScenario, columnId: string) {
  const col = scenario.columns.find((c) => c.id === columnId)
  if (!col) return []
  return scenario.columns.filter(
    (c) =>
      c.id !== columnId &&
      c.crumb.length === col.crumb.length &&
      c.crumb.slice(0, -1).every((seg, i) => seg === col.crumb[i]),
  )
}
