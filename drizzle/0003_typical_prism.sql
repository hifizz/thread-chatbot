CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "attachment_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"attachment_id" text NOT NULL,
	"page" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment_chunks" ADD CONSTRAINT "attachment_chunks_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_chunks_attachment_id_idx" ON "attachment_chunks" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "attachment_chunks_embedding_idx" ON "attachment_chunks" USING hnsw ("embedding" vector_cosine_ops);