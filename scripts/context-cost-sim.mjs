/**
 * thread-chat 上下文成本模拟器（docs/context-compression/01-调研报告.md 的数字来源）。
 *
 *   node --experimental-strip-types scripts/context-cost-sim.mjs
 *   CACHE_READ_RATIO=0.1 ASSISTANT_CHARS=1200 node --experimental-strip-types scripts/context-cost-sim.mjs
 *
 * 做什么：直接复用线上真实函数（collectInherited / serializeMessageForModel /
 * applyInheritedBudget / 真实 system 常量），在合成会话树上按真实交互顺序重放全部
 * 请求，统计每种「上下文装配策略」的输入 token、前缀缓存可命中量、摘要生成开销与
 * 折算成本。改了 prompt 装配或预算常量后重跑，即可看到成本结构的变化。
 *
 * 为什么用模拟而不是实测：thread-chat 的用量流水（usage_records）目前不带
 * treeId/threadId/depth，也不采集缓存命中 token，还原不出「每个叶子节点的成本」。
 * 补齐观测后应以线上真实分布替换这里的假设参数（见调研报告 P0-1）。
 *
 * 口径声明（重要）：
 * · 「命中%」是**理想上界**——假设前缀缓存全局共享、TTL 无限、逐字节相同即命中，
 *   且按方舟「缓存块 ≥1024 token」向下取整。真实命中率受 TTL / 供应商调度影响更低，
 *   报告里同时给出「无缓存¥」作为下界。
 * · token 数按字符数折算（中文 + Markdown 混排经验值），不是真实 tokenizer 结果。
 */

import { collectInherited } from "../app/thread-chat/core/selectors.ts"
import { serializeMessageForModel } from "../app/thread-chat/net/message-serialization.ts"
import {
  applyInheritedBudget,
  omittedNoticeText,
} from "../app/thread-chat/net/prompt-pure.ts"
import {
  INHERITED_CHAR_BUDGET,
  THREAD_CHAT_SYSTEM,
  THREAD_CHAT_BRANCH_PREFIX,
  THREAD_CHAT_BRANCH_SUFFIX,
} from "../constants/thread-chat.ts"

/* ---------------- 可调参数（全部可用同名环境变量覆盖） ---------------- */
const num = (name, fallback) => Number(process.env[name] ?? fallback)
const P = {
  charsPerToken: num("CHARS_PER_TOKEN", 1.5), // 中文 + Markdown 混排的经验换算
  userChars: num("USER_CHARS", 40),
  assistantChars: num("ASSISTANT_CHARS", 1800), // system 明确鼓励「讲透、不刻意压缩篇幅」
  artifactChars: num("ARTIFACT_CHARS", 4000),
  cacheBlockTokens: num("CACHE_BLOCK_TOKENS", 1024), // 方舟隐式缓存：缓存块最小 1024 token
  cacheReadRatio: num("CACHE_READ_RATIO", 0.2), // 命中部分的单价占比（方舟约 2 折）
  inputPerM: num("INPUT_PER_M", 10), // ¥/1M，取 constants/pricing.ts 的 ARK_CODING_MVP_COST
  outputPerM: num("OUTPUT_PER_M", 40),
  sealBlockMsgs: num("SEAL_BLOCK_MSGS", 4), // 封存块大小：每 4 条消息（2 轮）
  summaryChars: num("SUMMARY_CHARS", 300), // 单块封存摘要的长度
  artifactDigestChars: num("ARTIFACT_DIGEST_CHARS", 200), // Artifact 引用化后的占位长度
}
const tok = (chars) => Math.round(chars / P.charsPerToken)

/* ---------------- 合成会话树 ---------------- */
let seq = 0
const nid = (p) => `${p}-${++seq}`
const newState = () => ({
  threads: {
    main: {
      id: "main", modelId: "glm-5.2", parentId: null, depth: 0, title: "主线",
      anchorText: null, forkFromMsgId: null, footnote: null,
      children: [], messages: [], lastActive: 1,
    },
  },
  artifacts: {}, artifactOrder: [], recents: [], footnoteCounter: 0, seq: 1, tick: 1,
})

