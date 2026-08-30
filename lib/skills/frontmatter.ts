import { SkillPackageValidationError } from "@/lib/skills/package-error"

type ManifestObject = Record<string, unknown>

type StackEntry = {
  indent: number
  value: ManifestObject
}

function parseScalar(raw: string, lineNumber: number): string {
  const value = raw.trim()
  if (!value) {
    throw new SkillPackageValidationError(
      `frontmatter 第 ${lineNumber} 行缺少值`
    )
  }
  if (["|", ">", "[", "{", "&", "*", "!"].includes(value[0] ?? "")) {
    throw new SkillPackageValidationError(
      `frontmatter 第 ${lineNumber} 行使用了 MVP 不支持的 YAML 语法`
    )
  }
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed !== "string") throw new Error("not a string")
      return parsed
    } catch {
      throw new SkillPackageValidationError(
        `frontmatter 第 ${lineNumber} 行的双引号字符串无效`
      )
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new SkillPackageValidationError(
        `frontmatter 第 ${lineNumber} 行的单引号字符串无效`
      )
    }
    return value.slice(1, -1).replaceAll("''", "'")
  }
  return value
}

function parseMapping(lines: string[]): ManifestObject {
  const root: ManifestObject = {}
  const stack: StackEntry[] = [{ indent: -2, value: root }]

  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index]
    const lineNumber = index + 2
    if (!original.trim() || original.trimStart().startsWith("#")) continue
    if (original.includes("\t")) {
      throw new SkillPackageValidationError(
        `frontmatter 第 ${lineNumber} 行不能使用 Tab 缩进`
      )
    }
    const indent = original.length - original.trimStart().length
    if (indent % 2 !== 0) {
      throw new SkillPackageValidationError(
        `frontmatter 第 ${lineNumber} 行必须使用两空格缩进`
      )
    }
    const match = original
      .slice(indent)
      .match(/^([A-Za-z0-9][A-Za-z0-9_-]*):(?:\s+(.*))?$/)
    if (!match) {
      throw new SkillPackageValidationError(
        `frontmatter 第 ${lineNumber} 行不是受支持的键值映射`
      )
    }

    while (stack.length > 1 && stack.at(-1)!.indent >= indent) stack.pop()
    const parent = stack.at(-1)!
    if (indent !== parent.indent + 2) {
      throw new SkillPackageValidationError(
        `frontmatter 第 ${lineNumber} 行出现了跳级缩进`
      )
    }

    const key = match[1]
    if (Object.hasOwn(parent.value, key)) {
      throw new SkillPackageValidationError(
        `frontmatter 第 ${lineNumber} 行重复定义了 ${key}`
      )
    }

    const rawValue = match[2]
    if (rawValue === undefined) {
      const child: ManifestObject = {}
      parent.value[key] = child
      stack.push({ indent, value: child })
    } else {
      parent.value[key] = parseScalar(rawValue, lineNumber)
    }
  }

  return root
}

export function parseSkillDocument(document: string): {
  manifest: ManifestObject
  instructions: string
} {
  const lines = document.split("\n")
  if (lines[0] !== "---") {
    throw new SkillPackageValidationError("SKILL.md 必须以 YAML frontmatter 开始")
  }
  const closingIndex = lines.indexOf("---", 1)
  if (closingIndex < 0) {
    throw new SkillPackageValidationError("SKILL.md 缺少 frontmatter 结束标记")
  }

  const manifest = parseMapping(lines.slice(1, closingIndex))
  const body = lines
    .slice(closingIndex + 1)
    .join("\n")
    .trim()
  if (!body) {
    throw new SkillPackageValidationError("SKILL.md 指令正文不能为空")
  }
  return { manifest, instructions: `${body}\n` }
}

export function manifestString(
  manifest: ManifestObject,
  path: readonly string[],
  required = true
): string | null {
  let current: unknown = manifest
  for (const segment of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.hasOwn(current, segment)
    ) {
      if (!required) return null
      throw new SkillPackageValidationError(
        `frontmatter 缺少 ${path.join(".")}`
      )
    }
    current = (current as ManifestObject)[segment]
  }
  if (typeof current !== "string" || !current.trim()) {
    if (!required && current === undefined) return null
    throw new SkillPackageValidationError(
      `frontmatter ${path.join(".")} 必须是非空字符串`
    )
  }
  return current.trim()
}
