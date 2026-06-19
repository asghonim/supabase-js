-- ================================================================
-- SUBSCRIPTION SYSTEM
--
-- Multi-tenant SaaS billing engine. Organizations own subscriptions.
-- Core design principles:
--   * Never mutate subscriptions directly — all changes go through
--     subscription_change_requests (state machine)
--   * Invoices are immutable; adjustments use credit_notes
--   * Entitlements are computed/cached, never hard-coded per plan
--   * Billing amounts stored as integers (smallest currency unit)
--   * All provider interactions tracked via billing_webhook_events
--   * Idempotency keys on every write that touches money
-- ================================================================

CREATE TYPE public.billing_provider AS ENUM ('stripe', 'paddle', 'manual');
CREATE TYPE public.billing_interval  AS ENUM ('daily', 'weekly', 'monthly', 'yearly');
CREATE TYPE public.proration_behavior AS ENUM (
    'create_prorations',
    'none',
    'always_invoice'
    );
CREATE TYPE public.payment_behavior AS ENUM (
    'default_incomplete',
    'error_if_incomplete',
    'allow_incomplete'
    );
CREATE TYPE public.subscription_status AS ENUM (
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'paused',
    'cancelled',
    'expired'
    );
CREATE TYPE public.change_request_type AS ENUM (
    'create',
    'upgrade',
    'downgrade',
    'cancel',
    'pause',
    'resume',
    'renew',
    'add_seats',
    'remove_seats',
    'add_addon',
    'remove_addon'
    );
CREATE TYPE public.change_request_status AS ENUM (
    'pending',
    'processing',
    'awaiting_payment',
    'completed',
    'failed',
    'cancelled',
    'expired'
    );
CREATE TYPE public.invoice_status AS ENUM (
    'draft',
    'open',
    'paid',
    'void',
    'uncollectible'
    );
CREATE TYPE public.invoice_type AS ENUM (
    'subscription',
    'one_time',
    'credit_note'
    );
CREATE TYPE public.billing_reason AS ENUM (
    'subscription_create',
    'subscription_cycle',
    'subscription_update',
    'subscription_threshold',
    'manual',
    'upcoming'
    );
CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'processing',
    'succeeded',
    'failed',
    'cancelled',
    'refunded',
    'partially_refunded'
    );
CREATE TYPE public.payment_method AS ENUM (
    'card',
    'bank_transfer',
    'wallet',
    'manual',
    'crypto'
    );
CREATE TYPE public.feature_type AS ENUM (
    'boolean',
    'limit',
    'metered'
    );
CREATE TYPE public.feature_reset_period AS ENUM (
    'daily',
    'weekly',
    'monthly',
    'yearly',
    'never'
    );
CREATE TYPE public.org_member_role AS ENUM (
    'owner',
    'admin',
    'member',
    'billing'
    );
CREATE TYPE public.entitlement_source AS ENUM (
    'plan',
    'addon',
    'override',
    'promotion'
    );
CREATE TYPE public.contract_status AS ENUM (
    'draft',
    'active',
    'expired',
    'terminated'
    );
CREATE TYPE public.credit_note_status AS ENUM (
    'draft',
    'issued',
    'void'
    );
CREATE TYPE public.credit_note_reason AS ENUM (
    'duplicate',
    'fraudulent',
    'order_change',
    'product_unsatisfactory'
    );
CREATE TYPE public.webhook_event_status AS ENUM (
    'pending',
    'processed',
    'failed',
    'ignored'
    );


CREATE TABLE public.organization_billing_emails (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    billing_email   TEXT        NOT NULL CHECK (char_length(billing_email) BETWEEN 1 AND 320),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_organization_billing_emails_org ON public.organization_billing_emails(organization_id);
ALTER TABLE public.organization_billing_emails ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.organization_billing_emails TO service_role;


CREATE OR REPLACE FUNCTION private.is_org_billing(p_org_id BIGINT)
    RETURNS BOOLEAN AS $$
        SELECT private.has_org_permission(p_org_id, 'billing.manage');
    $$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


GRANT SELECT ON TABLE public.organization_billing_emails TO authenticated;
CREATE POLICY "Allow org billing role to view billing emails"
    ON public.organization_billing_emails FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id) OR public.has_permission('view', 'billing_email', id));


