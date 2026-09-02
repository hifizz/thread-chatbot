CREATE TABLE "thread_chat"."feedback_score_outbox" (
	"message_id" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"delivered_version" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"lock_token" text,
	"last_error_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_score_outbox_value_allowed" CHECK ("thread_chat"."feedback_score_outbox"."value" in ('up', 'down', 'cleared')),
	CONSTRAINT "feedback_score_outbox_version_positive" CHECK ("thread_chat"."feedback_score_outbox"."version" >= 1),
	CONSTRAINT "feedback_score_outbox_delivered_version_valid" CHECK ("thread_chat"."feedback_score_outbox"."delivered_version" >= 0 and "thread_chat"."feedback_score_outbox"."delivered_version" <= "thread_chat"."feedback_score_outbox"."version"),
	CONSTRAINT "feedback_score_outbox_attempts_nonnegative" CHECK ("thread_chat"."feedback_score_outbox"."attempts" >= 0),
	CONSTRAINT "feedback_score_outbox_lock_shape" CHECK (("thread_chat"."feedback_score_outbox"."locked_until" is null) = ("thread_chat"."feedback_score_outbox"."lock_token" is null))
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."feedback_score_outbox" ADD CONSTRAINT "feedback_score_outbox_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "thread_chat"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_score_outbox_due_idx" ON "thread_chat"."feedback_score_outbox" USING btree ("next_attempt_at","locked_until");