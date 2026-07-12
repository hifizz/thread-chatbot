/**
 * branching/anchor-ranges —— 把消息上的 forks 换算成互不重叠的原文高亮区间（纯函数，无 React/DOM）。
 *
 * 定位策略（W3C TextQuoteSelector 思路）：真实模型输出中同一短语可能出现多次，
 * 仅凭 indexOf 顺延会标错位置。fork 采集时记录了划选处前后的源文本上下文
 * （prefix/suffix，各最多 ANCHOR_CONTEXT_CHARS 字），这里枚举 fork.text 在
 * msg.text 中的所有出现位置，选上下文匹配得分最高的那一次：
 *   - prefix 精确相等 / suffix 精确相等各计一次「精确分」（远高于部分分）；
 *   - 否则按公共尾部（prefix）/ 公共头部（suffix）长度计部分分；
 * 无 prefix/suffix（旧数据）或全部零分（文本已变）时回退旧的「顺延占坑」行为。
 * 已被占用的区间不参与候选（占坑去重保留），选完后按 start 排序。
 */

import type { Fork, Message } from "../core/types"

/** 划选处前后采集的源文本上下文长度上限（字符） */
export const ANCHOR_CONTEXT_CHARS = 24

/** prefix/suffix 精确相等时的得分（远大于任何部分匹配分，保证精确命中优先） */
const EXACT_MATCH_SCORE = 1000

export interface AnchorRange {
  start: number
  end: number
  fork: Fork
}

/** 两串的公共尾部长度（prefix 的部分匹配：越靠近划选处的字符越该对上） */
function commonSuffixLen(a: string, b: string): number {
  let n = 0
  while (
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  )
    n++
  return n
}

/** 两串的公共头部长度（suffix 的部分匹配） */
function commonPrefixLen(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/** fork.text 在 text 中的全部出现位置（可重叠出现也逐一枚举） */
function allOccurrences(text: string, needle: string): number[] {
  const out: number[] = []
  let i = text.indexOf(needle)
  while (i !== -1) {
    out.push(i)
    i = text.indexOf(needle, i + 1)
  }
  return out
}

/** 某一次出现的上下文匹配得分（无 prefix/suffix 记 0 分） */
function contextScore(text: string, at: number, fork: Fork): number {
  let score = 0
  if (fork.prefix !== undefined) {
    const actual = text.slice(Math.max(0, at - fork.prefix.length), at)
    score +=
      actual === fork.prefix
        ? EXACT_MATCH_SCORE
        : commonSuffixLen(actual, fork.prefix)
  }
  if (fork.suffix !== undefined) {
    const end = at + fork.text.length
    const actual = text.slice(end, end + fork.suffix.length)
    score +=
      actual === fork.suffix
        ? EXACT_MATCH_SCORE
        : commonPrefixLen(actual, fork.suffix)
  }
  return score
}

/** 把消息上的 forks 换算成互不重叠的高亮区间（上下文定位 + 顺延回退，见文件头） */
export function computeRanges(
  msg: Pick<Message, "text" | "forks">
): AnchorRange[] {
  const t = msg.text
  const ranges: AnchorRange[] = []
  const overlapsTaken = (at: number, len: number) =>
    ranges.some((r) => !(at + len <= r.start || at >= r.end))

  msg.forks.forEach((f) => {
    // 候选 = 未与已占区间重叠的全部出现位置（占坑去重）
    const candidates = allOccurrences(t, f.text).filter(
      (i) => !overlapsTaken(i, f.text.length)
    )
    if (candidates.length === 0) return

    let pick = candidates[0] // 默认 = 旧顺延行为（首个空闲出现位置）
    if (f.prefix !== undefined || f.suffix !== undefined) {
      let best = 0
      candidates.forEach((i) => {
        const s = contextScore(t, i, f)
        if (s > best) {
          best = s
          pick = i
        }
      })
      // best === 0（全零分）时 pick 保持 candidates[0]，即回退顺延行为
    }
    ranges.push({ start: pick, end: pick + f.text.length, fork: f })
  })

  ranges.sort((a, b) => a.start - b.start)
  return ranges
}