function addThread(state, parentId, anchorText, forkFromMsgId) {
  const parent = state.threads[parentId]
  const id = nid("t")
  state.threads[id] = {
    id, modelId: "glm-5.2", parentId, depth: parent.depth + 1,
    title: anchorText.slice(0, 8), anchorText, forkFromMsgId,
    footnote: ++state.footnoteCounter, children: [], messages: [], lastActive: 1,
  }
  parent.children.push(id)
  return id
}

const includable = (m, s) => m.status !== "error" && (m.role === "user" || s !== null)
const focusText = (t) =>
  `${THREAD_CHAT_BRANCH_PREFIX}「${t.anchorText}」。${THREAD_CHAT_BRANCH_SUFFIX}`
const artifactDigest = (a) =>
  `[Markdown Artifact: ${a.title}｜${a.content.length} 字，正文按需取回]${"要".repeat(P.artifactDigestChars)}`

/** 消息序列化；fullArtifact=false 时把 Artifact 正文降级为「标题 + 取回指引」 */
function serializeMsg(state, m, fullArtifact) {
  if (fullArtifact) return serializeMessageForModel(state, m)
  const body = m.quote?.text
    ? `就我划选的这段话：「${m.quote.text}」——${m.text}`
    : m.text
  const parts = body.trim() ? [body] : []
  for (const id of m.artifactIds ?? []) {
    const a = state.artifacts[id]
    if (a?.kind === "markdown") parts.push(artifactDigest(a))
  }
  return parts.join("\n\n").trim() || null
}

/* ---------------- 装配策略：返回 [{kind, text}]，数组顺序即 KV 前缀顺序 ---------------- */

/** A：线上现状（app/thread-chat/net/prompt.ts 的 buildRequestBody） */
function stratCurrent(state, thread, exclude) {
  const segs = [{
    kind: "system",
    text: thread.anchorText?.trim()
      ? `${THREAD_CHAT_SYSTEM}\n\n${focusText(thread)}`
      : THREAD_CHAT_SYSTEM,
  }]
  const inh = []
  for (const m of collectInherited(state, thread)) {
    const t = serializeMessageForModel(state, m)
    if (!includable(m, t) || t === null) continue
    inh.push({ role: m.role, text: t })
  }
  const { kept, omitted } = applyInheritedBudget(inh, (m) => m.text, INHERITED_CHAR_BUDGET)
  if (omitted > 0) segs.push({ kind: "inherited", text: `user:${omittedNoticeText(omitted)}` })
  for (const m of kept) segs.push({ kind: "inherited", text: `${m.role}:${m.text}` })
  for (const m of thread.messages) {
    if (m.id === exclude) continue
    const t = serializeMessageForModel(state, m)
    if (!includable(m, t) || t === null) continue
    segs.push({ kind: "current", text: `${m.role}:${t}` })
  }
  return { segs, summaryCalls: [] }
}

/** O：对照组——继承段完全不截断 */
function stratNoBudget(state, thread, exclude) {
  const segs = [{
    kind: "system",
    text: thread.anchorText?.trim()
      ? `${THREAD_CHAT_SYSTEM}\n\n${focusText(thread)}`
      : THREAD_CHAT_SYSTEM,
  }]
  for (const m of collectInherited(state, thread)) {
    const t = serializeMessageForModel(state, m)
    if (!includable(m, t) || t === null) continue
    segs.push({ kind: "inherited", text: `${m.role}:${t}` })
  }
  for (const m of thread.messages) {
    if (m.id === exclude) continue
    const t = serializeMessageForModel(state, m)
    if (!includable(m, t) || t === null) continue
    segs.push({ kind: "current", text: `${m.role}:${t}` })
  }
  return { segs, summaryCalls: [] }
}

