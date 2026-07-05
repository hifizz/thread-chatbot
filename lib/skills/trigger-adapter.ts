import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from "@assistant-ui/core"
import { SKILL_DIRECTIVE_TYPE } from "@/constants/skill"
import type { SkillMeta } from "./types"

// categories() 返回空数组会让弹层跳过分类层、直接以 search("") 展示全部条目，
// 因此输入 "/" 即列出所有 skill，继续输入则过滤。

export function createSkillTriggerAdapter(skills: SkillMeta[]): Unstable_TriggerAdapter {
  const items: Unstable_TriggerItem[] = skills.map((s) => ({
    id: s.id,
    type: SKILL_DIRECTIVE_TYPE,
    label: s.label,
    description: s.description,
    ...(s.icon ? { metadata: { icon: s.icon } } : {}),
  }))

  return {
    categories: () => [],
    categoryItems: () => items,
    search: (query) => {
      const q = query.trim().toLowerCase()
      if (!q) return items
      return items.filter(
        (item) => item.id.toLowerCase().includes(q) || item.label.toLowerCase().includes(q),
      )
    },
  }
}
