"use client"

import { useCallback, useMemo, type RefObject } from "react"
import type { ConversationStore } from "../../core/store"
import type { WorkspacePanelSizes, WorkspaceUiState } from "../../core/types"
import { useConversationStore } from "../../core/use-thread-store"
import type { DrawerSide } from "../overlays/workspace-overlay-logic"
import { ArtifactsDrawer } from "./artifacts-drawer"

function findMessageElement(messageId: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>("[data-thread-chat-message-id]")].find(
      (element) => element.dataset.threadChatMessageId === messageId
    ) ?? null
  )
}

function revealMessage(messageId: string, attempt = 0) {
  const element = findMessageElement(messageId)
  if (!element) {
    if (attempt < 8)
      window.setTimeout(() => revealMessage(messageId, attempt + 1), 60)
    return
  }
  element.scrollIntoView({ behavior: "smooth", block: "center" })
  element.animate(
    [
      { backgroundColor: "transparent" },
      { backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)" },
      { backgroundColor: "transparent" },
    ],
    { duration: 1600, easing: "ease-out" }
  )
}

export function StoreBoundArtifactsDrawer({
  store,
  open,
  activeId,
  zIndex,
  side,
  topLayer,
  narrow,
  container,
  panelSizes,
  setWorkspace,
  onActivate,
  onClose,
  onOpenChangeComplete,
  onSelect,
  onLocate,
}: {
  store: ConversationStore
  open: boolean
  activeId: string | null
  zIndex: number
  side: DrawerSide
  topLayer: boolean
  narrow: boolean
  container?: HTMLElement | null | RefObject<HTMLElement | null>
  panelSizes?: WorkspacePanelSizes
  setWorkspace?(next: Partial<WorkspaceUiState>): void
  onActivate(): void
  onClose(): void
  onOpenChangeComplete?(open: boolean): void
  onSelect(id: string | null): void
  onLocate(threadId: string, sourceMessageId: string): void
}) {
  const state = useConversationStore(store, (value) => value)
  const artifacts = useMemo(
    () =>
      state.artifactOrder.flatMap((id) => {
        const artifact = state.artifactsById[id]
        return artifact ? [artifact] : []
      }),
    [state.artifactOrder, state.artifactsById]
  )
  const locate = useCallback(
    (threadId: string, sourceMessageId: string) => {
      onLocate(threadId, sourceMessageId)
      revealMessage(sourceMessageId)
    },
    [onLocate]
  )

  return (
    <ArtifactsDrawer
      project={state.project}
      artifacts={artifacts}
      open={open}
      activeId={activeId}
      zIndex={zIndex}
      side={side}
      topLayer={topLayer}
      narrow={narrow}
      container={container}
      panelSizes={panelSizes}
      setWorkspace={setWorkspace}
      onActivate={onActivate}
      onClose={onClose}
      onOpenChangeComplete={onOpenChangeComplete}
      onSelect={onSelect}
      onLocate={locate}
    />
  )
}