/** 祖先链按消息序号切块：块边界只由序号决定 → 对所有后代确定，可逐字节共享 */
function ancestorBlocks(state, thread) {
  const chain = []
  let cur = thread
  while (cur.parentId) {
    const p = state.threads[cur.parentId]
    const i = p.messages.findIndex((m) => m.id === cur.forkFromMsgId)
    chain.unshift({ threadId: p.id, upto: i + 1 })
    cur = p
  }
  const blocks = []
  for (const { threadId, upto } of chain) {
    const msgs = state.threads[threadId].messages.slice(0, upto)
    for (let i = 0; i < msgs.length; i += P.sealBlockMsgs)
      blocks.push({ threadId, index: i / P.sealBlockMsgs, msgs: msgs.slice(i, i + P.sealBlockMsgs) })
  }
  return blocks
}

/**
 * C/D/E：确定性分段封存
 *   [通用 system][旧块封存摘要…][fork 点附近原文块…][焦点段][本会话（可选自封存）]
 * 摘要按 (threadId, blockIndex) 记账：全树只生成一次、所有后代与后续轮次复用同一份字节。
 */
function makeSealed({ keepRecent = 2, artifactRef = false, ownWindowTurns = 0 } = {}) {
  return (state, thread, exclude, ctx) => {
    const segs = [{ kind: "system", text: THREAD_CHAT_SYSTEM }]
    const calls = []
    const blocks = ancestorBlocks(state, thread)
    const sealUntil = Math.max(0, blocks.length - keepRecent)
    blocks.forEach((b, i) => {
      const key = `${b.threadId}#${b.index}`
      if (i < sealUntil) {
        if (!ctx.seals.has(key)) {
          const src = b.msgs.reduce((n, m) => n + (serializeMessageForModel(state, m)?.length ?? 0), 0)
          ctx.seals.set(key, "摘".repeat(P.summaryChars))
          calls.push({ inChars: src, outChars: P.summaryChars })
        }
        segs.push({ kind: "inherited", text: `user:[上文摘要 ${key}]${ctx.seals.get(key)}` })
      } else {
        for (const m of b.msgs) {
          const t = serializeMsg(state, m, !artifactRef)
          if (!includable(m, t) || t === null) continue
          segs.push({ kind: "inherited", text: `${m.role}:${t}` })
        }
      }
    })
    if (thread.anchorText?.trim()) segs.push({ kind: "focus", text: `user:${focusText(thread)}` })

    const own = thread.messages.filter((m) => m.id !== exclude)
    // 本会话同样按固定序号块封存：块边界不随轮次移动 → 摘要每块只生成一次、前缀稳定
    const ownBlock = P.sealBlockMsgs * 2
    let keepFrom = 0
    if (ownWindowTurns) {
      const sealed = Math.max(0, Math.floor((own.length - ownWindowTurns * 2) / ownBlock))
      keepFrom = sealed * ownBlock
      for (let b = 0; b < sealed; b++) {
        const key = `${thread.id}@own#${b}`
        if (!ctx.seals.has(key)) {
          const src = own.slice(b * ownBlock, (b + 1) * ownBlock)
            .reduce((n, m) => n + (serializeMessageForModel(state, m)?.length ?? 0), 0)
          ctx.seals.set(key, "摘".repeat(P.summaryChars))
          calls.push({ inChars: src, outChars: P.summaryChars })
        }
        segs.push({ kind: "current", text: `user:[本会话早前摘要 ${b}]${ctx.seals.get(key)}` })
      }
    }
    const lastArt = [...own].reverse().find((m) => (m.artifactIds ?? []).length)?.id
    own.slice(keepFrom).forEach((m) => {
      const t = serializeMsg(state, m, !artifactRef || m.id === lastArt)
      if (!includable(m, t) || t === null) return
      segs.push({ kind: "current", text: `${m.role}:${t}` })
    })
    return { segs, summaryCalls: calls }
  }
}

