/**
 * net/prompt-pure —— prompt 层的零依赖纯函数（kickoff 文案模板 + 继承段预算截断）。
 *
 * 单独成叶子模块（不 import 任何运行时模块）的原因：e2e 脚本要用
 * `node --experimental-strip-types` 直接 import 这里的函数生成断言期望值
 * （Node 不解析无扩展名的相对导入，prompt.ts 依赖 core/selectors 无法直载），
 * 与 branching/text-anchor.ts 被 text-anchor.test.mjs 直载是同一先例。
 * 文案 / 预算规则改这里，测试期望值自动跟着变（openspec: add-bubble-composer D6/D8）。
 */

/** 分支代拟首问（kickoff，D6 用户定稿文案）：留空开分支时预填进 composer，由用户改写或直接回车确认（不自动发送） */
export function kickoffQuestion(anchorText: string): string {
  return `请结合上下文，展开讲解『${anchorText}』`
}

/** 继承段发生截断时置于最前的省略说明（作为 user 角色消息的正文，D8） */
export function omittedNoticeText(omitted: number): string {
  return `（更早的 ${omitted} 条上文已省略）`
}

/**
 * 继承段字符预算（D8）：从最新往回累计正文字符，超预算即停——更旧的消息以
 * 完整消息为单位丢弃；最新一条无论多长都保留（保底 1 条）。kept 保持原有顺序。
 * 预算常量见 constants/thread-chat.ts 的 INHERITED_CHAR_BUDGET（由调用方传入，
 * 本模块保持零依赖）。
 */
export function applyInheritedBudget<T>(
  msgs: T[],
  textOf: (m: T) => string,
  budget: number
): { kept: T[]; omitted: number } {
  let total = 0
  // cut = 第一条被保留的消息下标；从尾部（最新）往回收
  let cut = msgs.length
  for (let i = msgs.length - 1; i >= 0; i--) {
    const len = textOf(msgs[i]).length
    // 已保 ≥1 条且再收这条就超预算：停（这条与更旧的全部丢弃）
    if (cut < msgs.length && total + len > budget) break
    total += len
    cut = i
  }
  return { kept: msgs.slice(cut), omitted: cut }
}
