"use client"
/**
 * orchestration/tree-list —— 会话列表弹层（⌘⇧K / 顶栏「对话列表」按钮）。
 *
 * 视觉沿用 ⌘K 切换器的 swx 弹层语言（tlx-* 类在 CSS 里复用同一套 token）；
 * 数据由页面壳层预取并缓存；每次打开先展示缓存，再后台刷新一次。
 * · 条目 = 展示标题（coalesce 双轨，服务端已做）+ 相对更新时间 + 分支数徽标；
 * · 当前树高亮置顶——尚未入库（空树未保存）时以本地信息合成「未保存」条目；
 * · 内联重命名（悬停铅笔 → 输入框，Enter 提交 / Esc 取消 / 失焦放弃）：
 *   乐观更新，PATCH 失败回滚 + 壳层 toast（design D5）；
 * · 删除二段确认（垃圾桶 → 变「确认删除」，点它处 / Esc 复位），成功后就地
 *   清理 localStorage 善后；删的是当前树时把「下一站」交回壳层跳转（design D4）。
 *
 * Esc 语义：编辑态 / 确认态先被本组件的捕获期监听消费（stopPropagation），
 * 其余 Esc 冒泡到壳层关闭链（弹层在链的最外层，先关它）。
 *
 * 外壳是 shadcn/ui Dialog（Base UI）：借它的 data-starting/ending-style 过渡状态机
 * 做进出双向动效（样式仍是 .tc 纸面 token，见 thread-chat.css）。Esc 的内建关闭被
 * dialogCloseToShell 取消并放行冒泡——上面这条捕获期 stopPropagation 的 Esc 链依然
 * 先于 Dialog 与壳层生效，行为不变。
 */

import React, { useEffect, useState } from "react"
import { ListTodo } from "lucide-react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Dialog, DialogPortal } from "@/components/ui/dialog"
import {
  CUSTOM_TITLE_MAX_LEN,
  THREAD_CHAT_SHORTCUTS,
} from "@/constants/thread-chat"
import { dialogCloseToShell } from "../overlays/dialog-close-to-shell"
import { ShortcutHint } from "../overlays/shortcut-hint"
import { TreeListRow } from "./tree-list-row"

export interface TreeListItem {
  id: string
  title: string
  updatedAt: string
  threadCount: number
}

export interface TreeListProps {
  /** 当前打开的树（用于高亮置顶与「未保存」合成） */
  currentTreeId: string
  /** 当前树的本地合成信息：未入库时用它拼「未保存」条目 */
  currentTitle: string
  currentThreadCount: number
  /** 页面打开后预取到的内存缓存；null 表示预取尚未成功。 */
  cachedItems: TreeListItem[] | null
  /** 获取最新列表；页面预取尚未结束时会复用同一个请求。 */
  refreshItems(): Promise<TreeListItem[]>
  renameItem(projectId: string, title: string): Promise<void>
  deleteItem(projectId: string): Promise<void>
  /** 点击非当前树条目：壳层负责跳转（组件已先自关） */
  onSwitch: (treeId: string) => void
  /** 删除的是当前树：nextTreeId = 剩余最近一棵（null = 一棵不剩，开新树） */
  onDeleteCurrent: (nextTreeId: string | null) => void
  /** 重命名成功且改的是当前树时回调新标题——壳层用它同步主线列头副标题 */
  onRenamedCurrent?: (title: string) => void
  onClose: () => void
  /** 轻提示（沿用壳层 toast） */
  onToast: (msg: string) => void
  /** 壳层的退场标记：true = Dialog 置 open=false 播放关闭动画（随后壳层卸载本组件） */
  closing?: boolean
  /** Dialog Portal 的挂载点（.tc 根）：保证 .swx / .tlx 选择器与纸面 CSS 变量继续生效 */
  container?: React.RefObject<HTMLElement | null>
}

