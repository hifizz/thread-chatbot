CREATE TABLE "thread_chat"."conversation_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"input_message_id" text NOT NULL,
	"output_message_id" text NOT NULL,
	"intent" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"model_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"status" text NOT NULL,
	"content_state" text NOT NULL,
	"checkpoint_version" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb NOT NULL,
	"known_usage" jsonb,
	"usage_completeness" text NOT NULL,
	"billing_status" text NOT NULL,
	"paid_call_started" boolean DEFAULT false NOT NULL,
	"lease_owner" text,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stop_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_generations" ADD CONSTRAINT "conversation_generations_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_generations_owner_idempotency_uq" ON "thread_chat"."conversation_generations" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_generations_output_attempt_uq" ON "thread_chat"."conversation_generations" USING btree ("output_message_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_generations_current_turn_uq" ON "thread_chat"."conversation_generations" USING btree ("turn_id") WHERE "thread_chat"."conversation_generations"."is_current" = true;--> statement-breakpoint
CREATE INDEX "conversation_generations_owner_status_idx" ON "thread_chat"."conversation_generations" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "conversation_generations_conversation_updated_idx" ON "thread_chat"."conversation_generations" USING btree ("conversation_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversation_generations_lease_idx" ON "thread_chat"."conversation_generations" USING btree ("status","heartbeat_at");
--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_generations"
  ADD CONSTRAINT "conversation_generations_workspace_owner_fk"
  FOREIGN KEY (workspace_id, owner_id)
  REFERENCES "thread_chat"."workspace_members" (workspace_id, user_id);--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_generations"
  ADD CONSTRAINT "conversation_generations_project_workspace_fk"
  FOREIGN KEY (workspace_id, project_id)
  REFERENCES "thread_chat"."projects" (workspace_id, id);--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_generations"
  ADD CONSTRAINT "conversation_generations_conversation_project_fk"
  FOREIGN KEY (project_id, conversation_id)
  REFERENCES "thread_chat"."conversations" (project_id, id);--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_generations"
  ADD CONSTRAINT "conversation_generations_thread_conversation_fk"
  FOREIGN KEY (thread_id, conversation_id)
  REFERENCES "thread_chat"."conversation_threads" (id, conversation_id);--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_generations"
  ADD CONSTRAINT "conversation_generations_turn_thread_fk"
  FOREIGN KEY (turn_id, thread_id)
  REFERENCES "thread_chat"."conversation_turns" (id, thread_id);--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_generations"
  ADD CONSTRAINT "conversation_generations_input_message_fk"
  FOREIGN KEY (input_message_id, thread_id, turn_id)
  REFERENCES "thread_chat"."conversation_messages" (id, thread_id, turn_id);--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_generations"
  ADD CONSTRAINT "conversation_generations_output_message_fk"
  FOREIGN KEY (output_message_id, thread_id, turn_id)
  REFERENCES "thread_chat"."conversation_messages" (id, thread_id, turn_id);--> statement-breakpoint

ALTER TABLE "thread_chat"."conversation_generations"
  ADD CONSTRAINT "conversation_generations_attempt_positive_ck" CHECK (attempt > 0),
  ADD CONSTRAINT "conversation_generations_version_nonnegative_ck" CHECK (checkpoint_version >= 0 AND lease_version >= 0),
  ADD CONSTRAINT "conversation_generations_status_ck" CHECK (status IN ('running', 'stop_requested', 'completed', 'stopped', 'failed', 'superseded')),
  ADD CONSTRAINT "conversation_generations_content_state_ck" CHECK (content_state IN ('pending', 'streaming', 'complete', 'incomplete', 'failed')),
  ADD CONSTRAINT "conversation_generations_usage_completeness_ck" CHECK (usage_completeness IN ('complete', 'partial', 'unavailable')),
  ADD CONSTRAINT "conversation_generations_billing_status_ck" CHECK (billing_status IN ('pending', 'settled', 'usage_unavailable', 'not_billable')),
  ADD CONSTRAINT "conversation_generations_intent_ck" CHECK (intent ->> 'kind' IN ('send', 'regenerate-assistant', 'edit-user', 'retry')),
  ADD CONSTRAINT "conversation_generations_checkpoint_schema_ck" CHECK (checkpoint @> '{"schemaVersion": 1}'::jsonb),
  ADD CONSTRAINT "conversation_generations_terminal_time_ck" CHECK (
    (status IN ('running', 'stop_requested') AND finished_at IS NULL)
    OR (status IN ('completed', 'stopped', 'failed', 'superseded') AND finished_at IS NOT NULL)
  ),
  ADD CONSTRAINT "conversation_generations_stop_time_ck" CHECK (
    (status = 'stop_requested' AND stop_requested_at IS NOT NULL)
    OR status <> 'stop_requested'
  ),
  ADD CONSTRAINT "conversation_generations_terminal_content_ck" CHECK (
    (status = 'completed' AND content_state = 'complete')
    OR (status IN ('stopped', 'failed', 'superseded') AND content_state IN ('incomplete', 'failed'))
    OR status IN ('running', 'stop_requested')
  ),
  ADD CONSTRAINT "conversation_generations_billing_truth_ck" CHECK (
    (billing_status = 'pending' AND status IN ('running', 'stop_requested'))
    OR (billing_status = 'settled' AND usage_completeness = 'complete' AND known_usage IS NOT NULL AND paid_call_started)
    OR (billing_status = 'usage_unavailable' AND usage_completeness IN ('partial', 'unavailable'))
    OR (billing_status = 'not_billable' AND paid_call_started = false)
  ),
  ADD CONSTRAINT "conversation_generations_usage_shape_ck" CHECK (
    (usage_completeness = 'complete' AND known_usage IS NOT NULL AND (known_usage ->> 'reportedStepCount')::int = (known_usage ->> 'paidStepCount')::int)
    OR (usage_completeness = 'partial' AND known_usage IS NOT NULL AND (known_usage ->> 'reportedStepCount')::int < (known_usage ->> 'paidStepCount')::int)
    OR usage_completeness = 'unavailable'
  );--> statement-breakpoint

CREATE FUNCTION "thread_chat"."validate_conversation_generation_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "thread_chat"."conversation_messages"
    WHERE id = NEW.input_message_id
      AND thread_id = NEW.thread_id
      AND turn_id = NEW.turn_id
      AND role = 'user'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_generations_input_role_ck', MESSAGE = 'Generation input Message must have user role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "thread_chat"."conversation_messages"
    WHERE id = NEW.output_message_id
      AND thread_id = NEW.thread_id
      AND turn_id = NEW.turn_id
      AND role = 'assistant'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_generations_output_role_ck', MESSAGE = 'Generation output Message must have assistant role';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "conversation_generations_identity_guard"
  BEFORE INSERT OR UPDATE OF input_message_id, output_message_id, thread_id, turn_id
  ON "thread_chat"."conversation_generations"
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."validate_conversation_generation_identity"();
