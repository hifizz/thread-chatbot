import fs from "node:fs"
import path from "node:path"
import matter from "gray-matter"
import { SKILLS_DIR, SKILL_FILE_NAME } from "@/constants/skill"
import type { SkillDefinition, SkillMeta } from "./types"

// 仅限服务端使用（依赖 node:fs）。注册表在模块级缓存，
// 同一进程内不重复扫描磁盘；修改 SKILL.md 后需重启 dev server。

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/

function parseSkillFile(dirName: string, filePath: string): SkillDefinition | null {
  const { data, content } = matter(fs.readFileSync(filePath, "utf8"))

  const { id, label, description, icon, tools } = data as Record<string, unknown>
  if (typeof id !== "string" || typeof label !== "string" || typeof description !== "string") {
    console.warn(`[skills] 跳过 ${filePath}：frontmatter 缺少必填字段 id/label/description`)
    return null
  }
  if (id !== dirName || !KEBAB_CASE.test(id)) {
    console.warn(`[skills] 跳过 ${filePath}：id "${id}" 必须为 kebab-case 且与目录名一致`)
    return null
  }
  const body = content.trim()
  if (!body) {
    console.warn(`[skills] 跳过 ${filePath}：正文为空`)
    return null
  }

  return {
    id,
    label,
    description,
    ...(typeof icon === "string" ? { icon } : {}),
    body,
    ...(Array.isArray(tools) && tools.every((t) => typeof t === "string")
      ? { tools: tools as string[] }
      : {}),
  }
}

function loadRegistry(): Map<string, SkillDefinition> {
  const registry = new Map<string, SkillDefinition>()
  const skillsRoot = path.join(process.cwd(), SKILLS_DIR)
  if (!fs.existsSync(skillsRoot)) return registry

  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const filePath = path.join(skillsRoot, entry.name, SKILL_FILE_NAME)
    if (!fs.existsSync(filePath)) continue
    const skill = parseSkillFile(entry.name, filePath)
    if (skill) registry.set(skill.id, skill)
  }
  return registry
}

let cache: Map<string, SkillDefinition> | undefined

function getRegistry(): Map<string, SkillDefinition> {
  cache ??= loadRegistry()
  return cache
}

/** 所有已注册 skill 的元数据（不含正文与工具声明）。 */
export function getSkillMetas(): SkillMeta[] {
  return [...getRegistry().values()].map(({ id, label, description, icon }) => ({
    id,
    label,
    description,
    ...(icon ? { icon } : {}),
  }))
}

/** 按 id 查询完整 skill 定义；未注册返回 undefined（白名单校验入口）。 */
export function getSkillById(id: string): SkillDefinition | undefined {
  return getRegistry().get(id)
}
