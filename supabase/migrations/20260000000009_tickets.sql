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
    id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                        UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    status                     public.ticket_status   NOT NULL DEFAULT 'new',
    priority                   public.ticket_priority NOT NULL DEFAULT 'normal',
    source                     TEXT        CHECK (char_length(source) <= 100),
    category                   TEXT        CHECK (char_length(category) <= 255),
    subject                    TEXT        CHECK (char_length(subject) <= 500),
    message                    TEXT        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 65535),
    full_name                  TEXT        CHECK (char_length(full_name) <= 255),
    email                      TEXT        CHECK (char_length(email) <= 320),
    phone                      TEXT        CHECK (char_length(phone) <= 50),
    company_name               TEXT        CHECK (char_length(company_name) <= 255),
    ip_address                 INET,
    user_agent                 TEXT        CHECK (char_length(user_agent) <= 1000),
    referer                    TEXT        CHECK (char_length(referer) <= 2048),
    authenticated_account_id   BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL,
    assigned_to_account_id     BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL,
    spam_score                 NUMERIC(5,2),
    first_response_at          TIMESTAMPTZ,
    resolved_at                TIMESTAMPTZ,
    due_at                     TIMESTAMPTZ,
    metadata                   JSONB NOT NULL DEFAULT '{}',
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.tickets TO authenticated, service_role;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_tickets_status         ON public.tickets(status);
CREATE INDEX idx_tickets_created_at     ON public.tickets(created_at DESC);
CREATE INDEX idx_tickets_email          ON public.tickets(email);
CREATE INDEX idx_tickets_assigned       ON public.tickets(assigned_to_account_id);
CREATE INDEX idx_tickets_authed_account ON public.tickets(authenticated_account_id);
CREATE INDEX idx_tickets_ip             ON public.tickets(ip_address);

CREATE INDEX idx_tickets_message_fts ON public.tickets USING gin(message gin_trgm_ops);
CREATE INDEX idx_tickets_subject_fts ON public.tickets USING gin(coalesce(subject, '') gin_trgm_ops);

CREATE OR REPLACE FUNCTION private.on_insert_tickets() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_tickets BEFORE INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION private.on_insert_tickets();

CREATE OR REPLACE FUNCTION private.on_update_tickets()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'new' AND NEW.status <> 'new' AND NEW.first_response_at IS NULL THEN
        NEW.first_response_at = NOW();
    END IF;

    IF NEW.status IN ('resolved', 'closed') AND NEW.resolved_at IS NULL THEN
        NEW.resolved_at = NOW();
    END IF;

    IF OLD.status IN ('resolved', 'closed') AND NEW.status NOT IN ('resolved', 'closed') THEN
        NEW.resolved_at = NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_update_tickets
    BEFORE UPDATE ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION private.on_update_tickets();

CREATE POLICY "Allow users to view own tickets"
    ON public.tickets FOR SELECT
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
