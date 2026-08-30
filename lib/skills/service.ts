import { randomUUID } from "node:crypto"
import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import { and, eq, sql } from "drizzle-orm"
import {
  RUNTIME_SKILLS_DIRECTORY,
  SKILL_SOURCE_TYPES,
  type SkillSourceType,
} from "@/constants/skill"
import { db } from "@/lib/db"
import { skills, skillVersions } from "@/lib/db/schema"
import { loadCanonicalSkillPackage } from "@/lib/skills/package-loader"
import { SkillPackageValidationError } from "@/lib/skills/package-error"
import type { CanonicalSkillPackage } from "@/lib/skills/package-types"
import {
  findSkillBySlug,
  findSkillVersionByDigest,
  findSkillVersionByLabel,
  listCurrentSkillCatalog,
} from "@/lib/skills/repository"
import { runtimeSkillDiscoveryRoot } from "@/lib/skills/runtime-paths"

export interface PublishSkillPackageInput {
  package: CanonicalSkillPackage
  sourceType: SkillSourceType
  /** 只允许安全 revision，不得保存本地绝对路径。 */
  sourceRevision: string
}

export interface PublishSkillPackageResult {
  skillId: string
  skillVersionId: string
  slug: string
  version: string
  digest: string
  createdVersion: boolean
  changedCurrentVersion: boolean
}

function safeSourceRevision(sourceType: SkillSourceType, digest: string): string {
  return `${sourceType}:${digest}`
}

export async function publishSkillPackage(
  input: PublishSkillPackageInput
): Promise<PublishSkillPackageResult> {
  if (input.sourceRevision !== safeSourceRevision(input.sourceType, input.package.digest)) {
    throw new SkillPackageValidationError("Skill source revision 不是安全内容标识")
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.package.slug}, 0))`
    )

    let skill = await findSkillBySlug(tx, input.package.slug)
    if (!skill) {
      const [inserted] = await tx
        .insert(skills)
        .values({
          id: randomUUID(),
          slug: input.package.slug,
          sourceType: input.sourceType,
        })
        .returning()
      skill = inserted
    } else if (skill.sourceType !== input.sourceType) {
      throw new SkillPackageValidationError(
        `Skill ${input.package.slug} 已由 ${skill.sourceType} 来源管理`
      )
    }

    const existingDigest = await findSkillVersionByDigest(
      tx,
      skill.id,
      input.package.digest
    )
    if (existingDigest?.revokedAt) {
      throw new SkillPackageValidationError(
        `SkillVersion ${input.package.slug}@${input.package.version} 已被撤销`
      )
    }

    const existingLabel = await findSkillVersionByLabel(
      tx,
      skill.id,
      input.package.version
    )
    if (existingLabel && existingLabel.digest !== input.package.digest) {
      throw new SkillPackageValidationError(
        `Skill ${input.package.slug} 的版本 ${input.package.version} 已对应其他内容；请提升版本号`
      )
    }

    const now = new Date()
    if (existingDigest) {
      const changedCurrentVersion = !existingDigest.isCurrent
      if (changedCurrentVersion) {
        await tx
          .update(skillVersions)
          .set({ isCurrent: false })
          .where(
            and(
              eq(skillVersions.skillId, skill.id),
              eq(skillVersions.isCurrent, true)
            )
          )
        await tx
          .update(skillVersions)
          .set({ isCurrent: true })
          .where(eq(skillVersions.id, existingDigest.id))
      }
      await tx
        .update(skills)
        .set({ updatedAt: now })
        .where(eq(skills.id, skill.id))
      return {
        skillId: skill.id,
        skillVersionId: existingDigest.id,
        slug: skill.slug,
        version: existingDigest.version,
        digest: existingDigest.digest,
        createdVersion: false,
        changedCurrentVersion,
      }
    }

    await tx
      .update(skillVersions)
      .set({ isCurrent: false })
      .where(
        and(
          eq(skillVersions.skillId, skill.id),
          eq(skillVersions.isCurrent, true)
        )
      )
    const [created] = await tx
      .insert(skillVersions)
      .values({
        id: randomUUID(),
        skillId: skill.id,
        version: input.package.version,
        digest: input.package.digest,
        name: input.package.name,
        description: input.package.description,
        manifest: input.package.manifest,
        instructions: input.package.instructions,
        resources: input.package.resources,
        activationMode: input.package.activationMode,
        capabilityProfileId: input.package.capabilityProfileId,
        sourceRevision: input.sourceRevision,
        isCurrent: true,
      })
      .returning()
    await tx
      .update(skills)
      .set({ updatedAt: now })
      .where(eq(skills.id, skill.id))

    return {
      skillId: skill.id,
      skillVersionId: created.id,
      slug: skill.slug,
      version: created.version,
      digest: created.digest,
      createdVersion: true,
      changedCurrentVersion: true,
    }
  })
}

export async function installSkillDirectory(input: {
  packagePath: string
  sourceType: SkillSourceType
  projectRoot?: string
}) {
  const skillPackage = await loadCanonicalSkillPackage(input.packagePath, {
    projectRoot: input.projectRoot,
  })
  return publishSkillPackage({
    package: skillPackage,
    sourceType: input.sourceType,
    sourceRevision: safeSourceRevision(input.sourceType, skillPackage.digest),
  })
}

export async function listBuiltInSkillDirectories(
  projectRoot: string = process.cwd()
): Promise<string[]> {
  const root = runtimeSkillDiscoveryRoot(projectRoot)
  const entries = await readdir(root, { withFileTypes: true })
  const directories: string[] = []
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en")
  )) {
    if (entry.name === "README.md") continue
    const candidate = path.join(root, entry.name)
    const stat = await lstat(candidate)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new SkillPackageValidationError(
        `运行时 Skill 根目录只能包含真实 Skill 子目录：${entry.name}`
      )
    }
    directories.push(candidate)
  }
  return directories
}

export async function syncBuiltInSkills(
  projectRoot: string = process.cwd()
): Promise<PublishSkillPackageResult[]> {
  const directories = await listBuiltInSkillDirectories(projectRoot)
  const results: PublishSkillPackageResult[] = []
  for (const packagePath of directories) {
    results.push(
      await installSkillDirectory({
        packagePath,
        sourceType: SKILL_SOURCE_TYPES.builtin,
        projectRoot,
      })
    )
  }
  return results
}

export async function disableSkill(slug: string): Promise<boolean> {
  const [updated] = await db
    .update(skills)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(skills.slug, slug))
    .returning({ id: skills.id })
  return Boolean(updated)
}

export { listCurrentSkillCatalog }
