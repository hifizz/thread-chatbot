const ids = {
  project: "00000000-0000-4000-8000-000000000101",
  thread: "00000000-0000-4000-8000-000000000102",
  userMessage: "00000000-0000-4000-8000-000000000103",
  assistantMessage: "00000000-0000-4000-8000-000000000104",
  artifact: "00000000-0000-4000-8000-000000000105",
}
const timestamp = "2026-08-25T00:00:00.000Z"

export const projectDTOFixture = {
  id: ids.project,
  ownerUserId: "user-fixture",
  autoTitle: null,
  customTitle: null,
  target: null,
  instruction: null,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}

export const rootThreadDTOFixture = {
  id: ids.thread,
  projectId: ids.project,
  parentThreadId: null,
  sourceMessageId: null,
  forkSourceSnapshot: null,
  autoTitle: null,
  customTitle: null,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}

export const userMessageDTOFixture = {
  id: ids.userMessage,
  threadId: ids.thread,
  sequence: 1,
  role: "user" as const,
  parts: [{ type: "text", text: "hello" }],
  replacesMessageId: null,
  supersededAt: null,
  finalizedAt: timestamp,
  createdAt: timestamp,
}

export const assistantMessageDTOFixture = {
  id: ids.assistantMessage,
  threadId: ids.thread,
  sequence: 2,
  role: "assistant" as const,
  parts: null,
  replacesMessageId: null,
  supersededAt: null,
  finalizedAt: null,
  createdAt: timestamp,
}

export const assistantRunDTOFixture = {
  assistantMessageId: ids.assistantMessage,
  status: "queued" as const,
  modelId: "fake/model",
  checkpointParts: [],
  eventSequence: 0,
  error: null,
  stopRequestedAt: null,
  finishedAt: null,
}

export const creationBundleDTOFixture = {
  project: projectDTOFixture,
  rootThread: rootThreadDTOFixture,
  artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
  userMessage: userMessageDTOFixture,
  assistantMessage: assistantMessageDTOFixture,
  assistantRun: assistantRunDTOFixture,
}

export const apiErrorFixture = {
  error: {
    code: "validation_error" as const,
    message: "Request validation failed.",
    details: [{ path: ["initialMessage", "parts"] }],
  },
}

export const ownershipMismatchFixture = {
  ...assistantMessageDTOFixture,
  threadId: "00000000-0000-4000-8000-000000000999",
}

export const invalidUserPartFixture = {
  type: "reasoning",
  text: "client-forged",
}
