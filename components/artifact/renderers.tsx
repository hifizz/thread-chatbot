"use client"

import type { FC, SVGProps } from "react"
import type { ArtifactType } from "@/lib/artifact/artifact-store"
import { MarkdownIcon } from "@/components/artifact/markdown-icon"
import { MarkdownPreview } from "@/components/artifact/markdown-preview"

export type ArtifactRenderer = {
  /** Short kind label, shown on the in-thread card (e.g. "Markdown"). */
  label: string
  /** Icon for this artifact kind, shown on the in-thread card. */
  Icon: FC<SVGProps<SVGSVGElement>>
  /** Shiki language used by the panel's Code view for the raw source. */
  codeLanguage: string
  /** Renders the artifact's Preview view. */
  Preview: FC<{ content: string }>
}

// Registry of preview renderers by artifact type. To support a new artifact
// kind (html, svg, jsx, ...): extend ArtifactType in lib/artifact/artifact-store.ts,
// add an entry here, and have a tool call showArtifact with that type.
export const artifactRenderers: Record<ArtifactType, ArtifactRenderer> = {
  markdown: {
    label: "Markdown",
    Icon: MarkdownIcon,
    codeLanguage: "markdown",
    Preview: MarkdownPreview,
  },
}