GRANT INSERT (organization_id, billing_email) ON TABLE public.organization_billing_emails TO authenticated;
CREATE POLICY "Allow org admins to insert billing emails"
    ON public.organization_billing_emails FOR INSERT
    TO authenticated
    WITH CHECK (
        exists(SELECT 1 FROM public.organizations o WHERE o.id = organization_id AND private.is_org_admin(o.id))
        OR public.has_permission('edit', 'billing_email', NULL)
    );


DROP SEQUENCE IF EXISTS public.invoice_number_seq; CREATE SEQUENCE public.invoice_number_seq START 1;
CREATE OR REPLACE FUNCTION private.next_invoice_number()
    RETURNS TEXT AS $$
    BEGIN
        RETURN 'INV-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
            LPAD(nextval('public.invoice_number_seq')::TEXT, 6, '0');
    END;
    $$ LANGUAGE plpgsql SET search_path = public, private;


DROP SEQUENCE IF EXISTS public.credit_note_number_seq; CREATE SEQUENCE public.credit_note_number_seq START 1;
CREATE OR REPLACE FUNCTION private.next_credit_note_number()
    RETURNS TEXT AS $$
    BEGIN
        RETURN 'CN-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
            LPAD(nextval('public.credit_note_number_seq')::TEXT, 6, '0');
    END;
    $$ LANGUAGE plpgsql SET search_path = public, private;


CREATE TABLE public.features (
    id          BIGINT               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID                 NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    key         TEXT                 NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 1 AND 100),
    name        TEXT                 NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description TEXT                 CHECK (char_length(description) <= 1000),
    type        public.feature_type  NOT NULL,
    unit        TEXT                 CHECK (char_length(unit) <= 100),
    is_active   BOOLEAN              NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ          NOT NULL DEFAULT NOW()
    );
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.features TO service_role;

GRANT SELECT ON TABLE public.features TO authenticated;
CREATE POLICY "Allow authenticated users to read active features"
    ON public.features FOR SELECT
    TO authenticated
    USING (is_active = TRUE);


CREATE TABLE public.plans (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    slug        TEXT        NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 100),
    description TEXT        CHECK (char_length(description) <= 1000),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    is_public   BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.plans TO service_role;

GRANT SELECT ON TABLE public.plans TO authenticated;
CREATE POLICY "Allow authenticated users to read active public plans"
    ON public.plans FOR SELECT
    TO authenticated
    USING (is_active = TRUE AND is_public = TRUE);


-- Versioned pricing — create a new version when pricing changes so
-- historical invoices always reference stable, immutable data.
CREATE TABLE public.plan_versions (
    id                        BIGINT                  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                       UUID                    NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    plan_id                   BIGINT                  NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
    version_number            INTEGER                 NOT NULL DEFAULT 1,
    price_amount              BIGINT                  NOT NULL DEFAULT 0,
    currency                  CHAR(3)                 NOT NULL DEFAULT 'USD',
    billing_interval          public.billing_interval NOT NULL DEFAULT 'monthly',
    trial_days                INTEGER                 NOT NULL DEFAULT 0,
    is_active                 BOOLEAN                 NOT NULL DEFAULT TRUE,
    effective_from            TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    effective_until           TIMESTAMPTZ,
    billing_provider          public.billing_provider,
    billing_provider_plan_id  TEXT,
    billing_provider_price_id TEXT,
    metadata                  JSONB                   NOT NULL DEFAULT '{}',
    created_at                TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, version_number)
    );
CREATE INDEX idx_plan_versions_plan ON public.plan_versions(plan_id);
CREATE INDEX idx_plan_versions_provider_price ON public.plan_versions(billing_provider_price_id) WHERE billing_provider_price_id IS NOT NULL;
ALTER TABLE public.plan_versions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.plan_versions TO service_role;


GRANT SELECT ON TABLE public.plan_versions TO authenticated;
CREATE POLICY "Allow authenticated users to read active plan versions"
    ON public.plan_versions FOR SELECT
    TO authenticated
    USING (
        is_active = TRUE
        AND EXISTS (
            SELECT 1 FROM public.plans p
            WHERE p.id = plan_id
              AND p.is_active = TRUE
              AND p.is_public = TRUE
        )
    );


CREATE TABLE public.plan_feature_entitlements (
    id              BIGINT                      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID                        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    plan_version_id BIGINT                      NOT NULL REFERENCES public.plan_versions(id) ON DELETE CASCADE,
    feature_id      BIGINT                      NOT NULL REFERENCES public.features(id)      ON DELETE RESTRICT,
    value_boolean   BOOLEAN,
    value_limit     BIGINT,
    reset_period    public.feature_reset_period NOT NULL DEFAULT 'monthly',
    created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    UNIQUE (plan_version_id, feature_id)
    );
