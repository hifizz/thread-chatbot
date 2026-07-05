"use client"

import { create } from "zustand"

// Artifact kinds the preview panel can display. Adding a new kind (e.g. html,
// svg, jsx) means extending this union and registering a renderer for it in
// components/artifact/renderers.tsx.
export type ArtifactType = "markdown"

export type Artifact = {
  toolCallId: string
  type: ArtifactType
  title: string
  content: string
}

export type ArtifactView = "preview" | "code"

type ArtifactState = {
  open: boolean
  view: ArtifactView
  artifact: Artifact | null
  /** Open the panel showing the given artifact (a newly shown artifact starts in preview). */
  showArtifact: (artifact: Artifact) => void
  /** Live-update the displayed artifact while it streams; no-op for any other artifact. */
  syncArtifact: (artifact: Artifact) => void
  setView: (view: ArtifactView) => void
  closePanel: () => void
}

export const useArtifactStore = create<ArtifactState>((set) => ({
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
      state.artifact?.toolCallId === artifact.toolCallId ? { artifact } : state
    ),
  setView: (view) => set({ view }),
  closePanel: () => set({ open: false }),
}))