/** X：反面对照——每轮现场重算摘要（前缀每轮都变、摘要成本每轮都付） */
function makeNaiveRolling({ keepTurns = 3 } = {}) {
  let counter = 0
  return (state, thread, exclude) => {
    const segs = [{
      kind: "system",
      text: thread.anchorText?.trim()
        ? `${THREAD_CHAT_SYSTEM}\n\n${focusText(thread)}`
        : THREAD_CHAT_SYSTEM,
    }]
    const calls = []
    const inh = []
    for (const m of collectInherited(state, thread)) {
      const t = serializeMessageForModel(state, m)
      if (!includable(m, t) || t === null) continue
      inh.push({ role: m.role, text: t })
    }
    if (inh.length) {
      calls.push({ inChars: inh.reduce((n, m) => n + m.text.length, 0), outChars: P.summaryChars })
      segs.push({ kind: "inherited", text: `user:[继承上文摘要#${++counter}]${"摘".repeat(P.summaryChars)}` })
    }
    const own = thread.messages.filter((m) => m.id !== exclude)
    const keepFrom = Math.max(0, own.length - keepTurns * 2)
    if (keepFrom > 0) {
      const src = own.slice(0, keepFrom).reduce((n, m) => n + (serializeMessageForModel(state, m)?.length ?? 0), 0)
      calls.push({ inChars: src, outChars: P.summaryChars })
      segs.push({ kind: "current", text: `user:[本会话摘要#${++counter}]${"摘".repeat(P.summaryChars)}` })
    }
    own.slice(keepFrom).forEach((m) => {
      const t = serializeMessageForModel(state, m)
      if (!includable(m, t) || t === null) return
      segs.push({ kind: "current", text: `${m.role}:${t}` })
    })
    return { segs, summaryCalls: calls }
  }
}

