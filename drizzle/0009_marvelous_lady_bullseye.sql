CREATE TABLE "thread_chat"."conversation_command_records" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."conversation_outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"aggregate_revision" integer NOT NULL,
	"type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"actor_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_command_records" ADD CONSTRAINT "conversation_command_records_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_outbox_events" ADD CONSTRAINT "conversation_outbox_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_command_records_scope_key_uq" ON "thread_chat"."conversation_command_records" USING btree ("actor_id","scope_type","scope_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "conversation_command_records_actor_created_idx" ON "thread_chat"."conversation_command_records" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_outbox_events_pending_idx" ON "thread_chat"."conversation_outbox_events" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "conversation_outbox_events_aggregate_idx" ON "thread_chat"."conversation_outbox_events" USING btree ("aggregate_type","aggregate_id","aggregate_revision");
--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_command_records"
  ADD CONSTRAINT "conversation_command_records_scope_type_ck"
  CHECK (scope_type IN ('project', 'conversation', 'thread', 'turn', 'generation')),
  ADD CONSTRAINT "conversation_command_records_identity_ck"
  CHECK (length(idempotency_key) BETWEEN 1 AND 200 AND length(payload_hash) = 64);--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_outbox_events"
  ADD CONSTRAINT "conversation_outbox_events_status_ck"
  CHECK (status IN ('pending', 'processing', 'dispatched', 'failed')),
  ADD CONSTRAINT "conversation_outbox_events_version_ck"
  CHECK (aggregate_revision >= 0 AND schema_version > 0 AND attempts >= 0),
  ADD CONSTRAINT "conversation_outbox_events_terminal_ck"
  CHECK (
    (status = 'dispatched' AND dispatched_at IS NOT NULL)
    OR (status <> 'dispatched' AND dispatched_at IS NULL)
  );
