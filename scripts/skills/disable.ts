import process from "node:process"
import { disableSkill } from "@/lib/skills/service"

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const slug = option("--slug")
if (!slug) {
  console.error("用法：pnpm skills:disable -- --slug <skill-slug>")
  process.exitCode = 1
} else {
  try {
    const disabled = await disableSkill(slug)
    if (!disabled) throw new Error(`Skill 不存在：${slug}`)
    console.log(JSON.stringify({ slug, disabled: true }, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Skill 禁用失败")
    process.exitCode = 1
  }
}
