import { config } from "dotenv"

config({ path: ".env.local" })
process.env.CONVERSATION_COMMAND_API_AUTHORITY = "isolated-test"

const { eq } = await import("drizzle-orm")
const { db } = await import("../lib/db/index.ts")
const { projects, user, workspaceMembers, workspaces } =
  await import("../lib/db/schema.ts")
const { ConversationCommandApplicationService } =
  await import("../lib/thread-chat/application/conversation-command-service.ts")
const { conversationId, projectId, threadId, workspaceId } =
  await import("../lib/thread-chat/domain/conversation-model.ts")
const { DrizzleConversationCommandStore } =
  await import("../lib/thread-chat/persistence/drizzle-conversation-command-store.ts")
const { DrizzleConversationGenerationRepository } =
  await import("../lib/thread-chat/persistence/drizzle-conversation-generation-repository.ts")

const email = "codex.issue34.20260822@example.com"
const [owner] = await db
  .select({ id: user.id })
  .from(user)
  .where(eq(user.email, email))
  .limit(1)
if (!owner) throw new Error(`测试账号不存在：${email}`)

const workspace = workspaceId("34343434-0000-4000-8000-000000000001")
const project = projectId("34343434-0000-4000-8000-000000000002")
const conversation = conversationId("34343434-0000-4000-8000-000000000003")
const root = threadId("34343434-0000-4000-8000-000000000004")
await db
  .insert(workspaces)
  .values({ id: workspace, revision: 0, lifecycle: "active" })
  .onConflictDoNothing()
await db
  .insert(workspaceMembers)
  .values({ workspaceId: workspace, userId: owner.id, role: "owner" })
  .onConflictDoNothing()
await db
  .insert(projects)
  .values({
    id: project,
    workspaceId: workspace,
    title: "Issue 34 Browser Fixture",
    revision: 0,
    lifecycle: "active",
  })
  .onConflictDoNothing()

const policy = {
  authority: "isolated-test" as const,
  legacyAuthorityEnabled: true,
}
const store = new DrizzleConversationCommandStore(policy)
const service = new ConversationCommandApplicationService(
  store,
  store,
  new DrizzleConversationGenerationRepository({
    authority: "isolated-test",
    legacyAuthorityEnabled: true,
  }),
  {
    schedule() {},
    async dispatchPending() {
      return 0
    },
  }
)
const existing = await service.getConversationSnapshot({
  actorUserId: owner.id,
  conversationId: conversation,
})
if (!existing)
  await service.createConversation({
    commandId: "34343434-0000-4000-8000-000000000005",
    actor: { kind: "user", userId: owner.id },
    scope: { type: "project", id: project },
    idempotencyKey: "issue-34-browser-fixture-create",
    payload: {
      conversationId: conversation,
      rootThreadId: root,
      title: "Issue 34 Canonical Client",
      modelId: "glm-5.3",
    },
  })
console.log(
  JSON.stringify({
    email,
    conversationId: conversation,
    rootThreadId: root,
    url: `http://localhost:4040/thread-chat/${conversation}`,
  })
)
