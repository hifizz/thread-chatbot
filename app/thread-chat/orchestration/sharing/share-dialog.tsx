"use client"

/**
 * orchestration/share-dialog —— 快照分享弹层（顶栏 / 文档视图入口）。
 *
 * 创建即冻结：确认时经 captureShareLayout 现取 workspace+overlay 白名单布局，
 * commandId 幂等（重复点击同一条收据）。已有分享列出状态、可复制链接、可撤销；
 * 全部写路径只走 client 的 shares 三个方法。
 */

import React, { useCallback, useEffect, useState } from "react"
import { Share2 } from "lucide-react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Dialog, DialogPortal } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  SHARE_EXPIRY_OPTIONS,
  SHARE_EXPIRY_DEFAULT,
  SHARE_UI_COPY,
  type ShareExpiry,
} from "@/constants/sharing"
import type {
  CreateShareCommand,
  ShareDTO,
} from "@/lib/thread-chat/sharing/contracts"
import type { ConversationStore } from "../../core/store"
import type { ThreadChatClient } from "../../net/client"
import { dialogCloseToShell } from "../overlays/dialog-close-to-shell"
import { captureShareLayout } from "./capture-layout"

export type ShareResource =
  | { resourceType: "project"; resourceId: string }
  | { resourceType: "document"; resourceId: string }

export interface ShareDialogProps {
  open: boolean
  onClose(): void
  resource: ShareResource | null
  store: ConversationStore
  client: ThreadChatClient
  overlay: { drawerOpen: boolean; activeArtifactId: string | null }
  container?: React.RefObject<HTMLElement | null>
}

