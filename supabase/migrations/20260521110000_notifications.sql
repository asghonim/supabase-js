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
    type             TEXT        NOT NULL,   -- stable contract key: 'invoice.paid', 'comment.added'
    actor_account_id BIGINT      REFERENCES public.accounts(id)       ON DELETE SET NULL,
    entity_type      TEXT,                   -- 'invoice', 'campaign', 'comment'
    entity_id        TEXT,                   -- polymorphic; TEXT to support UUIDs and integers
    payload          JSONB       NOT NULL DEFAULT '{}',
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_events_type
    ON public.notification_events(type, occurred_at DESC);
CREATE INDEX idx_notification_events_entity
    ON public.notification_events(entity_type, entity_id)
    WHERE entity_type IS NOT NULL;
CREATE INDEX idx_notification_events_actor
    ON public.notification_events(actor_account_id)
    WHERE actor_account_id IS NOT NULL;
CREATE OR REPLACE FUNCTION private.on_insert_notification_events()      RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_notification_events_inserted      BEFORE INSERT ON public.notification_events
	FOR EACH ROW EXECUTE FUNCTION private.on_insert_notification_events();


-- ================================================================
-- NOTIFICATION RECIPIENTS
--
-- One row per (event, user) pair. The status here reflects the
-- overall orchestration state; per-channel status lives in
-- notification_deliveries.
-- ================================================================

CREATE TABLE public.notification_recipients (
    id         BIGINT                               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id   BIGINT                               NOT NULL REFERENCES public.notification_events(id) ON DELETE CASCADE,
    account_id BIGINT                               NOT NULL REFERENCES public.accounts(id)            ON DELETE CASCADE,
    status     public.notification_recipient_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ                          NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, account_id)
);

CREATE INDEX idx_notification_recipients_event
    ON public.notification_recipients(event_id);
CREATE INDEX idx_notification_recipients_account
    ON public.notification_recipients(account_id, created_at DESC);
CREATE OR REPLACE FUNCTION private.on_insert_notification_recipients()  RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_notification_recipients_inserted  BEFORE INSERT ON public.notification_recipients  FOR EACH ROW EXECUTE FUNCTION private.on_insert_notification_recipients();


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
    recipient_id BIGINT      NOT NULL REFERENCES public.notification_recipients(id) ON DELETE CASCADE,
    account_id   BIGINT      NOT NULL REFERENCES public.accounts(id)                ON DELETE CASCADE,
    title        TEXT        NOT NULL,
    body         TEXT        NOT NULL,
    image_url    TEXT,
    action_url   TEXT,
    group_key    TEXT,        -- e.g. 'post:55:likes' — for grouping N similar notifications
    is_read      BOOLEAN     NOT NULL DEFAULT FALSE,
    read_at      TIMESTAMPTZ,
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_inbox_account
    ON public.notification_inbox(account_id, created_at DESC);
CREATE INDEX idx_notification_inbox_unread
    ON public.notification_inbox(account_id)
    WHERE is_read = FALSE AND archived_at IS NULL;
CREATE INDEX idx_notification_inbox_group
    ON public.notification_inbox(account_id, group_key)
    WHERE group_key IS NOT NULL;
CREATE INDEX idx_notification_inbox_recipient
    ON public.notification_inbox(recipient_id);
CREATE OR REPLACE FUNCTION private.on_insert_notification_inbox()       RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_notification_inbox_inserted       BEFORE INSERT ON public.notification_inbox
	FOR EACH ROW EXECUTE FUNCTION private.on_insert_notification_inbox();


-- ================================================================
-- NOTIFICATION DELIVERIES  (per-channel delivery attempts)
--
-- Tracks every send attempt. Never conflate "sent" with "delivered"
-- — providers confirm delivery separately via webhooks.
-- ================================================================

