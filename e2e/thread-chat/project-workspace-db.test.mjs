import assert from "node:assert/strict"
import { config } from "dotenv"

config({ path: ".env.local" })
const source = process.env.DIRECT_URL || process.env.DATABASE_URL
assert.ok(source, "测试需要 DIRECT_URL 或 DATABASE_URL")
const testUrl = new URL(source.trim().replace(/^(['"])(.*)\1$/, "$2"))
testUrl.pathname = "/thread-chat-normalized-test"
testUrl.searchParams.set(
  "options",
  "-c search_path=thread_chat,public,extensions"
)
process.env.DATABASE_URL = testUrl.toString()
process.env.DIRECT_URL = testUrl.toString()

const [drizzle, { db }, schema, application, commands, workspaceConstants, modelConstants] =
  await Promise.all([
    import("drizzle-orm"),
    import("../../lib/db/index.ts"),
    import("../../lib/db/schema.ts"),
    import("../../lib/thread-chat/application/index.ts"),
    import("../../lib/thread-chat/contracts/commands.ts"),
    import("../../constants/project-workspace.ts"),
    import("../../constants/model.ts"),
  ])

const { and, eq } = drizzle
const id = () => crypto.randomUUID()
const prefix = `project-workspace-db-${id()}`
const userId = `${prefix}-owner`
const otherUserId = `${prefix}-other`
const modelId = modelConstants.DEFAULT_THREAD_CHAT_MODEL_ID

async function createUser(userIdValue, suffix) {
  await db.insert(schema.user).values({
    id: userIdValue,
    name: `Project Workspace ${suffix}`,
    email: `${prefix}-${suffix}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function createProject(ownerId, projectId, rootThreadId) {
  return application.startProject(ownerId, {
    commandId: id(),
    projectId,
    rootThreadId,
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "Project workspace test",
    files: [],
  })
}

async function insertAttachment(ownerId, attachmentId, filename = "reference.pdf") {
  await db.insert(schema.attachments).values({
    id: attachmentId,
    userId: ownerId,
    key: `${prefix}/${attachmentId}.pdf`,
    filename,
    mimeType: "application/pdf",
    size: 128,
    kind: "document",
    status: "ready",
    pageCount: 1,
    pages: ["Page one"],
  })
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code)
    return true
  })
}

try {
  await createUser(userId, "owner")
  await createUser(otherUserId, "other")

  // Command schema: maximum lengths and strict payloads are enforced before DB mutation.
  assert.equal(
    commands.updateProjectContractCommandSchema.safeParse({
      commandId: id(),
      expectedContractVersion: 0,
      target: "x".repeat(workspaceConstants.PROJECT_TARGET_MAX_CHARS + 1),
      instructions: "",
    }).success,
    false
  )
  assert.equal(
    commands.updateProjectContractCommandSchema.safeParse({
      commandId: id(),
      expectedContractVersion: 0,
      target: "ok",
      instructions: "ok",
      unexpected: true,
    }).success,
    false
  )

  const projectId = id()
  const rootThreadId = id()
  await createProject(userId, projectId, rootThreadId)

  // Empty/whitespace contract normalizes to null and increments once.
  const emptyContract = await application.updateProjectContract(userId, projectId, {
    commandId: id(),
    expectedContractVersion: 0,
    target: "   ",
    instructions: "\n\t",
  })
  assert.equal(emptyContract.result.target, null)
  assert.equal(emptyContract.result.instructions, null)
  assert.equal(emptyContract.result.contractVersion, 1)

  // Idempotent replay: same command ID + same payload returns same result, no double increment.
  const replayCommand = {
    commandId: id(),
    expectedContractVersion: 1,
    target: "Ship the workspace",
    instructions: "Use evidence",
  }
  const first = await application.updateProjectContract(userId, projectId, replayCommand)
  const replay = await application.updateProjectContract(userId, projectId, replayCommand)
  assert.deepEqual(replay.result, first.result)
  assert.equal(replay.result.contractVersion, 2)

  // Optimistic conflict must not overwrite the newer contract.
  await expectCode(
    application.updateProjectContract(userId, projectId, {
      commandId: id(),
      expectedContractVersion: 1,
      target: "stale",
      instructions: "stale",
    }),
    "STATE_CONFLICT"
  )
  const afterConflict = await application.getProjectBootstrap(userId, projectId)
  assert.equal(afterConflict.project.contractVersion, 2)
  assert.equal(afterConflict.project.target, "Ship the workspace")

  // DB check constraints remain a second line of defense behind command schemas.
  await assert.rejects(
    db
      .update(schema.projects)
      .set({ target: "x".repeat(workspaceConstants.PROJECT_TARGET_MAX_CHARS + 1) })
      .where(eq(schema.projects.id, projectId))
  )

  const attachmentId = id()
  await insertAttachment(userId, attachmentId)
  const addCommand = { commandId: id(), attachmentId }
  const added = await application.addProjectFile(userId, projectId, addCommand)
  const replayedAdd = await application.addProjectFile(userId, projectId, addCommand)
  assert.deepEqual(replayedAdd.result, added.result)

  // Duplicate add with a new command is membership-idempotent, not a duplicate row.
  await application.addProjectFile(userId, projectId, {
    commandId: id(),
    attachmentId,
  })
  const memberships = await db
    .select()
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.attachmentId, attachmentId))
  assert.equal(memberships.length, 1)

  // One Attachment cannot belong to two Projects.
  const secondProjectId = id()
  await createProject(userId, secondProjectId, id())
  await expectCode(
    application.addProjectFile(userId, secondProjectId, {
      commandId: id(),
      attachmentId,
    }),
    "STATE_CONFLICT"
  )

  // Cross-owner attachment is indistinguishable from not found.
  const foreignAttachmentId = id()
  await insertAttachment(otherUserId, foreignAttachmentId, "foreign.pdf")
  await expectCode(
    application.addProjectFile(userId, projectId, {
      commandId: id(),
      attachmentId: foreignAttachmentId,
    }),
    "NOT_FOUND"
  )

  // Removing membership preserves the underlying Attachment row/R2 identity.
  const removed = await application.removeProjectFile(userId, projectId, {
    commandId: id(),
    attachmentId,
  })
  assert.equal(removed.result.removed, true)
  assert.equal(
    (await db.select().from(schema.attachments).where(eq(schema.attachments.id, attachmentId))).length,
    1
  )
  assert.equal(
    (await db.select().from(schema.projectFiles).where(eq(schema.projectFiles.attachmentId, attachmentId))).length,
    0
  )

  // Archived Project rejects workspace writes, while unarchive remains available.
  await application.setProjectArchived(userId, projectId, {
    commandId: id(),
    archived: true,
  })
  await expectCode(
    application.updateProjectContract(userId, projectId, {
      commandId: id(),
      expectedContractVersion: 2,
      target: "archived write",
      instructions: "no",
    }),
    "STATE_CONFLICT"
  )
  const archivedAttachmentId = id()
  await insertAttachment(userId, archivedAttachmentId, "archived.pdf")
  await expectCode(
    application.addProjectFile(userId, projectId, {
      commandId: id(),
      attachmentId: archivedAttachmentId,
    }),
    "STATE_CONFLICT"
  )
  await application.setProjectArchived(userId, projectId, {
    commandId: id(),
    archived: false,
  })

  console.log("project workspace schema/command/repository tests passed")
} finally {
  await db.delete(schema.user).where(and(eq(schema.user.id, userId)))
  await db.delete(schema.user).where(and(eq(schema.user.id, otherUserId)))
  await globalThis.__dbClient?.end()
}