CREATE INDEX idx_plan_feature_entitlements_version ON public.plan_feature_entitlements(plan_version_id);
ALTER TABLE public.plan_feature_entitlements ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.plan_feature_entitlements TO service_role;


GRANT SELECT ON TABLE public.plan_feature_entitlements TO authenticated;
CREATE POLICY "Allow authenticated users to read plan entitlements"
    ON public.plan_feature_entitlements FOR SELECT
    TO authenticated
    USING (TRUE);


CREATE TABLE public.addons (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    key         TEXT        NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 1 AND 100),
    description TEXT        CHECK (char_length(description) <= 1000),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
ALTER TABLE public.addons ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.addons TO service_role;

GRANT SELECT ON TABLE public.addons TO authenticated;
CREATE POLICY "Allow authenticated users to read active addons"
    ON public.addons FOR SELECT
    TO authenticated
    USING (is_active = TRUE);


CREATE TABLE public.addon_versions (
    id                        BIGINT                  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                       UUID                    NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    addon_id                  BIGINT                  NOT NULL REFERENCES public.addons(id) ON DELETE RESTRICT,
    price_amount              BIGINT                  NOT NULL,
    currency                  CHAR(3)                 NOT NULL DEFAULT 'USD',
    billing_interval          public.billing_interval NOT NULL DEFAULT 'monthly',
    billing_provider_price_id TEXT,
    is_active                 BOOLEAN                 NOT NULL DEFAULT TRUE,
    effective_from            TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    created_at                TIMESTAMPTZ             NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_addon_versions_addon ON public.addon_versions(addon_id);
ALTER TABLE public.addon_versions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.addon_versions TO service_role;

GRANT SELECT ON TABLE public.addon_versions TO authenticated;
CREATE POLICY "Allow authenticated users to read active addon versions"
    ON public.addon_versions FOR SELECT
    TO authenticated
    USING (is_active = TRUE);


CREATE TABLE public.addon_feature_entitlements (
    id               BIGINT                      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID                        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    addon_version_id BIGINT                      NOT NULL REFERENCES public.addon_versions(id) ON DELETE CASCADE,
    feature_id       BIGINT                      NOT NULL REFERENCES public.features(id)       ON DELETE RESTRICT,
    value_boolean    BOOLEAN,
    value_limit      BIGINT,
    reset_period     public.feature_reset_period NOT NULL DEFAULT 'monthly',
    created_at       TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    UNIQUE (addon_version_id, feature_id)
    );
CREATE INDEX idx_addon_feature_entitlements_version ON public.addon_feature_entitlements(addon_version_id);
ALTER TABLE public.addon_feature_entitlements ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.addon_feature_entitlements TO service_role;

GRANT SELECT ON TABLE public.addon_feature_entitlements TO authenticated;
CREATE POLICY "Allow authenticated users to read addon entitlements"
    ON public.addon_feature_entitlements FOR SELECT
    TO authenticated
    USING (TRUE);


CREATE TABLE public.subscriptions (
    id                               BIGINT                     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                              UUID                       NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id                  BIGINT                     NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    plan_version_id                  BIGINT                     NOT NULL REFERENCES public.plan_versions(id) ON DELETE RESTRICT,
    status                           public.subscription_status NOT NULL DEFAULT 'incomplete',
    quantity                         INTEGER                    NOT NULL DEFAULT 1,
    current_period_start             TIMESTAMPTZ,
    current_period_end               TIMESTAMPTZ,
    trial_start                      TIMESTAMPTZ,
    trial_end                        TIMESTAMPTZ,
    cancel_at                        TIMESTAMPTZ,
    cancelled_at                     TIMESTAMPTZ,
    ended_at                         TIMESTAMPTZ,
    billing_anchor_day               SMALLINT                   CHECK (billing_anchor_day BETWEEN 1 AND 31),
    billing_provider                 public.billing_provider,
    billing_provider_subscription_id TEXT                       UNIQUE,
    metadata                         JSONB                      NOT NULL DEFAULT '{}',
    created_at                       TIMESTAMPTZ                NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_subscriptions_org ON public.subscriptions(organization_id);
CREATE INDEX idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX idx_subscriptions_provider_id ON public.subscriptions(billing_provider_subscription_id) WHERE billing_provider_subscription_id IS NOT NULL;
CREATE INDEX idx_subscriptions_period_end ON public.subscriptions(current_period_end) WHERE status = 'active';
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.subscriptions TO service_role;

GRANT SELECT ON TABLE public.subscriptions TO authenticated;
CREATE POLICY "Allow billing role to view subscriptions"
    ON public.subscriptions FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id) OR public.has_permission('view', 'subscription', id));



