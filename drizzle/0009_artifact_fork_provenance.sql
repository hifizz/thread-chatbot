ALTER TABLE "thread_chat"."threads" ADD COLUMN "fork_artifact_id" text;
--> statement-breakpoint
ALTER TABLE "thread_chat"."threads" ADD CONSTRAINT "threads_fork_artifact_id_artifacts_id_fk" FOREIGN KEY ("fork_artifact_id") REFERENCES "thread_chat"."artifacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "threads_project_fork_artifact_idx" ON "thread_chat"."threads" USING btree ("project_id","fork_artifact_id");
--> statement-breakpoint
ALTER TABLE "thread_chat"."threads" DROP CONSTRAINT "threads_root_or_fork_shape";
--> statement-breakpoint
ALTER TABLE "thread_chat"."threads" ADD CONSTRAINT "threads_root_or_fork_shape" CHECK ((
        ("parent_id" is null and "depth" = 0 and
          "fork_message_id" is null and "fork_artifact_id" is null and
          "fork_anchor" is null and "anchor_text" is null and
          "footnote" is null and "fork_context" = '[]'::jsonb)
        or
        ("parent_id" is not null and "depth" > 0 and
          "fork_message_id" is not null and "fork_anchor" is not null and
          "anchor_text" is not null and "footnote" is not null and
          jsonb_array_length("fork_context") > 0)
      ));
