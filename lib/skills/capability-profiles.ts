import {
  SKILL_CAPABILITY_PROFILE_IDS,
  type SkillCapabilityProfileId,
} from "@/constants/skill"
import { isSearchConfigured } from "@/lib/ai/search"

export const SKILL_CAPABILITY_PROFILES = {
  [SKILL_CAPABILITY_PROFILE_IDS.core]: {
    id: SKILL_CAPABILITY_PROFILE_IDS.core,
    toolNames: ["readSkillResource"] as const,
  },
  [SKILL_CAPABILITY_PROFILE_IDS.research]: {
    id: SKILL_CAPABILITY_PROFILE_IDS.research,
    toolNames: [
      "createMarkdownArtifact",
      "readSkillResource",
      "readUrl",
      "webSearch",
    ] as const,
  },
} as const satisfies Record<
  SkillCapabilityProfileId,
  { id: SkillCapabilityProfileId; toolNames: readonly string[] }
>

export function getSkillCapabilityProfile(
  profileId: SkillCapabilityProfileId
) {
  return SKILL_CAPABILITY_PROFILES[profileId]
}

export function isSkillCapabilityProfileAvailable(
  profileId: SkillCapabilityProfileId
): boolean {
  if (profileId === SKILL_CAPABILITY_PROFILE_IDS.research) {
    return isSearchConfigured()
  }
  return Boolean(SKILL_CAPABILITY_PROFILES[profileId])
}
