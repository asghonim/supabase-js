-- ================================================================
-- AUDIT TABLES
--
-- Captures before/after row snapshots for every RPC function that
-- performs in-place UPDATE or DELETE operations.  Each source table
-- gets a paired <table>_audit table.
--
-- Schema per audit table:
--   operation             — 'UPDATE' or 'DELETE'
--   old_row               — full row snapshot before the change (JSONB)
--   new_row               — full row snapshot after the change (JSONB; NULL on DELETE)
--   performed_by_account_id — accounts.id of the caller (resolved from auth.uid())
--   performed_at          — wall-clock timestamp of the change
--
-- A single SECURITY DEFINER trigger function (private.audit_row_changes)
-- uses TG_TABLE_NAME to route each event to the correct audit table,
-- avoiding per-table trigger-function boilerplate.
--
-- Access: audit tables are service_role-only by default.
--         Authenticated users have no direct access (they use RPCs).
-- ================================================================


-- ================================================================
-- GENERIC AUDIT TRIGGER FUNCTION
-- ================================================================

CREATE OR REPLACE FUNCTION private.audit_row_changes()
    RETURNS TRIGGER AS $$
    DECLARE
        v_account_id BIGINT;
    BEGIN
        SELECT id INTO v_account_id
        FROM   public.accounts
        WHERE  user_id = auth.uid()
        LIMIT  1;

        IF TG_OP = 'DELETE' THEN
            EXECUTE format(
                'INSERT INTO public.%I
                    (operation, old_row, new_row, performed_by_account_id)
                 VALUES ($1, $2, $3, $4)',
                TG_TABLE_NAME || '_audit'
            ) USING 'DELETE', to_jsonb(OLD), NULL, v_account_id;
            RETURN OLD;
        ELSE
            EXECUTE format(
                'INSERT INTO public.%I
                    (operation, old_row, new_row, performed_by_account_id)
                 VALUES ($1, $2, $3, $4)',
                TG_TABLE_NAME || '_audit'
            ) USING 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), v_account_id;
            RETURN NEW;
        END IF;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, auth;


-- ================================================================
-- HELPER MACRO: creates the standard audit table + trigger
--   usage: called inline below for each source table
-- ================================================================


-- ================================================================
-- api_keys  →  revoke_api_key (UPDATE)
-- ================================================================

CREATE TABLE public.api_keys_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_api_keys_audit_source  ON public.api_keys_audit ((old_row->>'id'));
CREATE INDEX idx_api_keys_audit_account ON public.api_keys_audit (performed_by_account_id);
ALTER TABLE public.api_keys_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.api_keys_audit TO service_role;

CREATE TRIGGER trg_api_keys_audit
    AFTER UPDATE ON public.api_keys
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- notification_inbox  →  mark_notification_read,
--                         mark_all_notifications_read,
--                         archive_notification  (UPDATE)
-- ================================================================

CREATE TABLE public.notification_inbox_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_notification_inbox_audit_source  ON public.notification_inbox_audit ((old_row->>'id'));
CREATE INDEX idx_notification_inbox_audit_account ON public.notification_inbox_audit (performed_by_account_id);
ALTER TABLE public.notification_inbox_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.notification_inbox_audit TO service_role;

CREATE TRIGGER trg_notification_inbox_audit
    AFTER UPDATE ON public.notification_inbox
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- tickets  →  set_ticket_status (UPDATE)
-- ================================================================

CREATE TABLE public.tickets_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_tickets_audit_source  ON public.tickets_audit ((old_row->>'id'));
CREATE INDEX idx_tickets_audit_account ON public.tickets_audit (performed_by_account_id);
ALTER TABLE public.tickets_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.tickets_audit TO service_role;

CREATE TRIGGER trg_tickets_audit
    AFTER UPDATE ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- wallet_holds  →  release_wallet_hold (UPDATE)
-- ================================================================

CREATE TABLE public.wallet_holds_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_wallet_holds_audit_source  ON public.wallet_holds_audit ((old_row->>'id'));
CREATE INDEX idx_wallet_holds_audit_account ON public.wallet_holds_audit (performed_by_account_id);
ALTER TABLE public.wallet_holds_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.wallet_holds_audit TO service_role;

CREATE TRIGGER trg_wallet_holds_audit
    AFTER UPDATE ON public.wallet_holds
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- content_types  →  update_content_type (UPDATE)
-- ================================================================

CREATE TABLE public.content_types_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_content_types_audit_source  ON public.content_types_audit ((old_row->>'id'));
CREATE INDEX idx_content_types_audit_account ON public.content_types_audit (performed_by_account_id);
ALTER TABLE public.content_types_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_types_audit TO service_role;

CREATE TRIGGER trg_content_types_audit
    AFTER UPDATE ON public.content_types
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- contents  →  update_content, submit_content_for_review,
--              publish_content, unpublish_content,
--              archive_content, soft_delete_content  (UPDATE)
-- ================================================================

CREATE TABLE public.contents_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_contents_audit_source  ON public.contents_audit ((old_row->>'id'));
CREATE INDEX idx_contents_audit_account ON public.contents_audit (performed_by_account_id);
ALTER TABLE public.contents_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.contents_audit TO service_role;

CREATE TRIGGER trg_contents_audit
    AFTER UPDATE ON public.contents
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- content_blocks  →  replace_content_blocks (DELETE then INSERT)
-- ================================================================

