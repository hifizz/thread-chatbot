CREATE TABLE "branch_trees" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
