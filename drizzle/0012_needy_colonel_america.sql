CREATE TABLE "thread_chat"."legacy_conversation_entity_mappings" (
	"legacy_tree_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"local_id" text NOT NULL,
	"canonical_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_conversation_entity_mappings_pk" PRIMARY KEY("legacy_tree_id","entity_type","local_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_conversation_entity_mappings_canonical_uq" ON "thread_chat"."legacy_conversation_entity_mappings" USING btree ("canonical_id");--> statement-breakpoint
CREATE INDEX "legacy_conversation_entity_mappings_tree_idx" ON "thread_chat"."legacy_conversation_entity_mappings" USING btree ("legacy_tree_id");