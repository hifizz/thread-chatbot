"use client"

import { create } from "zustand"

export type MarkdownArtifact = {
  toolCallId: string
  title: string
  content: string
}

export type MarkdownArtifactView = "preview" | "code"

type MarkdownArtifactState = {
  open: boolean
  view: MarkdownArtifactView
  artifact: MarkdownArtifact | null
  /** Open the panel showing the given document (a newly shown document starts in preview). */
  showArtifact: (artifact: MarkdownArtifact) => void
  /** Live-update the displayed document while it streams; no-op for any other document. */
  syncArtifact: (artifact: MarkdownArtifact) => void
  setView: (view: MarkdownArtifactView) => void
  closePanel: () => void
}

export const useMarkdownArtifactStore = create<MarkdownArtifactState>(
  (set) => ({
    open: false,
    view: "preview",
    artifact: null,
    showArtifact: (artifact) =>
      set((state) => ({
        open: true,
        artifact,
        view:
          state.artifact?.toolCallId === artifact.toolCallId
            ? state.view
            : "preview",
      })),
    syncArtifact: (artifact) =>
      set((state) =>
        state.artifact?.toolCallId === artifact.toolCallId
          ? { artifact }
          : state
      ),
    setView: (view) => set({ view }),
    closePanel: () => set({ open: false }),
  })
)
