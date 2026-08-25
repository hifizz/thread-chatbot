export const threadChatRoutes = {
  newProject: () => "/thread-chat/new",
  project: (projectId: string) => `/thread-chat/${encodeURIComponent(projectId)}`,
} as const

export const threadChatApiRoutes = {
  projects: () => "/api/v1/projects",
  project: (projectId: string) =>
    `/api/v1/projects/${encodeURIComponent(projectId)}`,
  projectBootstrap: (projectId: string) =>
    `/api/v1/projects/${encodeURIComponent(projectId)}/bootstrap`,
  projectArchive: (projectId: string, archived: boolean) =>
    `/api/v1/projects/${encodeURIComponent(projectId)}/${archived ? "archive" : "unarchive"}`,
  thread: (threadId: string) =>
    `/api/v1/threads/${encodeURIComponent(threadId)}`,
  threadMessages: (threadId: string) =>
    `/api/v1/threads/${encodeURIComponent(threadId)}/messages`,
  threadArchive: (threadId: string, archived: boolean) =>
    `/api/v1/threads/${encodeURIComponent(threadId)}/${archived ? "archive" : "unarchive"}`,
  threadForks: (threadId: string) =>
    `/api/v1/threads/${encodeURIComponent(threadId)}/forks`,
  messageEdits: (messageId: string) =>
    `/api/v1/messages/${encodeURIComponent(messageId)}/edits`,
  messageRegenerations: (messageId: string) =>
    `/api/v1/messages/${encodeURIComponent(messageId)}/regenerations`,
  messageFeedback: (messageId: string) =>
    `/api/v1/messages/${encodeURIComponent(messageId)}/feedback`,
  assistantEvents: (messageId: string) =>
    `/api/v1/assistant-messages/${encodeURIComponent(messageId)}/events`,
  assistantStop: (messageId: string) =>
    `/api/v1/assistant-messages/${encodeURIComponent(messageId)}/stop`,
  artifact: (artifactId: string) =>
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
} as const
