-- ================================================================
-- COMMENTS & CONVERSATIONS
--
-- Unified model for chat, threaded comments, and forum discussions:
--   conversations          — a channel, DM, ticket thread, or comment section
--   conversation_participants — membership and roles
--   conversation_targets   — binds a conversation to an external object
--   messages               — individual messages with optional thread nesting
--   message_attachments    — file metadata (files live in object storage)
--   message_reactions      — emoji reactions per account per message
--   conversation_reads     — per-account read position within a conversation
--   message_versions       — immutable audit trail of edits
--
-- Design notes:
--   * message_number is a per-conversation sequence — safer for cursors than
--     timestamps and consistent with queue-server per-queue sequences
--   * parent_message_id enables one level of threading (Slack-style)
--   * conversation_targets lets any object (post, ticket, product) have comments
--     without a dedicated comment table per type
--   * All writes except messages, reactions, and reads are intended to flow
--     through service_role (server-side); users get SELECT + the narrow
--     writes scoped to their own messages, reactions, and read state
-- ================================================================


-- ================================================================
-- ENUMS
-- ================================================================

CREATE TYPE public.conversation_type AS ENUM (
    'direct',
    'group',
    'channel',
    'comments'
    );
CREATE TYPE public.conversation_participant_role AS ENUM (
    'owner',
    'admin',
    'member'
    );


CREATE TABLE public.conversations (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                     UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    tenant_id               BIGINT REFERENCES public.organizations(id) ON DELETE CASCADE,
    type                    public.conversation_type NOT NULL DEFAULT 'group',
    title                   TEXT        CHECK (char_length(title) <= 500),
    message_count           BIGINT      NOT NULL DEFAULT 0,
    last_message_at         TIMESTAMPTZ,
    last_message_number     BIGINT,
    created_by              BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    );
CREATE INDEX idx_conversations_tenant     ON public.conversations(tenant_id);
CREATE INDEX idx_conversations_created_by ON public.conversations(created_by);
CREATE INDEX idx_conversations_type       ON public.conversations(type);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.conversations TO service_role;


CREATE TABLE public.conversation_participants (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    conversation_id BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    account_id      BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    role            public.conversation_participant_role NOT NULL DEFAULT 'member',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, account_id)
    );
CREATE INDEX idx_conv_participants_conversation ON public.conversation_participants(conversation_id);
CREATE INDEX idx_conv_participants_account      ON public.conversation_participants(account_id);
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.conversation_participants TO service_role;


-- Reusable helper: true when auth.uid() belongs to a participant of the given conversation.
-- Defined here (rather than under public.conversations) because it queries
-- conversation_participants, which must already exist.
CREATE OR REPLACE FUNCTION private.is_conversation_participant(p_conversation_id BIGINT)
    RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.conversation_participants cp
        JOIN public.accounts a ON a.id = cp.account_id
        WHERE cp.conversation_id = p_conversation_id
          AND a.user_id = auth.uid()
    );
    $$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


GRANT SELECT ON TABLE public.conversations TO authenticated;
CREATE POLICY "Participants can view conversations"
    ON public.conversations FOR SELECT TO authenticated
    USING (private.is_conversation_participant(id) OR public.has_permission('view', 'conversation', id));

