"use client"

import { useMemo } from "react"
import { createConversationStore } from "@/app/thread-chat/core/store"
import type { WorkspaceUiState } from "@/app/thread-chat/core/types"
import {
  ThreadChatApiError,
  type ThreadChatClient,
} from "@/app/thread-chat/net/client"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { ConversationCommands } from "@/app/thread-chat/net/commands/conversation-commands"
import type { PublicLayout, PublicProjectSnapshot } from "@/lib/thread-chat/sharing/contracts"
import { SHARE_UI_COPY } from "@/constants/sharing"

const readOnly = <T,>(): Promise<T> =>
  Promise.reject(new Error(SHARE_UI_COPY.readOnlyWrite))

/**
 * 与 createConversationCommands 同接口的空命令：任何写路径在这里立即失败，
 * 根本到不了网络。UI 禁用位没盖住的遗漏也由它兜底（fail-closed）。
 */
export function createReadOnlyCommands(): ConversationCommands {
  return {
    startProject: readOnly,
    sendMessage: readOnly,
    forkThread: readOnly,
    retryMessage: readOnly,
    editLatestTurn: readOnly,
    stopMessage: readOnly,
    setFeedback: readOnly,
    updateThread: readOnly,
    renameProject: readOnly,
    updateProjectContract: readOnly,
    addProjectFile: readOnly,
    removeProjectFile: readOnly,
    setProjectArchived: readOnly,
    deleteProject: readOnly,
    dispose() {},
  }
}

/**
 * 只从快照回答的 client：getArtifact/文档历史读快照内容（版本导航只给 pin 的当前版），
 * 项目列表为空，其余方法一律只读拒绝——share token 从不离开 /api/share/[token]。
 */
export function createShareClient(
  snapshot: PublicProjectSnapshot
): ThreadChatClient {
  const artifacts = new Map(
    snapshot.entities.artifacts.map((artifact) => [artifact.id, artifact])
  )
  const documents = new Map(
    snapshot.entities.documents.map((document) => [document.id, document])
  )
  const base: Partial<ThreadChatClient> = {
    listProjects: () => Promise.resolve([]),
    listDocuments: (projectId) =>
      projectId === snapshot.entities.project?.id
        ? Promise.resolve({
            artifacts: snapshot.entities.artifacts,
            documents: snapshot.entities.documents,
          })
        : Promise.reject(new ThreadChatApiError(404, { code: "NOT_FOUND", message: "资源不存在" })),
    getArtifact: (artifactId) => {
      // 快照 artifacts 携带白名单后的正文（ArtifactDTO）；契约按 Summary 收窄
      const artifact = artifacts.get(artifactId) as ArtifactDTO | undefined
      return artifact
        ? Promise.resolve(artifact)
        : Promise.reject(new ThreadChatApiError(404, { code: "NOT_FOUND", message: "资源不存在" }))
    },
    // 只读快照只 pin 当前版；历史列表为空 → 版本导航自然不出现。
    getDocumentHistory: (documentId) =>
      documents.has(documentId)
        ? Promise.resolve([])
        : Promise.reject(new ThreadChatApiError(404, { code: "NOT_FOUND", message: "资源不存在" })),
    getMessage: (messageId) => {
      const message = snapshot.entities.messages.find(
        (candidate) => candidate.id === messageId
      )
      return message
        ? Promise.resolve(message)
        : Promise.reject(new ThreadChatApiError(404, { code: "NOT_FOUND", message: "资源不存在" }))
    },
  }
  return new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target]
      return () => Promise.reject(new Error(SHARE_UI_COPY.readOnlyWrite))
    },
  }) as ThreadChatClient
}

function workspaceFromLayout(
  layout: PublicLayout,
  fallbackThreadId: string
): Partial<WorkspaceUiState> {
  return {
    view: layout.view,
    openThreadIds: layout.columnSlots.map((slot) => slot.threadId),
    columnSlots: layout.columnSlots,
    columnWidths: layout.columnWidths,
    forceColumns: layout.forceColumns,
    placementMode: layout.placementMode,
    selectedThreadId: layout.selectedThreadId ?? fallbackThreadId,
    canvas: layout.canvas,
    panelSizes: layout.panelSizes,
    expandedNodes: layout.expandedNodes,
  }
}

export type ShareRuntime = {
  store: ReturnType<typeof createConversationStore>
  client: ThreadChatClient
  commands: ConversationCommands
  status: "ready"
  error: null
  /** overlay 初值：分享时的 Artifact 抽屉状态 */
  initialOverlay: { drawerOpen: boolean; activeArtifactId: string | null }
}

/**
 * 与 useConversationRuntime 同形的只读 runtime：快照 hydrate + 快照布局 +
 * 空命令。不跑 boot——localStorage、轮询、恢复、订阅天然缺席。
 */
export function useShareRuntime(
  snapshot: PublicProjectSnapshot
): ShareRuntime {
  return useMemo(() => {
    const rootThreadId =
      snapshot.entities.project?.rootThreadId ??
      snapshot.entities.threads[0]?.id ??
      ""
    return {
      store: createConversationStore({
        bootstrap: snapshot.entities,
        workspace: workspaceFromLayout(snapshot.layout, rootThreadId),
      }),
      client: createShareClient(snapshot),
      commands: createReadOnlyCommands(),
      status: "ready" as const,
      error: null,
      initialOverlay: {
        drawerOpen: snapshot.layout.drawerOpen,
        activeArtifactId: snapshot.layout.activeArtifactId,
      },
    }
  }, [snapshot])
}
