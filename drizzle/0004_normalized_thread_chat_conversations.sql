CREATE TABLE "thread_chat"."artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"language" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."conversation_commands" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_commands_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."messages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"status" text NOT NULL,
	"model_id" text,
	"replaces_message_id" text,
	"superseded_at" timestamp with time zone,
	"stop_requested_at" timestamp with time zone,
	"feedback" text,
	"provider_usage" jsonb,
	"finish_reason" text,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_sequence_positive" CHECK ("thread_chat"."messages"."sequence" >= 1),
	CONSTRAINT "messages_role_allowed" CHECK ("thread_chat"."messages"."role" in ('user', 'assistant')),
	CONSTRAINT "messages_status_allowed" CHECK ("thread_chat"."messages"."status" in ('generating', 'completed', 'stopped', 'failed')),
	CONSTRAINT "messages_role_status_shape" CHECK ((
        ("thread_chat"."messages"."role" = 'user' and "thread_chat"."messages"."status" = 'completed' and "thread_chat"."messages"."model_id" is null)
        or
        ("thread_chat"."messages"."role" = 'assistant' and "thread_chat"."messages"."model_id" is not null)
      )),
	CONSTRAINT "messages_terminal_finished_shape" CHECK ((
        ("thread_chat"."messages"."status" = 'generating' and "thread_chat"."messages"."finished_at" is null)
        or
        ("thread_chat"."messages"."status" <> 'generating' and "thread_chat"."messages"."finished_at" is not null)
      )),
	CONSTRAINT "messages_feedback_allowed" CHECK ("thread_chat"."messages"."feedback" is null or "thread_chat"."messages"."feedback" in ('up', 'down'))
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"auto_title" text,
	"custom_title" text,
	"next_footnote" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_next_footnote_positive" CHECK ("thread_chat"."projects"."next_footnote" >= 1)
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."threads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"fork_message_id" text,
	"fork_context" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fork_anchor" jsonb,
	"anchor_text" text,
	"footnote" integer,
	"depth" integer NOT NULL,
	"model_id" text NOT NULL,
	"auto_title" text,
	"custom_title" text,
	"title_generation_attempted" boolean DEFAULT false NOT NULL,
	"title_generated" boolean DEFAULT false NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_depth_nonnegative" CHECK ("thread_chat"."threads"."depth" >= 0),
	CONSTRAINT "threads_next_sequence_positive" CHECK ("thread_chat"."threads"."next_sequence" >= 1),
	CONSTRAINT "threads_root_or_fork_shape" CHECK ((
        ("thread_chat"."threads"."parent_id" is null and "thread_chat"."threads"."depth" = 0 and
          "thread_chat"."threads"."fork_message_id" is null and "thread_chat"."threads"."fork_anchor" is null and
          "thread_chat"."threads"."anchor_text" is null and "thread_chat"."threads"."footnote" is null and
          "thread_chat"."threads"."fork_context" = '[]'::jsonb)
        or
        ("thread_chat"."threads"."parent_id" is not null and "thread_chat"."threads"."depth" > 0 and
          "thread_chat"."threads"."fork_message_id" is not null and "thread_chat"."threads"."fork_anchor" is not null and
          "thread_chat"."threads"."anchor_text" is not null and "thread_chat"."threads"."footnote" is not null and
          jsonb_array_length("thread_chat"."threads"."fork_context") > 0)
      ))
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."attachments" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_chat"."artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "thread_chat"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."artifacts" ADD CONSTRAINT "artifacts_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "thread_chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_commands" ADD CONSTRAINT "conversation_commands_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."messages" ADD CONSTRAINT "messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "thread_chat"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "thread_chat"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."messages" ADD CONSTRAINT "messages_replaces_message_id_messages_id_fk" FOREIGN KEY ("replaces_message_id") REFERENCES "thread_chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."projects" ADD CONSTRAINT "projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."threads" ADD CONSTRAINT "threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "thread_chat"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."threads" ADD CONSTRAINT "threads_parent_id_threads_id_fk" FOREIGN KEY ("parent_id") REFERENCES "thread_chat"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."threads" ADD CONSTRAINT "threads_fork_message_id_messages_id_fk" FOREIGN KEY ("fork_message_id") REFERENCES "thread_chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_project_created_idx" ON "thread_chat"."artifacts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "artifacts_source_message_idx" ON "thread_chat"."artifacts" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "conversation_commands_scope_idx" ON "thread_chat"."conversation_commands" USING btree ("user_id","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_thread_sequence_uq" ON "thread_chat"."messages" USING btree ("thread_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_project_thread_id_uq" ON "thread_chat"."messages" USING btree ("project_id","thread_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_project_id_uq" ON "thread_chat"."messages" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_replaces_message_uq" ON "thread_chat"."messages" USING btree ("replaces_message_id") WHERE "thread_chat"."messages"."replaces_message_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_project_thread_sequence_idx" ON "thread_chat"."messages" USING btree ("project_id","thread_id","sequence");--> statement-breakpoint
CREATE INDEX "messages_thread_timeline_idx" ON "thread_chat"."messages" USING btree ("thread_id","superseded_at","sequence");--> statement-breakpoint
CREATE INDEX "projects_user_updated_idx" ON "thread_chat"."projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "projects_user_archived_updated_idx" ON "thread_chat"."projects" USING btree ("user_id","archived_at","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_project_id_id_uq" ON "thread_chat"."threads" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_one_root_per_project_uq" ON "thread_chat"."threads" USING btree ("project_id") WHERE "thread_chat"."threads"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "threads_project_footnote_uq" ON "thread_chat"."threads" USING btree ("project_id","footnote") WHERE "thread_chat"."threads"."footnote" is not null;--> statement-breakpoint
CREATE INDEX "threads_project_parent_idx" ON "thread_chat"."threads" USING btree ("project_id","parent_id");--> statement-breakpoint
CREATE INDEX "threads_project_fork_message_idx" ON "thread_chat"."threads" USING btree ("project_id","fork_message_id");--> statement-breakpoint
ALTER TABLE "thread_chat"."attachments" ADD CONSTRAINT "attachments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_user_id_idx" ON "thread_chat"."attachments" USING btree ("user_id");