-- Titles are event sourced: rather than updating conversations.title directly,
-- users insert a new row here. The latest row is synced back to the
-- denormalized conversations.title column by the trigger below.
CREATE TABLE public.conversation_titles (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    conversation_id BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    title           TEXT   NOT NULL CHECK (char_length(title) <= 500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
CREATE INDEX idx_conversation_titles_conversation ON public.conversation_titles(conversation_id, created_at DESC);
ALTER TABLE public.conversation_titles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.conversation_titles TO service_role;

-- Sync the newly inserted title back to the denormalized conversations.title.
CREATE OR REPLACE FUNCTION private.on_conversation_title_inserted()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
    BEGIN
        UPDATE public.conversations SET title = NEW.title WHERE id = NEW.conversation_id;
        RETURN NEW;
    END;
    $$;
CREATE TRIGGER on_conversation_title_inserted AFTER INSERT ON public.conversation_titles FOR EACH ROW EXECUTE FUNCTION private.on_conversation_title_inserted();

GRANT SELECT ON TABLE public.conversation_titles TO authenticated;
CREATE POLICY "Participants can view conversation titles"
    ON public.conversation_titles FOR SELECT TO authenticated
    USING (private.is_conversation_participant(conversation_id) OR public.has_permission('view', 'conversation', conversation_id));

GRANT INSERT (conversation_id, title) ON TABLE public.conversation_titles TO authenticated;
CREATE POLICY "Participants can set conversation titles"
    ON public.conversation_titles FOR INSERT TO authenticated
    WITH CHECK (private.is_conversation_participant(conversation_id) OR public.has_permission('edit', 'conversation', conversation_id));


GRANT SELECT ON TABLE public.conversation_participants TO authenticated;
CREATE POLICY "Participants can view members"
    ON public.conversation_participants FOR SELECT TO authenticated
    USING (private.is_conversation_participant(conversation_id) OR public.has_permission('view', 'conversation', conversation_id));


CREATE TABLE public.conversation_targets (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    conversation_id BIGINT NOT NULL UNIQUE REFERENCES public.conversations(id) ON DELETE CASCADE,
    target_type     TEXT   NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 100),
    target_id       TEXT   NOT NULL CHECK (char_length(target_id) BETWEEN 1 AND 255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (target_type, target_id)
    );
CREATE INDEX idx_conv_targets_type_id ON public.conversation_targets(target_type, target_id);
ALTER TABLE public.conversation_targets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.conversation_targets TO service_role;

GRANT SELECT ON TABLE public.conversation_targets TO authenticated;
CREATE POLICY "Participants can view targets"
    ON public.conversation_targets FOR SELECT TO authenticated
    USING (private.is_conversation_participant(conversation_id) OR public.has_permission('view', 'conversation', conversation_id));


-- Private counter table for per-conversation message sequence numbers
CREATE TABLE private.conversation_message_seq (
    conversation_id BIGINT PRIMARY KEY,
    last_number     BIGINT NOT NULL DEFAULT 0
    );
GRANT ALL ON TABLE private.conversation_message_seq TO service_role;


CREATE TABLE public.messages (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                 UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    conversation_id     BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id           BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE DEFAULT public.my_account_id(),
    body                TEXT   CHECK (char_length(body) <= 65535),
    parent_message_id   BIGINT REFERENCES public.messages(id) ON DELETE SET NULL,
    message_number      BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at           TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    UNIQUE (conversation_id, message_number)
    );
CREATE INDEX idx_messages_conv_number  ON public.messages(conversation_id, message_number);
CREATE INDEX idx_messages_conv_created ON public.messages(conversation_id, created_at);
CREATE INDEX idx_messages_sender       ON public.messages(sender_id);
CREATE INDEX idx_messages_parent       ON public.messages(parent_message_id) WHERE parent_message_id IS NOT NULL;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.messages TO service_role;


-- Atomically assign the next per-conversation message_number before insert,
-- and set created_at.
CREATE OR REPLACE FUNCTION private.on_insert_messages()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
    BEGIN
        INSERT INTO private.conversation_message_seq (conversation_id, last_number)
        VALUES (NEW.conversation_id, 1) ON CONFLICT (conversation_id) DO UPDATE
            SET last_number = private.conversation_message_seq.last_number + 1
        RETURNING last_number INTO NEW.message_number;
        RETURN NEW;
    END;
    $$;
CREATE TRIGGER on_insert_messages BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.on_insert_messages();


-- Keep conversation summary columns up-to-date after insert.
CREATE OR REPLACE FUNCTION private.on_messages_inserted()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
    BEGIN
        UPDATE public.conversations SET
            message_count       = message_count + 1,
            last_message_at     = NEW.created_at,
            last_message_number = NEW.message_number
        WHERE id = NEW.conversation_id;
        RETURN NEW;
    END;
    $$;
CREATE TRIGGER on_messages_inserted AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.on_messages_inserted();


-- Prevent mutation of routing/sequencing fields after insert.
CREATE OR REPLACE FUNCTION private.on_update_messages()
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
CREATE TRIGGER on_update_messages BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION private.on_update_messages();


GRANT SELECT ON TABLE public.messages TO authenticated;
CREATE POLICY "Participants can view messages"
    ON public.messages FOR SELECT TO authenticated
    USING (
        (deleted_at IS NULL AND private.is_conversation_participant(conversation_id))
        OR public.has_permission('view', 'message', id)
    );


GRANT INSERT (conversation_id, body, parent_message_id) ON TABLE public.messages TO authenticated;
CREATE POLICY "Participants can insert own messages"
    ON public.messages FOR INSERT TO authenticated
    WITH CHECK (
        (
            private.is_conversation_participant(conversation_id)
            AND EXISTS (
                SELECT 1 FROM public.accounts a
                WHERE a.id = sender_id AND a.user_id = auth.uid()
            )
        )
        OR public.has_permission('create', 'message', NULL)
    );


-- Messages are not updated directly. Editing (body/edited_at) and soft-deleting
-- (deleted_at) go through public.edit_message() / public.delete_message(),
-- defined in the MUTATION FUNCTIONS section at the end of this file.


CREATE TABLE public.message_attachments (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid          UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    message_id   BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    storage_key  TEXT   NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 1000),
    file_name    TEXT   NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
    content_type TEXT   CHECK (char_length(content_type) <= 100),
    size         BIGINT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
CREATE INDEX idx_message_attachments_message ON public.message_attachments(message_id);
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.message_attachments TO service_role;

GRANT SELECT ON TABLE public.message_attachments TO authenticated;
CREATE POLICY "Participants can view attachments"
    ON public.message_attachments FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id
              AND private.is_conversation_participant(m.conversation_id)
        )
        OR public.has_permission('view', 'message_attachment', id)
    );

