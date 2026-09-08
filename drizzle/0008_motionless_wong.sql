ALTER TABLE "thread_chat"."threads" DROP CONSTRAINT "threads_root_or_fork_shape";--> statement-breakpoint
ALTER TABLE "thread_chat"."threads" ADD CONSTRAINT "threads_root_or_fork_shape" CHECK ((
        ("thread_chat"."threads"."parent_id" is null and "thread_chat"."threads"."depth" = 0 and
          "thread_chat"."threads"."fork_message_id" is null and "thread_chat"."threads"."fork_anchor" is null and
          "thread_chat"."threads"."anchor_text" is null and "thread_chat"."threads"."footnote" is null and
          "thread_chat"."threads"."fork_context" = '[]'::jsonb)
        or
        ("thread_chat"."threads"."parent_id" is not null and "thread_chat"."threads"."depth" > 0 and
          "thread_chat"."threads"."fork_message_id" is not null and "thread_chat"."threads"."footnote" is not null and
          (("thread_chat"."threads"."fork_anchor" is null and "thread_chat"."threads"."anchor_text" is null) or
           ("thread_chat"."threads"."fork_anchor" is not null and "thread_chat"."threads"."anchor_text" is not null)) and
          jsonb_array_length("thread_chat"."threads"."fork_context") > 0)
      ));