CREATE TABLE public.subscription_addons (
    id                                    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                                   UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    subscription_id                       BIGINT      NOT NULL REFERENCES public.subscriptions(id)  ON DELETE CASCADE,
    addon_version_id                      BIGINT      NOT NULL REFERENCES public.addon_versions(id)  ON DELETE RESTRICT,
    quantity                              INTEGER     NOT NULL DEFAULT 1,
    status                                TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    started_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at                               TIMESTAMPTZ,
    billing_provider_subscription_item_id TEXT,
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_subscription_addons_subscription ON public.subscription_addons(subscription_id);
ALTER TABLE public.subscription_addons ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.subscription_addons TO service_role;

GRANT SELECT ON TABLE public.subscription_addons TO authenticated;
CREATE POLICY "Allow billing role to view subscription addons"
    ON public.subscription_addons FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.subscriptions s
            WHERE s.id = subscription_id
              AND private.is_org_billing(s.organization_id)
        )
        OR public.has_permission('view', 'subscription_addon', id)
    );

-- ================================================================
-- SUBSCRIPTION CHANGE REQUESTS  (state machine)
-- ================================================================

CREATE TABLE public.subscription_change_requests (
    id                       BIGINT                       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                      UUID                         NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    subscription_id          BIGINT                       REFERENCES public.subscriptions(id)   ON DELETE SET NULL,
    organization_id          BIGINT                       NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    requested_by_account_id  BIGINT                       NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    type                     public.change_request_type   NOT NULL,
    status                   public.change_request_status NOT NULL DEFAULT 'pending',
    current_plan_version_id  BIGINT                       REFERENCES public.plan_versions(id)   ON DELETE RESTRICT,
    target_plan_version_id   BIGINT                       REFERENCES public.plan_versions(id)   ON DELETE RESTRICT,
    effective_at             TIMESTAMPTZ,
    proration_behavior       public.proration_behavior    NOT NULL DEFAULT 'create_prorations',
    payment_behavior         public.payment_behavior      NOT NULL DEFAULT 'default_incomplete',
    idempotency_key          TEXT                         UNIQUE,
    billing_impact           JSONB                        NOT NULL DEFAULT '{}',
    billing_provider_payload JSONB                        NOT NULL DEFAULT '{}',
    failure_reason           TEXT,
    metadata                 JSONB                        NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
    processed_at             TIMESTAMPTZ,
    expires_at               TIMESTAMPTZ                  NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
    );
CREATE INDEX idx_change_requests_subscription ON public.subscription_change_requests(subscription_id);
CREATE INDEX idx_change_requests_org ON public.subscription_change_requests(organization_id);
CREATE INDEX idx_change_requests_status ON public.subscription_change_requests(status);
CREATE INDEX idx_change_requests_expires ON public.subscription_change_requests(expires_at) WHERE status IN ('pending', 'processing', 'awaiting_payment');
ALTER TABLE public.subscription_change_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.subscription_change_requests TO service_role;

GRANT SELECT ON TABLE public.subscription_change_requests TO authenticated;
CREATE POLICY "Allow billing role to view change requests"
    ON public.subscription_change_requests FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id) OR public.has_permission('view', 'subscription_change', id));

GRANT INSERT ON TABLE public.subscription_change_requests TO authenticated;
CREATE POLICY "Allow billing role to create change requests"
    ON public.subscription_change_requests FOR INSERT
    TO authenticated
    WITH CHECK (
        (
            private.is_org_billing(organization_id)
            AND requested_by_account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
        )
        OR public.has_permission('create', 'subscription_change', NULL)
    );


-- ================================================================
-- INVOICES  (immutable billing records)
-- ================================================================

