import { randomUUID } from "node:crypto"
import type { Artifact } from "@/lib/thread-chat/domain/artifact"
import type { Message } from "@/lib/thread-chat/domain/message"
import type { MessageRun } from "@/lib/thread-chat/domain/message-run"
import type { Project } from "@/lib/thread-chat/domain/project"
import type { Thread } from "@/lib/thread-chat/domain/thread"

const FIXTURE_TIME = new Date("2026-01-01T00:00:00.000Z")

export type UserFixture = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  createdAt: Date
  updatedAt: Date
}

export type ProjectFixture = Project
export type ThreadFixture = Thread
export type MessageFixture = Message
export type ArtifactFixture = Artifact
export type MessageRunFixture = MessageRun

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
    artifactChangeSequence: 0,
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
    changeSequence: 1,
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
