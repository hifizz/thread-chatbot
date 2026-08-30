import process from "node:process"
import { syncBuiltInSkills } from "@/lib/skills/service"

try {
  const results = await syncBuiltInSkills()
  console.log(JSON.stringify({ synchronized: results }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : "内置 Skill 同步失败")
  process.exitCode = 1
}
