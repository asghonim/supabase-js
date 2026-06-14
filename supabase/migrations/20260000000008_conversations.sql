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
--   * All writes except reactions and reads are intended to flow through
--     service_role (server-side); users get SELECT + reactions + reads
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


-- ================================================================
-- TABLES
-- ================================================================

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
GRANT ALL ON TABLE public.conversations TO authenticated, service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_conversations_tenant     ON public.conversations(tenant_id);
CREATE INDEX idx_conversations_created_by ON public.conversations(created_by);
CREATE INDEX idx_conversations_type       ON public.conversations(type);

CREATE OR REPLACE FUNCTION private.on_insert_conversations()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_conversations
    BEFORE INSERT ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_conversations();

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
GRANT ALL ON TABLE public.conversation_participants TO authenticated, service_role;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_conv_participants_conversation ON public.conversation_participants(conversation_id);
CREATE INDEX idx_conv_participants_account      ON public.conversation_participants(account_id);

CREATE OR REPLACE FUNCTION private.on_insert_conversation_participants()
RETURNS TRIGGER AS $$ BEGIN NEW.joined_at = NOW(); NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_conversation_participants
    BEFORE INSERT ON public.conversation_participants
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_conversation_participants();

CREATE TABLE public.conversation_targets (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    conversation_id BIGINT NOT NULL UNIQUE REFERENCES public.conversations(id) ON DELETE CASCADE,
    target_type     TEXT   NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 100),
    target_id       TEXT   NOT NULL CHECK (char_length(target_id) BETWEEN 1 AND 255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (target_type, target_id)
);
GRANT ALL ON TABLE public.conversation_targets TO authenticated, service_role;
ALTER TABLE public.conversation_targets ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_conv_targets_type_id ON public.conversation_targets(target_type, target_id);

CREATE OR REPLACE FUNCTION private.on_insert_conversation_targets()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_conversation_targets
    BEFORE INSERT ON public.conversation_targets
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_conversation_targets();

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
    sender_id           BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    body                TEXT   CHECK (char_length(body) <= 65535),
    parent_message_id   BIGINT REFERENCES public.messages(id) ON DELETE SET NULL,
    message_number      BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at           TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    UNIQUE (conversation_id, message_number)
);
GRANT ALL ON TABLE public.messages TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.messages TO authenticated;
GRANT UPDATE (body, edited_at, deleted_at) ON TABLE public.messages TO authenticated;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_messages_conv_number  ON public.messages(conversation_id, message_number);
CREATE INDEX idx_messages_conv_created ON public.messages(conversation_id, created_at);
CREATE INDEX idx_messages_sender       ON public.messages(sender_id);
CREATE INDEX idx_messages_parent       ON public.messages(parent_message_id)
    WHERE parent_message_id IS NOT NULL;

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
GRANT ALL ON TABLE public.message_attachments TO authenticated, service_role;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_message_attachments_message ON public.message_attachments(message_id);

CREATE OR REPLACE FUNCTION private.on_insert_message_attachments()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_message_attachments
    BEFORE INSERT ON public.message_attachments
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_message_attachments();

CREATE TABLE public.message_reactions (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    message_id BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    reaction   TEXT   NOT NULL CHECK (char_length(reaction) BETWEEN 1 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (message_id, account_id, reaction)
);
GRANT ALL ON TABLE public.message_reactions TO authenticated, service_role;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_message_reactions_msg ON public.message_reactions(message_id);

CREATE OR REPLACE FUNCTION private.on_insert_message_reactions()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_message_reactions
    BEFORE INSERT ON public.message_reactions
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_message_reactions();

CREATE TABLE public.conversation_reads (
    id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                      UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    conversation_id          BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    account_id               BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    last_read_message_id     BIGINT REFERENCES public.messages(id) ON DELETE SET NULL,
    last_read_message_number BIGINT,
    last_read_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, account_id)
);
GRANT ALL ON TABLE public.conversation_reads TO authenticated, service_role;
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_conv_reads_account        ON public.conversation_reads(account_id);
CREATE INDEX idx_conv_reads_conversation   ON public.conversation_reads(conversation_id);

CREATE OR REPLACE FUNCTION private.on_insert_conversation_reads()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_conversation_reads
    BEFORE INSERT ON public.conversation_reads
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_conversation_reads();

