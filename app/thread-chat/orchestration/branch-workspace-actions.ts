import { activeLeafTurn, threadTitle, type TreeRow } from "../core/selectors"
import type { ThreadStore } from "../core/store"
import type { ThreadTreeState } from "../core/types"
import type { SelectionInfo } from "../branching/use-assistant-text-selection"
import { kickoffQuestion } from "../net/prompt"
import type { ChatController } from "../net/chat-controller"
import type { PlacementHint, PlacementMode } from "./placement"
import type { SwitcherMode } from "./thread-switcher"
import type { useColumnSlots } from "./use-column-slots"
import type { ViewMode } from "../net/persist"

type ColumnWorkspace = ReturnType<typeof useColumnSlots>

/** 页面视图可直接消费的分支导航命令组合。 */
export function createBranchWorkspaceActions({
  state,
  store,
  chat,
  columns,
  viewMode,
  mode,
  setMode,
  showColumnsView,
  focusCanvasNode,
  closeSwitcher,
  showToast,
}: {
  state: ThreadTreeState
  store: ThreadStore
  chat: ChatController
  columns: ColumnWorkspace
  viewMode: ViewMode
  mode: PlacementMode
  setMode(mode: PlacementMode): void
  showColumnsView(): void
  focusCanvasNode(threadId: string): void
  closeSwitcher(): void
  showToast(message: string, undo?: () => void): void
}) {
  function openBranchUI(
    id: string,
    sourceId?: string | null,
    hint?: PlacementHint
  ) {
    showColumnsView()
    if (id === "main") {
      columns.flashThread("main")
      return
    }
    const effect = columns.openThread(id, sourceId ?? null, hint)
    if (effect.kind === "replaced") {
      showToast(
        `第 ${effect.idx + 2} 列已替换：「${threadTitle(state, effect.replacedId)}」→「${threadTitle(state, id)}」`,
        () => {
          columns.restoreSlots(effect.prevSlots)
          columns.flashThread(effect.replacedId)
        }
      )
    } else if (effect.kind === "folded") {
      showToast(
        `已打开「${threadTitle(state, id)}」，「${threadTitle(state, effect.foldedId)}」已折叠为细条`
      )
    }
  }

  function handleFork(
    selection: SelectionInfo,
    hint?: PlacementHint,
    question?: string
  ) {
    const fork = store.fork({
      sourceThreadId: selection.threadId,
      sourceMsgId: selection.msgId,
      anchorText: selection.text,
      anchor: selection.anchor,
    })
    if (!fork) return
    const trimmedQuestion = question?.trim()
    if (trimmedQuestion)
      chat.send(fork.threadId, trimmedQuestion, { text: selection.text })
    if (viewMode === "canvas") {
      focusCanvasNode(fork.threadId)
      showToast(`已开启分支 · ${fork.title}`)
      return
    }
    const effect = columns.openThread(fork.threadId, selection.threadId, hint)
    if (effect.kind === "replaced") {
      showToast(
        `已开启分支「${fork.title}」，替换了第 ${effect.idx + 2} 列的「${threadTitle(state, effect.replacedId)}」`,
        () => {
          columns.restoreSlots(effect.prevSlots)
          columns.flashThread(effect.replacedId)
        }
      )
    } else if (effect.kind === "folded") {
      showToast(
        `已开启分支「${fork.title}」，「${threadTitle(state, effect.foldedId)}」已折叠为细条`
      )
    } else {
      showToast(`已开启分支 · ${fork.title}`)
    }
  }

  function changeMode(nextMode: PlacementMode) {
    if (nextMode === mode) return
    setMode(nextMode)
    if (nextMode !== "replace") return
    const dropped = columns.normalizeToReplace()
    if (dropped.length)
      showToast(
        `已切回替换⑥：细条全部展开后，超出列数的「${dropped.map((id) => threadTitle(state, id)).join("」「")}」已收起`
      )
  }

  function pickRow(row: TreeRow, switcherMode: SwitcherMode) {
    closeSwitcher()
    if (switcherMode.kind === "column") {
      if (columns.slots[switcherMode.vpIndex]?.id === row.id) {
        columns.flashThread(row.id)
        return
      }
      columns.navColumn(switcherMode.vpIndex, row.id, "swap")
    } else if (switcherMode.kind === "subtree") {
      openBranchUI(row.id, switcherMode.rootId)
    } else {
      openBranchUI(row.id, null)
    }
  }

  function isThreadBusy(threadId: string): boolean {
    const thread = state.threads[threadId]
    const last = thread ? activeLeafTurn(thread)?.assistantMessage : null
    return Boolean(
      last && (last.status === "pending" || last.status === "streaming")
    )
  }

  function composerPrefillFor(threadId: string): string | undefined {
    const thread = state.threads[threadId]
    return thread?.anchorText && thread.messages.length === 0
      ? kickoffQuestion(thread.anchorText)
      : undefined
  }

  return {
    openBranchUI,
    handleFork,
    changeMode,
    pickRow,
    isThreadBusy,
    composerPrefillFor,
  }
}