GRANT INSERT (message_id, storage_key, file_name, content_type, size) ON TABLE public.message_attachments TO authenticated;
CREATE POLICY "Sender can add attachments to own messages"
    ON public.message_attachments FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.messages m
            JOIN public.accounts a ON a.id = m.sender_id
            WHERE m.id = message_id AND a.user_id = auth.uid()
        )
        OR public.has_permission('create', 'message_attachment', NULL)
    );


CREATE TABLE public.message_reactions (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    message_id BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE DEFAULT public.my_account_id(),
    reaction   TEXT   NOT NULL CHECK (char_length(reaction) BETWEEN 1 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (message_id, account_id, reaction)
    );
CREATE INDEX idx_message_reactions_msg ON public.message_reactions(message_id);
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.message_reactions TO service_role;

GRANT SELECT ON TABLE public.message_reactions TO authenticated;
CREATE POLICY "Participants can view reactions"
    ON public.message_reactions FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id
              AND private.is_conversation_participant(m.conversation_id)
        )
        OR public.has_permission('view', 'message_reaction', id)
    );

GRANT INSERT (message_id, reaction) ON TABLE public.message_reactions TO authenticated;
CREATE POLICY "Participants can add own reactions"
    ON public.message_reactions FOR INSERT TO authenticated
    WITH CHECK (
        (
            EXISTS (
                SELECT 1 FROM public.accounts a
                WHERE a.id = account_id AND a.user_id = auth.uid()
            )
            AND EXISTS (
                SELECT 1 FROM public.messages m
                WHERE m.id = message_id
                  AND private.is_conversation_participant(m.conversation_id)
            )
        )
        OR public.has_permission('create', 'message_reaction', NULL)
    );

-- Reactions are not deleted directly. Removal goes through
-- public.remove_message_reaction(), defined in the MUTATION FUNCTIONS section
-- at the end of this file.


CREATE TABLE public.conversation_reads (
    id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                      UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    conversation_id          BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    account_id               BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE DEFAULT public.my_account_id(),
    last_read_message_id     BIGINT REFERENCES public.messages(id) ON DELETE SET NULL,
    last_read_message_number BIGINT,
    last_read_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, account_id)
    );
CREATE INDEX idx_conv_reads_account        ON public.conversation_reads(account_id);
CREATE INDEX idx_conv_reads_conversation   ON public.conversation_reads(conversation_id);
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.conversation_reads TO service_role;

GRANT SELECT ON TABLE public.conversation_reads TO authenticated;
CREATE POLICY "Users can view own read state"
    ON public.conversation_reads FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = account_id AND a.user_id = auth.uid()
        )
        OR public.has_permission('view', 'conversation_read', id)
    );

GRANT INSERT (conversation_id, last_read_message_id, last_read_message_number) ON TABLE public.conversation_reads TO authenticated;
CREATE POLICY "Users can insert own read state"
    ON public.conversation_reads FOR INSERT TO authenticated
    WITH CHECK (
        (
            private.is_conversation_participant(conversation_id)
            AND EXISTS (
                SELECT 1 FROM public.accounts a
                WHERE a.id = account_id AND a.user_id = auth.uid()
            )
        )
        OR public.has_permission('create', 'conversation_read', NULL)
    );

