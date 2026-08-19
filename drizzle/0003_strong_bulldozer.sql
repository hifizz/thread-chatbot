CREATE TABLE "thread_chat"."branch_message_feedback" (
	"user_id" text NOT NULL,
	"tree_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text NOT NULL,
	"feedback" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_message_feedback_pk" PRIMARY KEY("user_id","tree_id","thread_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_message_feedback" ADD CONSTRAINT "branch_message_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_message_feedback" ADD CONSTRAINT "branch_message_feedback_tree_id_branch_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "thread_chat"."branch_trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_message_feedback_tree_idx" ON "thread_chat"."branch_message_feedback" USING btree ("user_id","tree_id");--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_generations" DROP COLUMN "feedback";--> statement-breakpoint
ALTER TABLE "thread_chat"."branch_generations" DROP COLUMN "feedback_updated_at";