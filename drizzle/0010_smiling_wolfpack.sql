CREATE TABLE "thread_chat"."conversation_message_feedback" (
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text NOT NULL,
	"feedback" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_message_feedback_pk" PRIMARY KEY("user_id","conversation_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_message_feedback" ADD CONSTRAINT "conversation_message_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_message_feedback" ADD CONSTRAINT "conversation_message_feedback_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "thread_chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_message_feedback_conversation_idx" ON "thread_chat"."conversation_message_feedback" USING btree ("user_id","conversation_id");