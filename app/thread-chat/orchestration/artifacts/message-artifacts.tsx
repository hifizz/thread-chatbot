"use client"

import type { Message, ThreadTreeState } from "../../core/types"
import {
  MarkdownArtifactCard,
  MarkdownArtifactProgressCard,
} from "./markdown-artifact-card"
import { selectMessageArtifacts } from "./message-artifacts-logic"

export function MessageArtifacts({
  state,
  message,
  sourceDepth,
  compact = false,
  onOpen,
}: {
  state?: ThreadTreeState
  message: Message
  sourceDepth: number | null
  compact?: boolean
  onOpen?: (artifactId: string) => void
}) {
  const artifacts = onOpen ? selectMessageArtifacts(state, message) : []
  if (!message.markdownGeneration && artifacts.length === 0) return null

  return (
    <>
      {message.markdownGeneration && (
        <MarkdownArtifactProgressCard
          progress={message.markdownGeneration}
          sourceDepth={sourceDepth}
          compact={compact}
        />
      )}
      {onOpen &&
        artifacts.map((artifact) => (
          <MarkdownArtifactCard
            key={artifact.id}
            artifact={artifact}
            sourceDepth={state?.threads[artifact.sourceThreadId]?.depth ?? null}
            onOpen={onOpen}
            compact={compact}
          />
        ))}
    </>
  )
}