CREATE TABLE public.invoices (
    id                          BIGINT                 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                         UUID                   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id             BIGINT                 NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    subscription_id             BIGINT                 REFERENCES public.subscriptions(id)          ON DELETE SET NULL,
    status                      public.invoice_status  NOT NULL DEFAULT 'draft',
    type                        public.invoice_type    NOT NULL DEFAULT 'subscription',
    number                      TEXT                   UNIQUE DEFAULT private.next_invoice_number(),
    currency                    CHAR(3)                NOT NULL DEFAULT 'USD',
    subtotal_amount             BIGINT                 NOT NULL DEFAULT 0,
    tax_amount                  BIGINT                 NOT NULL DEFAULT 0,
    discount_amount             BIGINT                 NOT NULL DEFAULT 0,
    total_amount                BIGINT                 NOT NULL DEFAULT 0,
    amount_due                  BIGINT                 NOT NULL DEFAULT 0,
    amount_paid                 BIGINT                 NOT NULL DEFAULT 0,
    billing_reason              public.billing_reason,
    period_start                TIMESTAMPTZ,
    period_end                  TIMESTAMPTZ,
    due_date                    TIMESTAMPTZ,
    paid_at                     TIMESTAMPTZ,
    voided_at                   TIMESTAMPTZ,
    billing_provider            public.billing_provider,
    billing_provider_invoice_id TEXT                   UNIQUE,
    snapshot_customer_name      TEXT,
    snapshot_customer_email     TEXT,
    snapshot_customer_address   JSONB,
    snapshot_plan_name          TEXT,
    snapshot_tax_rates          JSONB                  NOT NULL DEFAULT '[]',
    idempotency_key             TEXT                   UNIQUE,
    metadata                    JSONB                  NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMPTZ            NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_invoices_org ON public.invoices(organization_id);
CREATE INDEX idx_invoices_subscription ON public.invoices(subscription_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoices_provider_id ON public.invoices(billing_provider_invoice_id) WHERE billing_provider_invoice_id IS NOT NULL;
CREATE INDEX idx_invoices_period ON public.invoices(organization_id, period_start, period_end);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.invoices TO service_role;

GRANT SELECT ON TABLE public.invoices TO authenticated;
CREATE POLICY "Allow billing role to view invoices"
    ON public.invoices FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id) OR public.has_permission('view', 'invoice', id));


CREATE TABLE public.invoice_line_items (
    id                            BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                           UUID          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    invoice_id                    BIGINT        NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    type                          TEXT          NOT NULL
                                      CHECK (type IN ('subscription','proration','one_time','tax','discount','credit','usage')),
    description                   TEXT          NOT NULL,
    quantity                      NUMERIC(12,4) NOT NULL DEFAULT 1,
    unit_amount                   BIGINT        NOT NULL DEFAULT 0,
    total_amount                  BIGINT        NOT NULL DEFAULT 0,
    period_start                  TIMESTAMPTZ,
    period_end                    TIMESTAMPTZ,
    snapshot_plan_name            TEXT,
    snapshot_feature_key          TEXT,
    billing_provider_line_item_id TEXT,
    metadata                      JSONB         NOT NULL DEFAULT '{}',
    created_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_invoice_line_items_invoice ON public.invoice_line_items(invoice_id);
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.invoice_line_items TO service_role;

GRANT SELECT ON TABLE public.invoice_line_items TO authenticated;
CREATE POLICY "Allow billing role to view invoice line items"
    ON public.invoice_line_items FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.invoices i
            WHERE i.id = invoice_id
              AND private.is_org_billing(i.organization_id)
        )
        OR public.has_permission('view', 'invoice_line_item', id)
    );


CREATE TABLE public.credit_notes (
    id                              BIGINT                    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                             UUID                      NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    invoice_id                      BIGINT                    NOT NULL REFERENCES public.invoices(id)      ON DELETE RESTRICT,
    organization_id                 BIGINT                    NOT NULL REFERENCES public.organizations(id)  ON DELETE RESTRICT,
    number                          TEXT                      UNIQUE DEFAULT private.next_credit_note_number(),
    status                          public.credit_note_status NOT NULL DEFAULT 'draft',
    reason                          public.credit_note_reason NOT NULL,
    currency                        CHAR(3)                   NOT NULL DEFAULT 'USD',
    total_amount                    BIGINT                    NOT NULL DEFAULT 0,
    billing_provider_credit_note_id TEXT                      UNIQUE,
    created_at                      TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
    voided_at                       TIMESTAMPTZ
    );
CREATE INDEX idx_credit_notes_invoice ON public.credit_notes(invoice_id);
CREATE INDEX idx_credit_notes_org     ON public.credit_notes(organization_id);
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.credit_notes TO service_role;

