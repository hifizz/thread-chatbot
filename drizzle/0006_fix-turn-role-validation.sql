CREATE OR REPLACE FUNCTION "thread_chat"."validate_turn_message_roles"()
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
$$;
