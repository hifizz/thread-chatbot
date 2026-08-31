import { createHash } from "node:crypto"
import { lstat, readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { TextDecoder } from "node:util"
import {
  SKILL_ACTIVATION_MODES,
  SKILL_CAPABILITY_PROFILE_IDS,
  SKILL_PACKAGE_LIMITS,
  type SkillActivationMode,
  type SkillCapabilityProfileId,
} from "@/constants/skill"
import { manifestString, parseSkillDocument } from "@/lib/skills/frontmatter"
import { SkillPackageValidationError } from "@/lib/skills/package-error"
import type {
  CanonicalSkillPackage,
  SkillResourceSnapshot,
} from "@/lib/skills/package-types"
import { assertRuntimeSkillImportPath } from "@/lib/skills/runtime-paths"

const PACKAGE_SCHEMA_VERSION = "thread-chat-skill-package-v1" as const
const SKILL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/
const utf8 = new TextDecoder("utf-8", { fatal: true })

type PackageFile = {
  path: string
  content: string
  byteSize: number
  digest: string
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function normalizeSkillText(buffer: Uint8Array, resourcePath: string): string {
  let decoded: string
  try {
    decoded = utf8.decode(buffer)
  } catch {
    throw new SkillPackageValidationError("文件不是有效 UTF-8 文本", resourcePath)
  }
  return decoded.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
}

export function normalizeSkillResourcePath(resourcePath: string): string {
  if (
    !resourcePath ||
    resourcePath.includes("\\") ||
    resourcePath.includes("\0") ||
    path.posix.isAbsolute(resourcePath)
  ) {
    throw new SkillPackageValidationError("Skill 资源路径不安全", resourcePath)
  }
  const normalized = path.posix.normalize(resourcePath)
  if (
    normalized !== resourcePath ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new SkillPackageValidationError("Skill 资源路径不安全", resourcePath)
  }
  return normalized
}

function isAllowedFile(resourcePath: string): boolean {
  return (
    resourcePath === "SKILL.md" ||
    (resourcePath.startsWith("references/") && resourcePath.endsWith(".md"))
  )
}

function assertAllowedDirectory(resourcePath: string): void {
  if (
    resourcePath !== "references" &&
    !resourcePath.startsWith("references/")
  ) {
    throw new SkillPackageValidationError(
      "MVP 只允许 references/ 目录，脚本与依赖目录均被拒绝",
      resourcePath
    )
  }
}

async function readPackageFiles(packageRoot: string): Promise<PackageFile[]> {
  const rootStat = await lstat(packageRoot).catch(() => null)
  if (!rootStat) throw new SkillPackageValidationError("Skill 包目录不存在")
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new SkillPackageValidationError("Skill 包根路径必须是真实目录")
  }

  const files: PackageFile[] = []
  const collisionKeys = new Set<string>()
  let totalBytes = 0
  let referenceCount = 0

  async function walk(absoluteDirectory: string, relativeDirectory = "") {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"))

    for (const entry of entries) {
      const relativePath = normalizeSkillResourcePath(
        relativeDirectory
          ? path.posix.join(relativeDirectory, entry.name)
          : entry.name
      )
      const absolutePath = path.join(absoluteDirectory, entry.name)
      const stat = await lstat(absolutePath)
      if (stat.isSymbolicLink()) {
        throw new SkillPackageValidationError("Skill 包不能包含符号链接", relativePath)
      }
      if (stat.isDirectory()) {
        assertAllowedDirectory(relativePath)
        await walk(absolutePath, relativePath)
        continue
      }
      if (!stat.isFile()) {
        throw new SkillPackageValidationError("Skill 包包含不支持的文件类型", relativePath)
      }
      if (!isAllowedFile(relativePath)) {
        throw new SkillPackageValidationError(
          "MVP 只接受 SKILL.md 与 references/**/*.md",
          relativePath
        )
      }
      if ((stat.mode & 0o111) !== 0) {
        throw new SkillPackageValidationError("Skill 文件不能带可执行权限", relativePath)
      }

      const collisionKey = relativePath.toLocaleLowerCase("en-US")
      if (collisionKeys.has(collisionKey)) {
        throw new SkillPackageValidationError(
          "Skill 包包含大小写冲突的重复路径",
          relativePath
        )
      }
      collisionKeys.add(collisionKey)

      const buffer = await readFile(absolutePath)
      const limit =
        relativePath === "SKILL.md"
          ? SKILL_PACKAGE_LIMITS.skillFileBytes
          : SKILL_PACKAGE_LIMITS.referenceFileBytes
      if (buffer.byteLength > limit) {
        throw new SkillPackageValidationError("Skill 文件超过大小限制", relativePath)
      }
      totalBytes += buffer.byteLength
      if (totalBytes > SKILL_PACKAGE_LIMITS.totalBytes) {
        throw new SkillPackageValidationError("Skill 包超过总大小限制")
      }
      if (relativePath !== "SKILL.md") {
        referenceCount += 1
        if (referenceCount > SKILL_PACKAGE_LIMITS.referenceCount) {
          throw new SkillPackageValidationError("Skill reference 数量超过限制")
        }
      }

      const content = normalizeSkillText(buffer, relativePath)
      files.push({
        path: relativePath,
        content,
        byteSize: buffer.byteLength,
        digest: sha256(content),
      })
    }
  }

  await walk(packageRoot)
  files.sort((left, right) => left.path.localeCompare(right.path, "en"))
  if (!files.some((file) => file.path === "SKILL.md")) {
    throw new SkillPackageValidationError("Skill 包缺少 SKILL.md")
  }
  return files
}

function asActivationMode(value: string): SkillActivationMode {
  if (!Object.values(SKILL_ACTIVATION_MODES).includes(value as SkillActivationMode)) {
    throw new SkillPackageValidationError(
      `不支持的 activation-mode：${value}`
    )
  }
  return value as SkillActivationMode
}

function asCapabilityProfile(value: string): SkillCapabilityProfileId {
  if (
    !Object.values(SKILL_CAPABILITY_PROFILE_IDS).includes(
      value as SkillCapabilityProfileId
    )
  ) {
    throw new SkillPackageValidationError(
      `未批准的 capability-profile：${value}`
    )
  }
  return value as SkillCapabilityProfileId
}

export async function loadCanonicalSkillPackage(
  packagePath: string,
  options: { projectRoot?: string } = {}
): Promise<CanonicalSkillPackage> {
  const projectRoot = options.projectRoot ?? process.cwd()
  const packageRoot = path.resolve(packagePath)
  assertRuntimeSkillImportPath(packageRoot, projectRoot)
  const files = await readPackageFiles(packageRoot)
  const skillFile = files.find((file) => file.path === "SKILL.md")!
  const { manifest, instructions } = parseSkillDocument(skillFile.content)

  const slug = manifestString(manifest, ["name"])!
  if (slug.length > 64 || !SKILL_SLUG_PATTERN.test(slug)) {
    throw new SkillPackageValidationError(
      "Skill name 必须是最多 64 字符的小写 kebab-case"
    )
  }
  const description = manifestString(manifest, ["description"])!
  if (description.length > 1_000) {
    throw new SkillPackageValidationError("Skill description 超过 1000 字符")
  }

  const canonicalPayload = JSON.stringify({
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    files: files.map((file) => ({ path: file.path, content: file.content })),
  })
  const digest = sha256(canonicalPayload)
  const configuredVersion = manifestString(
    manifest,
    ["metadata", "threadchat", "version"],
    false
  )
  const version = configuredVersion ?? `0.0.0+${digest.slice(0, 12)}`
  if (!VERSION_PATTERN.test(version)) {
    throw new SkillPackageValidationError("Skill version 格式无效")
  }

  const resources: SkillResourceSnapshot[] = files
    .filter((file) => file.path !== "SKILL.md")
    .map((file) => ({
      path: file.path,
      mediaType: "text/markdown" as const,
      digest: file.digest,
      byteSize: file.byteSize,
      content: file.content,
    }))

  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    slug,
    name: slug,
    description,
    version,
    digest,
    activationMode: asActivationMode(
      manifestString(manifest, [
        "metadata",
        "threadchat",
        "activation-mode",
      ])!
    ),
    capabilityProfileId: asCapabilityProfile(
      manifestString(manifest, [
        "metadata",
        "threadchat",
        "capability-profile",
      ])!
    ),
    manifest,
    instructions,
    resources,
    totalBytes: files.reduce((total, file) => total + file.byteSize, 0),
  }
}
