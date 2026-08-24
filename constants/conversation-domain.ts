/** 规范 Conversation 快照的首个结构版本。 */
export const CONVERSATION_SNAPSHOT_SCHEMA_VERSION = 1 as const

/** 遗留 JSON 没有实体时间戳时使用的显式未知值，保证投影可重复。 */
export const LEGACY_PROJECTION_UNKNOWN_TIMESTAMP =
  "1970-01-01T00:00:00.000Z" as const
