CREATE TABLE "thread_chat"."conversation_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"source_thread_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"lang" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "thread_chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_thread_fk" FOREIGN KEY ("source_thread_id","conversation_id") REFERENCES "thread_chat"."conversation_threads"("id","conversation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_message_fk" FOREIGN KEY ("source_message_id","source_thread_id") REFERENCES "thread_chat"."conversation_messages"("id","thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_artifacts_conversation_idx" ON "thread_chat"."conversation_artifacts" USING btree ("conversation_id","created_at");