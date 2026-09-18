"use client"

import type React from "react"
import { CircleHelp, Highlighter } from "lucide-react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Dialog, DialogPortal } from "@/components/ui/dialog"
import { THREAD_CHAT_SHORTCUTS } from "@/constants/thread-chat"
import { dialogCloseToShell } from "./dialog-close-to-shell"
import { ShortcutHint } from "./shortcut-hint"
import { useI18n } from "@/lib/i18n/client"


/** 首次内联提示与手动 Help Dialog 共用的功能要点。 */
function UsageTips() {
  const { t } = useI18n()

  return (
    <div className="helpx-list">
      <section className="helpx-section">
        <h3 className="helpx-section-title">{t("ui.branchingConversations")}</h3>
        <ul>
          <li>
            <b>{t("ui.selectTextInAnAiReply")}</b>
            {t("ui.openABranchEditTheSuggested")}</li>
          <li>
            {t("ui.hold")}<ShortcutHint {...THREAD_CHAT_SHORTCUTS.keepSourceColumn} />
            {t("ui.ctrlWhenSelectingTextOrClicking")}<b>{t("ui.keepThisColumn")}</b>
            {t("ui.andOpenTheNewThreadNext")}</li>
          <li>{t("ui.columnsAdaptToTheScreen2")}</li>
        </ul>
      </section>

      <section className="helpx-section">
        <h3 className="helpx-section-title">{t("ui.navigationAndLayout")}</h3>
        <ul>
          <li>{t("ui.dragBetweenColumnsToResizeDouble")}</li>
          <li>{t("ui.useBreadcrumbsToReturnToAn")}</li>
          <li>
            <ShortcutHint {...THREAD_CHAT_SHORTCUTS.openThreadTree} />{" "}
            {t("ui.findAndOpenAnyThread")}</li>
          <li>
            {t("ui.clickInTheColumnHeader")}<b>⇄</b> {t("ui.toSwitchThatColumnToAny")}<b>⑂</b> {t("ui.viewChildBranches")}</li>
        </ul>
      </section>

      <section className="helpx-section">
        <h3 className="helpx-section-title">{t("ui.contentAndViews")}</h3>
        <ul>
          <li>{t("ui.generatedMarkdownAppearsInTheMessage")}</li>
          <li>{t("ui.useTheTopBarToSwitch")}</li>
          <li>{t("ui.conversationsAreSavedAutomaticallyAndRestored")}</li>
        </ul>
      </section>
    </div>
  )
}

export interface UsageHintProps {
  onDismiss: () => void
}

/** 空白新对话中的首次内联提示。 */
export function UsageHint({ onDismiss }: UsageHintProps) {
  const { t } = useI18n()

  return (
    <div className="hint">
      <Highlighter size={15} color="var(--tc-depth-2)" />
      <UsageTips />
      <button
        type="button"
        className="close"
        aria-label={t("ui.closeHelp")}
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  )
}

export interface HelpPanelProps {
  closing?: boolean
  container?: React.RefObject<HTMLElement | null>
  onClose: () => void
}

/** 顶栏帮助入口打开的居中 Dialog。 */
export function HelpPanel({
  closing = false,
  container,
  onClose,
}: HelpPanelProps) {
  const { t } = useI18n()

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
          className="swx global helpx"
          initialFocus={false}
        >
          <DialogPrimitive.Title className="swx-title">
            <CircleHelp size={14} />
            {t("chat.help")}</DialogPrimitive.Title>
          <div className="helpx-body">
            <UsageTips />
          </div>
          <div className="swx-foot">
            <span>{t("ui.clickOutsideToClose")}</span>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.closeDialog} /> {t("common.close")}</span>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
