import type {
  ArtifactDTO,
  MessageDTO,
  ProjectDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { DocumentListItemDTO } from "@/lib/thread-chat/contracts/document"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import {
  isSafeShareUrl,
  sanitizeShareMarkdown,
  sanitizeShareText,
} from "./sanitize-links"

/**
 * 公开白名单：逐字段构造、parts 逐类型裁决。私有字段以常量填充（不复制源值），
 * 未识别 part 一律丢弃——源码新增私有字段不会自动进入快照。
 */

type Parts = ThreadChatUIMessage["parts"]

export interface WhitelistScope {
  /** 快照内的消息 ID（quote 来源校验） */
  messageIds: ReadonlySet<string>
  /** 快照内的 artifact ID（引用与工具卡校验） */
  artifactIds: ReadonlySet<string>
}

export function toPublicProject(project: ProjectDTO): ProjectDTO {
  return {
    id: project.id,
    rootThreadId: project.rootThreadId,
    autoTitle: project.autoTitle,
    customTitle: project.customTitle,
    target: null,
    instructions: null,
    contractVersion: 0,
    archivedAt: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

export function toPublicThread(thread: ThreadDTO): ThreadDTO {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentId: thread.parentId,
    forkMessageId: thread.forkMessageId,
    forkArtifactId: thread.forkArtifactId,
    forkContext: [...thread.forkContext],
    forkAnchor: thread.forkAnchor,
    anchorText: thread.anchorText,
    footnote: thread.footnote,
    depth: thread.depth,
    modelId: thread.modelId,
    autoTitle: thread.autoTitle,
    customTitle: thread.customTitle,
    titleGenerationAttempted: false,
    titleGenerated: false,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }
}

export function toPublicMessage(
  message: MessageDTO,
  scope: WhitelistScope
): MessageDTO {
  return {
    id: message.id,
    projectId: message.projectId,
    threadId: message.threadId,
    sequence: message.sequence,
    role: message.role,
    parts: sanitizeParts(message.parts, scope),
    status: message.status,
    modelId: message.modelId,
    replacesMessageId: message.replacesMessageId,
    supersededAt: message.supersededAt,
    feedback: null,
    error: null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    finishedAt: message.finishedAt,
  }
}

export function toPublicArtifact(artifact: ArtifactDTO): ArtifactDTO {
  return {
    ...(artifact.document ? { document: { ...artifact.document } } : {}),
    id: artifact.id,
    projectId: artifact.projectId,
    threadId: artifact.threadId,
    sourceMessageId: artifact.sourceMessageId,
    sourceThreadTitle: artifact.sourceThreadTitle,
    sourceThreadFootnote: artifact.sourceThreadFootnote,
    sourceMessageStatus: artifact.sourceMessageStatus,
    kind: artifact.kind,
    title: artifact.title,
    language: artifact.language,
    metadata: {},
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    content: sanitizeShareMarkdown(artifact.content),
  }
}

export function toPublicDocument(doc: DocumentListItemDTO): DocumentListItemDTO {
  return {
    id: doc.id,
    projectId: doc.projectId,
    currentRevisionId: doc.currentRevisionId,
    title: doc.title,
    revisionNumber: doc.revisionNumber,
    sourceMessageStatus: doc.sourceMessageStatus,
    currentArtifactId: doc.currentArtifactId,
    sourceThreadId: doc.sourceThreadId,
    sourceMessageId: doc.sourceMessageId,
  }
}

/* ========== parts 逐类型裁决 ========== */

type Part = Parts[number]
type SanitizedPart = Record<string, unknown>

const FILE_PART_PLACEHOLDER = "*附件未分享*"

function quoteSourceInScope(
  source: unknown,
  scope: WhitelistScope
): boolean {
  if (typeof source !== "object" || source === null) return false
  const value = source as { type?: string; messageId?: string; artifactId?: string }
  if (typeof value.messageId !== "string" || !scope.messageIds.has(value.messageId))
    return false
  if (value.type === "artifact")
    return typeof value.artifactId === "string" && scope.artifactIds.has(value.artifactId)
  return value.type === "message"
}

function sanitizeQuotePart(part: Part, scope: WhitelistScope): SanitizedPart {
  const data = (part as { data?: Record<string, unknown> }).data ?? {}
  const text = typeof data.text === "string" ? sanitizeShareText(data.text) : ""
  if ("source" in data && quoteSourceInScope(data.source, scope)) {
    const source = data.source as Record<string, unknown>
    const anchor = source.anchor as
      | { quote?: { exact?: string; prefix?: string; suffix?: string }; position?: unknown }
      | undefined
    return {
      type: "data-quote",
      data: {
        schemaVersion: data.schemaVersion,
        text,
        ...(typeof data.comment === "string"
          ? { comment: sanitizeShareText(data.comment) }
          : {}),
        source: {
          ...source,
          ...(anchor?.quote
            ? {
                anchor: {
                  ...anchor,
                  quote: {
                    exact: sanitizeShareText(anchor.quote.exact ?? ""),
                    prefix: sanitizeShareText(anchor.quote.prefix ?? ""),
                    suffix: sanitizeShareText(anchor.quote.suffix ?? ""),
                  },
                },
              }
            : {}),
        },
      },
    }
  }
  // 来源不在快照内：降级为纯文本引用（legacy 形态），不携带任何悬空 ID
  return { type: "data-quote", data: { text } }
}

function sanitizeResearchActivity(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data
  const activity = data as Record<string, unknown>
  const sources = Array.isArray(activity.sources)
    ? activity.sources.flatMap((source) => {
        if (typeof source !== "object" || source === null) return []
        const item = source as { title?: unknown; url?: unknown }
        if (typeof item.url !== "string" || !isSafeShareUrl(item.url)) return []
        return [
          {
            title:
              typeof item.title === "string"
                ? sanitizeShareText(item.title)
                : item.url,
            url: item.url,
          },
        ]
      })
    : []
  return {
    ...activity,
    ...(typeof activity.url === "string" && !isSafeShareUrl(activity.url)
      ? { url: undefined }
      : {}),
    sources,
  }
}

function sanitizeResearchRoute(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data
  const route = data as Record<string, unknown>
  return {
    ...route,
    urls: Array.isArray(route.urls)
      ? route.urls.filter(
          (url): url is string => typeof url === "string" && isSafeShareUrl(url)
        )
      : [],
  }
}

function sanitizeWebSearchPart(part: Part): SanitizedPart | null {
  const tool = part as {
    toolCallId: string
    state: string
    input?: { query?: string }
    output?: { query?: string; results?: { title?: string; url?: string; snippet?: string }[] }
  }
  if (tool.state !== "output-available" || !tool.output) return null
  const results = (tool.output.results ?? []).flatMap((result) => {
    if (typeof result.url !== "string" || !isSafeShareUrl(result.url)) return []
    return [
      {
        title: sanitizeShareText(result.title ?? result.url),
        url: result.url,
        snippet: sanitizeShareText(result.snippet ?? ""),
      },
    ]
  })
  return {
    type: "tool-webSearch",
    toolCallId: tool.toolCallId,
    state: "output-available",
    input: { query: tool.input?.query ?? tool.output.query ?? "" },
    output: { query: tool.output.query ?? "", results },
  }
}

function sanitizeReadUrlPart(part: Part): SanitizedPart | null {
  const tool = part as {
    toolCallId: string
    state: string
    input?: { url?: string }
    output?: { url?: string; content?: string }
  }
  const url = tool.output?.url ?? tool.input?.url ?? ""
  if (tool.state !== "output-available" || !isSafeShareUrl(url)) return null
  return {
    type: "tool-readUrl",
    toolCallId: tool.toolCallId,
    state: "output-available",
    input: { url },
    output: { url, content: "" },
  }
}

function sanitizeCreateArtifactPart(
  part: Part,
  scope: WhitelistScope
): SanitizedPart | null {
  const tool = part as {
    toolCallId: string
    state: string
    input?: { title?: string }
    output?: { created?: boolean; artifactId?: string }
  }
  const artifactId = tool.output?.artifactId
  if (
    tool.state !== "output-available" ||
    typeof artifactId !== "string" ||
    !scope.artifactIds.has(artifactId)
  )
    return null
  return {
    type: "tool-createMarkdownArtifact",
    toolCallId: tool.toolCallId,
    state: "output-available",
    input: { title: sanitizeShareText(tool.input?.title ?? "") },
    output: { created: true, artifactId },
  }
}

function sanitizeFindDocumentsPart(part: Part): SanitizedPart | null {
  const tool = part as {
    toolCallId: string
    state: string
    input?: { query?: string; artifactId?: string }
    output?: { id: string; projectId: string; currentRevisionId: string; title: string }[]
  }
  if (tool.state !== "output-available" || !Array.isArray(tool.output)) return null
  return {
    type: "tool-findProjectDocuments",
    toolCallId: tool.toolCallId,
    state: "output-available",
    input: tool.input ?? {},
    output: tool.output.map((doc) => ({
      id: doc.id,
      projectId: doc.projectId,
      currentRevisionId: doc.currentRevisionId,
      title: sanitizeShareText(doc.title),
    })),
  }
}

function sanitizeReadDocumentPart(part: Part): SanitizedPart | null {
  const tool = part as {
    toolCallId: string
    state: string
    input?: { documentId?: string; revisionId?: string }
    output?: {
      document?: { id: string; projectId: string; currentRevisionId: string; title: string }
      revision?: Record<string, unknown> & { content?: string }
      readId?: string
      isCurrent?: boolean
    }
  }
  const output = tool.output
  if (tool.state !== "output-available" || !output?.document || !output.revision)
    return null
  return {
    type: "tool-readProjectDocument",
    toolCallId: tool.toolCallId,
    state: "output-available",
    input: {
      documentId: tool.input?.documentId ?? output.document.id,
      ...(tool.input?.revisionId ? { revisionId: tool.input.revisionId } : {}),
    },
    output: {
      document: {
        id: output.document.id,
        projectId: output.document.projectId,
        currentRevisionId: output.document.currentRevisionId,
        title: sanitizeShareText(output.document.title),
      },
      revision: {
        ...output.revision,
        title: sanitizeShareText(
          typeof output.revision.title === "string" ? output.revision.title : ""
        ),
        content: "",
      },
      readId: "",
      isCurrent: output.isCurrent === true,
    },
  }
}

function sanitizeUpdateDocumentPart(part: Part): SanitizedPart | null {
  const tool = part as {
    toolCallId: string
    state: string
    input?: { documentId?: string; changeSummary?: string }
    output?: Record<string, unknown>
  }
  if (tool.state !== "output-available" || !tool.output) return null
  const output = { ...tool.output }
  if (typeof output.changeSummary === "string")
    output.changeSummary = sanitizeShareText(output.changeSummary)
  return {
    type: "tool-updateProjectDocument",
    toolCallId: tool.toolCallId,
    state: "output-available",
    input: {
      documentId: tool.input?.documentId ?? "",
      expectedRevisionId: "",
      readId: "",
      edits: [],
      changeSummary: sanitizeShareText(tool.input?.changeSummary ?? ""),
    },
    output,
  }
}

const DROPPED_DATA_PARTS = new Set([
  "data-project-document-updates",
  "data-document-update-notices",
  "data-artifact-progress",
])

function sanitizePart(part: Part, scope: WhitelistScope): SanitizedPart | null {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: sanitizeShareMarkdown((part as { text: string }).text),
      }
    case "reasoning":
      return {
        type: "reasoning",
        text: sanitizeShareText((part as { text: string }).text),
      }
    case "step-start":
      return { type: "step-start" }
    case "source-url": {
      const source = part as { sourceId: string; url: string; title?: string }
      if (!isSafeShareUrl(source.url)) return null
      return {
        type: "source-url",
        sourceId: source.sourceId,
        url: source.url,
        ...(source.title ? { title: sanitizeShareText(source.title) } : {}),
      }
    }
    case "file":
      // 附件不公开：原位给文本占位，不携带 url/filename/mediaType
      return { type: "text", text: FILE_PART_PLACEHOLDER }
    case "data-quote":
      return sanitizeQuotePart(part, scope)
    case "data-artifact-reference": {
      const data = (part as { data?: { artifactId?: string; title?: string } })
        .data
      if (!data || typeof data.artifactId !== "string") return null
      if (!scope.artifactIds.has(data.artifactId)) return null
      return {
        type: "data-artifact-reference",
        data: {
          ...(data as Record<string, unknown>),
          title: sanitizeShareText(data.title ?? ""),
        },
      }
    }
    case "data-research-activity":
      return {
        type: "data-research-activity",
        data: sanitizeResearchActivity(
          (part as { data?: unknown }).data
        ),
      }
    case "data-research-route":
      return {
        type: "data-research-route",
        data: sanitizeResearchRoute((part as { data?: unknown }).data),
      }
    case "data-research-plan":
      return part as SanitizedPart
    case "tool-webSearch":
      return sanitizeWebSearchPart(part)
    case "tool-readUrl":
      return sanitizeReadUrlPart(part)
    case "tool-createMarkdownArtifact":
      return sanitizeCreateArtifactPart(part, scope)
    case "tool-findProjectDocuments":
      return sanitizeFindDocumentsPart(part)
    case "tool-readProjectDocument":
      return sanitizeReadDocumentPart(part)
    case "tool-updateProjectDocument":
      return sanitizeUpdateDocumentPart(part)
    default:
      // 未识别的 data-*/tool-*、瞬态 UI marker、dynamic-tool 等一律丢弃
      if (part.type.startsWith("data-") || part.type.startsWith("tool-"))
        return null
      return null
  }
}

export function sanitizeParts(parts: Parts, scope: WhitelistScope): Parts {
  return parts.flatMap((part) => {
    if (typeof part !== "object" || part === null) return []
    if (
      DROPPED_DATA_PARTS.has(part.type) ||
      ("transient" in part && (part as { transient?: boolean }).transient)
    )
      return []
    const sanitized = sanitizePart(part, scope)
    return sanitized ? [sanitized as Parts[number]] : []
  })
}
