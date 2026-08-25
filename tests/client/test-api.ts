import type { ThreadChatApiCapabilities } from "@/lib/thread-chat/api/capabilities"

const notImplemented = () =>
  Promise.reject(new Error("Not implemented in test."))

export function createTestApi(
  overrides: Partial<ThreadChatApiCapabilities> = {}
): ThreadChatApiCapabilities {
  return {
    listProjects: notImplemented,
    createProject: notImplemented,
    bootstrapProject: notImplemented,
    patchProject: notImplemented,
    setProjectArchived: notImplemented,
    deleteProject: notImplemented,
    loadThreadMessages: notImplemented,
    patchThread: notImplemented,
    setThreadArchived: notImplemented,
    sendMessage: notImplemented,
    forkThread: notImplemented,
    editMessage: notImplemented,
    regenerateMessage: notImplemented,
    setFeedback: notImplemented,
    loadArtifact: notImplemented,
    async *subscribeAssistantEvents() {
      throw new Error("Not implemented in test.")
    },
    stopAssistant: notImplemented,
    ...overrides,
  }
}
