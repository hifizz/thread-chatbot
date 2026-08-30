/** Thread Chat 运行时 Skill 的稳定领域常量。 */

export const SKILL_ACTIVATION_MODES = {
  sticky: "sticky",
  oneShot: "one-shot",
} as const

export type SkillActivationMode =
  (typeof SKILL_ACTIVATION_MODES)[keyof typeof SKILL_ACTIVATION_MODES]

export const SKILL_SOURCE_TYPES = {
  builtin: "builtin",
  admin: "admin",
} as const

export type SkillSourceType =
  (typeof SKILL_SOURCE_TYPES)[keyof typeof SKILL_SOURCE_TYPES]

/**
 * SkillVersion 的展示状态由 isCurrent/revokedAt 推导；已发布版本保持不可变。
 */
export const SKILL_VERSION_STATUSES = {
  current: "current",
  superseded: "superseded",
  revoked: "revoked",
} as const

export type SkillVersionStatus =
  (typeof SKILL_VERSION_STATUSES)[keyof typeof SKILL_VERSION_STATUSES]

export const SKILL_CAPABILITY_PROFILE_IDS = {
  core: "skill-core-v1",
  research: "research-v1",
} as const

export type SkillCapabilityProfileId =
  (typeof SKILL_CAPABILITY_PROFILE_IDS)[keyof typeof SKILL_CAPABILITY_PROFILE_IDS]

export const SKILL_ERROR_CODES = {
  notFound: "SKILL_NOT_FOUND",
  disabled: "SKILL_DISABLED",
  versionRevoked: "SKILL_VERSION_REVOKED",
  capabilityUnavailable: "SKILL_CAPABILITY_UNAVAILABLE",
  resourceNotFound: "SKILL_RESOURCE_NOT_FOUND",
  packageInvalid: "SKILL_PACKAGE_INVALID",
} as const

export type SkillErrorCode =
  (typeof SKILL_ERROR_CODES)[keyof typeof SKILL_ERROR_CODES]

export const SKILL_PACKAGE_LIMITS = {
  skillFileBytes: 128 * 1024,
  referenceFileBytes: 128 * 1024,
  totalBytes: 512 * 1024,
  referenceCount: 32,
} as const

/** 运行时只从该目录发现内置 Skill。 */
export const RUNTIME_SKILLS_DIRECTORY = "runtime-skills"

/** 这些目录只服务开发代理，产品运行时不得扫描或导入。 */
export const DEVELOPMENT_AGENT_SKILL_DIRECTORIES = [
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
] as const

export const BUILTIN_RESEARCH_SKILL_SLUG = "research"

export const SKILL_PROMPT_POLICY_VERSION = "thread-chat-skill-prompt-v1"
export const SKILL_CACHE_POLICY_VERSION = "thread-chat-skill-cache-v1"
