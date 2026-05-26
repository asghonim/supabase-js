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

CREATE TABLE public.organization_billing_emails (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    billing_email   TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.organization_billing_emails ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_organization_billing_emails_org ON public.organization_billing_emails(organization_id);

CREATE OR REPLACE FUNCTION private.on_insert_organization_billing_emails() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_organization_billing_emails_inserted BEFORE INSERT ON public.organization_billing_emails FOR EACH ROW EXECUTE FUNCTION private.on_insert_organization_billing_emails();

CREATE OR REPLACE FUNCTION private.is_org_billing(p_org_id BIGINT)
RETURNS BOOLEAN AS $$
    SELECT private.has_org_permission(p_org_id, 'billing.manage');
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

CREATE POLICY "Allow org admins to insert billing emails"
    ON public.organization_billing_emails FOR INSERT
    TO authenticated
    WITH CHECK (exists(SELECT 1 FROM public.organizations o WHERE o.id = organization_id AND private.is_org_admin(o.id)));

CREATE POLICY "Allow org admins to view billing emails"
    ON public.organization_billing_emails FOR SELECT
    TO authenticated
    USING (private.is_org_admin(organization_id));


-- ================================================================
-- ENUMS
-- ================================================================

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
    'incomplete',           -- awaiting initial payment
    'incomplete_expired',   -- initial payment window elapsed
    'trialing',
    'active',
    'past_due',             -- renewal failed, retrying
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
    'boolean',  -- feature is on/off
    'limit',    -- feature has a numeric cap (-1 = unlimited)
    'metered'   -- billed based on usage
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

DROP SEQUENCE IF EXISTS public.invoice_number_seq;
CREATE SEQUENCE public.invoice_number_seq     START 1;
DROP SEQUENCE IF EXISTS public.credit_note_number_seq;
CREATE SEQUENCE public.credit_note_number_seq START 1;

CREATE OR REPLACE FUNCTION private.next_invoice_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'INV-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
           LPAD(nextval('public.invoice_number_seq')::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE OR REPLACE FUNCTION private.next_credit_note_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'CN-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
           LPAD(nextval('public.credit_note_number_seq')::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TABLE public.features (
    id          BIGINT               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key         TEXT                 NOT NULL UNIQUE,  -- e.g. 'ai_tokens', 'advanced_reports'
    name        TEXT                 NOT NULL,
    description TEXT,
    type        public.feature_type  NOT NULL,
    unit        TEXT,                                  -- 'tokens', 'requests', 'bytes', 'seats'
    is_active   BOOLEAN              NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION private.on_update_feature()            
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_feature_updated
    BEFORE UPDATE ON public.features
    FOR EACH ROW EXECUTE FUNCTION private.on_update_feature();
CREATE OR REPLACE FUNCTION private.on_insert_features()     
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_features_inserted BEFORE INSERT ON public.features                     FOR EACH ROW EXECUTE FUNCTION private.on_insert_features();

CREATE TABLE public.plans (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    description TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    is_public   BOOLEAN     NOT NULL DEFAULT TRUE,  -- visible on pricing page
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION private.on_update_plan()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_plan_updated
    BEFORE UPDATE ON public.plans
    FOR EACH ROW EXECUTE FUNCTION private.on_update_plan();
CREATE OR REPLACE FUNCTION private.on_insert_plans()        
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_plans_inserted  BEFORE INSERT ON public.plans                        FOR EACH ROW EXECUTE FUNCTION private.on_insert_plans();


-- Versioned pricing — create a new version when pricing changes so
-- historical invoices always reference stable, immutable data.
CREATE TABLE public.plan_versions (
    id                        BIGINT                  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_id                   BIGINT                  NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
    version_number            INTEGER                 NOT NULL DEFAULT 1,
    price_amount              BIGINT                  NOT NULL DEFAULT 0,      -- cents / smallest unit
    currency                  CHAR(3)                 NOT NULL DEFAULT 'USD',  -- ISO 4217
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

CREATE INDEX idx_plan_versions_plan
    ON public.plan_versions(plan_id);
CREATE INDEX idx_plan_versions_provider_price
    ON public.plan_versions(billing_provider_price_id)
    WHERE billing_provider_price_id IS NOT NULL;
CREATE OR REPLACE FUNCTION private.on_insert_plan_versions()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_plan_versions_inserted   BEFORE INSERT ON public.plan_versions                FOR EACH ROW EXECUTE FUNCTION private.on_insert_plan_versions();

CREATE TABLE public.plan_feature_entitlements (
    id              BIGINT                      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_version_id BIGINT                      NOT NULL REFERENCES public.plan_versions(id) ON DELETE CASCADE,
    feature_id      BIGINT                      NOT NULL REFERENCES public.features(id)      ON DELETE RESTRICT,
    value_boolean   BOOLEAN,
    value_limit     BIGINT, -- -1 = unlimited
    reset_period    public.feature_reset_period NOT NULL DEFAULT 'monthly',
    created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    UNIQUE (plan_version_id, feature_id)
);

CREATE INDEX idx_plan_feature_entitlements_version
    ON public.plan_feature_entitlements(plan_version_id);
CREATE OR REPLACE FUNCTION private.on_insert_plan_feature_entitlements()    RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_plan_feature_entitlements_inserted    BEFORE INSERT ON public.plan_feature_entitlements    FOR EACH ROW EXECUTE FUNCTION private.on_insert_plan_feature_entitlements();

CREATE TABLE public.addons (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT        NOT NULL,
    key         TEXT        NOT NULL UNIQUE,
    description TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION private.on_update_addon()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_addon
    BEFORE UPDATE ON public.addons
    FOR EACH ROW EXECUTE FUNCTION private.on_update_addon();
CREATE OR REPLACE FUNCTION private.on_insert_addons()       
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_addons_inserted BEFORE INSERT ON public.addons                       FOR EACH ROW EXECUTE FUNCTION private.on_insert_addons();

CREATE TABLE public.addon_versions (
    id                        BIGINT                  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
CREATE OR REPLACE FUNCTION private.on_insert_addon_versions()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_addon_versions_inserted  BEFORE INSERT ON public.addon_versions               FOR EACH ROW EXECUTE FUNCTION private.on_insert_addon_versions();

CREATE TABLE public.addon_feature_entitlements (
    id               BIGINT                      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    addon_version_id BIGINT                      NOT NULL REFERENCES public.addon_versions(id) ON DELETE CASCADE,
    feature_id       BIGINT                      NOT NULL REFERENCES public.features(id)       ON DELETE RESTRICT,
    value_boolean    BOOLEAN,
    value_limit      BIGINT, -- -1 = unlimited
    reset_period     public.feature_reset_period NOT NULL DEFAULT 'monthly',
    created_at       TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    UNIQUE (addon_version_id, feature_id)
);

CREATE INDEX idx_addon_feature_entitlements_version
    ON public.addon_feature_entitlements(addon_version_id);
CREATE OR REPLACE FUNCTION private.on_insert_addon_feature_entitlements()   RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_addon_feature_entitlements_inserted   BEFORE INSERT ON public.addon_feature_entitlements   FOR EACH ROW EXECUTE FUNCTION private.on_insert_addon_feature_entitlements();


CREATE TABLE public.subscriptions (
    id                               BIGINT                     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id                  BIGINT                     NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    plan_version_id                  BIGINT                     NOT NULL REFERENCES public.plan_versions(id) ON DELETE RESTRICT,
    status                           public.subscription_status NOT NULL DEFAULT 'incomplete',
    quantity                         INTEGER                    NOT NULL DEFAULT 1,   -- seats
    current_period_start             TIMESTAMPTZ,
    current_period_end               TIMESTAMPTZ,
    trial_start                      TIMESTAMPTZ,
    trial_end                        TIMESTAMPTZ,
    cancel_at                        TIMESTAMPTZ,               -- scheduled future cancellation
    cancelled_at                     TIMESTAMPTZ,               -- when cancel was executed
    ended_at                         TIMESTAMPTZ,
    billing_anchor_day               SMALLINT                   CHECK (billing_anchor_day BETWEEN 1 AND 31),
    billing_provider                 public.billing_provider,
    billing_provider_subscription_id TEXT                       UNIQUE,
    metadata                         JSONB                      NOT NULL DEFAULT '{}',
    created_at                       TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
    updated_at                       TIMESTAMPTZ                NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_org
    ON public.subscriptions(organization_id);
CREATE INDEX idx_subscriptions_status
    ON public.subscriptions(status);
CREATE INDEX idx_subscriptions_provider_id
    ON public.subscriptions(billing_provider_subscription_id)
    WHERE billing_provider_subscription_id IS NOT NULL;
CREATE INDEX idx_subscriptions_period_end
    ON public.subscriptions(current_period_end)
    WHERE status = 'active';

CREATE OR REPLACE FUNCTION private.on_update_subscription()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_subscription
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION private.on_update_subscription();
CREATE OR REPLACE FUNCTION private.on_insert_subscriptions()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_subscriptions_inserted   BEFORE INSERT ON public.subscriptions                FOR EACH ROW EXECUTE FUNCTION private.on_insert_subscriptions();

CREATE TABLE public.subscription_addons (
    id                                    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subscription_id                       BIGINT      NOT NULL REFERENCES public.subscriptions(id)  ON DELETE CASCADE,
    addon_version_id                      BIGINT      NOT NULL REFERENCES public.addon_versions(id)  ON DELETE RESTRICT,
    quantity                              INTEGER     NOT NULL DEFAULT 1,
    status                                TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    started_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at                               TIMESTAMPTZ,
    billing_provider_subscription_item_id TEXT,
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_addons_subscription
    ON public.subscription_addons(subscription_id);

CREATE OR REPLACE FUNCTION private.on_update_subscription_addon() 
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_subscription_addon
    BEFORE UPDATE ON public.subscription_addons
    FOR EACH ROW EXECUTE FUNCTION private.on_update_subscription_addon();
CREATE OR REPLACE FUNCTION private.on_insert_subscription_addons()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_subscription_addons_inserted    BEFORE INSERT ON public.subscription_addons          FOR EACH ROW EXECUTE FUNCTION private.on_insert_subscription_addons();


-- ================================================================
-- SUBSCRIPTION CHANGE REQUESTS  (state machine)
--
-- Every plan change, cancellation, seat adjustment, or addon
-- purchase is modelled as a change request, never a direct UPDATE
-- on subscriptions. The state machine drives the subscription
-- mutation only after payment is confirmed.
--
-- State transitions:
--   pending → processing → awaiting_payment → completed
--                                           ↘ failed
--   pending → cancelled   (user abandoned before processing)
--   pending → expired     (TTL elapsed without action)
-- ================================================================

CREATE TABLE public.subscription_change_requests (
    id                       BIGINT                       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    billing_impact           JSONB                        NOT NULL DEFAULT '{}',  -- computed proration amounts
    billing_provider_payload JSONB                        NOT NULL DEFAULT '{}',  -- raw provider response
    failure_reason           TEXT,
    metadata                 JSONB                        NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
    processed_at             TIMESTAMPTZ,
    expires_at               TIMESTAMPTZ                  NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX idx_change_requests_subscription
    ON public.subscription_change_requests(subscription_id);
CREATE INDEX idx_change_requests_org
    ON public.subscription_change_requests(organization_id);
CREATE INDEX idx_change_requests_status
    ON public.subscription_change_requests(status);
CREATE INDEX idx_change_requests_expires
    ON public.subscription_change_requests(expires_at)
    WHERE status IN ('pending', 'processing', 'awaiting_payment');
CREATE OR REPLACE FUNCTION private.on_insert_subscription_change_requests() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_subscription_change_requests_inserted BEFORE INSERT ON public.subscription_change_requests FOR EACH ROW EXECUTE FUNCTION private.on_insert_subscription_change_requests();


-- ================================================================
-- INVOICES  (immutable billing records)
--
-- Never UPDATE financial columns after an invoice is paid.
-- Issue a credit_note to adjust. Snapshot columns preserve the
-- display state even when org/plan data changes later.
-- ================================================================

CREATE TABLE public.invoices (
    id                          BIGINT                 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    -- Immutable snapshots — invoice display stays correct forever
    snapshot_customer_name      TEXT,
    snapshot_customer_email     TEXT,
    snapshot_customer_address   JSONB,
    snapshot_plan_name          TEXT,
    snapshot_tax_rates          JSONB                  NOT NULL DEFAULT '[]',
    idempotency_key             TEXT                   UNIQUE,
    metadata                    JSONB                  NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_org
    ON public.invoices(organization_id);
CREATE INDEX idx_invoices_subscription
    ON public.invoices(subscription_id);
CREATE INDEX idx_invoices_status
    ON public.invoices(status);
CREATE INDEX idx_invoices_provider_id
    ON public.invoices(billing_provider_invoice_id)
    WHERE billing_provider_invoice_id IS NOT NULL;
CREATE INDEX idx_invoices_period
    ON public.invoices(organization_id, period_start, period_end);

CREATE OR REPLACE FUNCTION private.on_update_invoice()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_invoice
    BEFORE UPDATE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION private.on_update_invoice();
CREATE OR REPLACE FUNCTION private.on_insert_invoices()     
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_invoices_inserted BEFORE INSERT ON public.invoices                     FOR EACH ROW EXECUTE FUNCTION private.on_insert_invoices();


CREATE TABLE public.invoice_line_items (
    id                            BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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

CREATE INDEX idx_invoice_line_items_invoice
    ON public.invoice_line_items(invoice_id);
CREATE OR REPLACE FUNCTION private.on_insert_invoice_line_items()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_invoice_line_items_inserted BEFORE INSERT ON public.invoice_line_items           FOR EACH ROW EXECUTE FUNCTION private.on_insert_invoice_line_items();


-- Credit notes adjust invoices without mutating them.
CREATE TABLE public.credit_notes (
    id                              BIGINT                    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
CREATE OR REPLACE FUNCTION private.on_insert_credit_notes() 
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_credit_notes_inserted BEFORE INSERT ON public.credit_notes                 FOR EACH ROW EXECUTE FUNCTION private.on_insert_credit_notes();

CREATE TABLE public.payments (
    id                                 BIGINT                  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    processed_at                       TIMESTAMPTZ,
    updated_at                         TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_org
    ON public.payments(organization_id);
CREATE INDEX idx_payments_invoice
    ON public.payments(invoice_id);
CREATE INDEX idx_payments_status
    ON public.payments(status);
CREATE INDEX idx_payments_provider_id
    ON public.payments(billing_provider_payment_id)
    WHERE billing_provider_payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.on_update_payment()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_payment
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION private.on_update_payment();
CREATE OR REPLACE FUNCTION private.on_insert_payments()     
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_payments_inserted BEFORE INSERT ON public.payments                     FOR EACH ROW EXECUTE FUNCTION private.on_insert_payments();


-- ================================================================
-- SUBSCRIPTION ENTITLEMENTS  (computed cache)
--
-- Rebuilt by recompute_entitlements() after any subscription or
-- addon change. Always check this table at runtime — never branch
-- on plan name or plan_version_id in application code.
-- ================================================================

CREATE TABLE public.subscription_entitlements (
    id              BIGINT                    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT                    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_id BIGINT                    NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    feature_id      BIGINT                    NOT NULL REFERENCES public.features(id)      ON DELETE CASCADE,
    feature_key     TEXT                      NOT NULL,  -- denormalized for hot-path lookup
    value_boolean   BOOLEAN,
    value_limit     BIGINT,                              -- -1 = unlimited
    is_unlimited    BOOLEAN                   NOT NULL DEFAULT FALSE,
    source          public.entitlement_source NOT NULL DEFAULT 'plan',
    computed_at     TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
    valid_until     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, subscription_id, feature_id)
);

CREATE INDEX idx_entitlements_org_feature
    ON public.subscription_entitlements(organization_id, feature_key);
CREATE INDEX idx_entitlements_subscription
    ON public.subscription_entitlements(subscription_id);
CREATE OR REPLACE FUNCTION private.on_insert_subscription_entitlements()    RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_subscription_entitlements_inserted    BEFORE INSERT ON public.subscription_entitlements    FOR EACH ROW EXECUTE FUNCTION private.on_insert_subscription_entitlements();

-- One row per discrete usage event. idempotency_key prevents
-- double-counting on retries / at-least-once delivery.
CREATE TABLE public.usage_records (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_id BIGINT      NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    feature_id      BIGINT      NOT NULL REFERENCES public.features(id)      ON DELETE RESTRICT,
    feature_key     TEXT        NOT NULL,  -- denormalized
    quantity        BIGINT      NOT NULL DEFAULT 1,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    idempotency_key TEXT        UNIQUE,
    metadata        JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_records_org_feature_period
    ON public.usage_records(organization_id, feature_key, period_start, period_end);
CREATE INDEX idx_usage_records_subscription
    ON public.usage_records(subscription_id, recorded_at);
CREATE OR REPLACE FUNCTION private.on_insert_usage_records()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_usage_records_inserted   BEFORE INSERT ON public.usage_records                FOR EACH ROW EXECUTE FUNCTION private.on_insert_usage_records();


-- Aggregated per billing period — maintained by trigger so
-- entitlement checks avoid a full SUM() scan.
CREATE TABLE public.usage_summaries (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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

CREATE INDEX idx_usage_summaries_org_feature
    ON public.usage_summaries(organization_id, feature_key);
CREATE INDEX idx_usage_summaries_subscription_period
    ON public.usage_summaries(subscription_id, period_start);
CREATE OR REPLACE FUNCTION private.on_insert_usage_summaries()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_usage_summaries_inserted BEFORE INSERT ON public.usage_summaries              FOR EACH ROW EXECUTE FUNCTION private.on_insert_usage_summaries();


CREATE OR REPLACE FUNCTION private.update_usage_summary()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.usage_summaries (
        organization_id, subscription_id, feature_id, feature_key,
        period_start, period_end, total_quantity, last_updated_at
    )
    VALUES (
        NEW.organization_id, NEW.subscription_id, NEW.feature_id, NEW.feature_key,
        NEW.period_start, NEW.period_end, NEW.quantity, NOW()
    )
    ON CONFLICT (organization_id, subscription_id, feature_id, period_start, period_end)
    DO UPDATE SET
        total_quantity  = usage_summaries.total_quantity + EXCLUDED.total_quantity,
        last_updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_usage_record_inserted
    AFTER INSERT ON public.usage_records
    FOR EACH ROW EXECUTE FUNCTION private.update_usage_summary();


-- ================================================================
-- DOMAIN EVENTS  (outbox / audit trail)
--
-- Emit after every state transition. Consumers (email, analytics,
-- CRM, provisioning) subscribe to these — no direct coupling.
-- ================================================================

CREATE TABLE public.subscription_events (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_id BIGINT      REFERENCES public.subscriptions(id)          ON DELETE SET NULL,
    type            TEXT        NOT NULL,  -- 'subscription.upgraded', 'invoice.paid', etc.
    payload         JSONB       NOT NULL DEFAULT '{}',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_events_org
    ON public.subscription_events(organization_id, occurred_at DESC);
CREATE INDEX idx_subscription_events_subscription
    ON public.subscription_events(subscription_id);
CREATE INDEX idx_subscription_events_type
    ON public.subscription_events(type, occurred_at DESC);
CREATE OR REPLACE FUNCTION private.on_insert_subscription_events()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_subscription_events_inserted    BEFORE INSERT ON public.subscription_events          FOR EACH ROW EXECUTE FUNCTION private.on_insert_subscription_events();


-- ================================================================
-- BILLING PROVIDER WEBHOOK EVENTS
--
-- Every inbound Stripe/Paddle webhook lands here first.
-- Processing is idempotent on (billing_provider, event_id).
-- Never trust frontend payment success — wait for this.
-- ================================================================

CREATE TABLE public.billing_webhook_events (
    id               BIGINT                      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    billing_provider public.billing_provider     NOT NULL,
    event_type       TEXT                        NOT NULL,
    event_id         TEXT                        NOT NULL,  -- provider's own event ID
    payload          JSONB                       NOT NULL DEFAULT '{}',
    status           public.webhook_event_status NOT NULL DEFAULT 'pending',
    processed_at     TIMESTAMPTZ,
    failure_reason   TEXT,
    retry_count      SMALLINT                    NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    UNIQUE (billing_provider, event_id)
);
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_webhook_events_status
    ON public.billing_webhook_events(status, created_at);
CREATE INDEX idx_webhook_events_provider_type
    ON public.billing_webhook_events(billing_provider, event_type);
CREATE OR REPLACE FUNCTION private.on_insert_billing_webhook_events()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_billing_webhook_events_inserted BEFORE INSERT ON public.billing_webhook_events       FOR EACH ROW EXECUTE FUNCTION private.on_insert_billing_webhook_events();


-- ================================================================
-- IDEMPOTENCY KEYS
--
-- Shared across all money-touching writes.
-- locked_at enables in-flight deduplication (optimistic lock).
-- ================================================================

CREATE TABLE public.idempotency_keys (
    key             TEXT        PRIMARY KEY,
    request_path    TEXT        NOT NULL,
    request_hash    TEXT        NOT NULL,
    response_status INTEGER,
    response_body   JSONB,
    locked_at       TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_idempotency_keys_expires
    ON public.idempotency_keys(expires_at);
CREATE OR REPLACE FUNCTION private.on_insert_idempotency_keys()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_idempotency_keys_inserted BEFORE INSERT ON public.idempotency_keys             FOR EACH ROW EXECUTE FUNCTION private.on_insert_idempotency_keys();


-- ================================================================
-- ENTERPRISE CONTRACTS
-- ================================================================

CREATE TABLE public.subscription_contracts (
    id                  BIGINT                 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id     BIGINT                 NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    subscription_id     BIGINT                 REFERENCES public.subscriptions(id)          ON DELETE SET NULL,
    status              public.contract_status NOT NULL DEFAULT 'draft',
    start_date          DATE                   NOT NULL,
    end_date            DATE,
    custom_pricing      JSONB                  NOT NULL DEFAULT '{}',
    negotiated_features JSONB                  NOT NULL DEFAULT '{}',
    sla_tier            TEXT,
    document_url        TEXT,
    signed_at           TIMESTAMPTZ,
    signed_by_account_id BIGINT                 REFERENCES public.accounts(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contracts_org
    ON public.subscription_contracts(organization_id);
CREATE INDEX idx_contracts_subscription
    ON public.subscription_contracts(subscription_id);

CREATE OR REPLACE FUNCTION private.on_update_subscription_contract() 
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_subscription_contract
    BEFORE UPDATE ON public.subscription_contracts
    FOR EACH ROW EXECUTE FUNCTION private.on_update_subscription_contract();
CREATE OR REPLACE FUNCTION private.on_insert_subscription_contracts()
	RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_subscription_contracts_inserted BEFORE INSERT ON public.subscription_contracts FOR EACH ROW EXECUTE FUNCTION private.on_insert_subscription_contracts();

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read active public plans"
    ON public.plans FOR SELECT
    TO authenticated
    USING (is_active = TRUE AND is_public = TRUE);

ALTER TABLE public.plan_versions ENABLE ROW LEVEL SECURITY;

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

ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read active features"
    ON public.features FOR SELECT
    TO authenticated
    USING (is_active = TRUE);

ALTER TABLE public.plan_feature_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read plan entitlements"
    ON public.plan_feature_entitlements FOR SELECT
    TO authenticated
    USING (TRUE);

ALTER TABLE public.addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read active addons"
    ON public.addons FOR SELECT
    TO authenticated
    USING (is_active = TRUE);

ALTER TABLE public.addon_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read active addon versions"
    ON public.addon_versions FOR SELECT
    TO authenticated
    USING (is_active = TRUE);

ALTER TABLE public.addon_feature_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read addon entitlements"
    ON public.addon_feature_entitlements FOR SELECT
    TO authenticated
    USING (TRUE);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow billing role to view subscriptions"
    ON public.subscriptions FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id));

ALTER TABLE public.subscription_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow billing role to view subscription addons"
    ON public.subscription_addons FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.subscriptions s
            WHERE s.id = subscription_id
              AND private.is_org_billing(s.organization_id)
        )
    );

ALTER TABLE public.subscription_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow billing role to view change requests"
    ON public.subscription_change_requests FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id));

CREATE POLICY "Allow billing role to create change requests"
    ON public.subscription_change_requests FOR INSERT
    TO authenticated
    WITH CHECK (
        private.is_org_billing(organization_id)
        AND requested_by_account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
    );

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow billing role to view invoices"
    ON public.invoices FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id));

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow billing role to view invoice line items"
    ON public.invoice_line_items FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.invoices i
            WHERE i.id = invoice_id
              AND private.is_org_billing(i.organization_id)
        )
    );

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow billing role to view credit notes"
    ON public.credit_notes FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id));

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow billing role to view payments"
    ON public.payments FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id));

ALTER TABLE public.subscription_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow org members to read their entitlements"
    ON public.subscription_entitlements FOR SELECT
    TO authenticated
    USING (private.is_org_member(organization_id));

ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow org members to view usage records"
    ON public.usage_records FOR SELECT
    TO authenticated
    USING (private.is_org_member(organization_id));

ALTER TABLE public.usage_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow org members to view usage summaries"
    ON public.usage_summaries FOR SELECT
    TO authenticated
    USING (private.is_org_member(organization_id));

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow billing role to view subscription events"
    ON public.subscription_events FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id));

ALTER TABLE public.subscription_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow billing role to view contracts"
    ON public.subscription_contracts FOR SELECT
    TO authenticated
    USING (private.is_org_billing(organization_id));


-- ================================================================
-- ENTITLEMENT RECOMPUTE
--
-- Call after: subscription created/changed, addon added/removed,
-- or any override/promotion applied.
--
-- Merge strategy:
--   plan grants are the baseline
--   addon grants are layered on top:
--     limits  → GREATEST(plan, addon), -1 (unlimited) always wins
--     boolean → TRUE wins (OR)
-- ================================================================

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

REVOKE EXECUTE ON FUNCTION private.recompute_entitlements(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.recompute_entitlements(BIGINT) TO service_role;

