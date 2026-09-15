"use client"

import { useCallback, useEffect, useMemo } from "react"
import { toast } from "sonner"
import {
  ARTIFACT_SOURCE_HIGHLIGHT_MS,
  ARTIFACT_SOURCE_LOCATE_ATTEMPTS,
  ARTIFACT_SOURCE_LOCATE_DELAY_MS,
} from "@/constants/artifact-navigation"
import {
  clearHighlights,
  locateAnchor,
  paintRange,
} from "../../branching/selection/text-anchor"
import type { ConversationStore } from "../../core/store"
import { useConversationStore } from "../../core/use-thread-store"
import type { ThreadChatClient } from "../../net/client"
import type { ConversationCommands } from "../../net/commands/conversation-commands"
import type { ArtifactSourceNav } from "../overlays/use-workspace-overlays"
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
  pendingSource,
  onConsumePendingSource,
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
  pendingSource: ArtifactSourceNav | null
  onConsumePendingSource(): void
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

  // 分支来源导航：openArtifact 同步带上 anchor，这里在对应 Artifact 渲染完成后
  // 精确定位并短暂高亮。重试有固定上限，绝不在其他文档或消息正文中按相同句子猜测。
  useEffect(() => {
    const request = pendingSource
    if (!open || !activeId || !request) return
    // openArtifact 同步设置 activeId 与 pendingSource；不匹配即过期请求，直接消费掉。
    if (request.artifactId !== activeId) {
      onConsumePendingSource()
      return
    }
    let cancelled = false
    let retryTimer: number | null = null
    let clearTimer: number | null = null
    const markId = `artifact-source:${request.artifactId}`

    const reveal = (attempt = 0) => {
      if (cancelled) return
      const surface = document.querySelector<HTMLElement>(
        `.project-panel.open [data-selection-artifact-id="${CSS.escape(request.artifactId)}"]`
      )
      const markdownRoot = surface?.querySelector<HTMLElement>(".md-body") ?? null
      if (!markdownRoot) {
        if (attempt < ARTIFACT_SOURCE_LOCATE_ATTEMPTS) {
          retryTimer = window.setTimeout(
            () => reveal(attempt + 1),
            ARTIFACT_SOURCE_LOCATE_DELAY_MS
          )
        } else {
          onConsumePendingSource()
          toast.error("已打开来源文档，但未能准确定位原文")
        }
        return
      }

      const located = locateAnchor(markdownRoot, request.anchor, {
        allowFuzzy: false,
      })
      if (!located) {
        onConsumePendingSource()
        toast.error("已打开来源文档，但未能准确定位原文")
        return
      }

      clearHighlights(markdownRoot, markId)
      const startElement =
        located.range.startContainer.nodeType === Node.TEXT_NODE
          ? located.range.startContainer.parentElement
          : (located.range.startContainer as Element)
      startElement?.scrollIntoView({ behavior: "smooth", block: "center" })
      paintRange(
        located.range,
        markId,
        "var(--tc-question-highlight, var(--tc-ink-hover))"
      )
      clearTimer = window.setTimeout(
        () => {
          clearHighlights(markdownRoot, markId)
          onConsumePendingSource()
        },
        ARTIFACT_SOURCE_HIGHLIGHT_MS
      )
    }

    const frame = window.requestAnimationFrame(() => reveal())
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      if (retryTimer) window.clearTimeout(retryTimer)
      if (clearTimer) window.clearTimeout(clearTimer)
      const root = document.querySelector<HTMLElement>(
        `.project-panel [data-selection-artifact-id="${CSS.escape(request.artifactId)}"] .md-body`
      )
      if (root) clearHighlights(root, markId)
    }
  }, [activeId, open, pendingSource, onConsumePendingSource])

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
