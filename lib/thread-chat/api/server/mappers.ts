import type { Artifact } from "../../domain/artifact"
import type { Message } from "../../domain/message"
import type { MessageRun } from "../../domain/message-run"
import type { Project } from "../../domain/project"
import type { Thread } from "../../domain/thread"
import type { ProjectSummary } from "../../application/application-types"

const iso = (value: Date | null) => value?.toISOString() ?? null

export function toProjectDTO(project: Project) {
  return {
    id: project.id,
    ownerUserId: project.ownerUserId,
    autoTitle: project.autoTitle,
    customTitle: project.customTitle,
    target: project.target,
    instruction: project.instruction,
    archivedAt: iso(project.archivedAt),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

export function toProjectSummaryDTO(project: ProjectSummary) {
  return {
    id: project.id,
    displayTitle: project.displayTitle,
    archivedAt: iso(project.archivedAt),
    updatedAt: project.updatedAt.toISOString(),
    threadCount: project.threadCount,
    messageCount: project.messageCount,
  }
}

export function toThreadDTO(thread: Thread) {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    sourceMessageId: thread.sourceMessageId,
    forkSourceSnapshot: thread.forkSourceSnapshot,
    autoTitle: thread.autoTitle,
    customTitle: thread.customTitle,
    archivedAt: iso(thread.archivedAt),
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  }
}

export function toMessageDTO(message: Message) {
  return {
    id: message.id,
    threadId: message.threadId,
    sequence: message.sequence,
    role: message.role,
    parts: message.parts,
    replacesMessageId: message.replacesMessageId,
    supersededAt: iso(message.supersededAt),
    finalizedAt: iso(message.finalizedAt),
    createdAt: message.createdAt.toISOString(),
  }
}

export function toAssistantRunStateDTO(run: MessageRun) {
  return {
    assistantMessageId: run.assistantMessageId,
    status: run.status,
    modelId: run.modelId,
    checkpointParts: run.checkpointParts,
    eventSequence: run.eventSequence,
    error:
      run.errorCode && run.errorMessage
        ? { code: run.errorCode, message: run.errorMessage }
        : null,
    stopRequestedAt: iso(run.stopRequestedAt),
    finishedAt: iso(run.finishedAt),
  }
}

export function toArtifactDTO(artifact: Artifact) {
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    sourceMessageId: artifact.sourceMessageId,
    kind: artifact.kind,
    title: artifact.title,
    content: artifact.content,
    createdAt: artifact.createdAt.toISOString(),
  }
}

export function toThreadMessageBundleDTO(bundle: {
  threadId: string
  messages: Message[]
  assistantRuns: MessageRun[]
  hasOlderMessages: boolean
  oldestReturnedSequence: number | null
  newestReturnedSequence: number | null
}) {
  return {
    ...bundle,
    messages: bundle.messages.map(toMessageDTO),
    assistantRuns: bundle.assistantRuns.map(toAssistantRunStateDTO),
  }
}