GRANT SELECT ON TABLE public.credit_notes TO authenticated;
CREATE POLICY "Allow billing role to view credit notes"
    ON public.credit_notes FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id) OR public.has_permission('view', 'credit_note', id));



CREATE TABLE public.payments (
    id                                 BIGINT                  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                                UUID                    NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id                    BIGINT                  NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    invoice_id                         BIGINT                  REFERENCES public.invoices(id)               ON DELETE SET NULL,
    status                             public.payment_status   NOT NULL DEFAULT 'pending',
    method                             public.payment_method,
    amount                             BIGINT                  NOT NULL,
    amount_refunded                    BIGINT                  NOT NULL DEFAULT 0,
    currency                           CHAR(3)                 NOT NULL DEFAULT 'USD',
    failure_reason                     TEXT,
    failure_code                       TEXT,
    billing_provider                   public.billing_provider NOT NULL,
    billing_provider_payment_id        TEXT                    UNIQUE,
    billing_provider_payment_method_id TEXT,
    metadata                           JSONB                   NOT NULL DEFAULT '{}',
    created_at                         TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    processed_at                       TIMESTAMPTZ
    );
CREATE INDEX idx_payments_org ON public.payments(organization_id);
CREATE INDEX idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX idx_payments_status ON public.payments(status);
CREATE INDEX idx_payments_provider_id ON public.payments(billing_provider_payment_id) WHERE billing_provider_payment_id IS NOT NULL;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.payments TO service_role;

GRANT SELECT ON TABLE public.payments TO authenticated;
CREATE POLICY "Allow billing role to view payments"
    ON public.payments FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id) OR public.has_permission('view', 'payment', id));


-- ================================================================
-- SUBSCRIPTION ENTITLEMENTS  (computed cache)
-- ================================================================

CREATE TABLE public.subscription_entitlements (
    id              BIGINT                    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID                      NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT                    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_id BIGINT                    NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    feature_id      BIGINT                    NOT NULL REFERENCES public.features(id)      ON DELETE CASCADE,
    feature_key     TEXT                      NOT NULL,
    value_boolean   BOOLEAN,
    value_limit     BIGINT,
    is_unlimited    BOOLEAN                   NOT NULL DEFAULT FALSE,
    source          public.entitlement_source NOT NULL DEFAULT 'plan',
    computed_at     TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
    valid_until     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, subscription_id, feature_id)
    );
CREATE INDEX idx_entitlements_org_feature ON public.subscription_entitlements(organization_id, feature_key);
CREATE INDEX idx_entitlements_subscription ON public.subscription_entitlements(subscription_id);
ALTER TABLE public.subscription_entitlements ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.subscription_entitlements TO service_role;

GRANT SELECT ON TABLE public.subscription_entitlements TO authenticated;
CREATE POLICY "Allow members with analytics.view to read their entitlements"
    ON public.subscription_entitlements FOR SELECT
    TO authenticated
    USING (private.has_org_permission(organization_id, 'analytics.view') OR public.has_permission('view', 'subscription_entitlement', id));



CREATE TABLE public.usage_records (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_id BIGINT               REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    feature_id      BIGINT               REFERENCES public.features(id)      ON DELETE RESTRICT,
    feature_key     TEXT        NOT NULL,
    quantity        BIGINT      NOT NULL DEFAULT 1,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    idempotency_key TEXT        UNIQUE,
    metadata        JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_usage_records_org_feature_period ON public.usage_records(organization_id, feature_key, period_start, period_end);
CREATE INDEX idx_usage_records_subscription ON public.usage_records(subscription_id, recorded_at);
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.usage_records TO service_role;

GRANT SELECT ON TABLE public.usage_records TO authenticated;
CREATE POLICY "Allow members with analytics.view to view usage records"
    ON public.usage_records FOR SELECT
    TO authenticated
    USING (private.has_org_permission(organization_id, 'analytics.view') OR public.has_permission('view', 'usage_record', id));


CREATE OR REPLACE FUNCTION private.on_insert_usage_records()
    RETURNS TRIGGER AS $$
    BEGIN
        IF NEW.feature_id IS NULL AND NEW.feature_key IS NOT NULL THEN
            SELECT id INTO NEW.feature_id
            FROM public.features
            WHERE key = NEW.feature_key
            LIMIT 1;
        END IF;

        IF NEW.subscription_id IS NULL AND NEW.organization_id IS NOT NULL THEN
            SELECT id INTO NEW.subscription_id
            FROM public.subscriptions
            WHERE organization_id = NEW.organization_id
            AND status IN ('active', 'trialing')
            ORDER BY created_at DESC
            LIMIT 1;
        END IF;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_usage_records BEFORE INSERT ON public.usage_records FOR EACH ROW EXECUTE FUNCTION private.on_insert_usage_records();

CREATE TABLE public.usage_summaries (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_id BIGINT      NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    feature_id      BIGINT      NOT NULL REFERENCES public.features(id)      ON DELETE RESTRICT,
    feature_key     TEXT        NOT NULL,
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    total_quantity  BIGINT      NOT NULL DEFAULT 0,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, subscription_id, feature_id, period_start, period_end)
    );
