-- ================================================================
-- NOTIFICATION SYSTEM
--
-- Layered, immutable-event architecture:
--   notification_events      — what happened (append-only)
--   notification_recipients  — who should receive it
--   notification_inbox       — in-app read state (projection of events)
--   notification_deliveries  — per-channel delivery attempts
--   notification_preferences — per-user channel/type opt-in settings
--   notification_templates   — content templates per type/channel/locale
--   notification_digests     — pending items for batch/digest delivery
--
-- Design principles:
--   * Events are immutable — never UPDATE notification_events
--   * One event can fan out to N recipients across M channels
--   * Channel routing is driven by preferences, never boolean columns
--   * Inbox is a denormalized projection — rendered title/body live here
--   * All delivery attempts are tracked for retry/audit
--   * group_key enables client-side notification grouping
-- ================================================================


-- ================================================================
-- ENUMS
-- ================================================================

CREATE TYPE public.notification_channel AS ENUM (
    'in_app',
    'email',
    'push',
    'sms',
    'slack',
    'webhook'
    );

CREATE TYPE public.notification_delivery_status AS ENUM (
    'pending',
    'queued',
    'sent',
    'delivered',
    'failed',
    'cancelled'
    );

CREATE TYPE public.notification_frequency AS ENUM (
    'immediate',
    'hourly_digest',
    'daily_digest',
    'weekly_digest'
    );

CREATE TYPE public.notification_recipient_status AS ENUM (
    'pending',
    'processing',
    'delivered',
    'failed'
    );


-- ================================================================
-- NOTIFICATION EVENTS  (immutable — append only)
--
-- One row per business event. The payload carries all context
-- needed for rendering templates or routing decisions later.
-- Never UPDATE this table; issue new events for corrections.
-- ================================================================

CREATE TABLE public.notification_events (
    id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    type             TEXT        NOT NULL,   -- stable contract key: 'invoice.paid', 'comment.added'
    actor_account_id BIGINT      REFERENCES public.accounts(id)       ON DELETE SET NULL,
    entity_type      TEXT,                   -- 'invoice', 'campaign', 'comment'
    entity_id        TEXT,                   -- polymorphic; TEXT to support UUIDs and integers
    payload          JSONB       NOT NULL DEFAULT '{}',
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_notification_events_type ON public.notification_events(type, occurred_at DESC);
CREATE INDEX idx_notification_events_entity ON public.notification_events(entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX idx_notification_events_actor ON public.notification_events(actor_account_id) WHERE actor_account_id IS NOT NULL;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.notification_events TO service_role;


-- ================================================================
-- NOTIFICATION RECIPIENTS
--
-- One row per (event, user) pair. The status here reflects the
-- overall orchestration state; per-channel status lives in
-- notification_deliveries.
-- ================================================================

CREATE TABLE public.notification_recipients (
    id         BIGINT                               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID                                 NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    event_id   BIGINT                               NOT NULL REFERENCES public.notification_events(id) ON DELETE CASCADE,
    account_id BIGINT                               NOT NULL REFERENCES public.accounts(id)            ON DELETE CASCADE,
    status     public.notification_recipient_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ                          NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, account_id)
    );
CREATE INDEX idx_notification_recipients_event ON public.notification_recipients(event_id);
CREATE INDEX idx_notification_recipients_account ON public.notification_recipients(account_id, created_at DESC);
ALTER TABLE public.notification_recipients ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.notification_recipients TO service_role;


GRANT SELECT ON TABLE public.notification_recipients TO authenticated;
CREATE POLICY "Allow users to view their own recipient records"
    ON public.notification_recipients FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id) OR public.has_permission('view', 'notification_recipient', id));


GRANT SELECT ON TABLE public.notification_events TO authenticated;
CREATE POLICY "Allow users to view notification events addressed to them"
    ON public.notification_events FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.notification_recipients nr
            JOIN  public.accounts a ON a.id = nr.account_id
            WHERE nr.event_id = public.notification_events.id
              AND a.user_id = auth.uid()
        )
        OR public.has_permission('view', 'notification_event', id)
    );


-- ================================================================
-- NOTIFICATION INBOX  (in-app notifications / read state)
--
-- Rendered snapshot of a recipient's notification. Decoupled from
-- the raw event so title/body can be localized, versioned, and
-- re-rendered independently.
--
-- account_id is denormalized for O(1) inbox queries without joins.
-- group_key drives client-side grouping (e.g. 'post:55:likes').
-- ================================================================

