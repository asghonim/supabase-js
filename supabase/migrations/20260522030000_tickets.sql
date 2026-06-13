CREATE TYPE public.ticket_status AS ENUM (
    'new',
    'reviewed',
    'in_progress',
    'waiting_customer',
    'resolved',
    'closed',
    'spam'
);

CREATE TYPE public.ticket_priority AS ENUM (
    'low',
    'normal',
    'high',
    'urgent'
);

CREATE TABLE public.tickets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    status                  public.ticket_status NOT NULL DEFAULT 'new',
    priority                public.ticket_priority NOT NULL DEFAULT 'normal',
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
GRANT ALL ON TABLE public.tickets TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.on_insert_tickets()  RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_tickets_inserted  BEFORE INSERT ON tickets  FOR EACH ROW EXECUTE FUNCTION private.on_insert_tickets();

CREATE INDEX idx_ticket_status          ON tickets(status);
CREATE INDEX idx_ticket_created_at      ON tickets(created_at DESC);
CREATE INDEX idx_ticket_email           ON tickets(email);
CREATE INDEX idx_ticket_assigned        ON tickets(assigned_to_account_id);
CREATE INDEX idx_ticket_authed_account  ON tickets(authenticated_account_id);
CREATE INDEX idx_ticket_ip              ON tickets(ip_address);


CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_ticket_message_fts ON tickets USING gin(message gin_trgm_ops);
CREATE INDEX idx_ticket_subject_fts ON tickets USING gin(coalesce(subject, '') gin_trgm_ops);

ALTER TABLE tickets  ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view their own tickets
CREATE POLICY "Allow users to view own tickets"
    ON tickets FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = authenticated_account_id
              AND a.user_id = auth.uid()
        )
    );

INSERT INTO public.notification_templates
    (type, channel, locale, version, is_active, subject_template, body_template)
VALUES
(
    'ticket_submission.admin_notification',
    'email',
    'en',
    1,
    true,
    '[Ticket] {{subject}} — from {{submitter_name}}',
    '<h2>New Ticket Submission</h2>
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
    'ticket_submission.auto_response',
    'email',
    'en',
    1,
    true,
    'We''ve received your ticket: {{subject}}',
    '<p>Hi {{name}},</p>
    <p>Thank you for reaching out. We''ve received your ticket and will get back to you as soon as possible.</p>
    <p>Best regards,<br>The Support Team</p>'
);