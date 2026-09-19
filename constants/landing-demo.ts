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
  /** 手动划选开出的列：来源原文（替代 sourceAnchor，不占用剧本脚注） */
  sourceText?: string
  /** 手动划选列的父列 id（决定插入位置与面包屑） */
  parentId?: string
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
          "可以把分叉拆成三层来定义：谁触发、带什么、怎么收场。\n\n**用户流程**：阅读回复时划选任意片段，在弹出的气泡里确认问题，点「带着问题开分支」，右侧随即开出一条新的分支列；讨论收敛后可以收起，也可以在里面继续追问。\n\n**功能规则**：分支[[a-ctx|继承创建时的上下文]]，带着已有背景继续讨论；创建之后独立发展，[[a-edit|不跟随主线的后续编辑]]。两条线互不打扰：主线照常推进，分支里哪怕问偏了也不污染主线。\n\n**边界情况**：同一段文字可以开出多条分支；分支里还能再划选，形成嵌套层级；锚点要记录它出自哪条消息、哪段文字，方便之后找回出处。\n\n**验收标准**：任意片段可划选；分支列能看到来源；分支树里能看到层级与数量；划选、开列、收起这三步在移动端也要走得通。",
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
          "建议只继承**创建那一刻主线已有的内容**，具体是三样东西：从第一条消息到锚点所在消息的全部对话、主线里已引用过的 Artifact、以及会话标题。\n\n不继承的同样要写清楚：锚点之后的消息、其他分支里的讨论、主线后来被编辑出的新版本，都不进入新分支。\n\n理由很简单——背景够用，又不会把无关讨论带进去。继承太多，分支一开始就是脏的；继承太少，AI 又得从头问起。\n\n还有一个值得写进 PRD 的取舍：如果锚点本身在分支里，继承的是那条分支自己的上文，而不是主线的——「继承父列」而不是「继承主线」，规则才是一致的。",
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
          "不应该。**分支在创建时冻结继承的背景**，之后独立发展。\n\n可以把它想成一次「快照」：分支拿到的是它被划选出来那一刻的上文，主线之后怎么改——补内容、删段落、换说法——都只影响主线自己的新版本，分支里的记录原样保留。\n\n反过来也成立：分支里讨论出的结论不会自动回写主线，想带回主线得由你主动用 @ 引用。\n\n两条讨论各自演进、互不改写，这正是「开分支」和「在一条对话里追问」的本质区别。",
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
          "有三种典型做法，差别在**主动权在谁**。\n\n一是自动合并：分支一收敛，就把它里面所有消息塞回主线上下文——省事，但连中间的试错、跑偏、半成品结论也一起带回去了，主线很快就会变脏。\n\n二是手动复制：自己把结论摘出来粘回主线——可控，但丢了出处，过两天再看就说不清这段结论是从哪条讨论里来的。\n\n三是[[t-art|把结论整理成 Artifact，再在主线用 @ 引用]]：带回主线的不是整段讨论，而是一份被挑选、确认过的结论，自带标题、出处和版本。\n\n建议走第三种：引用是你的主动选择，主线只接收被确认的结论；没被引用的分支内容，安静地留在原处就好。",
        ),
        msg("m-u2", "user", "请基于这份结论，继续完善主线方案。", {
          capsules: [
            { id: "art-1", title: "分支结论：@Artifact 引用设计", kind: "markdown" },
          ],
        }),
        msg(
          "m-a2",
          "assistant",
          "已读取《分支结论：@Artifact 引用设计》。按这份结论，主线方案更新为：\n\n**消息侧**：用户消息只携带 artifactId 引用标记，不携带正文；服务端在组装模型上下文时，把标记解析成 Artifact 的完整内容再注入。\n\n**展示侧**：引用在消息里渲染为胶囊，能看到标题和类型；点击可回看 Artifact 原文与来源分支，出处可追溯。\n\n**边界**：引用由你逐条选择，分支不做自动合并；Artifact 之后若更新版本，主线里已发送的引用仍按发送时的版本展示，避免历史对话「被改写」。\n\n**待办**：引用标记的协议字段需要和后端确认；多条 Artifact 同时引用时的注入顺序，也要在实现前定下来。",
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
          "分两步走：**先沉淀，再引用**。\n\n**第一步，沉淀**：分支讨论收敛后，把结论写成一份有标题、有正文的 Artifact。它不只是文本——自带出处（从哪条分支来）、创建时间和版本，之后再改会累加版本而不是覆盖。\n\n**第二步，引用**：回到主线输入框敲 @，列出可引用的 Artifact；选中后在输入框里变成一个[[t-ref|引用胶囊]]，随下一条问题一起发送。\n\n关键设计点是「引用」而不是「复制」：主线拿到的是指向这份结论的标记，想溯源随时能点回去，看它是从哪条分支讨论出来的。",
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
          "传**引用标记**，不传正文。用户消息里只保留一个 artifactId，由服务端在组装上下文时解析出 Artifact 的完整内容注入——消息体积始终是轻量的，大段正文也不会弄脏历史记录。\n\n至于「已在上下文里的内容要不要重复传」，属于服务端的预算策略：同一会话里已注入过的 Artifact 默认不重复注入，版本更新后才重新带入。方案里先约定接口边界——消息只认引用标记，注入、去重、版本选择由服务端统一负责。\n\n还有个小细节：引用胶囊要在消息气泡里同样可见，不然回看历史时不知道当时引用了什么。\n\n结论我先整理成一份 Artifact，你可以直接在主线 @ 它。",
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
          "首月的重点不是铺开，而是**找到最痛的一批人**。\n\n**先想清楚谁最需要**：经常做调研、写方案、学新知识，并且一次会话要追问很多细节的用户——他们被「一条线的对话」折磨最久。动手写文案之前必须先回答[[m-why|为什么他们已经有 AI 了还需要 ThreadChat]]，这个理由不成立，后面所有动作都是空的。\n\n**再决定怎么触达**：产品社区、AI 工具导航、深度使用者的口碑推荐。预算有限就先不买量，把每一条自然渠道的反馈接住。\n\n**最要投入的一件事**：一段[[m-demo|能让人 30 秒看懂价值的演示]]——分叉这个卖点，说出来抽象，演出来一眼就懂。\n\n**第一周要盯的指标**：看完演示的用户里，有多少人真的划选了一次、开了一条分支。激活动作比注册数更能说明问题。",
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
          "因为主流 AI 都是**一条线的对话**，而真实的问题从来不是一条线的。\n\n一段回答里冒出三个疑问：全混在同一条对话里，话题互相干扰、上下文越来越杂；每条另开聊天，背景又丢得一干二净。两个选择都难受。\n\nThreadChat 换了一个结构：每段追问有自己的分栏，带着划选那一刻的上文，讨论完还能把结论带回主线——这是线性对话在结构上给不了的。\n\n这个理由要打动的人，正是被「追问把对话搅乱」反复折磨过的深度用户：他们不需要被说服 AI 有用，只需要看到「原来还能这样问」。",
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
          "用一个真实任务演完整闭环，不要念功能清单：\n\n**0–10 秒**：提出一个写方案的真实问题，得到一段有料的回答——先让观众建立「这是正常 AI 对话」的预期。\n\n**10–20 秒**：划选回答里的一个短语，旁边开出一条分支继续问。这是全片的转折点，划选到开列的动作要慢放给足。\n\n**20–30 秒**：分支讨论收敛成结论，在主线 @ 引用回来，镜头停在主线消息里的引用胶囊上收尾。\n\n旁白只需要一句：「问题是会分叉的，AI 也应该会。」别加第二句，信息密度已经够了。",
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
          "先把调研拆成三层，再下结论：**事实**（官方资料可查）、**推断**（由事实合理外推）、**待验证**（只有说法、还没有证据）。调研报告里这三层最好分开写，混在一起的结论经不起复核。\n\n对 WorkBuddy 的初步判断：它的目标用户像是「想把事直接办完」的办公人群，宣传重点也不在聊天体验，而在交付结果。\n\n但[[r-diff|和普通 AI 聊天工具的核心区别]]要靠功能清单来确认，不能只凭 Slogan；官网表述里[[r-verify|哪些有功能支撑、哪些仍待验证]]，也应该逐条分开记录。\n\n建议产出物就是一张表：每条能力一行，标注证据来源和置信度——别人复核的时候能直接对着查。",
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
          "如果它强调的是「把事做完」而不只是「把天聊完」，那区别在于**产出物**：聊天工具交付的是一段文字回答，任务型产品交付的是一个完成的结果——一份文档、一次执行、一条可回看的任务记录。\n\n顺着这个假设往下，还要回答几个子问题：任务能不能在对话之外被管理？有没有任务历史和状态？交付物是结构化文件，还是只是聊天文本？\n\n注意，这目前只是**推断**——需要看它是否真的在产品内完成交付、能否追踪任务历史，才能写成结论。把「可能是」写成「是」，是调研里最常见的翻车方式。",
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
          "列一张清单逐条核对官方资料，每项只标三态：**有证据 / 只有说法 / 明确没有**：\n\n**能否产出文件**——有没有导出、文档页、交付物预览；**有没有真实可用的集成**——集成列表是文档还是真接口；**任务记录是否可回看**——有没有任务历史、执行日志；**是否有可复现的演示**——视频、试用入口、Demo 环境。\n\n**没有功能页或文档佐证的表述，先标记为待验证，不写进结论。**广告语可以指出方向，但不能当作证据。\n\n核对完把清单附在结论后面，别人质疑时直接拿清单说话。",
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
          "可以按「会用 → 懂原理 → 能动手」三层走，别一上来就啃论文。\n\n**第一层，会用**：每天用 AI 做一件真实的事——改稿子、查资料、整理笔记都行。目标不是学知识，是积累对它能力边界的直觉：它擅长什么、什么时候会一本正经地胡说。\n\n**第二层，懂原理**：理解[[l-llm|大语言模型]]是怎么工作的，它是一切的底座。不用碰数学细节，先建立「预测下一个词」这个心智模型就够了。\n\n**第三层，能动手**：学一点 Python 基础语法，跟着教程做一个小项目——比如给自己做一个自动整理读书笔记的小工具；再顺势了解 RAG、Agent、Embedding 这些常见概念。\n\n节奏上建议三层并行而不是串行：用着用着自然会冒出「为什么会这样」的疑问，那时候回头看原理最快。",
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
          "简单说两步：**先切分，再预测**。\n\n模型先把文字切成一个个[[l-token|Token]]（可以理解成「字块」），每个 Token 被转成一串数字；然后基于上文所有 Token，算出下一个最可能出现的 Token 是哪一个；把结果接上，再算下一个——循环往复，就生成了一段话。\n\n所以它「写文章」的本质是**一次次续写概率最高的下一个字块**：它不是在数据库里找答案，而是在按统计规律续写——这也解释了它为什么会流畅地编造事实。\n\n它的「理解」和人的理解不是一回事，但对自学者来说，这个类比足够用了；等想抠细节，再去碰注意力机制那一层。",
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
          "Token **不固定等于**一个汉字或一个单词。常见词可能整个是一个 Token，生僻词会被拆开；英文里 unbelievable 也可能被切成 un、believe、able 几段；标点、空格、emoji 也都各占份额。\n\n粗略记：**一个 Token 大约是半个词到一个词**。中文里「人工智能」可能是两个 Token，「魑魅魍魉」则要拆成更多。\n\n想了解精确切法，可以找在线的 Tokenizer 工具亲手试——把常用的话贴进去看它怎么切，比看十篇文章都直观。\n\n概念清楚了，回到学习路线，可以用同样的方式继续了解 RAG、Agent、Embedding——遇到名词就开分支问，这就是这个演示在做的事。",
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
          "抓住三张报表和一个核心问题：这家公司靠什么赚钱，赚到的钱是不是真的到手了。\n\n入门顺序建议：先读**利润表**，弄清收入从哪来、毛利还剩多少；再读**现金流量表**，分清[[c-cash|利润和现金流的差别]]——很多新手就栽在这里，看利润漂亮就放心，结果公司账上没钱；最后看**资产负债表**，了解家底厚不厚、欠了多少债。\n\n读的时候不用记公式，先回答三个朴素的问题：生意模式是什么？一年赚多少？这些钱变成现金了吗？\n\n三张表能对上号之后，再看年报里的「管理层讨论与分析」章节——那是公司自己对这三张表的解释，往往藏着最多信息。",
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
          "利润是**按记账规则算出来该赚的钱**，现金流是**实际进出账户的钱**。\n\n举个例子就清楚了：货发出去了、确认收入，利润表里就已经记上一笔利润；但客户可能三个月后才付款——所以这三个月里，会出现[[c-gap|公司盈利，账上却没有足够现金]]的情况。反过来也成立：预收了客户的钱还没发货，现金先进账，利润却要等交付才算。\n\n所以看公司要两张表对着看：利润表回答「这门生意赚不赚钱」，现金流量表回答「这家公司活不活得下去」。\n\n长期利润好看、现金流却一直为负的公司，要么是模式本身有账期问题，要么值得多问一个为什么。",
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
          "三个常见原因，按危害从大到小排：\n\n**回款慢**——货发了、利润入账，客户却拖三个月、半年才付款，账期越长，利润和现金的时间差越大；**压库存**——钱变成了仓库里的货，账面资产在涨，可用的现金在降；**赊销扩张**——为了做收入放松收款条件，利润越长越快，现金越绷越紧。\n\n也要警惕反向的假象：现金猛增不一定是在赚钱，可能只是融到一笔钱或变卖了资产——现金流量表才要拆成经营、投资、筹资三栏看。\n\n一句话记：**利润回答「能不能赚」，现金流回答「撑不撑得住」**，两个问题要分开问。",
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
  return childrenOfColumns(scenario.columns, columnId)
}

