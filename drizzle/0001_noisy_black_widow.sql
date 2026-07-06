CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"page_count" integer,
	"pages" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_key_unique" UNIQUE("key")
);
