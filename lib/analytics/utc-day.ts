// UTC 日历日工具：指标聚合与事件去重共用的日期语义（YYYY-MM-DD），
// 不涉及时区转换——所有桶边界一律 UTC。
export type UtcDay = string // YYYY-MM-DD

const DAY_MS = 24 * 60 * 60 * 1000

export function isUtcDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

export function utcToday(now = new Date()): UtcDay {
  return now.toISOString().slice(0, 10)
}

export function shiftUtcDay(day: UtcDay, offsetDays: number): UtcDay {
  return new Date(
    Date.parse(`${day}T00:00:00Z`) + offsetDays * DAY_MS
  )
    .toISOString()
    .slice(0, 10)
}