CREATE TABLE public.notification_inbox (
    id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid          UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    recipient_id BIGINT      NOT NULL REFERENCES public.notification_recipients(id) ON DELETE CASCADE,
    account_id   BIGINT      NOT NULL REFERENCES public.accounts(id)                ON DELETE CASCADE,
    title        TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
    body         TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
    image_url    TEXT        CHECK (char_length(image_url) <= 2048),
    action_url   TEXT        CHECK (char_length(action_url) <= 2048),
    group_key    TEXT        CHECK (char_length(group_key) <= 255),
    is_read      BOOLEAN     NOT NULL DEFAULT FALSE,
    read_at      TIMESTAMPTZ,
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_notification_inbox_account ON public.notification_inbox(account_id, created_at DESC);
CREATE INDEX idx_notification_inbox_unread ON public.notification_inbox(account_id) WHERE is_read = FALSE AND archived_at IS NULL;
CREATE INDEX idx_notification_inbox_group ON public.notification_inbox(account_id, group_key) WHERE group_key IS NOT NULL;
CREATE INDEX idx_notification_inbox_recipient ON public.notification_inbox(recipient_id);
ALTER TABLE public.notification_inbox ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.notification_inbox TO service_role;


GRANT SELECT ON TABLE public.notification_inbox TO authenticated;
CREATE POLICY "Allow users to view their own inbox"
    ON public.notification_inbox FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id) OR public.has_permission('view', 'notification_inbox', id));


-- ================================================================
-- NOTIFICATION DELIVERIES  (per-channel delivery attempts)
--
-- Tracks every send attempt. Never conflate "sent" with "delivered"
-- — providers confirm delivery separately via webhooks.
-- ================================================================

CREATE TABLE public.notification_deliveries (
    id                  BIGINT                               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                 UUID                                 NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    recipient_id        BIGINT                               NOT NULL REFERENCES public.notification_recipients(id) ON DELETE CASCADE,
    channel             public.notification_channel          NOT NULL,
    status              public.notification_delivery_status  NOT NULL DEFAULT 'pending',
    provider            TEXT                                 CHECK (char_length(provider) <= 100),
    provider_message_id TEXT                                 CHECK (char_length(provider_message_id) <= 255),
    attempts            SMALLINT                             NOT NULL DEFAULT 0,
    last_attempt_at     TIMESTAMPTZ,
    sent_at             TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    error_message       TEXT                                 CHECK (char_length(error_message) <= 2000),
    metadata            JSONB                                NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ                          NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_notification_deliveries_recipient ON public.notification_deliveries(recipient_id);
CREATE INDEX idx_notification_deliveries_pending ON public.notification_deliveries(status, created_at) WHERE status IN ('pending', 'queued');
CREATE INDEX idx_notification_deliveries_channel_status ON public.notification_deliveries(channel, status);
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.notification_deliveries TO service_role;


GRANT SELECT ON TABLE public.notification_deliveries TO authenticated;
CREATE POLICY "Allow users to view their own delivery records"
    ON public.notification_deliveries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.notification_recipients nr
            WHERE nr.id = public.notification_deliveries.recipient_id
              AND private.owns_account(nr.account_id)
        )
        OR public.has_permission('view', 'notification_delivery', id)
    );


-- ================================================================
-- NOTIFICATION PREFERENCES  (user opt-in/opt-out per type × channel)
--
-- notification_type matches notification_events.type exactly.
-- Absence of a row = platform default (enabled, immediate).
--
-- Event sourced: never UPDATE or DELETE. Setting a preference inserts
-- a new row; the row with the greatest created_at for a given
-- (account_id, notification_type, channel) is the current value.
-- ================================================================

CREATE TABLE public.notification_preferences (
    id                BIGINT                        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid               UUID                          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    account_id        BIGINT                        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE DEFAULT public.my_account_id(),
    notification_type TEXT                          NOT NULL CHECK (char_length(notification_type) BETWEEN 1 AND 255),
    channel           public.notification_channel   NOT NULL,
    is_enabled        BOOLEAN                       NOT NULL DEFAULT TRUE,
    frequency         public.notification_frequency NOT NULL DEFAULT 'immediate',
    created_at        TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_notification_preferences_lookup ON public.notification_preferences(account_id, notification_type, channel, created_at DESC);
CREATE INDEX idx_notification_preferences_type ON public.notification_preferences(notification_type, channel);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.notification_preferences TO service_role;


GRANT SELECT ON TABLE public.notification_preferences TO authenticated;
CREATE POLICY "Allow users to read their own preferences"
    ON public.notification_preferences FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id) OR public.has_permission('view', 'notification_preference', id));


