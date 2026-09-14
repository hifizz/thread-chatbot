"use client"

import { useCallback, useEffect, useMemo } from "react"
import type { ConversationStore } from "../../core/store"
import { useConversationStore } from "../../core/use-thread-store"
import type { ThreadChatClient } from "../../net/client"
import type { ConversationCommands } from "../../net/commands/conversation-commands"
import { ProjectPanel } from "./project-panel"

function findMessageElement(messageId: string): HTMLElement | null {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        "[data-thread-chat-message-id]"
      ),
    ].find((element) => element.dataset.threadChatMessageId === messageId) ??
    null
  )
}

function revealMessage(messageId: string, attempt = 0) {
  const element = findMessageElement(messageId)
  if (!element) {
    if (attempt < 8)
      window.setTimeout(() => revealMessage(messageId, attempt + 1), 60)
    return
  }
  element.scrollIntoView({ behavior: "smooth", block: "center" })
  element.animate(
    [
      { backgroundColor: "transparent" },
      { backgroundColor: "var(--tc-ink-hover)" },
      { backgroundColor: "transparent" },
    ],
    { duration: 1600, easing: "ease-out" }
  )
}

export function StoreBoundProjectPanel({
  projectId,
  store,
  client,
  commands,
  open,
  activeId,
  onClose,
  onSelect,
  onLocate,
}: {
  projectId: string
  store: ConversationStore
  client: ThreadChatClient
  commands: ConversationCommands
  open: boolean
  activeId: string | null
  onClose(): void
  onSelect(id: string): void
  onLocate(threadId: string, sourceMessageId: string): void
}) {
  const state = useConversationStore(store, (value) => value)
  const files = useMemo(
    () =>
      state.projectFileOrder.flatMap((id) => {
        const file = state.projectFilesById[id]
        return file ? [file] : []
      }),
    [state.projectFileOrder, state.projectFilesById]
  )
  const artifacts = useMemo(
    () =>
      state.artifactOrder.flatMap((id) => {
        const artifact = state.artifactsById[id]
        return artifact ? [artifact] : []
      }),
    [state.artifactOrder, state.artifactsById]
  )

  // ProjectPanel 的渲染组件保持纯展示；这里把当前 Markdown 阅读区标记成可划选来源。
  // 全局唯一 selection observer 据此获得稳定的 artifact/message/thread identity。
  useEffect(() => {
    if (!open || !activeId) return
    const artifact = state.artifactsById[activeId]
    if (!artifact || artifact.kind !== "markdown" || !state.project) return
    const frame = window.requestAnimationFrame(() => {
      const surface = document.querySelector<HTMLElement>(
        ".project-panel.open .project-artifact-content"
      )
      if (!surface) return
      surface.dataset.selectionArtifactId = artifact.id
      surface.dataset.selectionMessageId = artifact.sourceMessageId
      surface.dataset.selectionThreadId =
        artifact.threadId === state.project?.rootThreadId
          ? "main"
          : artifact.threadId
    })
    return () => {
      window.cancelAnimationFrame(frame)
      const surface = document.querySelector<HTMLElement>(
        ".project-panel .project-artifact-content"
      )
      if (!surface) return
      delete surface.dataset.selectionArtifactId
      delete surface.dataset.selectionMessageId
      delete surface.dataset.selectionThreadId
    }
  }, [activeId, open, state.artifactsById, state.project])

  const refresh = useCallback(async () => {
    const bootstrap = await client.getProject(projectId)
    store.getState().hydrateProject(bootstrap)
  }, [client, projectId, store])

  const saveContract = useCallback(
    async (target: string, instructions: string) => {
      await commands.updateProjectContract({
        projectId,
        target,
        instructions,
      })
    },
    [commands, projectId]
  )
  const addProjectFile = useCallback(
    async (attachmentId: string) => {
      await commands.addProjectFile(attachmentId)
    },
    [commands]
  )
  const removeProjectFile = useCallback(
    async (attachmentId: string) => {
      await commands.removeProjectFile(attachmentId)
    },
    [commands]
  )
  const locate = useCallback(
    (threadId: string, sourceMessageId: string) => {
      onLocate(threadId, sourceMessageId)
      revealMessage(sourceMessageId)
    },
    [onLocate]
  )

  return (
    <ProjectPanel
      project={state.project}
      files={files}
      artifacts={artifacts}
      open={open}
      activeId={activeId}
      onClose={onClose}
      onSelect={onSelect}
      onLocate={locate}
      onRefresh={refresh}
      onSaveContract={saveContract}
      onAddProjectFile={addProjectFile}
      onRemoveProjectFile={removeProjectFile}
    />
  )
}
