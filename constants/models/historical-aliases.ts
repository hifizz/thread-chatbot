/** 已确认的历史应用 ID → 当前应用 ID；不可根据供应商前缀猜测映射。 */
export const HISTORICAL_MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "umapis-claude-opus-5": "iceland-claude-opus-5",
})
