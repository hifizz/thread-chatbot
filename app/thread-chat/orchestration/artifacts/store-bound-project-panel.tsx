"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"
import {
  ARTIFACT_SOURCE_HIGHLIGHT_MS,
  ARTIFACT_SOURCE_LOCATE_ATTEMPTS,
  ARTIFACT_SOURCE_LOCATE_DELAY_MS,
  ARTIFACT_SOURCE_NAVIGATION_EVENT,
} from "@/constants/artifact-navigation"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import {
  clearHighlights,
  locateAnchor,
  paintRange,
} from "../../branching/selection/text-anchor"
import type { ConversationStore } from "../../core/store"
import { useConversationStore } from "../../core/use-thread-store"
import type { ThreadChatClient } from "../../net/client"
import type { ConversationCommands } from "../../net/commands/conversation-commands"
import { ProjectPanel } from "./project-panel"

interface ArtifactSourceNavigationDetail {
  artifactId: string
  anchor: TextAnchor
}

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
  const pendingSource = useRef<ArtifactSourceNavigationDetail | null>(null)
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

  useEffect(() => {
    const onArtifactSource = (event: Event) => {
      const detail = (event as CustomEvent<ArtifactSourceNavigationDetail>).detail
      if (!detail?.artifactId || !detail.anchor) return
      pendingSource.current = detail
    }
    window.addEventListener(ARTIFACT_SOURCE_NAVIGATION_EVENT, onArtifactSource)
    return () =>
      window.removeEventListener(ARTIFACT_SOURCE_NAVIGATION_EVENT, onArtifactSource)
  }, [])

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

  // 分支来源导航：先由上层打开正确 Artifact，再在该内容根中精确定位并短暂高亮。
  // 重试有固定上限，绝不在其他文档或消息正文中按相同句子猜测。
  useEffect(() => {
    const request = pendingSource.current
    if (!open || !activeId || !request || request.artifactId !== activeId) return
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let clearTimer: ReturnType<typeof setTimeout> | null = null
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
          pendingSource.current = null
          toast.error("已打开来源文档，但未能准确定位原文")
        }
        return
      }

      const located = locateAnchor(markdownRoot, request.anchor, {
        fuzzyThreshold: 1,
      })
      if (!located || located.strategy === "fuzzy") {
        pendingSource.current = null
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
      pendingSource.current = null
      clearTimer = window.setTimeout(
        () => clearHighlights(markdownRoot, markId),
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
  }, [activeId, open])

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