function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`
}

function statusLabel(share: ShareDTO): string {
  if (share.status === "active") return SHARE_UI_COPY.statusActive
  if (share.status === "expired") return SHARE_UI_COPY.statusExpired
  return SHARE_UI_COPY.statusRevoked
}

async function copyLink(token: string) {
  try {
    await navigator.clipboard.writeText(shareUrl(token))
    toast.success(SHARE_UI_COPY.copied)
  } catch {
    toast.error(SHARE_UI_COPY.copyFailed)
  }
}

export function ShareDialog({
  open,
  onClose,
  resource,
  store,
  client,
  overlay,
  container,
}: ShareDialogProps) {
  const [shares, setShares] = useState<ShareDTO[] | null>(null)
  const [expiry, setExpiry] = useState<ShareExpiry>(SHARE_EXPIRY_DEFAULT)
  const [creating, setCreating] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const hasActive = (shares ?? []).some((row) => row.status === "active")

  const resourceKey = resource
    ? `${resource.resourceType}:${resource.resourceId}`
    : null

  useEffect(() => {
    if (!open || !resource) return
    setShares(null)
    setLoadFailed(false)
    void client
      .listShares(resource.resourceType, resource.resourceId)
      .then((rows) => setShares(rows))
      .catch(() => setLoadFailed(true))
    // resourceKey 变化即换资源，重取列表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resourceKey, client])

  const create = useCallback(async () => {
    if (!resource || creating || hasActive) return
    setCreating(true)
    try {
      const base = {
        commandId: crypto.randomUUID(),
        expiresIn: expiry,
      }
      const command: CreateShareCommand =
        resource.resourceType === "project"
          ? {
              ...base,
              resourceType: "project",
              projectId: resource.resourceId,
              layout: captureShareLayout(store, overlay),
            }
          : {
              ...base,
              resourceType: "document",
              documentId: resource.resourceId,
            }
      const { data } = await client.createShare(command)
      setShares((rows) => [data.share, ...(rows ?? [])])
      await copyLink(data.share.token)
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : SHARE_UI_COPY.createFailed
      )
    } finally {
      setCreating(false)
    }
  }, [client, creating, expiry, hasActive, overlay, resource, store])

  const revoke = useCallback(
    async (share: ShareDTO) => {
      try {
        const { share: next } = await client.revokeShare(share.id)
        setShares((rows) =>
          (rows ?? []).map((row) => (row.id === share.id ? next : row))
        )
        toast.success(SHARE_UI_COPY.revoked)
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : SHARE_UI_COPY.createFailed
        )
      }
    },
    [client]
  )

  return (
    <Dialog
      open={open}
      onOpenChange={dialogCloseToShell(onClose)}
      modal={false}
      disablePointerDismissal
    >
      <DialogPortal container={container}>
        <DialogPrimitive.Backdrop className="swx-scrim" onMouseDown={onClose} />
        <DialogPrimitive.Popup
          className="swx global w-[420px] max-w-[calc(100vw-24px)]"
          initialFocus={false}
        >
          <div className="swx-title">
            <Share2 size={14} />
            {SHARE_UI_COPY.dialogTitle}
          </div>

          <div className="px-4 pb-3.5 pt-3">
            <p className="mb-3 text-xs leading-relaxed text-[var(--tc-content-secondary)]">
              {SHARE_UI_COPY.shareNotice}
            </p>

            <div
              className="mb-3 flex items-center gap-1.5"
              role="radiogroup"
              aria-label={SHARE_UI_COPY.expiryLabel}
            >
              <span className="mr-1 text-xs text-[var(--tc-content-secondary)]">
                {SHARE_UI_COPY.expiryLabel}
              </span>
              {SHARE_EXPIRY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={expiry === option.value}
                  className={cn(
                    "cursor-pointer rounded-lg border border-[var(--tc-border-strong)] bg-[var(--tc-surface-plain)] px-2.5 py-1 text-xs text-[var(--tc-content-secondary)] hover:text-[var(--tc-content-primary)]",
                    expiry === option.value &&
                      "border-[var(--tc-content-muted)] text-[var(--tc-content-primary)]"
                  )}
                  onClick={() => setExpiry(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="w-full cursor-pointer rounded-lg border border-[var(--tc-border-strong)] bg-[var(--tc-surface-plain)] py-2 text-[13px] text-[var(--tc-content-primary)] disabled:cursor-default disabled:opacity-50"
              disabled={creating || !resource || hasActive}
              onClick={() => void create()}
            >
              {creating ? "创建中…" : SHARE_UI_COPY.createAction}
            </button>
            {hasActive && (
              <p className="mt-1.5 text-center text-xs text-[var(--tc-content-muted)]">
                {SHARE_UI_COPY.oneActiveHint}
              </p>
            )}

            <div className="max-h-60 overflow-y-auto">
              {shares === null && !loadFailed && (
                <div className="swx-empty">加载中…</div>
              )}
              {loadFailed && (
                <div className="swx-empty">加载失败，请稍后重新打开</div>
              )}
              {shares !== null && shares.length === 0 && (
                <div className="swx-empty">{SHARE_UI_COPY.listEmpty}</div>
              )}
              {(shares ?? []).map((share) => (
                <div
                  className="flex items-center gap-2 border-t border-[var(--tc-border-subtle)] py-2 text-xs"
                  key={share.id}
                >
                  <span
                    className={cn(
                      "flex-none rounded-lg border border-[var(--tc-border-strong)] px-2 py-0.5 text-[var(--tc-content-secondary)]",
                      share.status !== "active" && "text-[var(--tc-content-muted)]"
                    )}
                  >
                    {statusLabel(share)}
                  </span>
                  <span className="flex-1 text-[var(--tc-content-secondary)]">
                    {share.createdAt.slice(0, 10)}
                    {share.expiresAt ? ` · 至 ${share.expiresAt.slice(0, 10)}` : " · 无限期"}
                  </span>
                  {share.status === "active" && (
                    <>
                      <button
                        type="button"
                        className="flex-none cursor-pointer rounded-lg border border-[var(--tc-border-strong)] bg-[var(--tc-surface-plain)] px-2 py-1 text-xs text-[var(--tc-content-secondary)] hover:border-[var(--tc-content-muted)] hover:text-[var(--tc-content-primary)]"
                        onClick={() => void copyLink(share.token)}
                      >
                        {SHARE_UI_COPY.copyAction}
                      </button>
                      <button
                        type="button"
                        className="flex-none cursor-pointer rounded-lg border border-[var(--tc-border-strong)] bg-[var(--tc-surface-plain)] px-2 py-1 text-xs text-[var(--tc-content-secondary)] hover:border-[var(--tc-danger-edge)] hover:text-[var(--tc-danger)]"
                        onClick={() => void revoke(share)}
                      >
                        {SHARE_UI_COPY.revokeAction}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
