import path from "node:path"
import {
  DEVELOPMENT_AGENT_SKILL_DIRECTORIES,
  RUNTIME_SKILLS_DIRECTORY,
} from "@/constants/skill"

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/** 内置运行时 Skill 的唯一自动发现根目录。 */
export function runtimeSkillDiscoveryRoot(
  projectRoot: string = process.cwd()
): string {
  return path.resolve(projectRoot, RUNTIME_SKILLS_DIRECTORY)
}

/** 判断路径是否位于任一开发代理 Skill 目录内。 */
export function isDevelopmentAgentSkillPath(
  candidatePath: string,
  projectRoot: string = process.cwd()
): boolean {
  const candidate = path.resolve(candidatePath)
  return DEVELOPMENT_AGENT_SKILL_DIRECTORIES.some((directory) =>
    isInside(path.resolve(projectRoot, directory), candidate)
  )
}

/**
 * 管理员导入入口也必须拒绝开发代理目录，避免把仓库维护指令误发布给产品用户。
 */
export function assertRuntimeSkillImportPath(
  candidatePath: string,
  projectRoot: string = process.cwd()
): void {
  if (isDevelopmentAgentSkillPath(candidatePath, projectRoot)) {
    throw new Error("开发代理 Skill 目录不能作为 Thread Chat 运行时 Skill 来源")
  }
}
