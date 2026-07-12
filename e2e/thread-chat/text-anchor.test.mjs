/**
 * text-anchor 纯字符串层用例：验证锚点三层降级定位（position → exact → fuzzy）。
 * 只 import 纯字符串 API（不碰 DOM），可直接跑：
 *   node --experimental-strip-types e2e/thread-chat/text-anchor.test.mjs
 */
import {
  buildQuoteSelector,
  fuzzySubstring,
  locateOffsets,
  normalizeWhitespace,
} from "../../app/thread-chat/branching/text-anchor.ts"

let failed = 0
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`)
  if (!cond) failed = 1
}

/* 同一短语「量子纠缠」出现 3 次的源文本（位置动态计算） */
const text =
  "量子纠缠是量子力学的核心现象，量子纠缠让两个粒子彼此关联，量子纠缠违反贝尔不等式。"
const idx = [...text.matchAll(/量子纠缠/g)].map((m) => m.index)
ok(`前置：短语出现 3 次（位置 ${idx.join("/")}）`, idx.length === 3)

/* 1) position 命中：position 指向第 2 次出现，切片与 exact 等价 → strategy=position */
{
  const at = idx[1]
  const anchor = {
    quote: buildQuoteSelector(text, at, at + 4),
    position: { start: at, end: at + 4 },
  }
  const r = locateOffsets(text, anchor)
  ok(
    "position：直接命中第 2 次出现（strategy=position, score=1）",
    r !== null && r.strategy === "position" && r.start === at && r.score === 1
  )
}

/* 2) exact 多处命中 → prefix/suffix 上下文消歧：无 position，靠上下文选中第 3 次 */
{
  const at = idx[2]
  const anchor = {
    quote: buildQuoteSelector(text, at, at + 4), // prefix/suffix 采自第 3 次出现
    // 故意不给 position，强制走 exact 层
  }
  const r = locateOffsets(text, anchor)
  ok(
    "exact：多处命中经 prefix/suffix 消歧 → 选中第 3 次（strategy=exact）",
    r !== null && r.strategy === "exact" && r.start === idx[2]
  )
}

/* 3) fuzzy：原文被改几个字后 exact 搜不到，仍以 score≥阈值 命中正确区间 */
const longText =
  "纠缠态在被测量之前并不具有确定的取值，这一点是理解量子力学非定域性的关键所在。"
{
  // 把「确定」改成「明确」、「关键」改成「要点」：exact 搜不到，fuzzy 应命中原句区间
  const mutated =
    "纠缠态在被测量之前并不具有明确的取值，这一点是理解量子力学非定域性的要点所在"
  const anchor = { quote: { exact: mutated, prefix: "", suffix: "" } }
  const r = locateOffsets(longText, anchor)
  const slice = r ? longText.slice(r.start, r.end) : ""
  ok(
    `fuzzy：改字后仍命中（strategy=fuzzy, score=${r ? r.score.toFixed(3) : "null"} ≥ 0.7）`,
    r !== null && r.strategy === "fuzzy" && r.score >= 0.7
  )
  ok(
    "fuzzy：命中区间落在原句上（含未改动的稳定尾串）",
    slice.includes("这一点是理解量子力学")
  )
}

/* 4) 低于阈值判丢失：同一改字锚点，把阈值抬到 0.98 → score 达不到 → 返回 null */
{
  const mutated =
    "纠缠态在被测量之前并不具有明确的取值，这一点是理解量子力学非定域性的要点所在"
  const anchor = { quote: { exact: mutated, prefix: "", suffix: "" } }
  const r = locateOffsets(longText, anchor, { fuzzyThreshold: 0.98 })
  ok("阈值 0.98：改动超过容忍 → 判定丢失（返回 null）", r === null)
}

/* 5) 彻底无关的锚点：fuzzy 相似度很低 → 默认阈值下也判丢失 */
{
  const anchor = {
    quote: {
      exact: "这是一段与原文毫不相干的陌生句子内容",
      prefix: "",
      suffix: "",
    },
  }
  const r = locateOffsets(longText, anchor)
  ok("无关锚点：默认阈值下判定丢失（返回 null）", r === null)
}

/* 6) fuzzySubstring 直接单测：空白归一化后子串近似匹配 */
{
  const hay = normalizeWhitespace("alpha   beta gamma   delta")
  const m = fuzzySubstring(hay, "beta gama") // gamma 少一个 m
  ok(
    "fuzzySubstring：容忍单字错漏，定位到 beta gamma 区间",
    m !== null && hay.slice(m.start, m.end).startsWith("beta ")
  )
}

process.exit(failed)
