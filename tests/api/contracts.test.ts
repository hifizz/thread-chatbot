import { describe, expect, it } from "vitest"
import {
  apiErrorResponseSchema,
  creationBundleSchema,
  createProjectRequestSchema,
  markdownArtifactToolOutputSchema,
  userMessagePartsSchema,
} from "@/lib/thread-chat/api/contracts"
import {
  apiErrorFixture,
  creationBundleDTOFixture,
  invalidUserPartFixture,
  ownershipMismatchFixture,
} from "../fixtures/thread-chat-api-fixtures"

describe("ThreadChat V1 contracts", () => {
  it("接受权威 Creation Bundle 与结构化错误", () => {
    expect(creationBundleSchema.parse(creationBundleDTOFixture)).toEqual(
      creationBundleDTOFixture
    )
    expect(apiErrorResponseSchema.parse(apiErrorFixture)).toEqual(
      apiErrorFixture
    )
  })

  it("拒绝未知请求字段、错误实体归属与非法 user part", () => {
    expect(() =>
      createProjectRequestSchema.parse({
        initialMessage: { parts: [{ type: "text", text: "hello" }] },
        clientProjectId: crypto.randomUUID(),
      })
    ).toThrow()
    expect(() =>
      creationBundleSchema.parse({
        ...creationBundleDTOFixture,
        assistantMessage: ownershipMismatchFixture,
      })
    ).toThrow(/ownership/)
    expect(() =>
      userMessagePartsSchema.parse([invalidUserPartFixture])
    ).toThrow()
  })

  it("Markdown tool output 只能携带 artifactId", () => {
    const artifactId = crypto.randomUUID()
    expect(markdownArtifactToolOutputSchema.parse({ artifactId })).toEqual({
      artifactId,
    })
    expect(() =>
      markdownArtifactToolOutputSchema.parse({
        artifactId,
        content: "# duplicated",
      })
    ).toThrow()
  })
})
