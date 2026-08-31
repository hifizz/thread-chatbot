import assert from "node:assert/strict"
import { parseAgentCase } from "../../evals/agent/schema.ts"
import { buildProductionEvaluationSeed } from "../../evals/agent/executors/production-harness.ts"

const evaluationCase = parseAgentCase({
  schemaVersion: "agent-case-v1",
  id: "project-workspace-harness-seed",
  suite: "memory-context",
  tags: ["project-workspace", "harness"],
  sensitivity: "synthetic",
  execution: "fixture",
  input: {
    messages: [{ role: "user", text: "Use current project resources." }],
    attachments: [
      {
        fixture: "synthetic-report.pdf",
        mediaType: "application/pdf",
        filename: "explicit.pdf",
      },
    ],
    projectContext: {
      target: "Current target",
      instructions: "Current instructions",
      files: [
        {
          fixture: "synthetic-report.pdf",
          mediaType: "application/pdf",
          filename: "project.pdf",
        },
      ],
      foreignFiles: [
        {
          fixture: "synthetic-report.pdf",
          mediaType: "application/pdf",
          filename: "foreign.pdf",
        },
      ],
    },
  },
  expected: { contains: ["Current target"] },
  fixtureResult: { text: "Current target", tools: [], terminalState: "completed" },
})

const seed = await buildProductionEvaluationSeed({
  evaluationCase,
  modelId: "test-model",
})

assert.equal(seed.project.target, "Current target")
assert.equal(seed.project.instructions, "Current instructions")
assert.equal(seed.project.contractVersion, 1)
assert.equal(seed.projectFiles.length, 1)
assert.equal(seed.foreignProjectFiles.length, 1)
assert.ok(seed.foreignProject)
assert.notEqual(seed.projectFiles[0].projectId, seed.foreignProjectFiles[0].projectId)

const lastUser = seed.messages.filter((message) => message.role === "user").at(-1)
const explicitParts = lastUser.parts.filter((part) => part.type === "file")
assert.equal(explicitParts.length, 1, "Project Files must not be duplicated into Message attachments")
assert.equal(explicitParts[0].filename, "explicit.pdf")

const projectAttachmentId = seed.projectFiles[0].attachmentId
const foreignAttachmentId = seed.foreignProjectFiles[0].attachmentId
assert.ok(seed.attachments.some((attachment) => attachment.id === projectAttachmentId))
assert.ok(seed.attachments.some((attachment) => attachment.id === foreignAttachmentId))
assert.notEqual(projectAttachmentId, foreignAttachmentId)

console.log("project workspace evaluation harness tests passed")
