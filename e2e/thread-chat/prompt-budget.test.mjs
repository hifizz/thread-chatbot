/**
 * 继承段字符预算（openspec: add-bubble-composer D8）纯函数用例，无需 dev server：
 *   node --experimental-strip-types e2e/thread-chat/prompt-budget.test.mjs
 *
 * 覆盖 app/thread-chat/net/prompt-pure.ts 的 applyInheritedBudget / omittedNoticeText：
 * 预算内不截断、超预算从最旧丢弃（顺序保持）、边界恰好等于预算、保底最近 1 条
 * （最新一条独超预算也保留）、省略说明文案形状、kickoffQuestion 文案形状。
 */
import {
  applyInheritedBudget,
  kickoffQuestion,
  omittedNoticeText,
} from "../../app/thread-chat/net/prompt-pure.ts"
import { INHERITED_CHAR_BUDGET } from "../../constants/thread-chat.ts"

let failed = 0
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`)
  if (!cond) failed = 1
}

/** 造一条 n 字正文的消息（text 即预算计数对象） */
const msg = (id, n) => ({ id, text: "字".repeat(n) })
const textOf = (m) => m.text

/* 1) 预算内不截断：与现状完全一致（无丢弃） */
{
  const msgs = [msg("a", 100), msg("b", 200), msg("c", 300)]
  const { kept, omitted } = applyInheritedBudget(msgs, textOf, 600)
  ok(
    "预算内不截断（600 预算收 600 字）：全保留、无丢弃",
    omitted === 0 && kept.length === 3 && kept[0].id === "a"
  )
}

/* 2) 超预算从最旧丢弃：从最新往回累计，装不下的最旧段整条丢，顺序保持 */
{
  const msgs = [msg("a", 300), msg("b", 300), msg("c", 300), msg("d", 300)]
  const { kept, omitted } = applyInheritedBudget(msgs, textOf, 700)
  ok(
    "超预算即停：700 预算装下最新 2 条（d+c=600，再收 b 就 900 超），丢最旧 2 条",
    omitted === 2 &&
      kept.length === 2 &&
      kept[0].id === "c" &&
      kept[1].id === "d"
  )
}

/* 3) 边界：累计恰好等于预算不算超（> 才停） */
{
  const msgs = [msg("a", 300), msg("b", 300), msg("c", 400)]
  const { kept, omitted } = applyInheritedBudget(msgs, textOf, 1000)
  ok(
    "恰好等于预算（300+300+400=1000）不截断",
    omitted === 0 && kept.length === 3
  )
}

/* 4) 保底最近 1 条：最新一条独自超预算也保留（继承上文不允许清零） */
{
  const msgs = [msg("a", 50), msg("b", 9000)]
  const { kept, omitted } = applyInheritedBudget(msgs, textOf, 6000)
  ok(
    "最新 1 条独超预算仍保留（保底 1 条），更旧的全部丢弃",
    omitted === 1 && kept.length === 1 && kept[0].id === "b"
  )
}

/* 5) 空继承段（主线 / 无上文）：原样空返回 */
{
  const { kept, omitted } = applyInheritedBudget([], textOf, 6000)
  ok("空继承段：无保留、无丢弃", omitted === 0 && kept.length === 0)
}

/* 6) 省略说明文案：带被丢弃条数、括号包裹（buildRequestBody 以 user 角色置于继承段最前） */
ok(
  "省略说明文案形状（N=3）",
  omittedNoticeText(3) === "（更早的 3 条上文已省略）"
)

/* 7) kickoff 文案（D6 用户定稿）：衔接上文意图在句首 + 锚点原文 */
ok(
  "kickoff 文案形状",
  kickoffQuestion("贝尔不等式") === "请结合上下文，展开讲解『贝尔不等式』"
)

/* 8) 默认预算常量存在且为正数（prompt.ts 实际使用的值） */
ok(
  `INHERITED_CHAR_BUDGET 常量（当前 ${INHERITED_CHAR_BUDGET}）为正数`,
  Number.isFinite(INHERITED_CHAR_BUDGET) && INHERITED_CHAR_BUDGET > 0
)

process.exit(failed)
