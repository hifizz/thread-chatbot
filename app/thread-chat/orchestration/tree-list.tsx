"use client"
/**
 * orchestration/tree-list —— 会话列表弹层（⌘⇧K / 顶栏「对话列表」按钮）。
 *
 * 视觉沿用 ⌘K 切换器的 swx 弹层语言（tlx-* 类在 CSS 里复用同一套 token）；
 * 数据每次打开现拉（design D3：无缓存/无轮询，壳层以重挂方式打开保证归零）。
 * · 条目 = 展示标题（coalesce 双轨，服务端已做）+ 相对更新时间 + 分支数徽标；
 * · 当前树高亮置顶——尚未入库（空树未保存）时以本地信息合成「未保存」条目；
 * · 内联重命名（悬停铅笔 → 输入框，Enter 提交 / Esc 取消 / 失焦放弃）：
 *   乐观更新，PATCH 失败回滚 + 壳层 toast（design D5）；
 * · 删除二段确认（垃圾桶 → 变「确认删除」，点它处 / Esc 复位），成功后就地
 *   清理 localStorage 善后；删的是当前树时把「下一站」交回壳层跳转（design D4）。
 *
 * Esc 语义：编辑态 / 确认态先被本组件的捕获期监听消费（stopPropagation），
 * 其余 Esc 冒泡到壳层关闭链（弹层在链的最外层，先关它）。
 */

import React, { useEffect, useState } from "react"
import { Check, ListTodo, Pencil, Trash2, X } from "lucide-react"
import { CUSTOM_TITLE_MAX_LEN } from "@/constants/thread-chat"
import {
  cleanupAfterTreeDelete,
  deleteTree,
  listTrees,
  renameTree,
  type TreeListItem,
} from "../net/persist"

export interface TreeListProps {
  /** 当前打开的树（用于高亮置顶与「未保存」合成） */
  currentTreeId: string
  /** 当前树的本地合成信息：未入库时用它拼「未保存」条目 */
  currentTitle: string
  currentThreadCount: number
  /** 点击非当前树条目：壳层负责跳转（组件已先自关） */
  onSwitch: (treeId: string) => void
  /** 删除的是当前树：nextTreeId = 剩余最近一棵（null = 一棵不剩，开新树） */
  onDeleteCurrent: (nextTreeId: string | null) => void
  onClose: () => void
  /** 轻提示（沿用壳层 toast） */
  onToast: (msg: string) => void
}

/** 相对时间：「刚刚 / N 分钟前 / N 小时前 / N 天前 / M月D日」 */
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function TreeList({
  currentTreeId,
  currentTitle,
  currentThreadCount,
  onSwitch,
  onDeleteCurrent,
  onClose,
  onToast,
}: TreeListProps) {
  /** null = 拉取中 */
  const [items, setItems] = useState<TreeListItem[] | null>(null)
  /** 内联重命名中的树 id + 草稿 */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  /** 二段删除确认中的树 id */
  const [confirmId, setConfirmId] = useState<string | null>(null)
  /** 删除请求进行中的树 id（防连点） */
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 打开现拉（组件每次打开重挂，天然只拉一次）
  useEffect(() => {
    let cancelled = false
    void listTrees().then((trees) => {
      if (!cancelled) setItems(trees)
    })
    return () => {
      cancelled = true
    }
  }, [])

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
    renameTree(id, next).catch(() => {
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
      await deleteTree(id)
    } catch {
      setDeletingId(null)
      onToast("删除失败，请重试")
      return
    }
    cleanupAfterTreeDelete(id) // 清工作台记忆 + 悬空「最近一棵」指针
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
    <>
      <div className="swx-scrim" onMouseDown={onClose} />
      {/* 面板内任意处 mousedown 复位删除确认态（确认按钮自身已 stopPropagation） */}
      <div className="swx global tlx" onMouseDown={() => setConfirmId(null)}>
        <div className="swx-title">
          <ListTodo size={14} />
          对话列表
          <span className="kbd">⌘⇧K</span>
        </div>
        <div className="swx-list">
          {items === null && <div className="swx-empty">加载中…</div>}
          {items !== null &&
            rows.map(({ item, isCurrent, unsaved }) => {
              const editing = editingId === item.id
              const confirming = confirmId === item.id
              return (
                <div
                  key={item.id}
                  className={`swx-row tlx-row ${isCurrent ? "cur" : ""}`}
                  onClick={() => {
                    if (editing || confirming || deletingId === item.id) return
                    onClose()
                    if (!isCurrent) onSwitch(item.id)
                  }}
                >
                  <span className="dot" />
                  {editing ? (
                    <input
                      className="tlx-edit"
                      autoFocus
                      value={draft}
                      maxLength={CUSTOM_TITLE_MAX_LEN}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          commitEdit(item.id)
                        }
                        // Esc 由上面的捕获期监听统一处理（取消编辑并拦下冒泡）
                      }}
                    />
                  ) : (
                    <>
                      <span className="t">{item.title}</span>
                      {unsaved && (
                        <span className="st tlx-unsaved">未保存</span>
                      )}
                      {isCurrent && !unsaved && (
                        <span className="st">当前</span>
                      )}
                      <span className="tlx-meta">
                        {item.threadCount > 1 && (
                          <span
                            className="tlx-badge"
                            title={`${item.threadCount - 1} 个分支`}
                          >
                            ⑂ {item.threadCount - 1}
                          </span>
                        )}
                        {item.updatedAt && (
                          <span className="tlx-time">
                            {relativeTime(item.updatedAt)}
                          </span>
                        )}
                      </span>
                      <span
                        className="tlx-acts"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        {confirming ? (
                          <>
                            <button
                              className="tlx-act danger confirm"
                              title="确认删除（不可撤销）"
                              onClick={() => void doDelete(item.id)}
                            >
                              <Check size={12} />
                              确认删除
                            </button>
                            <button
                              className="tlx-act"
                              title="取消"
                              onClick={() => setConfirmId(null)}
                            >
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            {!unsaved && (
                              <button
                                className="tlx-act"
                                title="重命名"
                                onClick={() => startEdit(item)}
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                            {!unsaved && (
                              <button
                                className="tlx-act danger"
                                title="删除此对话"
                                disabled={deletingId === item.id}
                                onClick={() => {
                                  setEditingId(null)
                                  setConfirmId(item.id)
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    </>
                  )}
                </div>
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
          <span>esc 关闭</span>
        </div>
      </div>
    </>
  )
}
