"use client"

import { Check, Pencil, Trash2, X } from "lucide-react"
import { CUSTOM_TITLE_MAX_LEN } from "@/constants/thread-chat"
import type { ProjectListItemDTO } from "@/lib/thread-chat/contracts/dto"

/** 相对时间：「刚刚 / N 分钟前 / N 小时前 / N 天前 / M月D日」 */
function relativeTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return ""
  const diff = Date.now() - time
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const date = new Date(time)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export interface TreeListRowProps {
  item: ProjectListItemDTO
  isCurrent: boolean
  unsaved: boolean
  editing: boolean
  confirming: boolean
  deleting: boolean
  draft: string
  onSelect(): void
  onDraftChange(value: string): void
  onCancelEdit(): void
  onCommitEdit(): void
  onStartEdit(): void
  onRequestDelete(): void
  onConfirmDelete(): void
  onCancelDelete(): void
}

/** 单条会话的展示/编辑/二段删除交互；列表级网络命令仍由 TreeList 负责。 */
export function TreeListRow({
  item,
  isCurrent,
  unsaved,
  editing,
  confirming,
  deleting,
  draft,
  onSelect,
  onDraftChange,
  onCancelEdit,
  onCommitEdit,
  onStartEdit,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: TreeListRowProps) {
  return (
    <div
      className={`swx-row tlx-row ${isCurrent ? "cur" : ""}`}
      onClick={() => {
        if (editing || confirming || deleting) return
        onSelect()
      }}
    >
      <span className="dot" />
      {editing ? (
        <input
          className="tlx-edit"
          autoFocus
          value={draft}
          maxLength={CUSTOM_TITLE_MAX_LEN}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onDraftChange(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={onCancelEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onCommitEdit()
            }
            // Esc 由 TreeList 的捕获期监听统一处理（取消编辑并拦下冒泡）。
          }}
        />
      ) : (
        <>
          <span className="t">{item.title}</span>
          {unsaved && <span className="st tlx-unsaved">未保存</span>}
          {isCurrent && !unsaved && <span className="st">当前</span>}
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
              <span className="tlx-time">{relativeTime(item.updatedAt)}</span>
            )}
          </span>
          <span
            className="tlx-acts"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {confirming ? (
              <>
                <button
                  className="tlx-act danger confirm"
                  title="确认删除（不可撤销）"
                  onClick={onConfirmDelete}
                >
                  <Check size={12} />
                  确认删除
                </button>
                <button
                  className="tlx-act"
                  title="取消"
                  onClick={onCancelDelete}
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
                    onClick={onStartEdit}
                  >
                    <Pencil size={12} />
                  </button>
                )}
                {!unsaved && (
                  <button
                    className="tlx-act danger"
                    title="删除此对话"
                    disabled={deleting}
                    onClick={onRequestDelete}
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
}
