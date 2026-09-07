/** 单条用户消息的引用预算：完整提供，超出时明确拒绝。 */
export const ARTIFACT_REFERENCE_SCHEMA_VERSION = 1 as const
export const ARTIFACT_REFERENCE_MAX_OCCURRENCES = 20
export const ARTIFACT_REFERENCE_MAX_CHARS = 200_000
export const ARTIFACT_REFERENCE_COPY = {
  empty: "暂无可以 @ 的资源",
  noMatches: "暂无匹配的资源",
  picker: "引用资源",
  placeholder: "输入问题，@ 引用 Artifact",
  missing: "引用的 Artifact 不存在或不属于当前 Project",
  incomplete: "只能引用来源已完成的 Artifact",
  budget: "引用内容过长，请减少引用或先生成精简版 Artifact",
} as const

export const ARTIFACT_MENTION_MAX_QUERY_LENGTH = 80
