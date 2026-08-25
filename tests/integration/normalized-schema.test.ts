import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import postgres from "postgres"
import { assertSafeTestDatabaseUrl } from "../../scripts/lib/test-database-safety.mjs"

const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const sql = postgres(testDatabaseUrl, { max: 1 })

type OwnedProject = {
  userId: string
  projectId: string
  rootThreadId: string
}

async function createOwnedProject(): Promise<OwnedProject> {
  const userId = randomUUID()
  const projectId = randomUUID()
  const rootThreadId = randomUUID()

  await sql`
    insert into thread_chat."user" (
      id, name, email, email_verified, created_at, updated_at
    ) values (
      ${userId},
      'Schema Test',
      ${`${userId}@thread-chat.test`},
      true,
      now(),
      now()
    )
  `
  await sql`
    insert into thread_chat.projects (id, owner_user_id)
    values (${projectId}, ${userId})
  `
  await sql`
    insert into thread_chat.threads (id, project_id)
    values (${rootThreadId}, ${projectId})
  `

  return { userId, projectId, rootThreadId }
}

async function deleteTestUser(userId: string): Promise<void> {
  await sql`delete from thread_chat."user" where id = ${userId}`
}

afterAll(async () => {
  await sql.end()
})

describe("规范化 ThreadChat Schema", () => {
  it("从空 schema 一次建立六张目标表", async () => {
    const rows = await sql<{ tableName: string }[]>`
      select table_name as "tableName"
      from information_schema.tables
      where table_schema = 'thread_chat'
        and table_name in (
          'projects',
          'threads',
          'messages',
          'message_runs',
          'artifacts',
          'message_feedback'
        )
      order by table_name
    `

    expect(rows.map((row) => row.tableName)).toEqual([
      "artifacts",
      "message_feedback",
      "message_runs",
      "messages",
      "projects",
      "threads",
    ])
  })

  it("约束唯一 Root 与完整 Root/Branch ForkFacts", async () => {
    const owned = await createOwnedProject()
    try {
      await expect(
        sql`
          insert into thread_chat.threads (id, project_id)
          values (${randomUUID()}, ${owned.projectId})
        `
      ).rejects.toMatchObject({ code: "23505" })

      await expect(
        sql`
          insert into thread_chat.threads (
            id, project_id, parent_thread_id
          ) values (
            ${randomUUID()}, ${owned.projectId}, ${owned.rootThreadId}
          )
        `
      ).rejects.toMatchObject({ code: "23514" })

      const sourceMessageId = randomUUID()
      await sql`
        insert into thread_chat.messages (
          id, thread_id, sequence, role, parts, finalized_at
        ) values (
          ${sourceMessageId},
          ${owned.rootThreadId},
          1,
          'user',
          '[]'::jsonb,
          now()
        )
      `
      await sql`
        insert into thread_chat.threads (
          id,
          project_id,
          parent_thread_id,
          source_message_id,
          fork_source_snapshot,
          base_context
        ) values (
          ${randomUUID()},
          ${owned.projectId},
          ${owned.rootThreadId},
          ${sourceMessageId},
          ${sql.json({
            schemaVersion: 1,
            sourceRole: "user",
            sourceSequence: 1,
          })},
          ${sql.json({ schemaVersion: 1, messageIds: [sourceMessageId] })}
        )
      `
    } finally {
      await deleteTestUser(owned.userId)
    }
  })

  it("约束 sequence、replacement、角色、Run 状态与非负游标", async () => {
    const owned = await createOwnedProject()
    try {
      const userMessageId = randomUUID()
      const assistantMessageId = randomUUID()
      await sql`
        insert into thread_chat.messages (
          id, thread_id, sequence, role, parts, finalized_at
        ) values
          (${userMessageId}, ${owned.rootThreadId}, 1, 'user', '[]'::jsonb, now()),
          (${assistantMessageId}, ${owned.rootThreadId}, 2, 'assistant', '[]'::jsonb, now())
      `

      await expect(
        sql`
          insert into thread_chat.messages (
            id, thread_id, sequence, role, parts, finalized_at
          ) values (
            ${randomUUID()}, ${owned.rootThreadId}, 1, 'user', '[]'::jsonb, now()
          )
        `
      ).rejects.toMatchObject({ code: "23505" })
      await expect(
        sql`
          insert into thread_chat.messages (
            id, thread_id, sequence, role, parts, finalized_at
          ) values (
            ${randomUUID()}, ${owned.rootThreadId}, 3, 'system', '[]'::jsonb, now()
          )
        `
      ).rejects.toMatchObject({ code: "23514" })
      await expect(
        sql`
          insert into thread_chat.messages (
            id, thread_id, sequence, role, parts, finalized_at
          ) values (
            ${randomUUID()}, ${owned.rootThreadId}, 0, 'user', '[]'::jsonb, now()
          )
        `
      ).rejects.toMatchObject({ code: "23514" })

      const replacementId = randomUUID()
      await sql`
        insert into thread_chat.messages (
          id,
          thread_id,
          sequence,
          role,
          parts,
          replaces_message_id,
          finalized_at
        ) values (
          ${replacementId},
          ${owned.rootThreadId},
          3,
          'assistant',
          '[]'::jsonb,
          ${assistantMessageId},
          now()
        )
      `
      await expect(
        sql`
          insert into thread_chat.messages (
            id,
            thread_id,
            sequence,
            role,
            parts,
            replaces_message_id,
            finalized_at
          ) values (
            ${randomUUID()},
            ${owned.rootThreadId},
            4,
            'assistant',
            '[]'::jsonb,
            ${assistantMessageId},
            now()
          )
        `
      ).rejects.toMatchObject({ code: "23505" })

      await sql`
        insert into thread_chat.message_runs (
          id, assistant_message_id, status, model_id
        ) values (
          ${randomUUID()}, ${assistantMessageId}, 'queued', 'fake/test-model'
        )
      `
      await expect(
        sql`
          insert into thread_chat.message_runs (
            id, assistant_message_id, status, model_id
          ) values (
            ${randomUUID()}, ${assistantMessageId}, 'queued', 'fake/test-model'
          )
        `
      ).rejects.toMatchObject({ code: "23505" })
      await expect(
        sql`
          insert into thread_chat.message_runs (
            id, assistant_message_id, status, model_id
          ) values (
            ${randomUUID()}, ${replacementId}, 'unknown', 'fake/test-model'
          )
        `
      ).rejects.toMatchObject({ code: "23514" })
      await expect(
        sql`
          insert into thread_chat.message_runs (
            id, assistant_message_id, status, model_id, event_sequence
          ) values (
            ${randomUUID()}, ${replacementId}, 'queued', 'fake/test-model', -1
          )
        `
      ).rejects.toMatchObject({ code: "23514" })
    } finally {
      await deleteTestUser(owned.userId)
    }
  })

  it("永久删除 Project 级联清理 Thread、Message、Run、Artifact 与 feedback", async () => {
    const owned = await createOwnedProject()
    try {
      const assistantMessageId = randomUUID()
      const artifactId = randomUUID()
      await sql`
        insert into thread_chat.messages (
          id, thread_id, sequence, role, parts, finalized_at
        ) values (
          ${assistantMessageId},
          ${owned.rootThreadId},
          1,
          'assistant',
          '[]'::jsonb,
          now()
        )
      `
      await sql`
        insert into thread_chat.message_runs (
          id, assistant_message_id, status, model_id
        ) values (
          ${randomUUID()}, ${assistantMessageId}, 'queued', 'fake/test-model'
        )
      `
      await sql`
        insert into thread_chat.artifacts (
          id,
          project_id,
          source_message_id,
          change_sequence,
          kind,
          title,
          content
        ) values (
          ${artifactId},
          ${owned.projectId},
          ${assistantMessageId},
          1,
          'markdown',
          '测试 Artifact',
          '{}'::jsonb
        )
      `
      await sql`
        insert into thread_chat.message_feedback (
          assistant_message_id, feedback
        ) values (${assistantMessageId}, 'positive')
      `

      await sql`
        delete from thread_chat.projects
        where id = ${owned.projectId}
      `

      const [remaining] = await sql<{ count: number }[]>`
        select (
          (select count(*) from thread_chat.threads where project_id = ${owned.projectId})
          + (select count(*) from thread_chat.messages where id = ${assistantMessageId})
          + (select count(*) from thread_chat.message_runs where assistant_message_id = ${assistantMessageId})
          + (select count(*) from thread_chat.artifacts where id = ${artifactId})
          + (select count(*) from thread_chat.message_feedback where assistant_message_id = ${assistantMessageId})
        )::integer as count
      `
      expect(remaining.count).toBe(0)
    } finally {
      await deleteTestUser(owned.userId)
    }
  })
})
