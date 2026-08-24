CREATE TABLE "thread_chat"."conversation_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_state" text NOT NULL,
	"variant_of_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."conversation_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"model_id" text NOT NULL,
	"local_title" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"lifecycle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."conversation_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"position" integer NOT NULL,
	"active_user_message_id" text NOT NULL,
	"active_assistant_message_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"root_thread_id" text NOT NULL,
	"auto_title" text,
	"custom_title" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"lifecycle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"lifecycle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."thread_forks" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"parent_thread_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	"child_thread_id" text NOT NULL,
	"anchor" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "thread_chat"."workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"lifecycle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_threads" ADD CONSTRAINT "conversation_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "thread_chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_turns" ADD CONSTRAINT "conversation_turns_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "thread_chat"."conversation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "thread_chat"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "thread_chat"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."thread_forks" ADD CONSTRAINT "thread_forks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "thread_chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."thread_forks" ADD CONSTRAINT "thread_forks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "thread_chat"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "thread_chat"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_chat"."workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "thread_chat"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_id_thread_id_uq" ON "thread_chat"."conversation_messages" USING btree ("id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_id_thread_turn_uq" ON "thread_chat"."conversation_messages" USING btree ("id","thread_id","turn_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_turn_created_idx" ON "thread_chat"."conversation_messages" USING btree ("turn_id","created_at","id");--> statement-breakpoint
CREATE INDEX "conversation_messages_variant_source_idx" ON "thread_chat"."conversation_messages" USING btree ("variant_of_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_threads_id_conversation_id_uq" ON "thread_chat"."conversation_threads" USING btree ("id","conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_threads_conversation_created_idx" ON "thread_chat"."conversation_threads" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turns_id_thread_id_uq" ON "thread_chat"."conversation_turns" USING btree ("id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turns_thread_position_uq" ON "thread_chat"."conversation_turns" USING btree ("thread_id","position");--> statement-breakpoint
CREATE INDEX "conversation_turns_active_user_idx" ON "thread_chat"."conversation_turns" USING btree ("active_user_message_id");--> statement-breakpoint
CREATE INDEX "conversation_turns_active_assistant_idx" ON "thread_chat"."conversation_turns" USING btree ("active_assistant_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_project_id_id_uq" ON "thread_chat"."conversations" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "conversations_project_updated_idx" ON "thread_chat"."conversations" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_project_lifecycle_idx" ON "thread_chat"."conversations" USING btree ("project_id","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_id_id_uq" ON "thread_chat"."projects" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "projects_workspace_lifecycle_idx" ON "thread_chat"."projects" USING btree ("workspace_id","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_forks_child_thread_uq" ON "thread_chat"."thread_forks" USING btree ("child_thread_id");--> statement-breakpoint
CREATE INDEX "thread_forks_parent_source_idx" ON "thread_chat"."thread_forks" USING btree ("parent_thread_id","source_message_id");--> statement-breakpoint
CREATE INDEX "thread_forks_conversation_created_idx" ON "thread_chat"."thread_forks" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_idx" ON "thread_chat"."workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspaces_lifecycle_idx" ON "thread_chat"."workspaces" USING btree ("lifecycle");--> statement-breakpoint

ALTER TABLE "thread_chat"."workspaces"
  ADD CONSTRAINT "workspaces_revision_nonnegative_ck" CHECK (revision >= 0),
  ADD CONSTRAINT "workspaces_lifecycle_ck" CHECK (lifecycle IN ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "thread_chat"."workspace_members"
  ADD CONSTRAINT "workspace_members_role_ck" CHECK (role IN ('owner', 'member'));--> statement-breakpoint
ALTER TABLE "thread_chat"."projects"
  ADD CONSTRAINT "projects_revision_nonnegative_ck" CHECK (revision >= 0),
  ADD CONSTRAINT "projects_lifecycle_ck" CHECK (lifecycle IN ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "thread_chat"."conversations"
  ADD CONSTRAINT "conversations_revision_nonnegative_ck" CHECK (revision >= 0),
  ADD CONSTRAINT "conversations_lifecycle_ck" CHECK (lifecycle IN ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_threads"
  ADD CONSTRAINT "conversation_threads_no_magic_main_ck" CHECK (id <> 'main'),
  ADD CONSTRAINT "conversation_threads_revision_nonnegative_ck" CHECK (revision >= 0),
  ADD CONSTRAINT "conversation_threads_lifecycle_ck" CHECK (lifecycle IN ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_turns"
  ADD CONSTRAINT "conversation_turns_position_nonnegative_ck" CHECK (position >= 0),
  ADD CONSTRAINT "conversation_turns_revision_nonnegative_ck" CHECK (revision >= 0);--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_messages"
  ADD CONSTRAINT "conversation_messages_role_ck" CHECK (role IN ('user', 'assistant', 'context')),
  ADD CONSTRAINT "conversation_messages_content_state_ck" CHECK (content_state IN ('pending', 'streaming', 'complete', 'incomplete', 'failed')),
  ADD CONSTRAINT "conversation_messages_content_version_ck" CHECK (content @> '{"schemaVersion": 1}'::jsonb);--> statement-breakpoint
ALTER TABLE "thread_chat"."thread_forks"
  ADD CONSTRAINT "thread_forks_distinct_threads_ck" CHECK (parent_thread_id <> child_thread_id);--> statement-breakpoint

ALTER TABLE "thread_chat"."conversations"
  ADD CONSTRAINT "conversations_root_thread_fk"
  FOREIGN KEY (root_thread_id, id)
  REFERENCES "thread_chat"."conversation_threads" (id, conversation_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "thread_chat"."thread_forks"
  ADD CONSTRAINT "thread_forks_parent_conversation_fk"
  FOREIGN KEY (parent_thread_id, conversation_id)
  REFERENCES "thread_chat"."conversation_threads" (id, conversation_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "thread_chat"."thread_forks"
  ADD CONSTRAINT "thread_forks_child_conversation_fk"
  FOREIGN KEY (child_thread_id, conversation_id)
  REFERENCES "thread_chat"."conversation_threads" (id, conversation_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "thread_chat"."thread_forks"
  ADD CONSTRAINT "thread_forks_source_parent_fk"
  FOREIGN KEY (source_message_id, parent_thread_id)
  REFERENCES "thread_chat"."conversation_messages" (id, thread_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_messages"
  ADD CONSTRAINT "conversation_messages_turn_thread_fk"
  FOREIGN KEY (turn_id, thread_id)
  REFERENCES "thread_chat"."conversation_turns" (id, thread_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_messages"
  ADD CONSTRAINT "conversation_messages_variant_turn_fk"
  FOREIGN KEY (variant_of_message_id, thread_id, turn_id)
  REFERENCES "thread_chat"."conversation_messages" (id, thread_id, turn_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_turns"
  ADD CONSTRAINT "conversation_turns_active_user_fk"
  FOREIGN KEY (active_user_message_id, thread_id, id)
  REFERENCES "thread_chat"."conversation_messages" (id, thread_id, turn_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "thread_chat"."conversation_turns"
  ADD CONSTRAINT "conversation_turns_active_assistant_fk"
  FOREIGN KEY (active_assistant_message_id, thread_id, id)
  REFERENCES "thread_chat"."conversation_messages" (id, thread_id, turn_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

CREATE FUNCTION "thread_chat"."reject_canonical_reparenting"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
BEGIN
  IF TG_TABLE_NAME = 'projects' AND new_row -> 'workspace_id' IS DISTINCT FROM old_row -> 'workspace_id' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'projects_workspace_immutable_ck', MESSAGE = 'Project workspace ownership is immutable';
  ELSIF TG_TABLE_NAME = 'conversations' AND new_row -> 'project_id' IS DISTINCT FROM old_row -> 'project_id' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversations_project_immutable_ck', MESSAGE = 'Conversation project ownership is immutable';
  ELSIF TG_TABLE_NAME = 'conversations' AND new_row -> 'root_thread_id' IS DISTINCT FROM old_row -> 'root_thread_id' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversations_root_thread_immutable_ck', MESSAGE = 'Conversation root Thread identity is immutable';
  ELSIF TG_TABLE_NAME = 'conversation_threads' AND new_row -> 'conversation_id' IS DISTINCT FROM old_row -> 'conversation_id' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_threads_conversation_immutable_ck', MESSAGE = 'Thread conversation ownership is immutable';
  ELSIF TG_TABLE_NAME = 'conversation_turns' AND new_row -> 'thread_id' IS DISTINCT FROM old_row -> 'thread_id' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_turns_thread_immutable_ck', MESSAGE = 'Turn thread ownership is immutable';
  ELSIF TG_TABLE_NAME = 'conversation_messages' AND (new_row -> 'thread_id' IS DISTINCT FROM old_row -> 'thread_id' OR new_row -> 'turn_id' IS DISTINCT FROM old_row -> 'turn_id') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_messages_owner_immutable_ck', MESSAGE = 'Message Thread and Turn ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "projects_reparenting_guard"
  BEFORE UPDATE ON "thread_chat"."projects"
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."reject_canonical_reparenting"();--> statement-breakpoint
CREATE TRIGGER "conversations_reparenting_guard"
  BEFORE UPDATE ON "thread_chat"."conversations"
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."reject_canonical_reparenting"();--> statement-breakpoint
CREATE TRIGGER "conversation_threads_reparenting_guard"
  BEFORE UPDATE ON "thread_chat"."conversation_threads"
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."reject_canonical_reparenting"();--> statement-breakpoint
CREATE TRIGGER "conversation_turns_reparenting_guard"
  BEFORE UPDATE ON "thread_chat"."conversation_turns"
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."reject_canonical_reparenting"();--> statement-breakpoint
CREATE TRIGGER "conversation_messages_reparenting_guard"
  BEFORE UPDATE ON "thread_chat"."conversation_messages"
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."reject_canonical_reparenting"();--> statement-breakpoint

CREATE FUNCTION "thread_chat"."validate_conversation_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_conversation_id text;
  target_root_thread_id text;
BEGIN
  target_conversation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;

  SELECT root_thread_id INTO target_root_thread_id
  FROM "thread_chat"."conversations"
  WHERE id = target_conversation_id;

  IF target_root_thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "thread_chat"."conversation_threads"
    WHERE id = target_root_thread_id AND conversation_id = target_conversation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_root_thread_integrity_ck', MESSAGE = 'Conversation root Thread is missing or belongs to another Conversation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "thread_chat"."conversation_threads"
    WHERE id = target_root_thread_id AND local_title IS NOT NULL AND btrim(local_title) <> ''
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_root_thread_title_ck', MESSAGE = 'Root Thread must not duplicate the Conversation title';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "thread_chat"."thread_forks"
    WHERE conversation_id = target_conversation_id AND child_thread_id = target_root_thread_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_root_has_no_fork_ck', MESSAGE = 'Conversation root Thread cannot have an incoming Fork';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "thread_chat"."conversation_threads" thread
    WHERE thread.conversation_id = target_conversation_id
      AND thread.id <> target_root_thread_id
      AND NOT EXISTS (
        SELECT 1 FROM "thread_chat"."thread_forks" fork
        WHERE fork.conversation_id = target_conversation_id
          AND fork.child_thread_id = thread.id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_non_root_has_fork_ck', MESSAGE = 'Every non-root Thread must have exactly one incoming Fork';
  END IF;

  IF EXISTS (
    WITH RECURSIVE fork_walk(parent_thread_id, child_thread_id, path, cycle) AS (
      SELECT parent_thread_id, child_thread_id, ARRAY[parent_thread_id, child_thread_id], parent_thread_id = child_thread_id
      FROM "thread_chat"."thread_forks"
      WHERE conversation_id = target_conversation_id
      UNION ALL
      SELECT walk.parent_thread_id, fork.child_thread_id, walk.path || fork.child_thread_id, fork.child_thread_id = ANY(walk.path)
      FROM fork_walk walk
      JOIN "thread_chat"."thread_forks" fork
        ON fork.conversation_id = target_conversation_id
       AND fork.parent_thread_id = walk.child_thread_id
      WHERE NOT walk.cycle
    )
    SELECT 1 FROM fork_walk WHERE cycle
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_fork_acyclic_ck', MESSAGE = 'ThreadFork graph cannot contain a cycle';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "conversation_threads_integrity_guard"
  AFTER INSERT OR UPDATE OR DELETE ON "thread_chat"."conversation_threads"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."validate_conversation_integrity"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "thread_forks_integrity_guard"
  AFTER INSERT OR UPDATE OR DELETE ON "thread_chat"."thread_forks"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."validate_conversation_integrity"();--> statement-breakpoint

CREATE FUNCTION "thread_chat"."validate_turn_message_roles"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_turn_id text;
  active_user_id text;
  active_assistant_id text;
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
BEGIN
  target_turn_id := CASE
    WHEN TG_TABLE_NAME = 'conversation_turns' AND TG_OP = 'DELETE' THEN old_row ->> 'id'
    WHEN TG_TABLE_NAME = 'conversation_turns' THEN new_row ->> 'id'
    WHEN TG_OP = 'DELETE' THEN old_row ->> 'turn_id'
    ELSE new_row ->> 'turn_id'
  END;

  SELECT active_user_message_id, active_assistant_message_id
  INTO active_user_id, active_assistant_id
  FROM "thread_chat"."conversation_turns"
  WHERE id = target_turn_id;

  IF active_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "thread_chat"."conversation_messages"
    WHERE id = active_user_id AND turn_id = target_turn_id AND role = 'user'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_turn_active_user_role_ck', MESSAGE = 'Turn active user Message must have user role';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "thread_chat"."conversation_messages"
    WHERE id = active_assistant_id AND turn_id = target_turn_id AND role = 'assistant'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_turn_active_assistant_role_ck', MESSAGE = 'Turn active assistant Message must have assistant role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "thread_chat"."conversation_messages" message
    JOIN "thread_chat"."conversation_messages" source
      ON source.id = message.variant_of_message_id
     AND source.thread_id = message.thread_id
     AND source.turn_id = message.turn_id
    WHERE message.turn_id = target_turn_id
      AND message.variant_of_message_id IS NOT NULL
      AND message.role <> source.role
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'conversation_message_variant_role_ck', MESSAGE = 'Message variant must preserve role';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "conversation_turns_active_role_guard"
  AFTER INSERT OR UPDATE OR DELETE ON "thread_chat"."conversation_turns"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."validate_turn_message_roles"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "conversation_messages_active_role_guard"
  AFTER INSERT OR UPDATE OR DELETE ON "thread_chat"."conversation_messages"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "thread_chat"."validate_turn_message_roles"();
