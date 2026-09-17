"use client"

import { Check, Pencil, Trash2, X } from "lucide-react"
import { CUSTOM_TITLE_MAX_LEN } from "@/constants/thread-chat"
import type { ProjectListItemDTO } from "@/lib/thread-chat/contracts/dto"
import { useState } from "react"
import { formatRelativeTime } from "@/lib/i18n/dictionary"
import { useI18n } from "@/lib/i18n/client"


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
  const { locale, t } = useI18n()
  const [now] = useState(() => Date.now())

  return (
    <div
      data-scroll-memory-anchor={item.id}
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
          {unsaved && <span className="st tlx-unsaved">{t("ui.notSaved")}</span>}
          {isCurrent && !unsaved && <span className="st">{t("ui.current")}</span>}
          <span className="tlx-meta">
            {item.threadCount > 1 && (
              <span
                className="tlx-badge"
                title={t("common.branchCount", { count: item.threadCount - 1 })}
              >
                ⑂ {item.threadCount - 1}
              </span>
            )}
            {item.updatedAt && (
              <span className="tlx-time">{formatRelativeTime(locale, item.updatedAt, now)}</span>
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
                  title={t("ui.confirmDeletionCannotBeUndone")}
                  onClick={onConfirmDelete}
                >
                  <Check size={12} />
                  {t("ui.confirmDeletion")}</button>
                <button
                  className="tlx-act"
                  title={t("common.cancel")}
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
                    title={t("ui.rename")}
                    onClick={onStartEdit}
                  >
                    <Pencil size={12} />
                  </button>
                )}
                {!unsaved && (
                  <button
                    className="tlx-act danger"
                    title={t("ui.deleteThisConversation")}
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
