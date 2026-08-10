CREATE TABLE "thread_chat"."external_usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text,
	"response_id" text,
	"request_id" text NOT NULL,
	"call_index" integer NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"billable_units" integer DEFAULT 0 NOT NULL,
	"provider_cost_micros" bigint DEFAULT 0 NOT NULL,
	"user_price_micros" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"query_fingerprint" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."external_usage_records" ADD CONSTRAINT "external_usage_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_usage_records_idempotency_key_idx" ON "thread_chat"."external_usage_records" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "external_usage_records_user_id_idx" ON "thread_chat"."external_usage_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "external_usage_records_thread_id_idx" ON "thread_chat"."external_usage_records" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "external_usage_records_response_id_idx" ON "thread_chat"."external_usage_records" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "external_usage_records_provider_operation_idx" ON "thread_chat"."external_usage_records" USING btree ("provider","operation");