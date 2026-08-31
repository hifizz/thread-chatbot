CREATE TABLE "thread_chat"."skill_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version" text NOT NULL,
	"digest" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"instructions" text NOT NULL,
	"resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"activation_mode" text NOT NULL,
	"capability_profile_id" text NOT NULL,
	"source_revision" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_digest_shape" CHECK ("thread_chat"."skill_versions"."digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "skill_versions_activation_mode_allowed" CHECK ("thread_chat"."skill_versions"."activation_mode" in ('sticky', 'one-shot')),
	CONSTRAINT "skill_versions_name_not_empty" CHECK (length(btrim("thread_chat"."skill_versions"."name")) > 0),
	CONSTRAINT "skill_versions_description_not_empty" CHECK (length(btrim("thread_chat"."skill_versions"."description")) > 0),
	CONSTRAINT "skill_versions_instructions_not_empty" CHECK (length(btrim("thread_chat"."skill_versions"."instructions")) > 0),
	CONSTRAINT "skill_versions_capability_profile_not_empty" CHECK (length(btrim("thread_chat"."skill_versions"."capability_profile_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."skills" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"source_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_slug_shape" CHECK ("thread_chat"."skills"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "skills_source_type_allowed" CHECK ("thread_chat"."skills"."source_type" in ('builtin', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."messages" DROP CONSTRAINT "messages_role_status_shape";--> statement-breakpoint
ALTER TABLE "thread_chat"."messages" ADD COLUMN "skill_version_id" text;--> statement-breakpoint
ALTER TABLE "thread_chat"."threads" ADD COLUMN "active_skill_version_id" text;--> statement-breakpoint
ALTER TABLE "thread_chat"."skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "thread_chat"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_skill_digest_uq" ON "thread_chat"."skill_versions" USING btree ("skill_id","digest");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_skill_version_uq" ON "thread_chat"."skill_versions" USING btree ("skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_one_current_uq" ON "thread_chat"."skill_versions" USING btree ("skill_id") WHERE "thread_chat"."skill_versions"."is_current" = true;--> statement-breakpoint
CREATE INDEX "skill_versions_digest_idx" ON "thread_chat"."skill_versions" USING btree ("digest");--> statement-breakpoint
CREATE INDEX "skill_versions_current_idx" ON "thread_chat"."skill_versions" USING btree ("is_current","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_slug_uq" ON "thread_chat"."skills" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "thread_chat"."messages" ADD CONSTRAINT "messages_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "thread_chat"."skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."threads" ADD CONSTRAINT "threads_active_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("active_skill_version_id") REFERENCES "thread_chat"."skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."messages" ADD CONSTRAINT "messages_role_status_shape" CHECK ((
        ("thread_chat"."messages"."role" = 'user' and "thread_chat"."messages"."status" = 'completed' and
          "thread_chat"."messages"."model_id" is null and "thread_chat"."messages"."skill_version_id" is null)
        or
        ("thread_chat"."messages"."role" = 'assistant' and "thread_chat"."messages"."model_id" is not null)
      ));