CREATE INDEX idx_usage_summaries_org_feature ON public.usage_summaries(organization_id, feature_key);
CREATE INDEX idx_usage_summaries_subscription_period ON public.usage_summaries(subscription_id, period_start);
ALTER TABLE public.usage_summaries ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.usage_summaries TO service_role;

GRANT SELECT ON TABLE public.usage_summaries TO authenticated;
CREATE POLICY "Allow members with analytics.view to view usage summaries"
    ON public.usage_summaries FOR SELECT
    TO authenticated
    USING (private.has_org_permission(organization_id, 'analytics.view') OR public.has_permission('view', 'usage_summary', id));


-- The AFTER INSERT trigger on usage_records references usage_summaries, so it is created after that table.
CREATE OR REPLACE FUNCTION private.on_usage_records_inserted()
    RETURNS TRIGGER AS $$
    BEGIN
        IF NEW.subscription_id IS NULL OR NEW.feature_id IS NULL THEN
            RETURN NEW;
        END IF;

        INSERT INTO public.usage_summaries (
            organization_id, subscription_id, feature_id, feature_key,
            period_start, period_end, total_quantity, last_updated_at
        )
        VALUES (
            NEW.organization_id, NEW.subscription_id, NEW.feature_id, NEW.feature_key,
            NEW.period_start, NEW.period_end, NEW.quantity, NOW()
        ) ON CONFLICT (organization_id, subscription_id, feature_id, period_start, period_end)
        DO UPDATE SET
            total_quantity  = usage_summaries.total_quantity + EXCLUDED.total_quantity,
            last_updated_at = NOW();
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_usage_records_inserted AFTER INSERT ON public.usage_records FOR EACH ROW EXECUTE FUNCTION private.on_usage_records_inserted();


-- ================================================================
-- DOMAIN EVENTS  (outbox / audit trail)
-- ================================================================

CREATE TABLE public.subscription_events (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_id BIGINT      REFERENCES public.subscriptions(id)          ON DELETE SET NULL,
    type            TEXT        NOT NULL CHECK (char_length(type) BETWEEN 1 AND 255),
    payload         JSONB       NOT NULL DEFAULT '{}',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_subscription_events_org ON public.subscription_events(organization_id, occurred_at DESC);
CREATE INDEX idx_subscription_events_subscription ON public.subscription_events(subscription_id);
CREATE INDEX idx_subscription_events_type ON public.subscription_events(type, occurred_at DESC);
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.subscription_events TO service_role;

GRANT SELECT ON TABLE public.subscription_events TO authenticated;
CREATE POLICY "Allow billing role to view subscription events"
    ON public.subscription_events FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id) OR public.has_permission('view', 'subscription_event', id));


-- ================================================================
-- BILLING PROVIDER WEBHOOK EVENTS
-- ================================================================

CREATE TABLE public.billing_webhook_events (
    id               BIGINT                      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID                        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    billing_provider public.billing_provider     NOT NULL,
    event_type       TEXT                        NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 255),
    event_id         TEXT                        NOT NULL CHECK (char_length(event_id) BETWEEN 1 AND 255),
    payload          JSONB                       NOT NULL DEFAULT '{}',
    status           public.webhook_event_status NOT NULL DEFAULT 'pending',
    processed_at     TIMESTAMPTZ,
    failure_reason   TEXT,
    retry_count      SMALLINT                    NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    UNIQUE (billing_provider, event_id)
    );
CREATE INDEX idx_webhook_events_status ON public.billing_webhook_events(status, created_at);
CREATE INDEX idx_webhook_events_provider_type ON public.billing_webhook_events(billing_provider, event_type);
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.billing_webhook_events TO service_role;


-- ================================================================
-- ENTERPRISE CONTRACTS
-- ================================================================