CREATE TABLE public.content_blocks_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_content_blocks_audit_source  ON public.content_blocks_audit ((old_row->>'id'));
CREATE INDEX idx_content_blocks_audit_account ON public.content_blocks_audit (performed_by_account_id);
ALTER TABLE public.content_blocks_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_blocks_audit TO service_role;

CREATE TRIGGER trg_content_blocks_audit
    AFTER DELETE ON public.content_blocks
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- media_folders  →  update_media_folder (UPDATE)
-- ================================================================

CREATE TABLE public.media_folders_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_media_folders_audit_source  ON public.media_folders_audit ((old_row->>'id'));
CREATE INDEX idx_media_folders_audit_account ON public.media_folders_audit (performed_by_account_id);
ALTER TABLE public.media_folders_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.media_folders_audit TO service_role;

CREATE TRIGGER trg_media_folders_audit
    AFTER UPDATE ON public.media_folders
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- media  →  update_media, soft_delete_media (UPDATE)
-- ================================================================

CREATE TABLE public.media_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_media_audit_source  ON public.media_audit ((old_row->>'id'));
CREATE INDEX idx_media_audit_account ON public.media_audit (performed_by_account_id);
ALTER TABLE public.media_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.media_audit TO service_role;

CREATE TRIGGER trg_media_audit
    AFTER UPDATE ON public.media
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- tags  →  update_tag (UPDATE)
-- ================================================================

CREATE TABLE public.tags_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_tags_audit_source  ON public.tags_audit ((old_row->>'id'));
CREATE INDEX idx_tags_audit_account ON public.tags_audit (performed_by_account_id);
ALTER TABLE public.tags_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.tags_audit TO service_role;

CREATE TRIGGER trg_tags_audit
    AFTER UPDATE ON public.tags
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- content_tags  →  remove_content_tag (DELETE)
-- ================================================================

CREATE TABLE public.content_tags_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_content_tags_audit_content ON public.content_tags_audit ((old_row->>'content_id'));
CREATE INDEX idx_content_tags_audit_account ON public.content_tags_audit (performed_by_account_id);
ALTER TABLE public.content_tags_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_tags_audit TO service_role;

CREATE TRIGGER trg_content_tags_audit
    AFTER DELETE ON public.content_tags
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- categories  →  update_category (UPDATE)
-- ================================================================

CREATE TABLE public.categories_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_categories_audit_source  ON public.categories_audit ((old_row->>'id'));
CREATE INDEX idx_categories_audit_account ON public.categories_audit (performed_by_account_id);
ALTER TABLE public.categories_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.categories_audit TO service_role;

CREATE TRIGGER trg_categories_audit
    AFTER UPDATE ON public.categories
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- content_categories  →  remove_content_category (DELETE)
-- ================================================================

CREATE TABLE public.content_categories_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_content_categories_audit_content ON public.content_categories_audit ((old_row->>'content_id'));
CREATE INDEX idx_content_categories_audit_account ON public.content_categories_audit (performed_by_account_id);
ALTER TABLE public.content_categories_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_categories_audit TO service_role;

CREATE TRIGGER trg_content_categories_audit
    AFTER DELETE ON public.content_categories
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- content_media  →  remove_content_media (DELETE)
-- ================================================================

CREATE TABLE public.content_media_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_content_media_audit_version ON public.content_media_audit ((old_row->>'content_version_id'));
CREATE INDEX idx_content_media_audit_account ON public.content_media_audit (performed_by_account_id);
ALTER TABLE public.content_media_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_media_audit TO service_role;

CREATE TRIGGER trg_content_media_audit
    AFTER DELETE ON public.content_media
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- content_translations  →  update_content_translation (UPDATE)
-- ================================================================

CREATE TABLE public.content_translations_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_content_translations_audit_source  ON public.content_translations_audit ((old_row->>'id'));
CREATE INDEX idx_content_translations_audit_account ON public.content_translations_audit (performed_by_account_id);
ALTER TABLE public.content_translations_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_translations_audit TO service_role;

CREATE TRIGGER trg_content_translations_audit
    AFTER UPDATE ON public.content_translations
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- seo_metadata  →  update_seo_metadata (UPDATE)
-- ================================================================

CREATE TABLE public.seo_metadata_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_seo_metadata_audit_source  ON public.seo_metadata_audit ((old_row->>'id'));
CREATE INDEX idx_seo_metadata_audit_account ON public.seo_metadata_audit (performed_by_account_id);
ALTER TABLE public.seo_metadata_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.seo_metadata_audit TO service_role;

CREATE TRIGGER trg_seo_metadata_audit
    AFTER UPDATE ON public.seo_metadata
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


-- ================================================================
-- content_snippets  →  update_content_snippet (UPDATE)
-- ================================================================

CREATE TABLE public.content_snippets_audit (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation               TEXT        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
    old_row                 JSONB,
    new_row                 JSONB,
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    performed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_content_snippets_audit_source  ON public.content_snippets_audit ((old_row->>'id'));
CREATE INDEX idx_content_snippets_audit_account ON public.content_snippets_audit (performed_by_account_id);
ALTER TABLE public.content_snippets_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_snippets_audit TO service_role;

CREATE TRIGGER trg_content_snippets_audit
    AFTER UPDATE ON public.content_snippets
    FOR EACH ROW EXECUTE FUNCTION private.audit_row_changes();


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
