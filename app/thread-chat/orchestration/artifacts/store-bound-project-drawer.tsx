"use client"

import { useCallback, useMemo, type RefObject } from "react"
import type { ConversationStore } from "../../core/store"
import { useConversationStore } from "../../core/use-thread-store"
import type { ThreadChatClient } from "../../net/client"
import type { ConversationCommands } from "../../net/commands/conversation-commands"
import { ProjectDrawer } from "./project-drawer"

export function StoreBoundProjectDrawer({
  projectId,
  store,
  client,
  commands,
  open,
  zIndex,
  topLayer,
  narrow,
  container,
  onActivate,
  onClose,
  onRefresh,
}: {
  projectId: string
  store: ConversationStore
  client: ThreadChatClient
  commands: ConversationCommands
  open: boolean
  zIndex: number
  topLayer: boolean
  narrow: boolean
  container: HTMLElement | null | RefObject<HTMLElement | null>
  onActivate(): void
  onClose(): void
  onRefresh?(): Promise<void>
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

  const refresh = useCallback(async () => {
    if (onRefresh) {
      await onRefresh()
      return
    }
    const bootstrap = await client.getProject(projectId)
    store.getState().hydrateProject(bootstrap)
  }, [client, onRefresh, projectId, store])

  const saveContract = useCallback(
    async (target: string, instructions: string) => {
      await commands.updateProjectContract({ projectId, target, instructions })
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
    <ProjectDrawer
      project={state.project}
      files={files}
      open={open}
      zIndex={zIndex}
      topLayer={topLayer}
      narrow={narrow}
      container={container}
      onActivate={onActivate}
      onClose={onClose}
      onRefresh={refresh}
      onSaveContract={saveContract}
      onAddProjectFile={addProjectFile}
      onRemoveProjectFile={removeProjectFile}
    />
  )
}
