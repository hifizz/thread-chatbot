import { invariant } from "../../domain/domain-error"
import type { MessageId, UserId } from "../../domain/ids"
import type { ThreadChatSql } from "./database"

export type MessageFeedbackValue = "positive" | "negative"

export class FeedbackRepository {
  constructor(private readonly sql: ThreadChatSql) {}

  async set(input: {
    actorId: UserId
    assistantMessageId: MessageId
    feedback: MessageFeedbackValue | null
  }): Promise<MessageFeedbackValue | null> {
    const [eligible] = await this.sql`
      select m.id
      from thread_chat.messages m
      join thread_chat.message_runs r on r.assistant_message_id = m.id
      join thread_chat.threads t on t.id = m.thread_id
      join thread_chat.projects p on p.id = t.project_id
      where m.id = ${input.assistantMessageId}
        and m.role = 'assistant'
        and m.finalized_at is not null
        and m.superseded_at is null
        and r.status = 'completed'
        and p.owner_user_id = ${input.actorId}
      for update of m
    `
    invariant(
      eligible,
      "feedback_not_eligible",
      "Message 不属于 actor 或不满足 feedback 资格。"
    )

    if (input.feedback === null) {
      await this.sql`
        delete from thread_chat.message_feedback
        where assistant_message_id = ${input.assistantMessageId}
      `
      return null
    }

    const [row] = await this.sql<{ feedback: MessageFeedbackValue }[]>`
      insert into thread_chat.message_feedback (
        assistant_message_id, feedback
      ) values (
        ${input.assistantMessageId}, ${input.feedback}
      )
      on conflict (assistant_message_id) do update
      set feedback = excluded.feedback, updated_at = now()
      returning feedback
    `
    return row.feedback
  }
}