/* ---------------- 重放引擎 ---------------- */
const lcp = (a, b) => {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

function replay(strategy, plan) {
  const state = newState()
  const ctx = { seals: new Map() }
  const seen = []
  const S = {
    requests: 0, input: 0, cached: 0, output: 0, sumIn: 0, sumOut: 0, calls: 0, peak: 0,
    bySeg: { system: 0, inherited: 0, focus: 0, current: 0 }, byDepth: {}, firstTurnMiss: 0,
  }
  const named = {}

  for (const step of plan) {
    if (step.fork) {
      const parentId = named[step.fork.parent] ?? step.fork.parent
      named[step.fork.as] = addThread(state, parentId, step.fork.anchor, named[step.fork.at])
      continue
    }
    const thread = state.threads[named[step.thread] ?? step.thread]
    const ph = nid("m")
    const u = { id: nid("m"), role: "user", text: "问".repeat(P.userChars), forks: [], status: "done" }
    if (step.quote) u.quote = { text: step.quote }
    thread.messages.push(u)

    const { segs, summaryCalls } = strategy(state, thread, ph, ctx)
    const key = segs.map((s) => s.text).join("\n")
    let best = 0
    for (const k of seen) best = Math.max(best, lcp(key, k))
    seen.push(key)

    const input = tok(key.length)
    const cached = Math.min(Math.floor(tok(best) / P.cacheBlockTokens) * P.cacheBlockTokens, input)
    S.requests++
    S.input += input
    S.cached += cached
    S.peak = Math.max(S.peak, input)
    S.byDepth[thread.depth] ??= { n: 0, input: 0, cached: 0 }
    S.byDepth[thread.depth].n++
    S.byDepth[thread.depth].input += input
    S.byDepth[thread.depth].cached += cached
    if (thread.messages.length === 1) S.firstTurnMiss += input - cached
    for (const s of segs) S.bySeg[s.kind] += tok(s.text.length)
    S.output += tok(P.assistantChars) + (step.artifact ? tok(P.artifactChars) : 0)
    for (const c of summaryCalls) {
      S.calls++
      S.sumIn += tok(c.inChars)
      S.sumOut += tok(c.outChars)
    }

    const a = { id: ph, role: "assistant", text: "答".repeat(P.assistantChars), forks: [], status: "done" }
    if (step.artifact) {
      const aid = nid("art")
      state.artifacts[aid] = {
        id: aid, title: "架构设计说明", kind: "markdown",
        content: "文".repeat(P.artifactChars), sourceThreadId: thread.id,
      }
      state.artifactOrder.push(aid)
      a.artifactIds = [aid]
    }
    thread.messages.push(a)
    if (step.as) named[step.as] = a.id
  }

  const billed = S.input - S.cached + S.cached * P.cacheReadRatio + S.sumIn
  const out = S.output + S.sumOut
  return {
    ...S,
    billed: Math.round(billed),
    inCost: (billed * P.inputPerM) / 1e6,
    outCost: (out * P.outputPerM) / 1e6,
    cost: (billed * P.inputPerM + out * P.outputPerM) / 1e6,
    costNoCache: ((S.input + S.sumIn) * P.inputPerM + out * P.outputPerM) / 1e6,
  }
}

/* ---------------- 场景 ---------------- */
function treePlan({ mainTurns = 6, branchTurns = 4, deepTurns = 3 } = {}) {
  const plan = []
  for (let i = 0; i < mainTurns; i++) plan.push({ thread: "main", artifact: i === 2, as: `main${i}` })
  const anchors = [1, 3, 5].filter((i) => i < mainTurns)
  const L1 = ["b1", "b2", "b3"].slice(0, anchors.length)
  L1.forEach((b, k) => {
    plan.push({ fork: { as: b, parent: "main", at: `main${anchors[k]}`, anchor: "被划选的关键概念片段" } })
    for (let i = 0; i < branchTurns; i++)
      plan.push({ thread: b, quote: i === 0 ? "被划选的关键概念片段" : null, as: `${b}m${i}` })
  })
  for (const c of ["c1", "c2"]) {
    plan.push({ fork: { as: c, parent: "b1", at: "b1m1", anchor: "二级分支的划选片段" } })
    for (let i = 0; i < deepTurns; i++)
      plan.push({ thread: c, quote: i === 0 ? "二级分支的划选片段" : null, as: `${c}m${i}` })
  }
  plan.push({ fork: { as: "d1", parent: "c1", at: "c1m0", anchor: "三级分支的划选片段" } })
  for (let i = 0; i < deepTurns; i++)
    plan.push({ thread: "d1", quote: i === 0 ? "三级分支的划选片段" : null })
  return plan
}

function widePlan() {
  const plan = []
  for (let i = 0; i < 8; i++) plan.push({ thread: "main", artifact: i === 3, as: `main${i}` })
  for (let k = 0; k < 12; k++) {
    const b = `w${k}`
    plan.push({ fork: { as: b, parent: "main", at: `main${k % 8}`, anchor: "被划选的关键概念片段" } })
    for (let i = 0; i < 2; i++)
      plan.push({ thread: b, quote: i === 0 ? "被划选的关键概念片段" : null })
  }
  return plan
}

const variants = [
  ["O 对照：继承段不截断", stratNoBudget],
  ["A 现状：6000 字预算 + anchor 在 system", stratCurrent],
  ["C1 分段封存 keepRecent=2 + 焦点后移", makeSealed({ keepRecent: 2 })],
  ["C2 分段封存 keepRecent=1", makeSealed({ keepRecent: 1 })],
  ["D  C2 + Artifact 引用化", makeSealed({ keepRecent: 1, artifactRef: true })],
  ["E  D + 本会话确定性封存(保 4 轮)", makeSealed({ keepRecent: 1, artifactRef: true, ownWindowTurns: 4 })],
  ["X 反面：每轮现场重算摘要", makeNaiveRolling({ keepTurns: 3 })],
]

const w = (s, n) =>
  s + " ".repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)))

