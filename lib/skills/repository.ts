import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { skills, skillVersions } from "@/lib/db/schema"

export type SkillTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]
export type SkillExecutor = typeof db | SkillTransaction

const skillVersionSelection = {
  skillId: skills.id,
  slug: skills.slug,
  sourceType: skills.sourceType,
  enabled: skills.enabled,
  skillCreatedAt: skills.createdAt,
  skillUpdatedAt: skills.updatedAt,
  skillVersionId: skillVersions.id,
  version: skillVersions.version,
  digest: skillVersions.digest,
  name: skillVersions.name,
  description: skillVersions.description,
  manifest: skillVersions.manifest,
  instructions: skillVersions.instructions,
  resources: skillVersions.resources,
  activationMode: skillVersions.activationMode,
  capabilityProfileId: skillVersions.capabilityProfileId,
  sourceRevision: skillVersions.sourceRevision,
  isCurrent: skillVersions.isCurrent,
  revokedAt: skillVersions.revokedAt,
  versionCreatedAt: skillVersions.createdAt,
} as const

export async function listCurrentSkillCatalog(
  executor: SkillExecutor = db,
  options: { includeDisabled?: boolean } = {}
) {
  const conditions = [eq(skillVersions.isCurrent, true), isNull(skillVersions.revokedAt)]
  if (!options.includeDisabled) conditions.push(eq(skills.enabled, true))
  return executor
    .select(skillVersionSelection)
    .from(skillVersions)
    .innerJoin(skills, eq(skillVersions.skillId, skills.id))
    .where(and(...conditions))
    .orderBy(asc(skills.slug))
}

export async function listSkillVersionsByIds(
  executor: SkillExecutor,
  skillVersionIds: readonly string[]
) {
  const ids = [...new Set(skillVersionIds)]
  if (ids.length === 0) return []
  return executor
    .select(skillVersionSelection)
    .from(skillVersions)
    .innerJoin(skills, eq(skillVersions.skillId, skills.id))
    .where(inArray(skillVersions.id, ids))
}

export async function findSkillBySlug(
  executor: SkillExecutor,
  slug: string
) {
  const [row] = await executor
    .select()
    .from(skills)
    .where(eq(skills.slug, slug))
    .limit(1)
  return row ?? null
}

export async function findSkillVersionById(
  executor: SkillExecutor,
  skillVersionId: string
) {
  const [row] = await executor
    .select(skillVersionSelection)
    .from(skillVersions)
    .innerJoin(skills, eq(skillVersions.skillId, skills.id))
    .where(eq(skillVersions.id, skillVersionId))
    .limit(1)
  return row ?? null
}

export async function findSkillVersionByDigest(
  executor: SkillExecutor,
  skillId: string,
  digest: string
) {
  const [row] = await executor
    .select()
    .from(skillVersions)
    .where(
      and(eq(skillVersions.skillId, skillId), eq(skillVersions.digest, digest))
    )
    .limit(1)
  return row ?? null
}

export async function findSkillVersionByLabel(
  executor: SkillExecutor,
  skillId: string,
  version: string
) {
  const [row] = await executor
    .select()
    .from(skillVersions)
    .where(
      and(
        eq(skillVersions.skillId, skillId),
        eq(skillVersions.version, version)
      )
    )
    .limit(1)
  return row ?? null
}

export async function findSkillResource(
  executor: SkillExecutor,
  skillVersionId: string,
  resourcePath: string
) {
  const version = await findSkillVersionById(executor, skillVersionId)
  if (!version) return null
  const resource = version.resources.find((item) => item.path === resourcePath)
  return resource ? { version, resource } : null
}
