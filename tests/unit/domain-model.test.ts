import { describe, expect, it } from "vitest"
import {
  resolveBaseContextMessages,
  validateBaseContext,
} from "@/lib/thread-chat/domain/base-context"
import {
  assertMessageCanBeReplaced,
  assertMessageForkEligible,
  selectEffectiveMessages,
  type Message,
} from "@/lib/thread-chat/domain/message"
import {
  assertMessageRunTransition,
  nextEventSequence,
  type MessageRun,
} from "@/lib/thread-chat/domain/message-run"
import {
  validateThreadTopology,
  type Thread,
} from "@/lib/thread-chat/domain/thread"
import {
  assertArtifactProvenance,
  toMarkdownArtifactToolOutput,
} from "@/lib/thread-chat/domain/artifact"

const now = new Date("2026-01-01T00:00:00.000Z")

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    threadId: "root",
    sequence: 1,
    role: "user",
    parts: [{ type: "text", text: "测试" }],
    replacesMessageId: null,
    supersededAt: null,
    finalizedAt: now,
    createdAt: now,
    ...overrides,
  }
}

function run(overrides: Partial<MessageRun> = {}): MessageRun {
  return {
    id: "run-1",
    assistantMessageId: "message-1",
    status: "completed",
    modelId: "fake/test-model",
    eventSequence: 0,
    checkpointParts: [],
    errorCode: null,
    errorMessage: null,
    heartbeatAt: null,
    stopRequestedAt: null,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "root",
    projectId: "project-1",
    parentThreadId: null,
    sourceMessageId: null,
    forkSourceSnapshot: null,
    baseContext: null,
    autoTitle: null,
    customTitle: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("BaseContext", () => {
  it("验证版本、去重并按 messageIds 顺序解析", () => {
    const first = message({ id: "first", sequence: 1 })
    const second = message({ id: "second", sequence: 2 })
    const context = validateBaseContext({
      schemaVersion: 1,
      messageIds: ["second", "first"],
    })

    expect(
      resolveBaseContextMessages(
        context,
        new Map([
          [first.id, first],
          [second.id, second],
        ])
      ).map((entry) => entry.id)
    ).toEqual(["second", "first"])
    expect(() =>
      validateBaseContext({ schemaVersion: 1, messageIds: ["first", "first"] })
    ).toThrow(/不得重复/)
  })
})

describe("Thread topology", () => {
  it("接受唯一 Root 与同 Project 的嵌套 Branch", () => {
    const source = message({ id: "source", threadId: "root" })
    const child = thread({
      id: "child",
      parentThreadId: "root",
      sourceMessageId: source.id,
      forkSourceSnapshot: {
        schemaVersion: 1,
        sourceRole: "user",
        sourceSequence: 1,
      },
      baseContext: { schemaVersion: 1, messageIds: [source.id] },
    })

    expect(() =>
      validateThreadTopology(
        "project-1",
        [thread(), child],
        new Map([[source.id, source]])
      )
    ).not.toThrow()
  })

  it("拒绝跨 Project Parent/source 与环", () => {
    const invalidChild = thread({
      id: "child",
      parentThreadId: "root",
      sourceMessageId: "source",
      forkSourceSnapshot: {
        schemaVersion: 1,
        sourceRole: "user",
        sourceSequence: 1,
      },
      baseContext: { schemaVersion: 1, messageIds: [] },
    })
    expect(() =>
      validateThreadTopology(
        "project-1",
        [thread(), invalidChild],
        new Map([["source", message({ id: "source", threadId: "other" })]])
      )
    ).toThrow(/Parent Thread/)

    const branchA = thread({
      id: "a",
      parentThreadId: "b",
      sourceMessageId: "source-b",
      forkSourceSnapshot: {
        schemaVersion: 1,
        sourceRole: "user",
        sourceSequence: 1,
      },
      baseContext: { schemaVersion: 1, messageIds: [] },
    })
    const branchB = thread({
      id: "b",
      parentThreadId: "a",
      sourceMessageId: "source-a",
      forkSourceSnapshot: {
        schemaVersion: 1,
        sourceRole: "user",
        sourceSequence: 1,
      },
      baseContext: { schemaVersion: 1, messageIds: [] },
    })
    expect(() =>
      validateThreadTopology(
        "project-1",
        [thread(), branchA, branchB],
        new Map([
          ["source-a", message({ id: "source-a", threadId: "a" })],
          ["source-b", message({ id: "source-b", threadId: "b" })],
        ])
      )
    ).toThrow(/不得形成环/)
  })
})

describe("Message replacement 与 Fork", () => {
  it("replacement 保持来源不可变并追加到有效时间线", () => {
    const source = message({ id: "source", sequence: 1, supersededAt: now })
    const replacement = message({
      id: "replacement",
      sequence: 3,
      replacesMessageId: source.id,
    })
    expect(
      selectEffectiveMessages([replacement, source]).map((item) => item.id)
    ).toEqual(["replacement"])

    const activeSource = { ...source, supersededAt: null }
    expect(() =>
      assertMessageCanBeReplaced(activeSource, replacement)
    ).not.toThrow()
    expect(() =>
      assertMessageCanBeReplaced(activeSource, {
        ...replacement,
        threadId: "other",
      })
    ).toThrow(/同 Thread/)
  })

  it("只允许 completed assistant 或 finalized user 作为 Fork source", () => {
    const assistant = message({ role: "assistant" })
    expect(() => assertMessageForkEligible(assistant, run())).not.toThrow()
    expect(() =>
      assertMessageForkEligible(assistant, run({ status: "running" }))
    ).toThrow(/completed/)
    expect(() => assertMessageForkEligible(message(), null)).not.toThrow()
  })
})

describe("MessageRun 状态机", () => {
  it("只允许条件状态转换和非负 eventSequence", () => {
    expect(() => assertMessageRunTransition("queued", "running")).not.toThrow()
    expect(() =>
      assertMessageRunTransition("running", "completed")
    ).not.toThrow()
    expect(() => assertMessageRunTransition("completed", "running")).toThrow(
      /不允许/
    )
    expect(nextEventSequence(7)).toBe(8)
    expect(() => nextEventSequence(-1)).toThrow(/非负/)
  })
})

describe("Artifact provenance", () => {
  it("只投影 artifactId，并拒绝跨 Project 来源", () => {
    const source = message()
    const root = thread()
    const artifact = {
      id: "artifact-1",
      projectId: root.projectId,
      sourceMessageId: source.id,
    }
    expect(() => assertArtifactProvenance(artifact, source, root)).not.toThrow()
    expect(toMarkdownArtifactToolOutput(artifact)).toEqual({
      artifactId: "artifact-1",
    })
    expect(() =>
      assertArtifactProvenance(
        { ...artifact, projectId: "other-project" },
        source,
        root
      )
    ).toThrow(/同一 Project/)
  })
})
