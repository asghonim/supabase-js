-- ================================================================
-- Fix: restrict authenticated UPDATE on messages to mutable columns only
--
-- The previous GRANT ALL gave authenticated full UPDATE rights, meaning a
-- sender could overwrite conversation_id, message_number, created_at,
-- sender_id, or parent_message_id on their own messages via the client.
-- Those fields are routing/sequencing state that must never change after
-- insert, so we:
--   1. Revoke the blanket UPDATE and re-grant only body, edited_at, deleted_at
--   2. Add a BEFORE UPDATE trigger that raises for any attempt to change the
--      immutable fields (defense-in-depth; fires for all roles)
--   3. Add WITH CHECK to the RLS UPDATE policy to re-verify conversation
--      membership and sender ownership on the proposed post-update row
-- ================================================================


-- ----------------------------------------------------------------
-- 1. Column-level privileges
-- ----------------------------------------------------------------

REVOKE UPDATE ON TABLE public.messages FROM authenticated;
GRANT  UPDATE (body, edited_at, deleted_at) ON TABLE public.messages TO authenticated;


-- ----------------------------------------------------------------
-- 2. Immutability trigger
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enforce_message_immutable_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, private AS $$
BEGIN
    IF NEW.conversation_id   IS DISTINCT FROM OLD.conversation_id   OR
       NEW.sender_id         IS DISTINCT FROM OLD.sender_id         OR
       NEW.message_number    IS DISTINCT FROM OLD.message_number    OR
       NEW.created_at        IS DISTINCT FROM OLD.created_at        OR
       NEW.parent_message_id IS DISTINCT FROM OLD.parent_message_id
    THEN
        RAISE EXCEPTION 'routing and sequencing fields on messages are immutable after insert';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_message_immutable_fields
    BEFORE UPDATE ON public.messages
    FOR EACH ROW EXECUTE FUNCTION private.enforce_message_immutable_fields();


-- ----------------------------------------------------------------
-- 3. Tighten the UPDATE RLS policy with WITH CHECK
--    (drop + recreate; policy must stay in same transaction as the
--     column grant so it's consistent on first apply)
-- ----------------------------------------------------------------

DROP POLICY IF EXISTS "sender can edit or soft-delete own messages" ON public.messages;

CREATE POLICY "sender can edit or soft-delete own messages"
    ON public.messages FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = sender_id AND a.user_id = auth.uid()
        )
    )
    WITH CHECK (
        -- Re-verify ownership on the proposed row and that the message
        -- still sits in a conversation the sender participates in.
        -- Column-level grants and the trigger enforce field immutability;
        -- this clause ensures the post-update row remains coherent.
        private.is_conversation_participant(conversation_id)
        AND EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = sender_id AND a.user_id = auth.uid()
        )
    );
