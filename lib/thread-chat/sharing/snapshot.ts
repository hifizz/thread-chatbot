import { SHARE_LIMITS } from "@/constants/sharing"
import type {
  ArtifactDTO,
  MessageDTO,
  ProjectDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { DocumentListItemDTO } from "@/lib/thread-chat/contracts/document"
import { currentTimeline } from "@/lib/thread-chat/domain/timeline"
import type {
  PublicDocumentSnapshot,
  PublicLayout,
  PublicProjectSnapshot,
} from "./contracts"
import { normalizeShareLayout } from "./layout"
import {
  toPublicArtifact,
  toPublicDocument,
  toPublicMessage,
  toPublicProject,
  toPublicThread,
} from "./whitelist"
import { sanitizeShareMarkdown } from "./sanitize-links"

export type ShareSnapshotErrorCode =
  | "SNAPSHOT_INCOMPLETE"
  | "SNAPSHOT_TOO_LARGE"

export class ShareSnapshotError extends Error {
  readonly code: ShareSnapshotErrorCode
  constructor(code: ShareSnapshotErrorCode, message: string) {
    super(message)
    this.name = "ShareSnapshotError"
    this.code = code
  }
}

export interface ProjectSnapshotSource {
  /** 已通过所有权校验的 Project */
  project: ProjectDTO
  /** 项目全部 Thread */
  threads: ThreadDTO[]
  /** 项目全部消息（含已被替换的） */
  messages: MessageDTO[]
  /** 项目全部 Artifact（含正文） */
  artifacts: ArtifactDTO[]
  /** 文档目录（已 pin 当前版本） */
  documents: DocumentListItemDTO[]
  /** 已通过契约校验的布局 */
  layout: PublicLayout
  /** 服务端创建时间 */
  createdAt: string
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

function assertWithinLimits(source: ProjectSnapshotSource): void {
  if (source.threads.length > SHARE_LIMITS.threads)
    throw new ShareSnapshotError(
      "SNAPSHOT_TOO_LARGE",
      `Thread 数量超过 ${SHARE_LIMITS.threads}`
    )
  if (source.messages.length > SHARE_LIMITS.messages)
    throw new ShareSnapshotError(
      "SNAPSHOT_TOO_LARGE",
      `消息数量超过 ${SHARE_LIMITS.messages}`
    )
  if (source.artifacts.length > SHARE_LIMITS.artifacts)
    throw new ShareSnapshotError(
      "SNAPSHOT_TOO_LARGE",
      `Artifact 数量超过 ${SHARE_LIMITS.artifacts}`
    )
  if (source.documents.length > SHARE_LIMITS.documents)
    throw new ShareSnapshotError(
      "SNAPSHOT_TOO_LARGE",
      `文档数量超过 ${SHARE_LIMITS.documents}`
    )
}

function assertSameProject(source: ProjectSnapshotSource): void {
  const projectId = source.project.id
  const belongs = (entity: { projectId: string }) => entity.projectId === projectId
  if (
    !source.threads.every(belongs) ||
    !source.messages.every(belongs) ||
    !source.artifacts.every(belongs) ||
    !source.documents.every(belongs)
  )
    throw new ShareSnapshotError(
      "SNAPSHOT_INCOMPLETE",
      "存在跨 Project 的实体引用"
    )
}

/**
 * Project 快照：全部 Thread + 阅读闭包消息 + 全部 Artifact + 当前版文档目录 + 布局。
 * 闭包 = 当前时间线 ∪ forkContext/forkMessageId 来源 ∪ Artifact/Document 来源链。
 */
export function buildProjectSnapshot(
  source: ProjectSnapshotSource
): PublicProjectSnapshot {
  assertSameProject(source)
  assertWithinLimits(source)

  const threadIds = new Set(source.threads.map((thread) => thread.id))
  const rootThread = source.threads.find((thread) => thread.parentId === null)
  if (!rootThread || source.project.rootThreadId !== rootThread.id)
    throw new ShareSnapshotError("SNAPSHOT_INCOMPLETE", "缺少根 Thread")

  const messagesById = new Map(
    source.messages.map((message) => [message.id, message])
  )
  const neededIds = new Set(
    currentTimeline(source.messages).map((message) => message.id)
  )
  const references = [
    ...source.threads.flatMap((thread) => [
      thread.forkMessageId,
      ...thread.forkContext,
    ]),
    ...source.artifacts.map((artifact) => artifact.sourceMessageId),
    ...source.documents.map((document) => document.sourceMessageId),
  ]
  for (const id of references) {
    if (id === null) continue
    if (!messagesById.has(id))
      throw new ShareSnapshotError(
        "SNAPSHOT_INCOMPLETE",
        `引用的消息 ${id} 不存在或不属于该 Project`
      )
    neededIds.add(id)
  }

  const artifactIds = new Set(source.artifacts.map((artifact) => artifact.id))
  for (const document of source.documents)
    if (!artifactIds.has(document.currentArtifactId))
      throw new ShareSnapshotError(
        "SNAPSHOT_INCOMPLETE",
        `文档 ${document.id} 的当前版本缺少对应 Artifact`
      )

  const scope = { messageIds: neededIds, artifactIds }
  const messages = source.messages
    .filter((message) => neededIds.has(message.id))
    .map((message) => toPublicMessage(message, scope))

  const entities = {
    project: toPublicProject(source.project),
    files: [],
    threads: source.threads.map(toPublicThread),
    messages,
    artifacts: source.artifacts.map(toPublicArtifact),
    documents: source.documents.map(toPublicDocument),
    activeGenerationIds: [],
  }
  const layout = normalizeShareLayout(source.layout, {
    threadIds,
    artifactIds,
  })

  if (byteLength({ entities, layout }) > SHARE_LIMITS.snapshotBytes)
    throw new ShareSnapshotError(
      "SNAPSHOT_TOO_LARGE",
      "快照超过尺寸上限，暂不支持分享"
    )

  return {
    schemaVersion: 1,
    kind: "project",
    createdAt: source.createdAt,
    entities,
    layout,
  }
}

export interface DocumentSnapshotSource {
  document: Pick<
    DocumentListItemDTO,
    "id" | "title" | "currentRevisionId" | "revisionNumber" | "currentArtifactId"
  >
  revisionCreatedAt: string
  /** 已 pin 版本的 Markdown 正文 */
  content: string
  createdAt: string
}

export function buildDocumentSnapshot(
  source: DocumentSnapshotSource
): PublicDocumentSnapshot {
  return {
    schemaVersion: 1,
    kind: "document",
    createdAt: source.createdAt,
    document: {
      id: source.document.id,
      title: source.document.title,
      revisionId: source.document.currentRevisionId,
      revisionNumber: source.document.revisionNumber,
      artifactId: source.document.currentArtifactId,
      createdAt: source.revisionCreatedAt,
    },
    content: sanitizeShareMarkdown(source.content),
  }
}