CREATE TABLE public.subscription_contracts (
    id                   BIGINT                 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                  UUID                   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id      BIGINT                 NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    subscription_id      BIGINT                 REFERENCES public.subscriptions(id)          ON DELETE SET NULL,
    status               public.contract_status NOT NULL DEFAULT 'draft',
    start_date           DATE                   NOT NULL,
    end_date             DATE,
    custom_pricing       JSONB                  NOT NULL DEFAULT '{}',
    negotiated_features  JSONB                  NOT NULL DEFAULT '{}',
    sla_tier             TEXT                   CHECK (char_length(sla_tier) <= 100),
    document_url         TEXT                   CHECK (char_length(document_url) <= 2048),
    signed_at            TIMESTAMPTZ,
    signed_by_account_id BIGINT                 REFERENCES public.accounts(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ            NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_contracts_org ON public.subscription_contracts(organization_id);
CREATE INDEX idx_contracts_subscription ON public.subscription_contracts(subscription_id);
ALTER TABLE public.subscription_contracts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.subscription_contracts TO service_role;

GRANT SELECT ON TABLE public.subscription_contracts TO authenticated;
CREATE POLICY "Allow billing role to view contracts"
    ON public.subscription_contracts FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id) OR public.has_permission('view', 'subscription_contract', id));


CREATE OR REPLACE FUNCTION private.recompute_entitlements(p_subscription_id BIGINT)
    RETURNS VOID AS $$
    DECLARE
        v_org_id          BIGINT;
        v_plan_version_id BIGINT;
    BEGIN
        SELECT organization_id, plan_version_id
        INTO   v_org_id, v_plan_version_id
        FROM   public.subscriptions
        WHERE  id = p_subscription_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'subscription % not found', p_subscription_id;
        END IF;

        DELETE FROM public.subscription_entitlements
        WHERE  subscription_id = p_subscription_id
        AND  source IN ('plan', 'addon');

        INSERT INTO public.subscription_entitlements (
            organization_id, subscription_id, feature_id, feature_key,
            value_boolean, value_limit, is_unlimited, source, computed_at
        )
        SELECT
            v_org_id,
            p_subscription_id,
            f.id,
            f.key,
            pfe.value_boolean,
            pfe.value_limit,
            (pfe.value_limit = -1),
            'plan',
            NOW()
        FROM  public.plan_feature_entitlements pfe
        JOIN  public.features f ON f.id = pfe.feature_id
        WHERE pfe.plan_version_id = v_plan_version_id
        ON CONFLICT (organization_id, subscription_id, feature_id) DO UPDATE
            SET value_boolean = EXCLUDED.value_boolean,
                value_limit   = EXCLUDED.value_limit,
                is_unlimited  = EXCLUDED.is_unlimited,
                source        = EXCLUDED.source,
                computed_at   = EXCLUDED.computed_at;

        INSERT INTO public.subscription_entitlements (
            organization_id, subscription_id, feature_id, feature_key,
            value_boolean, value_limit, is_unlimited, source, computed_at
        )
        SELECT
            v_org_id,
            p_subscription_id,
            f.id,
            f.key,
            afe.value_boolean,
            afe.value_limit,
            (afe.value_limit = -1),
            'addon',
            NOW()
        FROM  public.subscription_addons sa
        JOIN  public.addon_feature_entitlements afe ON afe.addon_version_id = sa.addon_version_id
        JOIN  public.features f                     ON f.id = afe.feature_id
        WHERE sa.subscription_id = p_subscription_id
        AND sa.status = 'active'
        ON CONFLICT (organization_id, subscription_id, feature_id) DO UPDATE
            SET value_boolean = COALESCE(subscription_entitlements.value_boolean, FALSE)
                                OR COALESCE(EXCLUDED.value_boolean, FALSE),
                value_limit   = CASE
                                    WHEN EXCLUDED.value_limit = -1                          THEN -1
                                    WHEN subscription_entitlements.value_limit = -1         THEN -1
                                    ELSE GREATEST(EXCLUDED.value_limit,
                                                subscription_entitlements.value_limit)
                                END,
                is_unlimited  = (EXCLUDED.value_limit = -1
                                OR subscription_entitlements.value_limit = -1),
                source        = 'addon',
                computed_at   = NOW();
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE EXECUTE ON FUNCTION private.recompute_entitlements(BIGINT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION private.recompute_entitlements(BIGINT) TO service_role;