CREATE TABLE public.notification_deliveries (
    id                  BIGINT                               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_id        BIGINT                               NOT NULL REFERENCES public.notification_recipients(id) ON DELETE CASCADE,
    channel             public.notification_channel          NOT NULL,
    status              public.notification_delivery_status  NOT NULL DEFAULT 'pending',
    provider            TEXT,             -- 'sendgrid', 'twilio', 'firebase', 'apns'
    provider_message_id TEXT,
    attempts            SMALLINT          NOT NULL DEFAULT 0,
    last_attempt_at     TIMESTAMPTZ,
    sent_at             TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    error_message       TEXT,
    metadata            JSONB             NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_deliveries_recipient
    ON public.notification_deliveries(recipient_id);
CREATE INDEX idx_notification_deliveries_pending
    ON public.notification_deliveries(status, created_at)
    WHERE status IN ('pending', 'queued');
CREATE INDEX idx_notification_deliveries_channel_status
    ON public.notification_deliveries(channel, status);

CREATE OR REPLACE FUNCTION private.on_update_notification_delivery()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_update_notification_delivery
    BEFORE UPDATE ON public.notification_deliveries
    FOR EACH ROW EXECUTE FUNCTION private.on_update_notification_delivery();
CREATE OR REPLACE FUNCTION private.on_insert_notification_deliveries()  RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_notification_deliveries_inserted  BEFORE INSERT ON public.notification_deliveries  FOR EACH ROW EXECUTE FUNCTION private.on_insert_notification_deliveries();


-- ================================================================
-- NOTIFICATION PREFERENCES  (user opt-in/opt-out per type × channel)
--
-- notification_type matches notification_events.type exactly.
-- Absence of a row = platform default (enabled, immediate).
-- ================================================================

CREATE TABLE public.notification_preferences (
    id                BIGINT                        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id        BIGINT                        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    notification_type TEXT                          NOT NULL,
    channel           public.notification_channel   NOT NULL,
    is_enabled        BOOLEAN                       NOT NULL DEFAULT TRUE,
    frequency         public.notification_frequency NOT NULL DEFAULT 'immediate',
    created_at        TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, notification_type, channel)
);

CREATE INDEX idx_notification_preferences_account
    ON public.notification_preferences(account_id);
CREATE INDEX idx_notification_preferences_type
    ON public.notification_preferences(notification_type, channel);

CREATE OR REPLACE FUNCTION private.on_update_notification_preference()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_update_notification_preference
    BEFORE UPDATE ON public.notification_preferences
    FOR EACH ROW EXECUTE FUNCTION private.on_update_notification_preference();
CREATE OR REPLACE FUNCTION private.on_insert_notification_preferences() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_notification_preferences_inserted BEFORE INSERT ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION private.on_insert_notification_preferences();


-- ================================================================
-- NOTIFICATION TEMPLATES
--
-- Content per (type × channel × locale). subject_template applies
-- to email only. body_template supports handlebars/mustache/liquid.
-- Always create a new version rather than overwriting active ones.
-- ================================================================

CREATE TABLE public.notification_templates (
    id               BIGINT                      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type             TEXT                        NOT NULL,
    channel          public.notification_channel NOT NULL,
    locale           CHAR(5)                     NOT NULL DEFAULT 'en',
    subject_template TEXT,         -- email subject; NULL for non-email channels
    body_template    TEXT          NOT NULL,
    version          INTEGER       NOT NULL DEFAULT 1,
    is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (type, channel, locale, version)
);

CREATE INDEX idx_notification_templates_lookup
    ON public.notification_templates(type, channel, locale)
    WHERE is_active = TRUE;

CREATE OR REPLACE FUNCTION private.on_update_notification_template()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_update_notification_template
    BEFORE UPDATE ON public.notification_templates
    FOR EACH ROW EXECUTE FUNCTION private.on_update_notification_template();
CREATE OR REPLACE FUNCTION private.on_insert_notification_templates()   RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_notification_templates_inserted   BEFORE INSERT ON public.notification_templates   FOR EACH ROW EXECUTE FUNCTION private.on_insert_notification_templates();


-- ================================================================
-- NOTIFICATION DIGESTS  (pending items awaiting batched delivery)
--
-- When a preference is set to hourly/daily/weekly_digest, a row
-- lands here instead of triggering immediate delivery. The digest
-- sender queries `scheduled_for <= NOW() AND sent_at IS NULL`.
-- ================================================================