CREATE TABLE public.message_versions (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    message_id BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    body       TEXT   NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON TABLE public.message_versions TO authenticated, service_role;
ALTER TABLE public.message_versions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_message_versions_msg ON public.message_versions(message_id);

CREATE OR REPLACE FUNCTION private.on_insert_message_versions()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_message_versions
    BEFORE INSERT ON public.message_versions
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_message_versions();


-- ================================================================
-- TRIGGERS
-- ================================================================

-- Atomically assign the next per-conversation message_number before insert,
-- and set created_at.
CREATE OR REPLACE FUNCTION private.on_insert_messages()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
BEGIN
    NEW.created_at = NOW();
    INSERT INTO private.conversation_message_seq (conversation_id, last_number)
    VALUES (NEW.conversation_id, 1)
    ON CONFLICT (conversation_id) DO UPDATE
        SET last_number = private.conversation_message_seq.last_number + 1
    RETURNING last_number INTO NEW.message_number;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_insert_messages
    BEFORE INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_messages();

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

CREATE TRIGGER on_messages_inserted
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION private.on_messages_inserted();

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

CREATE TRIGGER on_update_messages
    BEFORE UPDATE ON public.messages
    FOR EACH ROW EXECUTE FUNCTION private.on_update_messages();


-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

-- Reusable helper: true when auth.uid() belongs to a participant of the given conversation
CREATE OR REPLACE FUNCTION private.is_conversation_participant(p_conversation_id BIGINT)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.conversation_participants cp
        JOIN public.accounts a ON a.id = cp.account_id
        WHERE cp.conversation_id = p_conversation_id
          AND a.user_id = auth.uid()
    );
$$;

-- ── conversations ─────────────────────────────────────────────────────────────

CREATE POLICY "participants can view conversations"
    ON public.conversations FOR SELECT TO authenticated
    USING (private.is_conversation_participant(id));

CREATE POLICY "participants can update conversations"
    ON public.conversations FOR UPDATE TO authenticated
    USING (private.is_conversation_participant(id));

-- ── conversation_participants ─────────────────────────────────────────────────

CREATE POLICY "participants can view members"
    ON public.conversation_participants FOR SELECT TO authenticated
    USING (private.is_conversation_participant(conversation_id));

-- ── conversation_targets ──────────────────────────────────────────────────────

CREATE POLICY "participants can view targets"
    ON public.conversation_targets FOR SELECT TO authenticated
    USING (private.is_conversation_participant(conversation_id));

-- ── messages ──────────────────────────────────────────────────────────────────

CREATE POLICY "participants can view messages"
    ON public.messages FOR SELECT TO authenticated
    USING (
        deleted_at IS NULL
        AND private.is_conversation_participant(conversation_id)
    );

CREATE POLICY "participants can insert own messages"
    ON public.messages FOR INSERT TO authenticated
    WITH CHECK (
        private.is_conversation_participant(conversation_id)
        AND EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = sender_id AND a.user_id = auth.uid()
        )
    );

CREATE POLICY "sender can edit or soft-delete own messages"
    ON public.messages FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = sender_id AND a.user_id = auth.uid()
        )
    )
    WITH CHECK (
        private.is_conversation_participant(conversation_id)
        AND EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = sender_id AND a.user_id = auth.uid()
        )
    );

-- ── message_attachments ───────────────────────────────────────────────────────

CREATE POLICY "participants can view attachments"
    ON public.message_attachments FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id
              AND private.is_conversation_participant(m.conversation_id)
        )
    );

CREATE POLICY "sender can add attachments to own messages"
    ON public.message_attachments FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.messages m
            JOIN public.accounts a ON a.id = m.sender_id
            WHERE m.id = message_id AND a.user_id = auth.uid()
        )
    );

-- ── message_reactions ─────────────────────────────────────────────────────────

CREATE POLICY "participants can view reactions"
    ON public.message_reactions FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id
              AND private.is_conversation_participant(m.conversation_id)
        )
    );

CREATE POLICY "participants can add own reactions"
    ON public.message_reactions FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = account_id AND a.user_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id
              AND private.is_conversation_participant(m.conversation_id)
        )
    );

CREATE POLICY "users can remove own reactions"
    ON public.message_reactions FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = account_id AND a.user_id = auth.uid()
        )
    );

-- ── conversation_reads ────────────────────────────────────────────────────────

CREATE POLICY "users can view own read state"
    ON public.conversation_reads FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = account_id AND a.user_id = auth.uid()
        )
    );

CREATE POLICY "users can insert own read state"
    ON public.conversation_reads FOR INSERT TO authenticated
    WITH CHECK (
        private.is_conversation_participant(conversation_id)
        AND EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = account_id AND a.user_id = auth.uid()
        )
    );

CREATE POLICY "users can update own read state"
    ON public.conversation_reads FOR UPDATE TO authenticated
    USING (
        private.is_conversation_participant(conversation_id)
        AND EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = account_id AND a.user_id = auth.uid()
        )
    );

-- message_versions: no user policies — service_role only (audit trail)
