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

export const IMAGE_MODEL_VALIDATION_MESSAGE =
  "当前模型不支持图片，请切换视觉模型或移除图片。"

const MB = 1024 * 1024

/** 图片附件 MVP 限制与压缩参数的单一来源。 */
export const IMAGE_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const

export type ImageAttachmentMimeType =
  (typeof IMAGE_ATTACHMENT_MIME_TYPES)[number]

export const IMAGE_ATTACHMENT_LIMITS = {
  maxFilesPerMessage: 5,
  maxBytesPerFile: 10 * MB,
  maxLongestEdge: 2048,
  lossyOutputMediaType: "image/webp",
  lossyQuality: 0.8,
} as const

/** 短粘贴文本直接进入消息，避免语音转写产生无意义的附件上传。 */
export const INLINE_PASTED_TEXT_CHAR_LIMIT = 4_000

/** 作为 UTF-8 纯文本处理的常见文档与源码扩展名。 */
export const TEXT_ATTACHMENT_FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".mdx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".json",
  ".jsonc",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".xml",
  ".svg",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".config",
  ".env",
  ".py",
  ".pyi",
  ".rb",
  ".php",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rs",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".cs",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".vue",
  ".svelte",
] as const

export const ATTACHMENT_POLICIES: Record<string, AttachmentPolicy> = {
  "text/plain": { kind: "document", maxBytes: 20 * MB, ext: "txt" },
  "application/pdf": { kind: "document", maxBytes: 20 * MB, ext: "pdf" },
  "image/png": {
    kind: "image",
    maxBytes: IMAGE_ATTACHMENT_LIMITS.maxBytesPerFile,
    ext: "png",
  },
  "image/jpeg": {
    kind: "image",
    maxBytes: IMAGE_ATTACHMENT_LIMITS.maxBytesPerFile,
    ext: "jpg",
  },
  "image/webp": {
    kind: "image",
    maxBytes: IMAGE_ATTACHMENT_LIMITS.maxBytesPerFile,
    ext: "webp",
  },
  "image/gif": { kind: "image", maxBytes: 10 * MB, ext: "gif" },
  "application/zip": { kind: "archive", maxBytes: 50 * MB, ext: "zip" },
  "video/mp4": { kind: "video", maxBytes: 100 * MB, ext: "mp4" },
  "video/webm": { kind: "video", maxBytes: 100 * MB, ext: "webm" },
}

/** 文件选择器的 accept 属性（上传策略 + 规范为纯文本的源码扩展名）。 */
export const ATTACHMENT_ACCEPT = [
  ...Object.keys(ATTACHMENT_POLICIES),
  ...TEXT_ATTACHMENT_FILE_EXTENSIONS,
].join(",")

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