CREATE TABLE public.message_versions (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    message_id BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    body       TEXT   NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
CREATE INDEX idx_message_versions_msg ON public.message_versions(message_id);
ALTER TABLE public.message_versions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.message_versions TO service_role;
-- no user policies — service_role only (audit trail)


-- ================================================================
-- MUTATION FUNCTIONS
-- Messages and reactions are never updated or deleted directly by users.
-- These functions validate permissions before performing the operation.
-- ================================================================

-- Edit a message body. The prior body is preserved in message_versions
-- (event-sourced audit trail) before the row is updated.
CREATE OR REPLACE FUNCTION public.edit_message(p_message_id BIGINT, p_body TEXT) RETURNS void AS $$
	DECLARE
		v_sender_id BIGINT;
		v_old_body  TEXT;
	BEGIN
		SELECT sender_id, body INTO v_sender_id, v_old_body
		FROM public.messages WHERE id = p_message_id AND deleted_at IS NULL;
		IF v_sender_id IS NULL THEN
			RETURN;
		END IF;
		IF NOT (
			EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = v_sender_id AND a.user_id = auth.uid())
			OR public.has_permission('edit', 'message', p_message_id)
		) THEN
			RAISE EXCEPTION 'Insufficient permissions to edit message';
		END IF;
		IF p_body IS NOT NULL THEN
			INSERT INTO public.message_versions (message_id, body) VALUES (p_message_id, v_old_body);
		END IF;
		UPDATE public.messages SET body = p_body, edited_at = NOW()
		WHERE id = p_message_id AND deleted_at IS NULL;
	END;
	$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.edit_message(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_message(BIGINT, TEXT) TO authenticated;

-- Soft-delete a message by setting deleted_at.
CREATE OR REPLACE FUNCTION public.delete_message(p_message_id BIGINT) RETURNS void AS $$
	DECLARE
		v_sender_id BIGINT;
	BEGIN
		SELECT sender_id INTO v_sender_id
		FROM public.messages WHERE id = p_message_id AND deleted_at IS NULL;
		IF v_sender_id IS NULL THEN
			RETURN;
		END IF;
		IF NOT (
			EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = v_sender_id AND a.user_id = auth.uid())
			OR public.has_permission('edit', 'message', p_message_id)
		) THEN
			RAISE EXCEPTION 'Insufficient permissions to delete message';
		END IF;
		UPDATE public.messages SET deleted_at = NOW()
		WHERE id = p_message_id AND deleted_at IS NULL;
	END;
	$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.delete_message(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_message(BIGINT) TO authenticated;

-- Remove the caller's own reaction from a message.
CREATE OR REPLACE FUNCTION public.remove_message_reaction(p_message_id BIGINT, p_reaction TEXT) RETURNS void AS $$
	BEGIN
		DELETE FROM public.message_reactions mr
		WHERE mr.message_id = p_message_id
		  AND mr.reaction = p_reaction
		  AND (
			EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = mr.account_id AND a.user_id = auth.uid())
			OR public.has_permission('delete', 'message_reaction', mr.id)
		  );
	END;
	$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.remove_message_reaction(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_message_reaction(BIGINT, TEXT) TO authenticated;


-- ================================================================
-- messages  →  edit_message (UPDATE body),
--              delete_message (UPDATE deleted_at)
-- ================================================================

CREATE TABLE public.messages_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_messages_audit_source  ON public.messages_audit ((old_row->>'id'));
CREATE INDEX idx_messages_audit_account ON public.messages_audit (performed_by_account_id);
ALTER TABLE public.messages_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.messages_audit TO service_role;

CREATE TRIGGER trg_messages_audit
    AFTER UPDATE ON public.messages
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- message_reactions  →  remove_message_reaction (DELETE)
-- ================================================================

CREATE TABLE public.message_reactions_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_message_reactions_audit_message ON public.message_reactions_audit ((old_row->>'message_id'));
CREATE INDEX idx_message_reactions_audit_account ON public.message_reactions_audit (performed_by_account_id);
ALTER TABLE public.message_reactions_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.message_reactions_audit TO service_role;

CREATE TRIGGER trg_message_reactions_audit
    AFTER DELETE ON public.message_reactions
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();
