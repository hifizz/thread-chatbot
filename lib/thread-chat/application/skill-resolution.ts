import {
  SKILL_ACTIVATION_MODES,
  SKILL_ERROR_CODES,
} from "@/constants/skill"
import { isSkillCapabilityProfileAvailable } from "@/lib/skills/capability-profiles"
import { toSkillVersionSummaryDTO } from "@/lib/skills/dto"
import { findSkillVersionById } from "@/lib/skills/repository"
import type { SkillVersionSummaryDTO } from "@/lib/thread-chat/contracts/dto"
import type { ApiErrorCode } from "@/lib/thread-chat/contracts/errors"
import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"
import type { ConversationExecutor } from "@/lib/thread-chat/persistence/transaction"

export type ResolvedSkillVersion = {
  skillVersionId: string
  summary: SkillVersionSummaryDTO
}

export type EffectiveTurnSkill = {
  pinnedSkillVersionId: string | null
  pinnedSkill: SkillVersionSummaryDTO | null
  activeSkillVersionId: string | null
  activeSkill: SkillVersionSummaryDTO | null
}

function skillError(code: ApiErrorCode, message: string): never {
  throw new ConversationApplicationError(code, message)
}

export async function loadSkillVersionSummary(
  executor: ConversationExecutor,
  skillVersionId: string | null
): Promise<SkillVersionSummaryDTO | null> {
  if (!skillVersionId) return null
  const version = await findSkillVersionById(executor, skillVersionId)
  if (!version) return null
  return toSkillVersionSummaryDTO(version)
}

export async function resolveAvailableSkillVersion(
  executor: ConversationExecutor,
  skillVersionId: string | null
): Promise<ResolvedSkillVersion | null> {
  if (!skillVersionId) return null
  const version = await findSkillVersionById(executor, skillVersionId)
  if (!version) {
    skillError(SKILL_ERROR_CODES.notFound, "SkillVersion 不存在")
  }
  if (!version.enabled) {
    skillError(SKILL_ERROR_CODES.disabled, "Skill 已停用")
  }
  if (version.revokedAt) {
    skillError(SKILL_ERROR_CODES.versionRevoked, "SkillVersion 已撤销")
  }
  if (!isSkillCapabilityProfileAvailable(version.capabilityProfileId)) {
    skillError(
      SKILL_ERROR_CODES.capabilityUnavailable,
      "当前部署无法提供该 Skill 所需能力"
    )
  }
  return {
    skillVersionId: version.skillVersionId,
    summary: toSkillVersionSummaryDTO(version),
  }
}

export async function resolveEffectiveSkillForTurn(input: {
  executor: ConversationExecutor
  currentActiveSkillVersionId: string | null
  selectedSkillVersionId: string | null | undefined
}): Promise<EffectiveTurnSkill> {
  if (input.selectedSkillVersionId === null) {
    return {
      pinnedSkillVersionId: null,
      pinnedSkill: null,
      activeSkillVersionId: null,
      activeSkill: null,
    }
  }

  const inherited = input.selectedSkillVersionId === undefined
  const selectedId = inherited
    ? input.currentActiveSkillVersionId
    : input.selectedSkillVersionId
  const resolved = await resolveAvailableSkillVersion(
    input.executor,
    selectedId ?? null
  )
  if (!resolved) {
    return {
      pinnedSkillVersionId: null,
      pinnedSkill: null,
      activeSkillVersionId: null,
      activeSkill: null,
    }
  }

  if (
    inherited &&
    resolved.summary.activationMode !== SKILL_ACTIVATION_MODES.sticky
  ) {
    skillError(
      SKILL_ERROR_CODES.packageInvalid,
      "Thread ActiveSkill 必须引用 sticky SkillVersion"
    )
  }

  const staysActive =
    resolved.summary.activationMode === SKILL_ACTIVATION_MODES.sticky
  return {
    pinnedSkillVersionId: resolved.skillVersionId,
    pinnedSkill: resolved.summary,
    activeSkillVersionId: staysActive ? resolved.skillVersionId : null,
    activeSkill: staysActive ? resolved.summary : null,
  }
}

export async function resolveThreadActiveSkill(input: {
  executor: ConversationExecutor
  selectedSkillVersionId: string | null
}): Promise<{
  activeSkillVersionId: string | null
  activeSkill: SkillVersionSummaryDTO | null
}> {
  const resolved = await resolveAvailableSkillVersion(
    input.executor,
    input.selectedSkillVersionId
  )
  if (!resolved) {
    return { activeSkillVersionId: null, activeSkill: null }
  }
  if (resolved.summary.activationMode !== SKILL_ACTIVATION_MODES.sticky) {
    skillError(
      SKILL_ERROR_CODES.packageInvalid,
      "one-shot Skill 不能保存为 Thread ActiveSkill"
    )
  }
  return {
    activeSkillVersionId: resolved.skillVersionId,
    activeSkill: resolved.summary,
  }
}
