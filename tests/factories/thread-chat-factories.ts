import { randomUUID } from "node:crypto"
import type { UIMessage } from "ai"

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const FIXTURE_TIME = new Date("2026-01-01T00:00:00.000Z")

export type UserFixture = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  createdAt: Date
  updatedAt: Date
}

export type ProjectFixture = {
  id: string
  ownerUserId: string
  autoTitle: string | null
  customTitle: string | null
  target: JsonValue | null
  instruction: JsonValue | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type ThreadFixture = {
  id: string
  projectId: string
  parentThreadId: string | null
  sourceMessageId: string | null
  forkSourceSnapshot: JsonValue | null
  baseContext: { schemaVersion: 1; messageIds: string[] } | null
  autoTitle: string | null
  customTitle: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type MessageFixture = {
  id: string
  threadId: string
  sequence: number
  role: "user" | "assistant"
  parts: UIMessage["parts"] | null
  replacesMessageId: string | null
  supersededAt: Date | null
  finalizedAt: Date | null
  createdAt: Date
}

export type ArtifactFixture = {
  id: string
  projectId: string
  sourceMessageId: string
  kind: string
  title: string
  content: JsonValue
  createdAt: Date
}

export type MessageRunFixture = {
  id: string
  assistantMessageId: string
  status: "queued" | "running" | "completed" | "failed" | "stopped"
  modelId: string
  eventSequence: number
  checkpointParts: UIMessage["parts"]
  errorCode: string | null
  errorMessage: string | null
  heartbeatAt: Date | null
  stopRequestedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function createUserFixture(
  overrides: Partial<UserFixture> = {}
): UserFixture {
  const id = overrides.id ?? randomUUID()
  return {
    id,
    name: "测试用户",
    email: `${id}@thread-chat.test`,
    emailVerified: true,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...overrides,
  }
}

export function createProjectFixture(
  overrides: Partial<ProjectFixture> = {}
): ProjectFixture {
  return {
    id: randomUUID(),
    ownerUserId: randomUUID(),
    autoTitle: "测试 Project",
    customTitle: null,
    target: null,
    instruction: null,
    archivedAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...overrides,
  }
}

export function createThreadFixture(
  overrides: Partial<ThreadFixture> = {}
): ThreadFixture {
  const isBranch = overrides.parentThreadId != null
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    parentThreadId: null,
    sourceMessageId: null,
    forkSourceSnapshot: null,
    baseContext: null,
    autoTitle: null,
    customTitle: null,
    archivedAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...(isBranch
      ? {
          sourceMessageId: randomUUID(),
          forkSourceSnapshot: {
            schemaVersion: 1,
            sourceRole: "assistant",
            sourceSequence: 2,
          },
          baseContext: { schemaVersion: 1, messageIds: [] },
        }
      : {}),
    ...overrides,
  }
}

export function createMessageFixture(
  overrides: Partial<MessageFixture> = {}
): MessageFixture {
  return {
    id: randomUUID(),
    threadId: randomUUID(),
    sequence: 1,
    role: "user",
    parts: [{ type: "text", text: "测试消息" }],
    replacesMessageId: null,
    supersededAt: null,
    finalizedAt: FIXTURE_TIME,
    createdAt: FIXTURE_TIME,
    ...overrides,
  }
}

export function createArtifactFixture(
  overrides: Partial<ArtifactFixture> = {}
): ArtifactFixture {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    sourceMessageId: randomUUID(),
    kind: "markdown",
    title: "测试 Artifact",
    content: { markdown: "# 测试" },
    createdAt: FIXTURE_TIME,
    ...overrides,
  }
}

export function createMessageRunFixture(
  overrides: Partial<MessageRunFixture> = {}
): MessageRunFixture {
  return {
    id: randomUUID(),
    assistantMessageId: randomUUID(),
    status: "queued",
    modelId: "fake/test-model",
    eventSequence: 0,
    checkpointParts: [],
    errorCode: null,
    errorMessage: null,
    heartbeatAt: null,
    stopRequestedAt: null,
    finishedAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...overrides,
  }
}
