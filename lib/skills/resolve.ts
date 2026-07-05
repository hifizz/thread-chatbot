import { unstable_defaultDirectiveFormatter } from "@assistant-ui/core"
import type { UIMessage } from "ai"
import { SKILL_DIRECTIVE_TYPE } from "@/constants/skill"
import { getSkillById } from "./registry"
import type { SkillDefinition } from "./types"

// 仅限服务端（依赖 registry 的 node:fs）。formatter 与前端插入 directive 时
// 使用的是同一个实现，保证 `:skill[label]{name=id}` 语法前后端一致。

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

/**
 * 从最后一条 user message 解析第一个 skill directive 并做注册表白名单校验。
 * 历史消息不参与解析；未注册的 id 返回 null（按普通消息降级处理）。
 */
export function resolveSkillFromMessages(messages: UIMessage[]): SkillDefinition | null {
  const lastUser = messages.findLast((m) => m.role === "user")
  if (!lastUser) return null

  for (const seg of unstable_defaultDirectiveFormatter.parse(textOf(lastUser))) {
    if (seg.kind === "mention" && seg.type === SKILL_DIRECTIVE_TYPE) {
      return getSkillById(seg.id) ?? null
    }
  }
  return null
}

/**
 * 把发送给模型的消息文本中的 skill directive 替换为可读的 `/id`。
 * 只改发给模型的副本；持久化发生在前端 history adapter，不受影响。
 */
export function sanitizeSkillDirectives(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "text") return part
      const sanitized = unstable_defaultDirectiveFormatter
        .parse(part.text)
        .map((seg) => {
          if (seg.kind === "text") return seg.text
          if (seg.type === SKILL_DIRECTIVE_TYPE) return `/${seg.id}`
          // 其他类型的 directive（如 @ mention）原样保留
          return unstable_defaultDirectiveFormatter.serialize({
            id: seg.id,
            type: seg.type,
            label: seg.label,
          })
        })
        .join("")
      return sanitized === part.text ? part : { ...part, text: sanitized }
    }),
  }))
}
