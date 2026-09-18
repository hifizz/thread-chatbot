CREATE TABLE "thread_chat"."shares" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"owner_id" text NOT NULL,
	"source_project_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "shares_resource_type" CHECK ("thread_chat"."shares"."resource_type" in ('project','document'))
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."shares" ADD CONSTRAINT "shares_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."shares" ADD CONSTRAINT "shares_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "thread_chat"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shares_token_uq" ON "thread_chat"."shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "shares_owner_resource_idx" ON "thread_chat"."shares" USING btree ("owner_id","resource_type","resource_id","created_at");