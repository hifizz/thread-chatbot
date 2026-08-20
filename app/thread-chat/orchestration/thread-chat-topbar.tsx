"use client"

import {
  CircleHelp,
  Columns3,
  FileText,
  ListTodo,
  Network,
  Waypoints,
} from "lucide-react"
import { THREAD_CHAT_SHORTCUTS } from "@/constants/thread-chat"
import type { ViewMode } from "../net/persist"
import type { PlacementMode } from "./placement"
import { AccountButton } from "./account-button"
import { ShortcutHint } from "./shortcut-hint"
import { COL_MIN_W } from "./use-column-viewport"
import { columnCountChoices } from "./thread-chat-topbar-logic"

export function ThreadChatTopbar({
  viewMode,
  showHelp,
  windowWidth,
  forceCols,
  placementMode,
  branchCount,
  markdownCount,
  onNewConversation,
  onToggleTreeList,
  onOpenHelp,
  onShowColumns,
  onShowCanvas,
  onForceCols,
  onPlacementModeChange,
  onToggleThreadTree,
  onToggleMarkdown,
}: {
  viewMode: ViewMode
  showHelp: boolean
  windowWidth: number | null
  forceCols: number | null
  placementMode: PlacementMode
  branchCount: number
  markdownCount: number
  onNewConversation(): void
  onToggleTreeList(): void
  onOpenHelp(): void
  onShowColumns(): void
  onShowCanvas(): void
  onForceCols(value: number | null): void
  onPlacementModeChange(mode: PlacementMode): void
  onToggleThreadTree(): void
  onToggleMarkdown(): void
}) {
  return (
    <div className="topbar">
      <button
        className="tbtn"
        title="开启一棵全新的分支对话树（当前对话已自动保存，可经其 URL 随时回访）"
        onClick={onNewConversation}
      >
        新对话
      </button>
      <button
        className="tbtn"
        title="查看全部对话，可切换 / 重命名 / 删除（⌘⇧K）"
        onClick={onToggleTreeList}
      >
        <ListTodo size={13} />
        对话列表
        <ShortcutHint {...THREAD_CHAT_SHORTCUTS.openTreeList} />
      </button>
      <div className="brand">
        <span className="mark">Thread Chat</span>
      </div>
      <div className="spacer" />
      {showHelp && (
        <button className="tbtn help" title="使用提示" onClick={onOpenHelp}>
          <CircleHelp size={14} />
        </button>
      )}
      <div
        className="seg"
        role="group"
        aria-label="视图模式"
        title="列 = 并排深读；画布 = 纵览整棵会话树"
      >
        <button
          className={`mode ${viewMode === "columns" ? "on" : ""}`}
          aria-pressed={viewMode === "columns"}
          title="列视图：并排深读多个会话"
          onClick={onShowColumns}
        >
          <Columns3 size={12} />列
        </button>
        <button
          className={`mode ${viewMode === "canvas" ? "on" : ""}`}
          aria-pressed={viewMode === "canvas"}
          title="画布视图：纵览整棵会话树，单击节点就地对话，双击回到列模式"
          onClick={onShowCanvas}
        >
          <Waypoints size={12} />
          画布
        </button>
      </div>
      {viewMode === "columns" && (
        <>
          <div
            className="seg"
            role="group"
            aria-label="列数"
            title={
              windowWidth === null
                ? undefined
                : `列数：视口 ${windowWidth}px，约每 ${COL_MIN_W}px 一列`
            }
          >
            {columnCountChoices(forceCols).map((choice) => (
              <button
                key={choice.value}
                className={choice.active ? "on" : ""}
                aria-pressed={choice.active}
                onClick={() =>
                  onForceCols(choice.value === "auto" ? null : choice.value)
                }
              >
                {choice.label}
              </button>
            ))}
          </div>
          <div
            className="seg"
            role="group"
            aria-label="列满时的放置策略"
            title="列满时的放置策略"
          >
            <button
              className={placementMode === "replace" ? "on" : ""}
              aria-pressed={placementMode === "replace"}
              onClick={() => onPlacementModeChange("replace")}
            >
              替换⑥
            </button>
            <button
              className={placementMode === "fold" ? "on" : ""}
              aria-pressed={placementMode === "fold"}
              onClick={() => onPlacementModeChange("fold")}
            >
              细条⑤
            </button>
          </div>
        </>
      )}
      <button
        className="tbtn"
        title="搜索并打开任意会话（⌘K）"
        onClick={onToggleThreadTree}
      >
        <Network size={13} />
        会话树{branchCount > 0 ? ` · ${branchCount}` : ""}
        <ShortcutHint {...THREAD_CHAT_SHORTCUTS.openThreadTree} />
      </button>
      <button
        className="tbtn"
        title="打开 / 收起 Markdown 面板"
        onClick={onToggleMarkdown}
      >
        <FileText size={13} />
        Markdown
        <span className="cnt">{markdownCount}</span>
      </button>
      <AccountButton />
    </div>
  )
}