export function TreeList({
  currentTreeId,
  currentTitle,
  currentThreadCount,
  cachedItems,
  refreshItems,
  renameItem,
  deleteItem,
  onSwitch,
  onDeleteCurrent,
  onRenamedCurrent,
  onClose,
  onToast,
  closing = false,
  container,
}: TreeListProps) {
  const [items, setItems] = useState<TreeListItem[] | null>(cachedItems)
  const [refreshing, setRefreshing] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  /** 内联重命名中的树 id + 草稿 */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  /** 二段删除确认中的树 id */
  const [confirmId, setConfirmId] = useState<string | null>(null)
  /** 删除请求进行中的树 id（防连点） */
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 缓存已在首帧展示；组件每次打开重挂，并在后台刷新一次。
  useEffect(() => {
    let cancelled = false
    void refreshItems().then(
      (trees) => {
        if (cancelled) return
        setItems(trees)
        setLoadFailed(false)
        setRefreshing(false)
      },
      () => {
        if (cancelled) return
        setLoadFailed(true)
        setRefreshing(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [refreshItems])

  // Esc：编辑态 / 确认态在捕获期先于壳层关闭链被消费
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (editingId !== null) {
        e.stopPropagation()
        setEditingId(null)
      } else if (confirmId !== null) {
        e.stopPropagation()
        setConfirmId(null)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [editingId, confirmId])

  /* ---------- 列表拼装：当前树置顶（未入库合成「未保存」条目） ---------- */
  const saved = items ?? []
  const currentSaved = saved.find((t) => t.id === currentTreeId) ?? null
  const rest = saved.filter((t) => t.id !== currentTreeId)
  const currentRow: TreeListItem = currentSaved ?? {
    id: currentTreeId,
    title: currentTitle,
    updatedAt: "",
    threadCount: currentThreadCount,
  }
  const rows: { item: TreeListItem; isCurrent: boolean; unsaved: boolean }[] = [
    { item: currentRow, isCurrent: true, unsaved: currentSaved === null },
    ...rest.map((item) => ({ item, isCurrent: false, unsaved: false })),
  ]

  /* ---------- 内联重命名：乐观更新 + 失败回滚（design D5） ---------- */
  function startEdit(item: TreeListItem) {
    setConfirmId(null)
    setEditingId(item.id)
    setDraft(item.title)
  }
  function commitEdit(id: string) {
    const prev =
      id === currentTreeId
        ? currentRow.title
        : (saved.find((t) => t.id === id)?.title ?? "")
    const next = draft.trim()
    setEditingId(null)
    if (next === "" || next === prev) return
    if (next.length > CUSTOM_TITLE_MAX_LEN) {
      onToast(`标题最长 ${CUSTOM_TITLE_MAX_LEN} 字，未保存`)
      return
    }
    // 乐观改本地列表；未入库的当前树没有可 PATCH 的行，直接提示
    if (id === currentTreeId && currentSaved === null) {
      onToast("当前对话尚未保存，发出第一条消息后才能重命名")
      return
    }
    setItems((list) =>
      (list ?? []).map((t) => (t.id === id ? { ...t, title: next } : t))
    )
    renameItem(id, next)
      .then(() => {
        // 改的是当前树：通知壳层同步本地 customTitle（主线列头副标题即时更新）
        if (id === currentTreeId) onRenamedCurrent?.(next)
      })
      .catch(() => {
        setItems((list) =>
          (list ?? []).map((t) => (t.id === id ? { ...t, title: prev } : t))
        )
        onToast("重命名失败，已恢复原名")
      })
  }

  /* ---------- 二段删除 + 善后（design D4） ---------- */
  async function doDelete(id: string) {
    setConfirmId(null)
    setDeletingId(id)
    try {
      await deleteItem(id)
    } catch {
      setDeletingId(null)
      onToast("删除失败，请重试")
      return
    }
    const remaining = (items ?? []).filter((t) => t.id !== id)
    setItems(remaining)
    setDeletingId(null)
    if (id === currentTreeId) {
      // 跳剩余最近一棵（列表本就按 updated_at 降序）；一棵不剩开新树
      const next = remaining.find((t) => t.id !== currentTreeId)
      onDeleteCurrent(next?.id ?? null)
    } else {
      onToast("对话已删除")
    }
  }

  return (
    // Dialog 受控 open：closing 期间置 false 触发 data-ending-style 退场（Base UI 保持
    // Popup 挂载到 transition 结束）。modal=false + disablePointerDismissal 复刻旧行为：
    // 不锁滚动 / 不困焦点 / 点外关闭由 Backdrop 的 onMouseDown 自己接；initialFocus=false
    // 保持「打开不夺焦点」的旧语义（重命名输入框的 autoFocus 不受影响）。
    <Dialog
      open={!closing}
      onOpenChange={dialogCloseToShell(onClose)}
      modal={false}
      disablePointerDismissal
    >
      <DialogPortal container={container}>
        <DialogPrimitive.Backdrop className="swx-scrim" onMouseDown={onClose} />
        {/* 面板内任意处 mousedown 复位删除确认态（确认按钮自身已 stopPropagation） */}
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
            {refreshing && (
              <div
                className="tlx-refresh"
                role="progressbar"
                aria-label="正在更新对话列表"
              >
                <span />
              </div>
            )}
          </div>
          <div className="swx-list">
            {items === null && !loadFailed && (
              <div className="swx-empty">加载中…</div>
            )}
            {items === null && loadFailed && (
              <div className="swx-empty">加载失败，请稍后重新打开</div>
            )}
            {items !== null &&
              rows.map(({ item, isCurrent, unsaved }) => {
                const editing = editingId === item.id
                const confirming = confirmId === item.id
                return (
                  <TreeListRow
                    key={item.id}
                    item={item}
                    isCurrent={isCurrent}
                    unsaved={unsaved}
                    editing={editing}
                    confirming={confirming}
                    deleting={deletingId === item.id}
                    draft={draft}
                    onSelect={() => {
                      onClose()
                      if (!isCurrent) onSwitch(item.id)
                    }}
                    onDraftChange={setDraft}
                    onCancelEdit={() => setEditingId(null)}
                    onCommitEdit={() => commitEdit(item.id)}
                    onStartEdit={() => startEdit(item)}
                    onRequestDelete={() => {
                      setEditingId(null)
                      setConfirmId(item.id)
                    }}
                    onConfirmDelete={() => void doDelete(item.id)}
                    onCancelDelete={() => setConfirmId(null)}
                  />
                )
              })}
            {items !== null && rows.length === 1 && rows[0].unsaved && (
              <div className="swx-empty">
                还没有保存过的对话——发出第一条消息即自动保存
              </div>
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
