// 附件模块的策略表：客户端（accept/预校验）与服务端（presign 校验、模型注入策略）共用。
// 新增附件类型 = 在 ATTACHMENT_POLICIES 加一行，无需改动上传/存储链路。

/** 附件大类，决定 UI 展示形态与模型注入策略 */
export type AttachmentKind = "document" | "image" | "archive" | "video"

export type AttachmentPolicy = {
  kind: AttachmentKind
  /** 单文件字节上限 */
  maxBytes: number
  /** R2 对象 key 使用的扩展名（白名单映射，绝不采用用户文件名里的扩展名） */
  ext: string
}

const MB = 1024 * 1024

export const ATTACHMENT_POLICIES: Record<string, AttachmentPolicy> = {
  "application/pdf": { kind: "document", maxBytes: 20 * MB, ext: "pdf" },
  "image/png": { kind: "image", maxBytes: 10 * MB, ext: "png" },
  "image/jpeg": { kind: "image", maxBytes: 10 * MB, ext: "jpg" },
  "image/webp": { kind: "image", maxBytes: 10 * MB, ext: "webp" },
  "image/gif": { kind: "image", maxBytes: 10 * MB, ext: "gif" },
  "application/zip": { kind: "archive", maxBytes: 50 * MB, ext: "zip" },
  "video/mp4": { kind: "video", maxBytes: 100 * MB, ext: "mp4" },
  "video/webm": { kind: "video", maxBytes: 100 * MB, ext: "webm" },
}

/** Composer 文件选择器的 accept 属性（由策略表推导） */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_POLICIES).join(",")

/** 附件在应用内的稳定访问路径前缀（消息 parts 里存的 URL；presigned URL 会过期，不能落库） */
export const ATTACHMENT_URL_PREFIX = "/api/attachments/"

/** presigned PUT 上传链接时效（秒） */
export const UPLOAD_URL_TTL_SECONDS = 600
/** presigned GET 读取链接时效（秒） */
export const DOWNLOAD_URL_TTL_SECONDS = 3600

/**
 * 单次对话请求中，全部附件正文允许占用的总字符预算。
 * MiniMax-M2 约 200K token 窗口；中文约 1 字符/​token、英文约 4 字符/token，
 * 取 12 万字符作为保守值，给对话历史与回答留出充足余量。
 */
export const ATTACHMENT_CONTEXT_CHAR_BUDGET = 120_000

/** 附件状态机：uploading（已建行/直传中）→ ready（可用）/ failed（不可用，error 里给原因） */
export const ATTACHMENT_STATUSES = ["uploading", "ready", "failed"] as const
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number]

// === 附件洞察（自动摘要 + 建议问题，冷启动引导） ===
/** 生成摘要/建议问题时喂给模型的最大字符数（控制成本与延迟；取文档前若干页） */
export const INSIGHTS_INPUT_CHAR_LIMIT = 20_000
/** 建议问题数量 */
export const SUGGESTED_QUESTION_COUNT = 3
