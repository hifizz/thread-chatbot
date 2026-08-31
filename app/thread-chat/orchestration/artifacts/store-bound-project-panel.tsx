"use client"

import { useCallback, useMemo } from "react"
import type { ConversationStore } from "../../core/store"
import { useConversationStore } from "../../core/use-thread-store"
import type { ThreadChatClient } from "../../net/client"
import type { ConversationCommands } from "../../net/commands/conversation-commands"
import { ProjectPanel } from "./project-panel"

export function StoreBoundProjectPanel({
  projectId,
  store,
  client,
  commands,
  open,
  activeId,
  onClose,
  onSelect,
  onLocate,
}: {
  projectId: string
  store: ConversationStore
  client: ThreadChatClient
  commands: ConversationCommands
  open: boolean
  activeId: string | null
  onClose(): void
  onSelect(id: string): void
  onLocate(threadId: string, sourceMessageId: string): void
}) {
  const state = useConversationStore(store, (value) => value)
  const files = useMemo(
    () =>
      state.projectFileOrder.flatMap((id) => {
        const file = state.projectFilesById[id]
        return file ? [file] : []
      }),
    [state.projectFileOrder, state.projectFilesById]
  )
  const artifacts = useMemo(
    () =>
      state.artifactOrder.flatMap((id) => {
        const artifact = state.artifactsById[id]
        return artifact ? [artifact] : []
      }),
    [state.artifactOrder, state.artifactsById]
  )

  const refresh = useCallback(async () => {
    const bootstrap = await client.getProject(projectId)
    store.getState().hydrateProject(bootstrap)
  }, [client, projectId, store])

  const saveContract = useCallback(
    async (target: string, instructions: string) => {
      await commands.updateProjectContract({
        projectId,
        target,
        instructions,
      })
    },
    [commands, projectId]
  )
  const addProjectFile = useCallback(
    async (attachmentId: string) => {
      await commands.addProjectFile(attachmentId)
    },
    [commands]
  )
  const removeProjectFile = useCallback(
    async (attachmentId: string) => {
      await commands.removeProjectFile(attachmentId)
    },
    [commands]
  )

  return (
    <ProjectPanel
      project={state.project}
      files={files}
      artifacts={artifacts}
      open={open}
      activeId={activeId}
      onClose={onClose}
      onSelect={onSelect}
      onLocate={onLocate}
      onRefresh={refresh}
      onSaveContract={saveContract}
      onAddProjectFile={addProjectFile}
      onRemoveProjectFile={removeProjectFile}
    />
  )
}