GRANT INSERT (notification_type, channel, is_enabled, frequency) ON TABLE public.notification_preferences TO authenticated;
CREATE POLICY "Allow users to insert their own preferences"
    ON public.notification_preferences FOR INSERT
    TO authenticated
    WITH CHECK (private.owns_account(account_id) OR public.has_permission('edit', 'notification_preference', NULL));


-- ================================================================
-- NOTIFICATION TEMPLATES
--
-- Content per (type × channel × locale). subject_template applies
-- to email only. body_template supports handlebars/mustache/liquid.
-- Always create a new version rather than overwriting active ones.
-- ================================================================

CREATE TABLE public.notification_templates (
    id               BIGINT                      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID                        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    type             TEXT                        NOT NULL CHECK (char_length(type) BETWEEN 1 AND 255),
    channel          public.notification_channel NOT NULL,
    locale           CHAR(5)                     NOT NULL DEFAULT 'en',
    subject_template TEXT,
    body_template    TEXT                        NOT NULL,
    version          INTEGER                     NOT NULL DEFAULT 1,
    is_active        BOOLEAN                     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    UNIQUE (type, channel, locale, version)
    );
CREATE INDEX idx_notification_templates_lookup ON public.notification_templates(type, channel, locale) WHERE is_active = TRUE;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.notification_templates TO service_role;


-- ================================================================
-- NOTIFICATION DIGESTS  (pending items awaiting batched delivery)
--
-- When a preference is set to hourly/daily/weekly_digest, a row
-- lands here instead of triggering immediate delivery. The digest
-- sender queries `scheduled_for <= NOW() AND sent_at IS NULL`.
-- ================================================================

CREATE TABLE public.notification_digests (
    id            BIGINT                        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid           UUID                          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    account_id    BIGINT                        NOT NULL REFERENCES public.accounts(id)                ON DELETE CASCADE,
    recipient_id  BIGINT                        NOT NULL REFERENCES public.notification_recipients(id)  ON DELETE CASCADE,
    channel       public.notification_channel   NOT NULL,
    frequency     public.notification_frequency NOT NULL,
    scheduled_for TIMESTAMPTZ                   NOT NULL,
    sent_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_notification_digests_account ON public.notification_digests(account_id, scheduled_for);
CREATE INDEX idx_notification_digests_pending ON public.notification_digests(scheduled_for) WHERE sent_at IS NULL;
ALTER TABLE public.notification_digests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.notification_digests TO service_role;


GRANT SELECT ON TABLE public.notification_digests TO authenticated;
CREATE POLICY "Allow users to view their own digest queue"
    ON public.notification_digests FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id) OR public.has_permission('view', 'notification_digest', id));


CREATE OR REPLACE FUNCTION public.mark_notification_read(p_inbox_id BIGINT)
    RETURNS VOID AS $$
    BEGIN
        UPDATE public.notification_inbox
        SET    is_read = TRUE, read_at = NOW()
        WHERE  id = p_inbox_id
        AND  private.owns_account(account_id)
        AND  is_read = FALSE;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
    RETURNS VOID AS $$
    BEGIN
        UPDATE public.notification_inbox ni
        SET    is_read = TRUE, read_at = NOW()
        FROM   public.accounts a
        WHERE  a.id = ni.account_id
        AND  a.user_id = auth.uid()
        AND  ni.is_read = FALSE
        AND  ni.archived_at IS NULL;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.archive_notification(p_inbox_id BIGINT)
    RETURNS VOID AS $$
    BEGIN
        UPDATE public.notification_inbox
        SET    archived_at = NOW()
        WHERE  id = p_inbox_id
        AND  private.owns_account(account_id)
        AND  archived_at IS NULL;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.unread_notification_count()
    RETURNS BIGINT AS $$
        SELECT COUNT(*)
        FROM   public.notification_inbox ni
        JOIN   public.accounts a ON a.id = ni.account_id
        WHERE  a.user_id = auth.uid()
        AND  ni.is_read = FALSE
        AND  ni.archived_at IS NULL;
    $$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;


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
