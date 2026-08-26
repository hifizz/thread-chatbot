ALTER TABLE "thread_chat"."branch_trees" RENAME TO "legacy_branch_trees_backup";--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_generations" RENAME TO "legacy_branch_generations_backup";--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_message_feedback" RENAME TO "legacy_branch_message_feedback_backup";
