ALTER TABLE "usage_records" ADD COLUMN "generation_id" text;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "cost_source" text DEFAULT 'estimate' NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_records_cost_source_idx" ON "usage_records" USING btree ("cost_source");