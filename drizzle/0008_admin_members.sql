CREATE TABLE "thread_chat"."admin_members" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."admin_members" ADD CONSTRAINT "admin_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;