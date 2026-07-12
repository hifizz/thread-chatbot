/**
 * anchor-ranges 纯函数用例：验证 TextQuoteSelector 式上下文定位。
 * 运行（无需 dev server）：
 *   node --experimental-strip-types e2e/thread-chat/anchor-ranges.test.mjs
 */
import { computeRanges } from "../../app/thread-chat/branching/anchor-ranges.ts"

let failed = 0
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`)
  if (!cond) failed = 1
}

// 同一短语出现 3 次的源文本（位置动态计算，见下）
const text =
  "第一次提到量子纠缠概念之后，又解释量子纠缠原理，最后总结量子纠缠应用。"
const idx = [...text.matchAll(/量子纠缠/g)].map((m) => m.index)
ok(`前置：短语出现 3 次（位置 ${idx.join("/")}）`, idx.length === 3)

// 1. fork 指向第 2 次出现（prefix/suffix 采自第 2 次出现的真实上下文）
const at2 = idx[1]
const fork2 = {
  text: "量子纠缠",
  num: 1,
  threadId: "b1",
  depth: 1,
  prefix: text.slice(Math.max(0, at2 - 24), at2),
  suffix: text.slice(at2 + 4, at2 + 4 + 24),
}
{
  const r = computeRanges({ text, forks: [fork2] })
  ok(
    "上下文定位：fork 指向第 2 次出现 → 选中第 2 次",
    r.length === 1 && r[0].start === idx[1]
  )
}

// 2. 无 prefix/suffix（旧数据）→ 回退顺延：选第 1 次
{
  const r = computeRanges({
    text,
    forks: [{ text: "量子纠缠", num: 1, threadId: "b1", depth: 1 }],
  })
  ok("回退顺延：无上下文 → 选第 1 次", r.length === 1 && r[0].start === idx[0])
}

// 3. 上下文全零分（文本已变，前后文完全对不上）→ 回退顺延选第 1 次
{
  const r = computeRanges({
    text,
    forks: [
      {
        text: "量子纠缠",
        num: 1,
        threadId: "b1",
        depth: 1,
        prefix: "XXXX",
        suffix: "YYYY",
      },
    ],
  })
  ok(
    "全零分回退：上下文对不上 → 选第 1 次",
    r.length === 1 && r[0].start === idx[0]
  )
}

// 4. 占坑去重：两个 fork 都指向第 2 次出现的上下文，后到者让位到其余位置
{
  const r = computeRanges({
    text,
    forks: [fork2, { ...fork2, num: 2, threadId: "b2" }],
  })
  const starts = r.map((x) => x.start)
  ok(
    "占坑去重：第二个同上下文 fork 不与第一个重叠",
    r.length === 2 && starts.includes(idx[1]) && new Set(starts).size === 2
  )
}

// 5. 部分匹配得分：prefix 只有尾部若干字符对上（模拟上下文被截断），仍应命中第 2 次
{
  const partial = {
    ...fork2,
    prefix: fork2.prefix.slice(-4),
    suffix: fork2.suffix.slice(0, 4),
  }
  const r = computeRanges({ text, forks: [partial] })
  ok(
    "部分上下文：截短的 prefix/suffix 仍命中第 2 次",
    r.length === 1 && r[0].start === idx[1]
  )
}

process.exit(failed)
