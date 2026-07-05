/** skill 的元数据，`GET /api/skills` 只下发这一部分（不含正文与工具声明）。 */
export type SkillMeta = {
  id: string
  label: string
  description: string
  icon?: string
}

/** 服务端完整的 skill 定义：元数据 + 注入 system prompt 的正文 + 可选工具声明。 */
export type SkillDefinition = SkillMeta & {
  /** SKILL.md 的 Markdown 正文，触发时追加到 system prompt */
  body: string
  /** 触发时额外启用的服务端工具名（须存在于 route.ts 的 skillTools 映射中） */
  tools?: string[]
}
