ALTER TABLE "thread_chat"."branch_generations" ADD COLUMN "feedback" text;--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_generations" ADD COLUMN "feedback_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_trees" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;