import { GOOGLE_FONT_SCRIPT_RANGES, type GoogleFontTarget } from "@/constants/google-fonts"

/** 与 Google 的字体分片取交集，保留按字符加载，同时隔离中英文设置。 */
export function restrictGoogleFontRange(range: string, target: GoogleFontTarget): string {
  if (target !== "english" && target !== "chinese") return range
  const source = (range || "U+0-10FFFF").split(",").map((part) => {
    const match = part.trim().match(/^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i)
    if (!match) return null
    const start = parseInt(match[1].replace(/\?/g, "0"), 16)
    const end = parseInt(match[2] ?? match[1].replace(/\?/g, "F"), 16)
    return [start, end]
  })
  const output: string[] = []
  for (const sourceRange of source) {
    if (!sourceRange) continue
    for (const [minimum, maximum] of GOOGLE_FONT_SCRIPT_RANGES[target]) {
      const start = Math.max(sourceRange[0], minimum)
      const end = Math.min(sourceRange[1], maximum)
      if (start <= end) output.push(`U+${start.toString(16)}-${end.toString(16)}`)
    }
  }
  return output.join(",")
}
