/** 快照分享的期限选项、token 规格、尺寸上限与提示文案。 */

export const SHARE_EXPIRY_OPTIONS = [
  { value: "d3", label: "3 天", days: 3 },
  { value: "d7", label: "7 天", days: 7 },
  { value: "d30", label: "30 天", days: 30 },
  { value: "never", label: "无限期", days: null },
] as const

export type ShareExpiry = (typeof SHARE_EXPIRY_OPTIONS)[number]["value"]
export const SHARE_EXPIRY_VALUES = ["d3", "d7", "d30", "never"] as const
export const SHARE_EXPIRY_DEFAULT: ShareExpiry = "never"

export function shareExpiryDays(expiry: ShareExpiry): number | null {
  const option = SHARE_EXPIRY_OPTIONS.find((item) => item.value === expiry)
  return option?.days ?? null
}

/** token 为 24 字节随机（192 bit）的 base64url 编码，共 32 字符。 */
export const SHARE_TOKEN_BYTES = 24
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/

/** 宽松上限：够用即可，超限明确失败而不是截断或崩溃。 */
export const SHARE_LIMITS = {
  snapshotBytes: 16 * 1024 * 1024,
  layoutBytes: 512 * 1024,
  threads: 5_000,
  messages: 5_000,
  artifacts: 500,
  documents: 200,
  columnSlots: 64,
  columnWidths: 64,
  canvasPins: 256,
  expandedNodes: 512,
  coordinate: 1_000_000,
  zoomMin: 0.05,
  zoomMax: 8,
  panelSize: 10_000,
} as const

export const SHARE_UI_COPY = {
  dialogTitle: "分享",
  expiryLabel: "有效期",
  createAction: "创建分享链接",
  copyAction: "复制链接",
  copied: "已复制链接",
  revokeAction: "撤销",
  revoked: "已撤销",
  statusActive: "有效",
  statusExpired: "已过期",
  statusRevoked: "已撤销",
  listEmpty: "还没有分享链接",
  shareNotice:
    "此链接保存创建时的内容与布局，后续修改不会同步。任何持有链接的人均可在有效期内阅读。Instructions 与附件不会分享，但已出现在对话或文档正文中的敏感内容不会自动打码，请检查后再分享。",
  unavailable: "此分享链接不存在、已过期或已被撤销。",
  readOnlyBadge: "只读快照",
  createFailed: "创建分享失败，请稍后重试。",
} as const