CREATE TABLE public.notification_digests (
    id            BIGINT                        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id    BIGINT                        NOT NULL REFERENCES public.accounts(id)                ON DELETE CASCADE,
    recipient_id  BIGINT                        NOT NULL REFERENCES public.notification_recipients(id)  ON DELETE CASCADE,
    channel       public.notification_channel   NOT NULL,
    frequency     public.notification_frequency NOT NULL,
    scheduled_for TIMESTAMPTZ                   NOT NULL,
    sent_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_digests_account
    ON public.notification_digests(account_id, scheduled_for);
CREATE INDEX idx_notification_digests_pending
    ON public.notification_digests(scheduled_for)
    WHERE sent_at IS NULL;
CREATE OR REPLACE FUNCTION private.on_insert_notification_digests()     RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER on_notification_digests_inserted     BEFORE INSERT ON public.notification_digests
	FOR EACH ROW EXECUTE FUNCTION private.on_insert_notification_digests();

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

-- notification_events
-- Users see events where they are a recipient.
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

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
    );

-- notification_recipients
ALTER TABLE public.notification_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow users to view their own recipient records"
    ON public.notification_recipients FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id));

-- notification_inbox
ALTER TABLE public.notification_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow users to view their own inbox"
    ON public.notification_inbox FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id));

CREATE POLICY "Allow users to update their own inbox items"
    ON public.notification_inbox FOR UPDATE
    TO authenticated
    USING (private.owns_account(account_id))
    WITH CHECK (
        private.owns_account(account_id)
        AND (
            SELECT
                ni.id               IS NOT DISTINCT FROM notification_inbox.id
                AND ni.recipient_id IS NOT DISTINCT FROM notification_inbox.recipient_id
                AND ni.account_id   IS NOT DISTINCT FROM notification_inbox.account_id
                AND ni.title        IS NOT DISTINCT FROM notification_inbox.title
                AND ni.body         IS NOT DISTINCT FROM notification_inbox.body
                AND ni.image_url    IS NOT DISTINCT FROM notification_inbox.image_url
                AND ni.action_url   IS NOT DISTINCT FROM notification_inbox.action_url
                AND ni.group_key    IS NOT DISTINCT FROM notification_inbox.group_key
                AND ni.created_at   IS NOT DISTINCT FROM notification_inbox.created_at
            FROM   public.notification_inbox ni
            WHERE  ni.id = notification_inbox.id
        )
    );

-- notification_deliveries
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow users to view their own delivery records"
    ON public.notification_deliveries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.notification_recipients nr
            WHERE nr.id = public.notification_deliveries.recipient_id
              AND private.owns_account(nr.account_id)
        )
    );

-- notification_preferences
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow users to manage their own preferences"
    ON public.notification_preferences FOR ALL
    TO authenticated
    USING    (private.owns_account(account_id))
    WITH CHECK (private.owns_account(account_id));

-- notification_templates (public catalog — any authenticated user can read)
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read active templates"
    ON public.notification_templates FOR SELECT
    TO authenticated
    USING (is_active = TRUE);

-- notification_digests
ALTER TABLE public.notification_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow users to view their own digest queue"
    ON public.notification_digests FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id));


-- ================================================================
-- CONVENIENCE FUNCTIONS
-- ================================================================

-- Mark a single inbox item as read.
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_inbox_id BIGINT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.notification_inbox
    SET    is_read = TRUE, read_at = NOW()
    WHERE  id = p_inbox_id
      AND  private.owns_account(account_id)
      AND  is_read = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mark all unarchived inbox items as read for the calling user.
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Archive a single inbox item (soft delete).
CREATE OR REPLACE FUNCTION public.archive_notification(p_inbox_id BIGINT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.notification_inbox
    SET    archived_at = NOW()
    WHERE  id = p_inbox_id
      AND  private.owns_account(account_id)
      AND  archived_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Unread count for the calling user (excludes archived).
CREATE OR REPLACE FUNCTION public.unread_notification_count()
RETURNS BIGINT AS $$
    SELECT COUNT(*)
    FROM   public.notification_inbox ni
    JOIN   public.accounts a ON a.id = ni.account_id
    WHERE  a.user_id = auth.uid()
      AND  ni.is_read = FALSE
      AND  ni.archived_at IS NULL;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
