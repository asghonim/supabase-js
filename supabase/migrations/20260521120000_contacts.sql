-- Contact submissions: durable ticketing system with threading and async outbox

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE contact_status AS ENUM (
    'new',
    'reviewed',
    'in_progress',
    'waiting_customer',
    'resolved',
    'closed',
    'spam'
);

CREATE TYPE contact_priority AS ENUM (
    'low',
    'normal',
    'high',
    'urgent'
);

CREATE TYPE contact_sender_type AS ENUM (
    'customer',
    'agent',
    'system'
);

-- ── Core submissions table ────────────────────────────────────────────────────

CREATE TABLE contact_submissions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    status                  contact_status NOT NULL DEFAULT 'new',
    priority                contact_priority NOT NULL DEFAULT 'normal',

    source                  TEXT,
    category                TEXT,
    subject                 TEXT,
    message                 TEXT NOT NULL,

    full_name               TEXT,
    email                   TEXT,
    phone                   TEXT,
    company_name            TEXT,

    ip_address              INET,
    user_agent              TEXT,
    referer                 TEXT,

    authenticated_account_id   BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL,
    assigned_to_account_id     BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL,

    spam_score              NUMERIC(5,2),

    first_response_at       TIMESTAMPTZ,
    resolved_at             TIMESTAMPTZ,
    due_at                  TIMESTAMPTZ,

    metadata                JSONB NOT NULL DEFAULT '{}'
);

CREATE OR REPLACE FUNCTION on_update_contact_submissions()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, private AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_update_contact_submissions
    BEFORE UPDATE ON contact_submissions
    FOR EACH ROW EXECUTE FUNCTION on_update_contact_submissions();
CREATE OR REPLACE FUNCTION private.on_insert_contact_submissions()  RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_contact_submissions_inserted  BEFORE INSERT ON contact_submissions  FOR EACH ROW EXECUTE FUNCTION private.on_insert_contact_submissions();

-- ── Message threading ─────────────────────────────────────────────────────────

CREATE TABLE contact_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID NOT NULL REFERENCES contact_submissions(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sender_type     contact_sender_type NOT NULL DEFAULT 'customer',
    sender_account_id  BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL,
    body            TEXT NOT NULL,
    is_internal     BOOLEAN NOT NULL DEFAULT false,
    metadata        JSONB NOT NULL DEFAULT '{}'
);
CREATE OR REPLACE FUNCTION private.on_insert_contact_messages()     RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_contact_messages_inserted     BEFORE INSERT ON contact_messages     FOR EACH ROW EXECUTE FUNCTION private.on_insert_contact_messages();

-- ── Attachment metadata (files live in object storage) ────────────────────────

CREATE TABLE contact_attachments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id       UUID REFERENCES contact_submissions(id) ON DELETE CASCADE,
    message_id          UUID REFERENCES contact_messages(id) ON DELETE CASCADE,
    storage_provider    TEXT NOT NULL DEFAULT 'supabase',
    storage_key         TEXT NOT NULL,
    file_name           TEXT NOT NULL,
    mime_type           TEXT,
    size_bytes          BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION private.on_insert_contact_attachments()  RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_contact_attachments_inserted  BEFORE INSERT ON contact_attachments  FOR EACH ROW EXECUTE FUNCTION private.on_insert_contact_attachments();

-- ── Transactional outbox for async event processing ───────────────────────────

CREATE TABLE outbox_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    aggregate_type  TEXT NOT NULL,
    aggregate_id    UUID NOT NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    processed_at    TIMESTAMPTZ,
    error           TEXT
);
CREATE OR REPLACE FUNCTION private.on_insert_outbox_events()        RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_outbox_events_inserted        BEFORE INSERT ON outbox_events        FOR EACH ROW EXECUTE FUNCTION private.on_insert_outbox_events();

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_contact_status          ON contact_submissions(status);
CREATE INDEX idx_contact_created_at      ON contact_submissions(created_at DESC);
CREATE INDEX idx_contact_email           ON contact_submissions(email);
CREATE INDEX idx_contact_assigned        ON contact_submissions(assigned_to_account_id);
CREATE INDEX idx_contact_authed_account  ON contact_submissions(authenticated_account_id);
CREATE INDEX idx_contact_ip              ON contact_submissions(ip_address);

CREATE INDEX idx_contact_messages_sub    ON contact_messages(submission_id, created_at);

CREATE INDEX idx_outbox_unprocessed      ON outbox_events(created_at)
    WHERE processed_at IS NULL;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_contact_message_fts ON contact_submissions
    USING gin(message gin_trgm_ops);
CREATE INDEX idx_contact_subject_fts ON contact_submissions
    USING gin(coalesce(subject, '') gin_trgm_ops);

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE contact_submissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_attachments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events        ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view their own submissions
CREATE POLICY "Allow users to view own submissions"
    ON contact_submissions FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = authenticated_account_id
              AND a.user_id = auth.uid()
        )
    );

-- Authenticated users can view non-internal messages on their own submissions
CREATE POLICY "Allow users to view own messages"
    ON contact_messages FOR SELECT
    TO authenticated
    USING (
        is_internal = false
        AND EXISTS (
            SELECT 1 FROM contact_submissions cs
            JOIN public.accounts a ON a.id = cs.authenticated_account_id
            WHERE cs.id = submission_id
              AND a.user_id = auth.uid()
        )
    );

INSERT INTO notification_templates
    (type, channel, locale, version, is_active, subject_template, body_template)
VALUES
(
    'contact_submission.admin_notification',
    'email',
    'en',
    1,
    true,
    '[Contact] {{subject}} — from {{submitter_name}}',
    '<h2>New Contact Submission</h2>
    <table cellpadding="6" style="border-collapse:collapse">
    <tr><td><strong>Name</strong></td><td>{{submitter_name}}</td></tr>
    <tr><td><strong>Email</strong></td><td>{{submitter_email}}</td></tr>
    <tr><td><strong>Subject</strong></td><td>{{subject}}</td></tr>
    <tr><td><strong>Category</strong></td><td>{{category}}</td></tr>
    <tr><td><strong>Time</strong></td><td>{{created_at}}</td></tr>
    <tr><td><strong>ID</strong></td><td>{{submission_id}}</td></tr>
    </table>
    <hr/>
    <p style="white-space:pre-wrap">{{message}}</p>'
),
(
    'contact_submission.auto_response',
    'email',
    'en',
    1,
    true,
    'We''ve received your message',
    '<p>Hi {{name}},</p>
    <p>Thank you for reaching out. We''ve received your message and will get back to you as soon as possible.</p>
    <p>Best regards,<br>The Support Team</p>'
);