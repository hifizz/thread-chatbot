export interface AssistantOutputProgress {
  receivedTextChars: number
  attachedArtifactCount: number
}

/** 正文与已原子绑定的 Artifact 都属于可保留的 assistant 输出。 */
export function hasAssistantOutput(progress: AssistantOutputProgress): boolean {
  return progress.receivedTextChars > 0 || progress.attachedArtifactCount > 0
}
