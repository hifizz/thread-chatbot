-- 历史迁移已经创建此 schema；新快照开始显式追踪它。
CREATE SCHEMA IF NOT EXISTS "thread_chat";
--> statement-breakpoint
CREATE TABLE "thread_chat"."project_files" (
	"project_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_files_pk" PRIMARY KEY("project_id","attachment_id")
);
--> statement-breakpoint
-- 先通过来源消息回填旧 Artifact，再加非空约束，保留既有内容和关联。
ALTER TABLE "thread_chat"."artifacts" ADD COLUMN "thread_id" text;--> statement-breakpoint
UPDATE "thread_chat"."artifacts" AS artifact
SET "thread_id" = message."thread_id"
FROM "thread_chat"."messages" AS message
WHERE artifact."source_message_id" = message."id"
  AND artifact."project_id" = message."project_id";--> statement-breakpoint
ALTER TABLE "thread_chat"."artifacts" ALTER COLUMN "thread_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_chat"."projects" ADD COLUMN "target" text;--> statement-breakpoint
ALTER TABLE "thread_chat"."projects" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "thread_chat"."projects" ADD COLUMN "contract_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_chat"."project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "thread_chat"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."project_files" ADD CONSTRAINT "project_files_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "thread_chat"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_files_attachment_uq" ON "thread_chat"."project_files" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "project_files_project_added_idx" ON "thread_chat"."project_files" USING btree ("project_id","added_at");--> statement-breakpoint
ALTER TABLE "thread_chat"."artifacts" ADD CONSTRAINT "artifacts_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "thread_chat"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_thread_created_idx" ON "thread_chat"."artifacts" USING btree ("thread_id","created_at");--> statement-breakpoint
ALTER TABLE "thread_chat"."projects" ADD CONSTRAINT "projects_contract_version_nonnegative" CHECK ("thread_chat"."projects"."contract_version" >= 0);--> statement-breakpoint
ALTER TABLE "thread_chat"."projects" ADD CONSTRAINT "projects_target_length" CHECK ("thread_chat"."projects"."target" is null or char_length("thread_chat"."projects"."target") <= 4000);--> statement-breakpoint
ALTER TABLE "thread_chat"."projects" ADD CONSTRAINT "projects_instructions_length" CHECK ("thread_chat"."projects"."instructions" is null or char_length("thread_chat"."projects"."instructions") <= 20000);
