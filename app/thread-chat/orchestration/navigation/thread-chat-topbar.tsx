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
import { AccountButton, AccountMenuRow } from "./account-button"
import { ShortcutHint } from "../overlays/shortcut-hint"
import { COL_MIN_W } from "../columns/use-column-viewport"
import { columnCountChoices } from "./thread-chat-topbar-logic"
import { LanguageSwitcher } from "@/components/i18n/language-switcher"
import { useI18n } from "@/lib/i18n/client"


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
  const { t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="cbtn mobile-nav"
        aria-label={t("ui.openNavigationMenu")}
        title={t("ui.navigationMenu")}
      >
        <Menu size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52 max-w-[calc(100vw-24px)] font-mono"
      >
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("ui.chat")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onNewConversation(false)}>
              {t("chat.new")}</DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleTreeList}>
              <ListTodo />
              {t("chat.list")}</DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleThreadTree}>
              <Network />
              {t("chat.tree")}{branchCount > 0 ? ` · ${branchCount}` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleMarkdown}>
              <FolderKanban />
              Project · {markdownCount}
            </DropdownMenuItem>
            {showHelp && (
              <DropdownMenuItem onClick={onOpenHelp}>
                <CircleHelp />
                {t("chat.help")}</DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("ui.view")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={onShowColumns}>
              <Columns3 />
              {t("chat.columns")}{viewMode === "columns" && <Check className="mobile-nav-check" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onShowCanvas}>
              <Waypoints />
              {t("chat.canvas")}{viewMode === "canvas" && <Check className="mobile-nav-check" />}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {viewMode === "columns" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("ui.columns2")}</DropdownMenuLabel>
                {columnCountChoices(forceCols, t("ui.auto")).map((choice) => (
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
                <DropdownMenuLabel>{t("ui.whenColumnsAreFull")}</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => onPlacementModeChange("replace")}
                >
                  {t("ui.replace2")}{placementMode === "replace" && (
                    <Check className="mobile-nav-check" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onPlacementModeChange("fold")}
                >
                  {t("ui.strip")}{placementMode === "fold" && (
                    <Check className="mobile-nav-check" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <LanguageSwitcher /><AccountMenuRow />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ThreadChatTopbar(props: ThreadChatNavigationProps) {
  const { t } = useI18n()

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
        title={t("ui.startANewConversationTreeCommand")}
        onClick={(event: MouseEvent<HTMLButtonElement>) =>
          onNewConversation(event.metaKey)
        }
      >
        {t("chat.new")}</button>
      <button
        className="tbtn"
        title={t("ui.viewAllConversationsSwitchRenameOr")}
        onClick={onToggleTreeList}
      >
        <ListTodo size={13} />
        {t("chat.list")}<ShortcutHint {...THREAD_CHAT_SHORTCUTS.openTreeList} />
      </button>
      <div className="brand">
        <span className="mark">Thread Chat</span>
      </div>
      <div className="spacer" />
      <ThreadChatMobileMenu {...props} />
      {showHelp && (
        <button className="tbtn help" title={t("chat.help")} onClick={onOpenHelp}>
          <CircleHelp size={14} />
        </button>
      )}
      <div
        className="seg"
        role="group"
        aria-label={t("ui.viewMode")}
        title={t("ui.columnsForDetailedReadingCanvasFor")}
      >
        <button
          className={`mode ${viewMode === "columns" ? "on" : ""}`}
          aria-pressed={viewMode === "columns"}
          title={t("ui.columnViewReadMultipleThreadsSide")}
          onClick={onShowColumns}
        >
          <Columns3 size={12} />{t("ui.columns")}</button>
        <button
          className={`mode ${viewMode === "canvas" ? "on" : ""}`}
          aria-pressed={viewMode === "canvas"}
          title={t("ui.canvasViewBrowseTheTreeClick")}
          onClick={onShowCanvas}
        >
          <Waypoints size={12} />
          {t("ui.canvas")}</button>
      </div>
      {viewMode === "columns" && (
        <>
          <div
            className="seg"
            role="group"
            aria-label={t("ui.columns2")}
            title={
              windowWidth === null
                ? undefined
                : t("chat.columnWidths", { width: windowWidth, column: COL_MIN_W })
            }
          >
            {columnCountChoices(forceCols, t("ui.auto")).map((choice) => (
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
            aria-label={t("ui.placementWhenColumnsAreFull")}
            title={t("ui.placementWhenColumnsAreFull")}
          >
            <button
              className={placementMode === "replace" ? "on" : ""}
              aria-pressed={placementMode === "replace"}
              onClick={() => onPlacementModeChange("replace")}
            >
              {t("ui.replace2")}</button>
            <button
              className={placementMode === "fold" ? "on" : ""}
              aria-pressed={placementMode === "fold"}
              onClick={() => onPlacementModeChange("fold")}
            >
              {t("ui.strip")}</button>
          </div>
        </>
      )}
      <button
        className="tbtn"
        title={t("ui.findAndOpenAnyThreadK")}
        onClick={onToggleThreadTree}
      >
        <Network size={13} />
        {t("chat.tree")}{branchCount > 0 ? ` · ${branchCount}` : ""}
        <ShortcutHint {...THREAD_CHAT_SHORTCUTS.openThreadTree} />
      </button>
      <button
        className="tbtn"
        title={t("ui.expandOrCollapseTheProjectWorkspace")}
        onClick={onToggleMarkdown}
      >
        <FolderKanban size={13} />
        Project
        <span className="cnt">{markdownCount}</span>
      </button>
      <LanguageSwitcher /><AccountButton />
    </div>
  )
}
