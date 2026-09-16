CREATE TABLE "thread_chat"."document_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"project_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"parent_revision_id" text,
	"artifact_id" text NOT NULL,
	"change_summary" text NOT NULL,
	"edits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"command_id" text,
	"execution_id" text NOT NULL,
	"tool_call_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_revisions_document_id_uq" UNIQUE("document_id","id"),
	CONSTRAINT "document_revisions_number_positive" CHECK ("thread_chat"."document_revisions"."revision_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."documents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"current_revision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_project_id_uq" UNIQUE("id","project_id")
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."messages" ADD COLUMN "document_tool_parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_chat"."messages" ADD COLUMN "document_context_used" jsonb;--> statement-breakpoint
ALTER TABLE "thread_chat"."document_revisions" ADD CONSTRAINT "document_revisions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "thread_chat"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."document_revisions" ADD CONSTRAINT "document_revisions_execution_id_messages_id_fk" FOREIGN KEY ("execution_id") REFERENCES "thread_chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."document_revisions" ADD CONSTRAINT "document_revisions_project_fk" FOREIGN KEY ("document_id","project_id") REFERENCES "thread_chat"."documents"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."document_revisions" ADD CONSTRAINT "document_revisions_artifact_source_fk" FOREIGN KEY ("artifact_id","project_id","execution_id") REFERENCES "thread_chat"."artifacts"("id","project_id","source_message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."document_revisions" ADD CONSTRAINT "document_revisions_parent_fk" FOREIGN KEY ("document_id","parent_revision_id") REFERENCES "thread_chat"."document_revisions"("document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "thread_chat"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."documents" ADD CONSTRAINT "documents_current_revision_fk" FOREIGN KEY ("id","current_revision_id") REFERENCES "thread_chat"."document_revisions"("document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_revisions_number_uq" ON "thread_chat"."document_revisions" USING btree ("document_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "document_revisions_artifact_uq" ON "thread_chat"."document_revisions" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "thread_chat"."documents" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "thread_chat"."artifacts" ADD CONSTRAINT "artifacts_document_source_uq" UNIQUE("id","project_id","source_message_id");