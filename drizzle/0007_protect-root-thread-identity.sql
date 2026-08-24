CREATE OR REPLACE FUNCTION "thread_chat"."reject_canonical_reparenting"()
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
$$;
