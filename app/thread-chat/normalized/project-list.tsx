"use client"

import { useEffect, useMemo, useState, type RefObject } from "react"
import { useRouter } from "next/navigation"
import { ListTodo } from "lucide-react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Dialog, DialogPortal } from "@/components/ui/dialog"
import {
  CUSTOM_TITLE_MAX_LEN,
  THREAD_CHAT_SHORTCUTS,
} from "@/constants/thread-chat"
import {
  useThreadChatAppRuntime,
} from "@/lib/thread-chat/client/providers"
import { useThreadChatAppStore } from "@/lib/thread-chat/client/hooks"
import { threadChatRoutes } from "@/lib/thread-chat/api/routes"
import { dialogCloseToShell } from "../orchestration/overlays/dialog-close-to-shell"
import { ShortcutHint } from "../orchestration/overlays/shortcut-hint"
import { TreeListRow } from "../orchestration/navigation/tree-list-row"

export function ProjectList({
  currentProjectId,
  closing = false,
  container,
  onClose,
  onToast,
}: {
  currentProjectId: string | null
  closing?: boolean
  container?: RefObject<HTMLElement | null>
  onClose(): void
  onToast(message: string): void
}) {
  const router = useRouter()
  const runtime = useThreadChatAppRuntime()
  const catalog = useThreadChatAppStore((state) => state.catalog)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    void runtime.commands.loadProjectCatalog({ reset: true })
  }, [runtime])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (editingId !== null) {
        event.stopPropagation()
        setEditingId(null)
      } else if (confirmId !== null) {
        event.stopPropagation()
        setConfirmId(null)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [confirmId, editingId])

  const rows = useMemo(() => {
    const items = catalog.orderedProjectIds
      .map((id) => catalog.projectsById[id])
      .filter(Boolean)
    return [
      ...items.filter((item) => item.id === currentProjectId),
      ...items.filter((item) => item.id !== currentProjectId),
    ]
  }, [catalog.orderedProjectIds, catalog.projectsById, currentProjectId])

  async function rename(projectId: string) {
    const previous = catalog.projectsById[projectId]
    const title = draft.trim()
    setEditingId(null)
    if (!previous || !title || title === previous.displayTitle) return
    if (title.length > CUSTOM_TITLE_MAX_LEN) {
      onToast(`标题最长 ${CUSTOM_TITLE_MAX_LEN} 字，未保存`)
      return
    }
    runtime.appStore.getState().upsertProjectSummary({
      ...previous,
      displayTitle: title,
    })
    try {
      const project = await runtime.api.patchProject({
        projectId,
        customTitle: title,
      })
      runtime.appStore.getState().upsertProjectSummary({
        ...previous,
        displayTitle: project.customTitle ?? project.autoTitle ?? "新对话",
        updatedAt: project.updatedAt,
      })
      runtime.projectRuntimeRegistry
        .peek(projectId)
        ?.store.getState()
        .applyProject(project)
    } catch {
      runtime.appStore.getState().upsertProjectSummary(previous)
      onToast("重命名失败，已恢复原名")
    }
  }

  async function remove(projectId: string) {
    setConfirmId(null)
    setDeletingId(projectId)
    try {
      await runtime.commands.deleteProject(projectId)
      onClose()
      if (projectId === currentProjectId)
        runtime.navigation.replace(threadChatRoutes.newProject())
      else onToast("对话已删除")
    } catch {
      onToast("删除失败，请重试")
    } finally {
      setDeletingId(null)
    }
  }

  const loading = catalog.loadState.status === "idle" || catalog.loadState.status === "loading"

  return (
    <Dialog
      open={!closing}
      onOpenChange={dialogCloseToShell(onClose)}
      modal={false}
      disablePointerDismissal
    >
      <DialogPortal container={container}>
        <DialogPrimitive.Backdrop className="swx-scrim" onMouseDown={onClose} />
        <DialogPrimitive.Popup
          className="swx global tlx"
          initialFocus={false}
          onMouseDown={() => setConfirmId(null)}
        >
          <div className="swx-title">
            <ListTodo size={14} />
            对话列表
            <ShortcutHint
              {...THREAD_CHAT_SHORTCUTS.openTreeList}
              className="ml-auto shrink-0"
            />
          </div>
          <div className="swx-list">
            {loading && <div className="swx-empty">加载中…</div>}
            {catalog.loadState.status === "error" && (
              <button
                className="swx-empty"
                onClick={() => void runtime.commands.loadProjectCatalog({ reset: true })}
              >
                加载失败，点击重试
              </button>
            )}
            {!loading &&
              rows.map((project) => (
                <TreeListRow
                  key={project.id}
                  item={{
                    id: project.id,
                    title: project.displayTitle || "新对话",
                    updatedAt: project.updatedAt,
                    threadCount: project.threadCount,
                  }}
                  isCurrent={project.id === currentProjectId}
                  unsaved={false}
                  editing={editingId === project.id}
                  confirming={confirmId === project.id}
                  deleting={deletingId === project.id}
                  draft={draft}
                  onSelect={() => {
                    onClose()
                    if (project.id !== currentProjectId)
                      router.push(threadChatRoutes.project(project.id))
                  }}
                  onDraftChange={setDraft}
                  onCancelEdit={() => setEditingId(null)}
                  onCommitEdit={() => void rename(project.id)}
                  onStartEdit={() => {
                    setConfirmId(null)
                    setEditingId(project.id)
                    setDraft(project.displayTitle)
                  }}
                  onRequestDelete={() => {
                    setEditingId(null)
                    setConfirmId(project.id)
                  }}
                  onConfirmDelete={() => void remove(project.id)}
                  onCancelDelete={() => setConfirmId(null)}
                />
              ))}
            {!loading && rows.length === 0 && (
              <div className="swx-empty">还没有对话——发出第一条消息即可创建</div>
            )}
          </div>
          <div className="swx-foot">
            <span>点击切换</span>
            <span>悬停条目可重命名 / 删除</span>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.closeDialog} /> 关闭
            </span>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
