/** 分享的公开契约、容量与产品文案。 */
export const SHARE_EXPIRIES = ["unlimited", "3", "7", "30"] as const
export const SHARE_EXPIRY_LABELS = { unlimited: "无限", "3": "3 天", "7": "7 天", "30": "30 天" }
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/
export const SHARE_PAGE_PATTERN = /^\/share\/[A-Za-z0-9_-]{32}\/?$/
export const SHARE_LIMITS = { requestBytes: 128 * 1024, snapshotBytes: 8 * 1024 * 1024, threads: 500, messages: 10000, artifacts: 500, text: 2 * 1024 * 1024, coordinate: 100000, minWidth: 240, maxWidth: 1600 } as const
export const SHARE_NOTICE = "此链接保存创建时的内容与布局，后续修改不会同步。任何持有链接的人均可在有效期内阅读。Memory、Instructions 和附件不会分享，但已出现在对话或文档正文中的敏感内容不会自动打码，请检查后再分享。已加载或复制的内容无法收回。"
export const SHARE_UNAVAILABLE = "分享不可用，链接可能已过期或被撤销。"
export const SHARE_PENDING = "分享时尚未完成"
export const SHARE_ATTACHMENT = "附件未分享"
export const SHARE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" } as const
