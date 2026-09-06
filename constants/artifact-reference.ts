/** 单条用户消息的引用预算：完整提供，超出时明确拒绝。 */
export const ARTIFACT_REFERENCE_SCHEMA_VERSION = 1 as const
export const ARTIFACT_REFERENCE_MAX_OCCURRENCES = 20
export const ARTIFACT_REFERENCE_MAX_CHARS = 200_000
export const ARTIFACT_REFERENCE_MENU_LIMIT = 20
export const ARTIFACT_REFERENCE_COPY = {
  missing: "引用的 Artifact 不存在或不属于当前 Project",
  incomplete: "只能引用来源已完成的 Artifact",
  budget: "引用内容过长，请减少引用或先生成精简版 Artifact",
  empty: "没有匹配的 Artifact",
  placeholder: "输入消息，使用 @ 引用项目中的 Artifact",
} as const
