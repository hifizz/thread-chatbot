import type {
  SkillCatalogDTO,
  SkillVersionSummaryDTO,
} from "@/lib/thread-chat/contracts/dto"

export interface SkillVersionSummarySource {
  skillId: string
  skillVersionId: string
  slug: string
  sourceType: SkillCatalogDTO["sourceType"]
  name: string
  description: string
  version: string
  digest: string
  activationMode: SkillVersionSummaryDTO["activationMode"]
  capabilityProfileId: SkillVersionSummaryDTO["capabilityProfileId"]
}

export function toSkillVersionSummaryDTO(
  row: SkillVersionSummarySource
): SkillVersionSummaryDTO {
  return {
    skillId: row.skillId,
    skillVersionId: row.skillVersionId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    version: row.version,
    digest: row.digest,
    activationMode: row.activationMode,
    capabilityProfileId: row.capabilityProfileId,
  }
}

export function toSkillCatalogDTO(
  row: SkillVersionSummarySource
): SkillCatalogDTO {
  return {
    id: row.skillId,
    slug: row.slug,
    sourceType: row.sourceType,
    currentVersion: toSkillVersionSummaryDTO(row),
  }
}
