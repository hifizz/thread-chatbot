/**
 * Thread Chat prompt policy —— 仅保留客户端空分支 Composer 的 kickoff 文案。
 *
 * 单独成叶子模块（不 import 任何运行时模块）的原因：e2e 脚本要用
 * `node --experimental-strip-types` 直接 import 这里的函数生成断言期望值
 * （Node 不解析无扩展名的相对导入，prompt.ts 依赖 core/selectors 无法直载），
 * 与 branching/text-anchor.ts 被 text-anchor.test.mjs 直载是同一先例。
 * 该文案只预填客户端，不直接进入模型 System。
 */

/** 分支代拟首问（kickoff，D6 用户定稿文案）：留空开分支时预填进 composer，由用户改写或直接回车确认（不自动发送） */
export function kickoffQuestion(anchorText: string): string {
  return `请结合上下文，展开讲解『${anchorText}』`
}
