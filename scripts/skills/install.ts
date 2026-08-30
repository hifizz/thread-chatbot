import process from "node:process"
import { SKILL_SOURCE_TYPES } from "@/constants/skill"
import { installSkillDirectory } from "@/lib/skills/service"

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const packagePath = option("--path")
if (!packagePath) {
  console.error("用法：pnpm skills:install -- --path <skill-directory>")
  process.exitCode = 1
} else {
  try {
    const result = await installSkillDirectory({
      packagePath,
      sourceType: SKILL_SOURCE_TYPES.admin,
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Skill 安装失败")
    process.exitCode = 1
  }
}
