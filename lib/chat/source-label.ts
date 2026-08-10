const SOURCE_LABEL_MAX_CHARS = 28
const TITLE_SEPARATOR = /\s+(?:—|–|-|\|)\s+/
const SOURCE_PREFIX = /^\s*(?:信息源|来源|source)\s*[:：]\s*/i

const DOMAIN_LABELS: Readonly<Record<string, string>> = {
  "ibm.com": "IBM",
  "linkedin.com": "LinkedIn",
  "runoob.com": "菜鸟教程",
  "cnblogs.com": "博客园",
  "github.com": "GitHub",
}

function hostnameLabel(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    for (const [domain, label] of Object.entries(DOMAIN_LABELS)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return label
    }
    const segment = hostname.split(".")[0] ?? hostname
    return segment
      ? segment.charAt(0).toUpperCase() + segment.slice(1)
      : "来源"
  } catch {
    return "来源"
  }
}

/** 将搜索结果的长页面标题收敛成适合胶囊展示的来源/站点短名。 */
export function compactSourceLabel(title: string, url: string): string {
  const normalized = title.replace(/\s+/g, " ").trim()
  const leadingSegment = normalized.split(TITLE_SEPARATOR)[0]?.trim() ?? ""
  if (
    leadingSegment &&
    leadingSegment.length <= SOURCE_LABEL_MAX_CHARS &&
    !/[?!？！]$/.test(leadingSegment)
  ) {
    return leadingSegment
  }
  return hostnameLabel(url)
}

/** assistant 来源胶囊已表达语义，不再额外占用一段“来源：”文字。 */
export function stripSourcePrefix(value: string): string {
  return value.replace(SOURCE_PREFIX, "")
}
