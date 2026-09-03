"use client"

import {
  Check,
  CircleHelp,
  Columns3,
  FolderKanban,
  ListTodo,
  Menu,
  Network,
  Waypoints,
} from "lucide-react"
import type { MouseEvent } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { THREAD_CHAT_SHORTCUTS } from "@/constants/thread-chat"
import type { PlacementMode } from "../columns/placement"
import { AccountButton } from "./account-button"
import { ShortcutHint } from "../overlays/shortcut-hint"
import { COL_MIN_W } from "../columns/use-column-viewport"
import { columnCountChoices } from "./thread-chat-topbar-logic"

type ViewMode = "columns" | "canvas"

export interface ThreadChatNavigationProps {
  viewMode: ViewMode
  showHelp: boolean
  windowWidth: number | null
  forceCols: number | null
  placementMode: PlacementMode
  branchCount: number
  markdownCount: number
  onNewConversation(openInNewPage: boolean): void
  onToggleTreeList(): void
  onOpenHelp(): void
  onShowColumns(): void
  onShowCanvas(): void
  onForceCols(value: number | null): void
  onPlacementModeChange(mode: PlacementMode): void
  onToggleThreadTree(): void
  onToggleMarkdown(): void
}

export function ThreadChatMobileMenu({
  viewMode,
  showHelp,
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
}: ThreadChatNavigationProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="cbtn mobile-nav"
        aria-label="打开导航菜单"
        title="导航菜单"
      >
        <Menu size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52 max-w-[calc(100vw-24px)] font-mono"
      >
          <DropdownMenuGroup>
            <DropdownMenuLabel>对话</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onNewConversation(false)}>
              新对话
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleTreeList}>
              <ListTodo />
              对话列表
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleThreadTree}>
              <Network />
              会话树{branchCount > 0 ? ` · ${branchCount}` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleMarkdown}>
              <FolderKanban />
              Project · {markdownCount}
            </DropdownMenuItem>
            {showHelp && (
              <DropdownMenuItem onClick={onOpenHelp}>
                <CircleHelp />
                使用提示
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>视图</DropdownMenuLabel>
            <DropdownMenuItem onClick={onShowColumns}>
              <Columns3 />
              列视图
              {viewMode === "columns" && <Check className="mobile-nav-check" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onShowCanvas}>
              <Waypoints />
              画布视图
              {viewMode === "canvas" && <Check className="mobile-nav-check" />}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {viewMode === "columns" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>列数</DropdownMenuLabel>
                {columnCountChoices(forceCols).map((choice) => (
                  <DropdownMenuItem
                    key={choice.value}
                    onClick={() =>
                      onForceCols(choice.value === "auto" ? null : choice.value)
                    }
                  >
                    {choice.label}
                    {choice.active && <Check className="mobile-nav-check" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>列满时</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => onPlacementModeChange("replace")}
                >
                  替换⑥
                  {placementMode === "replace" && (
                    <Check className="mobile-nav-check" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onPlacementModeChange("fold")}
                >
                  细条⑤
                  {placementMode === "fold" && (
                    <Check className="mobile-nav-check" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <div className="mx-1 mb-1 flex min-h-10 items-center justify-between rounded-xl px-2 py-2 text-sm text-muted-foreground">
            <span>账户</span>
            <AccountButton />
          </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ThreadChatTopbar(props: ThreadChatNavigationProps) {
  const {
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
  } = props
  return (
    <div className="topbar">
      <button
        className="tbtn"
        title="开启一棵全新的分支对话树；按住 Command 点击可在新页面打开（当前对话已自动保存，可经其 URL 随时回访）"
        onClick={(event: MouseEvent<HTMLButtonElement>) =>
          onNewConversation(event.metaKey)
        }
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
      <ThreadChatMobileMenu {...props} />
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
        title="打开 / 收起 Project Workspace"
        onClick={onToggleMarkdown}
      >
        <FolderKanban size={13} />
        Project
        <span className="cnt">{markdownCount}</span>
      </button>
      <AccountButton />
    </div>
  )
}