function table(title, plan) {
  console.log(`\n### ${title}`)
  console.log(w("策略", 40), w("输入tok", 9), w("命中%", 7), w("摘要tok", 8), w("计费输入", 9),
    w("输入¥", 8), w("输出¥", 8), w("合计¥", 8), w("无缓存¥", 8), "峰值tok")
  let current = null
  for (const [label, strat] of variants) {
    const r = replay(strat, plan)
    if (label.startsWith("A")) current = r
    console.log(
      w(label, 40), w(r.input.toLocaleString(), 9),
      w(((r.cached / r.input) * 100).toFixed(0) + "%", 7),
      w(String(r.sumIn + r.sumOut), 8), w(r.billed.toLocaleString(), 9),
      w("¥" + r.inCost.toFixed(3), 8), w("¥" + r.outCost.toFixed(3), 8),
      w("¥" + r.cost.toFixed(3), 8), w("¥" + r.costNoCache.toFixed(3), 8),
      r.peak.toLocaleString()
    )
  }
  const a = current
  console.log(`  · 现状分段：system ${a.bySeg.system.toLocaleString()} tok｜继承段 ${a.bySeg.inherited.toLocaleString()} tok｜本会话 ${a.bySeg.current.toLocaleString()} tok`)
  console.log(`  · 现状：分支首轮未命中输入 ${a.firstTurnMiss.toLocaleString()} tok；输入成本占比 ${((a.inCost / a.cost) * 100).toFixed(0)}%`)
  console.log("  · 现状按深度的平均单请求输入：" + Object.keys(a.byDepth).sort()
    .map((d) => `depth${d} ${Math.round(a.byDepth[d].input / a.byDepth[d].n).toLocaleString()} tok(${a.byDepth[d].n} 次)`)
    .join("｜"))
}

console.log(
  `参数：${P.charsPerToken} 字/token｜回答 ${P.assistantChars} 字｜Artifact ${P.artifactChars} 字｜` +
  `缓存块 ≥${P.cacheBlockTokens} tok，命中按 ${P.cacheReadRatio * 100}% 计价｜¥${P.inputPerM}/¥${P.outputPerM} 每 M token\n` +
  `system 通用段 ${THREAD_CHAT_SYSTEM.length} 字（≈${tok(THREAD_CHAT_SYSTEM.length)} tok）｜` +
  `分支焦点段 ${(THREAD_CHAT_BRANCH_PREFIX + THREAD_CHAT_BRANCH_SUFFIX).length} 字｜继承预算 ${INHERITED_CHAR_BUDGET} 字`
)

table("场景一：浅树（主线 6 轮 + 7 个分支 × 3~4 轮，27 次请求）", treePlan())
table("场景二：深用（主线 14 轮 + 7 个分支 × 8~10 轮，91 次请求）",
  treePlan({ mainTurns: 14, branchTurns: 10, deepTurns: 8 }))
table("场景三：宽树（主线 8 轮 + 12 个一级分支 × 2 轮，32 次请求）", widePlan())

console.log("\n### 单会话连续对话的输入增长（现状算法，主线）")
{
  const state = newState()
  let cum = 0
  for (let i = 1; i <= 20; i++) {
    const t = state.threads.main
    const ph = nid("m")
    t.messages.push({ id: nid("m"), role: "user", text: "问".repeat(P.userChars), forks: [], status: "done" })
    const { segs } = stratCurrent(state, t, ph)
    const n = tok(segs.map((s) => s.text).join("\n").length)
    cum += n
    if ([1, 5, 10, 15, 20].includes(i))
      console.log(`  第 ${String(i).padStart(2)} 轮：本轮 ${String(n).padStart(6)} tok｜累计 ${String(cum).padStart(7)} tok｜本轮输入成本 ¥${((n * P.inputPerM) / 1e6).toFixed(4)}`)
    t.messages.push({ id: ph, role: "assistant", text: "答".repeat(P.assistantChars), forks: [], status: "done" })
  }
}