/** 在任意列集合里找直接子分支（覆盖手动划选开出的列）。 */
export function childrenOfColumns(
  cols: readonly DemoColumn[],
  columnId: string,
) {
  const col = cols.find((c) => c.id === columnId)
  if (!col) return []
  return cols.filter(
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

/* ═══ 手动划选开出的列 ═══ */

/** 用户自由提问后的本地示例回答（不调用模型）。 */
export const MANUAL_BRANCH_REPLY =
  "这是首页演示里的本地示例回答：真实产品中，AI 会带着这段上文继续讨论你的问题。\n\n在真实产品里，这条分支会继承你划选位置之前的上文，用自己的分栏展开讨论，讨论出的结论还可以用 @ 引用带回主线。\n\n你可以继续在任意回答里划选新的片段，也可以点左侧带下划线的文字回到已经展开的分支。"

/** 构造用户手动划选开出的分支列。 */
export function makeManualColumn(
  id: string,
  parent: DemoColumn | undefined,
  quote: string,
  question: string,
): DemoColumn {
  const depth = Math.min((parent?.depth ?? 0) + 1, 2) as 0 | 1 | 2
  const title = question.trim()
    ? question.trim().replace(/\s+/g, " ").slice(0, 14)
    : "自由提问"
  return {
    id,
    depth,
    title,
    sub: "来自演示中的自由划选",
    crumb: [...(parent?.crumb ?? ["主线"]), title],
    sourceText: quote,
    parentId: parent?.id,
    inheritedCount: 2,
    messages: [
      msg(`${id}-u`, "user", question.trim() || "就这段内容继续讨论", {
        quote,
      }),
      msg(`${id}-a`, "assistant", MANUAL_BRANCH_REPLY),
    ],
  }
}
