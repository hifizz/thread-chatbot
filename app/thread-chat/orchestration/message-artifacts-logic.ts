import type { Artifact, Message, ThreadTreeState } from "../core/types"

export function selectMessageArtifacts(
  state: ThreadTreeState | undefined,
  message: Message
): Artifact[] {
  if (!state) return []
  return (message.artifactIds ?? []).flatMap((artifactId) => {
    const artifact = state.artifacts[artifactId]
    return artifact ? [artifact] : []
  })
}
