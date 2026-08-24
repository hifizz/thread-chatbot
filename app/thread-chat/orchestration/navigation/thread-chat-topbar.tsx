"use client"

import {
  CircleHelp,
  Columns3,
  FileText,
  ListTodo,
  Network,
  Waypoints,
} from "lucide-react"

import { Kbd, KbdGroup } from "@/components/ui/kbd"
import type {
  ConversationColumnPolicy,
  ConversationViewMode,
} from "@/lib/thread-chat/client/ui-workspace"
import { AccountButton } from "./account-button"

const COL_MIN_W = 430
const columnCountChoices = (forcedColumnCount: number | null) =>
  (["auto", 2, 3, 4] as const).map((value) => ({
    value,
    label: value === "auto" ? "自适应" : String(value),
    active:
      value === "auto"
        ? forcedColumnCount === null
        : forcedColumnCount === value,
  }))

function ShortcutHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <KbdGroup aria-label={label}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}

/** 重构前的 Thread Chat 顶栏；数据与命令通过 canonical props 注入。 */
export function ThreadChatTopbar({
  viewMode,
  windowWidth,
  forcedColumnCount,
  columnPolicy,
  branchCount,
  markdownCount,
  onNewConversation,
  onToggleConversationList,
  onOpenHelp,
  onShowColumns,
  onShowCanvas,
  onForcedColumnCountChange,
  onColumnPolicyChange,
  onToggleThreadTree,
  onToggleMarkdown,
}: {
  viewMode: ConversationViewMode
  windowWidth: number | null
  forcedColumnCount: number | null
  columnPolicy: ConversationColumnPolicy
  branchCount: number
  markdownCount: number
  onNewConversation(): void
  onToggleConversationList(): void
  onOpenHelp(): void
  onShowColumns(): void
  onShowCanvas(): void
  onForcedColumnCountChange(value: number | null): void
  onColumnPolicyChange(value: ConversationColumnPolicy): void
  onToggleThreadTree(): void
  onToggleMarkdown(): void
}) {
  return (
    <div className="topbar">
      <button
        className="tbtn"
        title="开启一棵全新的分支对话树"
        onClick={onNewConversation}
      >
        新对话
      </button>
      <button
        className="tbtn"
        title="查看全部对话（⌘⇧K）"
        onClick={onToggleConversationList}
      >
        <ListTodo size={13} />
        对话列表
        <ShortcutHint
          keys={["⌘", "⇧", "K"]}
          label="打开对话列表：Command 或 Control 加 Shift 加 K"
        />
      </button>
      <div className="brand">
        <span className="mark">Thread Chat</span>
      </div>
      <div className="spacer" />
      <button className="tbtn help" title="使用提示" onClick={onOpenHelp}>
        <CircleHelp size={14} />
      </button>
      <div
        className="seg"
        role="group"
        aria-label="视图模式"
        title="列 = 并排深读；画布 = 纵览整棵会话树"
      >
        <button
          className={`mode ${viewMode === "columns" ? "on" : ""}`}
          aria-pressed={viewMode === "columns"}
          onClick={onShowColumns}
        >
          <Columns3 size={12} />列
        </button>
        <button
          className={`mode ${viewMode === "canvas" ? "on" : ""}`}
          aria-pressed={viewMode === "canvas"}
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
            {columnCountChoices(forcedColumnCount).map((choice) => (
              <button
                key={choice.value}
                className={choice.active ? "on" : ""}
                aria-pressed={choice.active}
                onClick={() =>
                  onForcedColumnCountChange(
                    choice.value === "auto" ? null : choice.value
                  )
                }
              >
                {choice.label}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="列满时的放置策略">
            <button
              className={columnPolicy === "replace" ? "on" : ""}
              aria-pressed={columnPolicy === "replace"}
              onClick={() => onColumnPolicyChange("replace")}
            >
              替换⑥
            </button>
            <button
              className={columnPolicy === "fold" ? "on" : ""}
              aria-pressed={columnPolicy === "fold"}
              onClick={() => onColumnPolicyChange("fold")}
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
        <ShortcutHint
          keys={["⌘", "K"]}
          label="打开会话树：Command 或 Control 加 K"
        />
      </button>
      <button
        className="tbtn"
        title="打开或收起 Markdown 面板"
        onClick={onToggleMarkdown}
        disabled={markdownCount === 0}
      >
        <FileText size={13} />
        Markdown
        <span className="cnt">{markdownCount}</span>
      </button>
      <AccountButton />
    </div>
  )
}
