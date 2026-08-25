import { describe, expect, it } from "vitest"
import {
  createArtifactFixture,
  createMessageFixture,
  createMessageRunFixture,
  createProjectFixture,
  createThreadFixture,
  createUserFixture,
} from "../factories/thread-chat-factories"

describe("ThreadChat fixture factories", () => {
  it("由 factory 生成服务端侧测试 ID 并允许显式关联", () => {
    const user = createUserFixture()
    const project = createProjectFixture({ ownerUserId: user.id })
    const root = createThreadFixture({ projectId: project.id })
    const message = createMessageFixture({
      threadId: root.id,
      role: "assistant",
    })
    const artifact = createArtifactFixture({
      projectId: project.id,
      sourceMessageId: message.id,
    })
    const run = createMessageRunFixture({ assistantMessageId: message.id })

    expect(
      new Set([user.id, project.id, root.id, message.id, artifact.id]).size
    ).toBe(5)
    expect(project.ownerUserId).toBe(user.id)
    expect(artifact.sourceMessageId).toBe(message.id)
    expect(run.assistantMessageId).toBe(message.id)
  })

  it("Branch fixture 自动补齐 ForkFacts", () => {
    const branch = createThreadFixture({ parentThreadId: "parent-thread" })

    expect(branch.sourceMessageId).not.toBeNull()
    expect(branch.forkSourceSnapshot).not.toBeNull()
    expect(branch.baseContext).toEqual({ schemaVersion: 1, messageIds: [] })
  })
})
