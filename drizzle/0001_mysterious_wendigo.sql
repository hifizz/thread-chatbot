CREATE TABLE "thread_chat"."branch_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tree_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"user_message_id" text NOT NULL,
	"assistant_message_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"status" text NOT NULL,
	"model_id" text NOT NULL,
	"assistant_message_index" integer NOT NULL,
	"turn_snapshot" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"billing_status" text DEFAULT 'pending' NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stop_requested_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_trees" ADD COLUMN "user_id" text;--> statement-breakpoint
-- 历史整树没有 owner。只有数据库恰好存在一个用户时才能无歧义回填；
-- 多用户库保持 NULL，等待持有原精确 /thread-chat/{treeId} URL 的用户原子认领。
DO $$
DECLARE
	sole_user_id text;
BEGIN
	IF (SELECT count(*) FROM "thread_chat"."user") = 1 THEN
		SELECT "id" INTO sole_user_id FROM "thread_chat"."user" LIMIT 1;
		UPDATE "thread_chat"."branch_trees"
		SET "user_id" = sole_user_id
		WHERE "user_id" IS NULL;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "thread_chat"."usage_records" ADD COLUMN "app_generation_id" text;--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_generations" ADD CONSTRAINT "branch_generations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_generations" ADD CONSTRAINT "branch_generations_tree_id_branch_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "thread_chat"."branch_trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_generations_current_assistant_uq" ON "thread_chat"."branch_generations" USING btree ("tree_id","thread_id","assistant_message_id") WHERE "thread_chat"."branch_generations"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_generations_assistant_attempt_uq" ON "thread_chat"."branch_generations" USING btree ("tree_id","thread_id","assistant_message_id","attempt");--> statement-breakpoint
CREATE INDEX "branch_generations_user_id_idx" ON "thread_chat"."branch_generations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "branch_generations_tree_current_idx" ON "thread_chat"."branch_generations" USING btree ("tree_id","is_current");--> statement-breakpoint
CREATE INDEX "branch_generations_user_status_idx" ON "thread_chat"."branch_generations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "branch_generations_heartbeat_idx" ON "thread_chat"."branch_generations" USING btree ("status","heartbeat_at");--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_trees" ADD CONSTRAINT "branch_trees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_trees_user_id_idx" ON "thread_chat"."branch_trees" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_app_generation_id_uq" ON "thread_chat"."usage_records" USING btree ("app_generation_id");
