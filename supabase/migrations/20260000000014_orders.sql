-- ================================================================
-- ORDERS, FULFILLMENT & MARKETPLACE FINANCIALS
--
-- Module overview:
--   orders              — immutable purchase record (never recalculate)
--   order_items         — frozen line items with captured title/sku/price
--   order_events        — append-only audit trail for state machine
--   commissions         — platform fee per order_item
--   shipments           — one or more per order (supports partial shipment)
--   shipment_items      — maps order_items → shipments
--   returns             — return requests from buyer
--   return_items        — which items + quantities are being returned
--   refunds             — monetary refund records (references payments)
--   seller_payouts      — payout request to transfer seller wallet → bank
--   seller_reviews      — buyer reviews seller after delivery
--   listing_reviews     — buyer reviews a specific listing after purchase
--
-- Integration points:
--   * payments (migration 7): extended with order_id + buyer_account_id
--     columns via ALTER TABLE so marketplace orders bind to a payment record
--   * wallets (migration 10): commissions/payouts move money via
--     wallet_transfer, spend_from_wallet, deposit_to_wallet
--   * notification_events (migration 4): order.placed, order.shipped,
--     order.delivered, return.requested, refund.issued events
--   * inventory_transactions (migration 11): stock decremented on order
--     confirmation, incremented on return
--   * inventory_reservations (migration 12): consumed on order confirmation,
--     released on cancellation
-- ================================================================


-- ================================================================
-- ENUMS
-- ================================================================

CREATE TYPE public.order_status AS ENUM (
    'draft',
    'pending_payment',
    'paid',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
    'refunded'
);

CREATE TYPE public.shipment_status AS ENUM (
    'pending',
    'packed',
    'shipped',
    'delivered',
    'returned'
);

CREATE TYPE public.return_status AS ENUM (
    'requested',
    'approved',
    'rejected',
    'received',
    'completed'
);

CREATE TYPE public.refund_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);

CREATE TYPE public.payout_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


-- ================================================================
-- ORDER NUMBER SEQUENCE  (user-visible, human-friendly)
-- ================================================================
DROP SEQUENCE IF EXISTS public.order_number_seq;
CREATE SEQUENCE public.order_number_seq START 10000 INCREMENT 1;


-- ================================================================
-- ORDERS  (immutable — never recalculate from current product state)
-- ================================================================

CREATE TABLE public.orders (
    id                  BIGINT             GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                 UUID               NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    order_number        TEXT               NOT NULL UNIQUE DEFAULT ('ORD-' || nextval('public.order_number_seq')),
    buyer_account_id    BIGINT             NOT NULL REFERENCES public.accounts(id)          ON DELETE RESTRICT,
    checkout_session_id BIGINT             REFERENCES public.checkout_sessions(id)          ON DELETE SET NULL,
    status              public.order_status NOT NULL DEFAULT 'pending_payment',
    currency            CHAR(3)            NOT NULL DEFAULT 'USD',
    subtotal            NUMERIC(20,4)      NOT NULL DEFAULT 0,
    tax                 NUMERIC(20,4)      NOT NULL DEFAULT 0,
    discount            NUMERIC(20,4)      NOT NULL DEFAULT 0,
    shipping            NUMERIC(20,4)      NOT NULL DEFAULT 0,
    total               NUMERIC(20,4)      NOT NULL DEFAULT 0,
    shipping_address    JSONB              NOT NULL DEFAULT '{}',
    metadata            JSONB              NOT NULL DEFAULT '{}',
    paid_at             TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.orders TO authenticated, service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_orders_buyer      ON public.orders(buyer_account_id, created_at DESC);
CREATE INDEX idx_orders_status     ON public.orders(status);
CREATE INDEX idx_orders_checkout   ON public.orders(checkout_session_id) WHERE checkout_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.on_insert_orders()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_orders
    BEFORE INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_orders();

-- ================================================================
-- EXTEND PAYMENTS TABLE (migration 7)
--
-- Placed here (after orders table) so the order_id FK can reference
-- public.orders. buyer_account_id references accounts which already
-- exists but is included in the same ALTER for atomicity.
-- Both columns are nullable to preserve compatibility with existing
-- subscription/billing payments that predate the marketplace.
-- ================================================================

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS order_id         BIGINT REFERENCES public.orders(id)   ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS buyer_account_id BIGINT REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_order   ON public.payments(order_id)         WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_buyer   ON public.payments(buyer_account_id) WHERE buyer_account_id IS NOT NULL;


-- ================================================================
-- ORDER ITEMS  (frozen snapshot — product details copied at order time)
-- ================================================================

CREATE TABLE public.order_items (
    id               BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    order_id         BIGINT        NOT NULL REFERENCES public.orders(id)           ON DELETE RESTRICT,
    listing_id       BIGINT        NOT NULL REFERENCES public.listings(id)         ON DELETE RESTRICT,
    seller_id        BIGINT        NOT NULL REFERENCES public.seller_profiles(id)  ON DELETE RESTRICT,
    variant_id       BIGINT        REFERENCES public.product_variants(id)          ON DELETE SET NULL,
    snapshot_title   TEXT          NOT NULL CHECK (char_length(snapshot_title) BETWEEN 1 AND 500),
    snapshot_sku     TEXT          CHECK (char_length(snapshot_sku) <= 100),
    unit_price       NUMERIC(20,4) NOT NULL CHECK (unit_price >= 0),
    quantity         INT           NOT NULL DEFAULT 1 CHECK (quantity > 0),
    tax              NUMERIC(20,4) NOT NULL DEFAULT 0,
    discount         NUMERIC(20,4) NOT NULL DEFAULT 0,
    line_total       NUMERIC(20,4) NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.order_items TO authenticated, service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_order_items_order   ON public.order_items(order_id);
CREATE INDEX idx_order_items_seller  ON public.order_items(seller_id);
CREATE INDEX idx_order_items_listing ON public.order_items(listing_id);

CREATE OR REPLACE FUNCTION private.on_insert_order_items()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_order_items
    BEFORE INSERT ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_order_items();


-- ================================================================
-- ORDER EVENTS  (immutable audit trail / state machine log)
-- ================================================================

CREATE TABLE public.order_events (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    order_id   BIGINT      NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    event_type TEXT        NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 100),
    payload    JSONB       NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.order_events TO authenticated, service_role;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_order_events_order ON public.order_events(order_id, created_at DESC);
CREATE INDEX idx_order_events_type  ON public.order_events(event_type);

CREATE OR REPLACE FUNCTION private.on_insert_order_events()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_order_events
    BEFORE INSERT ON public.order_events
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_order_events();


-- ================================================================
-- COMMISSIONS  (platform fee per order_item)
--
-- Actual money movement happens via wallet_spend from seller wallet
-- to platform_fee ledger account (migration 10). This table records
-- the amounts for reporting and reconciliation.
-- ================================================================

CREATE TABLE public.commissions (
    id            BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid           UUID          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    order_item_id BIGINT        NOT NULL UNIQUE REFERENCES public.order_items(id) ON DELETE RESTRICT,
    seller_id     BIGINT        NOT NULL REFERENCES public.seller_profiles(id)    ON DELETE RESTRICT,
    percentage    NUMERIC(5,2)  NOT NULL CHECK (percentage BETWEEN 0 AND 100),
    amount        NUMERIC(20,4) NOT NULL CHECK (amount >= 0),
    currency      CHAR(3)       NOT NULL DEFAULT 'USD',
    journal_entry_id BIGINT     REFERENCES public.journal_entries(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.commissions TO authenticated, service_role;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_commissions_order_item ON public.commissions(order_item_id);
CREATE INDEX idx_commissions_seller     ON public.commissions(seller_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.on_insert_commissions()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_commissions
    BEFORE INSERT ON public.commissions
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_commissions();


-- ================================================================
-- SHIPMENTS  (one or more per order — supports partial shipment)
-- ================================================================

CREATE TABLE public.shipments (
    id              BIGINT                  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID                    NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    order_id        BIGINT                  NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    seller_id       BIGINT                  NOT NULL REFERENCES public.seller_profiles(id) ON DELETE RESTRICT,
    status          public.shipment_status  NOT NULL DEFAULT 'pending',
    carrier         TEXT                    CHECK (char_length(carrier) <= 100),
    tracking_number TEXT                    CHECK (char_length(tracking_number) <= 255),
    tracking_url    TEXT                    CHECK (char_length(tracking_url) <= 2048),
    shipped_at      TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    metadata        JSONB                   NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.shipments TO authenticated, service_role;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_shipments_order  ON public.shipments(order_id);
CREATE INDEX idx_shipments_seller ON public.shipments(seller_id);
CREATE INDEX idx_shipments_status ON public.shipments(status);

CREATE OR REPLACE FUNCTION private.on_insert_shipments()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_shipments
    BEFORE INSERT ON public.shipments
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_shipments();


-- ================================================================
-- SHIPMENT ITEMS  (which order_items are in which shipment)
-- ================================================================

CREATE TABLE public.shipment_items (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shipment_id   BIGINT NOT NULL REFERENCES public.shipments(id)    ON DELETE CASCADE,
    order_item_id BIGINT NOT NULL REFERENCES public.order_items(id)  ON DELETE RESTRICT,
    quantity      INT    NOT NULL DEFAULT 1 CHECK (quantity > 0),
    UNIQUE (shipment_id, order_item_id)
);
GRANT ALL ON TABLE public.shipment_items TO authenticated, service_role;
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_shipment_items_order_item ON public.shipment_items(order_item_id);


-- ================================================================
-- RETURNS
-- ================================================================

CREATE TABLE public.returns (
    id         BIGINT               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID                 NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    order_id   BIGINT               NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    status     public.return_status NOT NULL DEFAULT 'requested',
    reason     TEXT                 CHECK (char_length(reason) <= 1000),
    approved_at  TIMESTAMPTZ,
    received_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.returns TO authenticated, service_role;
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_returns_order  ON public.returns(order_id);
CREATE INDEX idx_returns_status ON public.returns(status);

CREATE OR REPLACE FUNCTION private.on_insert_returns()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_returns
    BEFORE INSERT ON public.returns
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_returns();


-- ================================================================
-- RETURN ITEMS
-- ================================================================

CREATE TABLE public.return_items (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    return_id     BIGINT NOT NULL REFERENCES public.returns(id)     ON DELETE CASCADE,
    order_item_id BIGINT NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
    quantity      INT    NOT NULL DEFAULT 1 CHECK (quantity > 0),
    reason        TEXT   CHECK (char_length(reason) <= 500),
    UNIQUE (return_id, order_item_id)
);
GRANT ALL ON TABLE public.return_items TO authenticated, service_role;
ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_return_items_order_item ON public.return_items(order_item_id);


-- ================================================================
-- REFUNDS
--
-- References the original payment so the payment provider refund
-- flow can be initiated. Actual wallet credit goes through
-- deposit_to_wallet (migration 10). journal_entry_id links the
-- double-entry record when refund is processed.
-- ================================================================

CREATE TABLE public.refunds (
    id               BIGINT               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID                 NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    payment_id       BIGINT               NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
    return_id        BIGINT               REFERENCES public.returns(id)           ON DELETE SET NULL,
    amount           NUMERIC(20,4)        NOT NULL CHECK (amount > 0),
    currency         CHAR(3)              NOT NULL DEFAULT 'USD',
    status           public.refund_status NOT NULL DEFAULT 'pending',
    reason           TEXT                 CHECK (char_length(reason) <= 1000),
    journal_entry_id BIGINT               REFERENCES public.journal_entries(id)   ON DELETE SET NULL,
    processed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.refunds TO authenticated, service_role;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_refunds_payment ON public.refunds(payment_id);
CREATE INDEX idx_refunds_return  ON public.refunds(return_id) WHERE return_id IS NOT NULL;
CREATE INDEX idx_refunds_status  ON public.refunds(status);

CREATE OR REPLACE FUNCTION private.on_insert_refunds()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_refunds
    BEFORE INSERT ON public.refunds
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_refunds();


-- ================================================================
-- SELLER PAYOUTS
--
-- Tracks a payout request; actual transfer from seller wallet to
-- bank ledger account is done via private.spend_from_wallet
-- (migration 10). journal_entry_id is set once the transfer posts.
-- ================================================================

CREATE TABLE public.seller_payouts (
    id               BIGINT               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID                 NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    seller_id        BIGINT               NOT NULL REFERENCES public.seller_profiles(id) ON DELETE RESTRICT,
    wallet_id        BIGINT               NOT NULL REFERENCES public.wallets(id)          ON DELETE RESTRICT,
    amount           NUMERIC(20,4)        NOT NULL CHECK (amount > 0),
    currency         CHAR(3)              NOT NULL DEFAULT 'USD',
    status           public.payout_status NOT NULL DEFAULT 'pending',
    journal_entry_id BIGINT               REFERENCES public.journal_entries(id) ON DELETE SET NULL,
    payout_method    TEXT                 CHECK (char_length(payout_method) <= 50),
    payout_reference TEXT                 CHECK (char_length(payout_reference) <= 255),
    scheduled_for    TIMESTAMPTZ,
    processed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.seller_payouts TO authenticated, service_role;
ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_seller_payouts_seller ON public.seller_payouts(seller_id, created_at DESC);
CREATE INDEX idx_seller_payouts_status ON public.seller_payouts(status);

CREATE OR REPLACE FUNCTION private.on_insert_seller_payouts()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_seller_payouts
    BEFORE INSERT ON public.seller_payouts
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_seller_payouts();


-- ================================================================
-- SELLER REVIEWS  (buyer reviews seller post-delivery; one per order)
-- ================================================================

CREATE TABLE public.seller_reviews (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    seller_id  BIGINT      NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
    buyer_id   BIGINT      NOT NULL REFERENCES public.accounts(id)         ON DELETE CASCADE,
    order_id   BIGINT      NOT NULL REFERENCES public.orders(id)           ON DELETE RESTRICT,
    rating     SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review     TEXT        CHECK (char_length(review) <= 5000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (seller_id, order_id)
);
GRANT ALL ON TABLE public.seller_reviews TO authenticated, service_role;
ALTER TABLE public.seller_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_seller_reviews_seller ON public.seller_reviews(seller_id, created_at DESC);
CREATE INDEX idx_seller_reviews_buyer  ON public.seller_reviews(buyer_id);
CREATE INDEX idx_seller_reviews_order  ON public.seller_reviews(order_id);

CREATE OR REPLACE FUNCTION private.on_insert_seller_reviews()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_seller_reviews
    BEFORE INSERT ON public.seller_reviews
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_seller_reviews();

-- Keep seller_profiles.rating and review_count in sync
CREATE OR REPLACE FUNCTION private.on_seller_review_inserted()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.seller_profiles
    SET    review_count = review_count + 1,
           rating = (
               SELECT ROUND(AVG(rating)::NUMERIC, 2)
               FROM   public.seller_reviews
               WHERE  seller_id = NEW.seller_id
           )
    WHERE  id = NEW.seller_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
CREATE TRIGGER on_seller_review_inserted
    AFTER INSERT ON public.seller_reviews
    FOR EACH ROW EXECUTE FUNCTION private.on_seller_review_inserted();


-- ================================================================
-- LISTING REVIEWS  (buyer reviews listing after purchase)
-- ================================================================

CREATE TABLE public.listing_reviews (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    listing_id BIGINT      NOT NULL REFERENCES public.listings(id)  ON DELETE CASCADE,
    buyer_id   BIGINT      NOT NULL REFERENCES public.accounts(id)  ON DELETE CASCADE,
    order_id   BIGINT      NOT NULL REFERENCES public.orders(id)    ON DELETE RESTRICT,
    rating     SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review     TEXT        CHECK (char_length(review) <= 5000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (listing_id, order_id)
);
GRANT ALL ON TABLE public.listing_reviews TO authenticated, service_role;
ALTER TABLE public.listing_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_listing_reviews_listing ON public.listing_reviews(listing_id, created_at DESC);
CREATE INDEX idx_listing_reviews_buyer   ON public.listing_reviews(buyer_id);

CREATE OR REPLACE FUNCTION private.on_insert_listing_reviews()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_listing_reviews
    BEFORE INSERT ON public.listing_reviews
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_listing_reviews();


-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

-- orders: buyers see own orders; sellers see orders containing their items
CREATE POLICY "Buyers can view own orders"
    ON public.orders FOR SELECT TO authenticated
    USING (private.owns_account(buyer_account_id));

CREATE POLICY "Sellers can view orders containing their items"
    ON public.orders FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM   public.order_items oi
            JOIN   public.seller_profiles sp ON sp.id = oi.seller_id
            JOIN   public.accounts a         ON a.id  = sp.account_id
            WHERE  oi.order_id = public.orders.id
              AND  a.user_id   = auth.uid()
        )
    );

-- order_items
CREATE POLICY "Buyers can view own order items"
    ON public.order_items FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND private.owns_account(o.buyer_account_id)
        )
    );

CREATE POLICY "Sellers can view their own order items"
    ON public.order_items FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.seller_profiles sp
            JOIN public.accounts a ON a.id = sp.account_id
            WHERE sp.id = seller_id AND a.user_id = auth.uid()
        )
    );

-- order_events
CREATE POLICY "Buyers can view events for own orders"
    ON public.order_events FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND private.owns_account(o.buyer_account_id)
        )
    );

-- commissions: sellers see own commissions
CREATE POLICY "Sellers can view own commissions"
    ON public.commissions FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.seller_profiles sp
            JOIN public.accounts a ON a.id = sp.account_id
            WHERE sp.id = seller_id AND a.user_id = auth.uid()
        )
    );

-- shipments: buyers and sellers can view relevant shipments
CREATE POLICY "Buyers can view shipments for own orders"
    ON public.shipments FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND private.owns_account(o.buyer_account_id)
        )
    );

CREATE POLICY "Sellers can view own shipments"
    ON public.shipments FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.seller_profiles sp
            JOIN public.accounts a ON a.id = sp.account_id
            WHERE sp.id = seller_id AND a.user_id = auth.uid()
        )
    );

CREATE POLICY "Sellers can manage own shipments"
    ON public.shipments FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.seller_profiles sp
            JOIN public.accounts a ON a.id = sp.account_id
            WHERE sp.id = seller_id AND a.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.seller_profiles sp
            JOIN public.accounts a ON a.id = sp.account_id
            WHERE sp.id = seller_id AND a.user_id = auth.uid()
        )
    );

-- shipment_items
CREATE POLICY "Buyers and sellers can view shipment items"
    ON public.shipment_items FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shipments s
            JOIN public.orders o ON o.id = s.order_id
            WHERE s.id = shipment_id
              AND (
                  private.owns_account(o.buyer_account_id)
                  OR EXISTS (
                      SELECT 1 FROM public.seller_profiles sp
                      JOIN public.accounts a ON a.id = sp.account_id
                      WHERE sp.id = s.seller_id AND a.user_id = auth.uid()
                  )
              )
        )
    );

-- returns
CREATE POLICY "Buyers can view own returns"
    ON public.returns FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND private.owns_account(o.buyer_account_id)
        )
    );

CREATE POLICY "Buyers can create returns for own orders"
    ON public.returns FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND private.owns_account(o.buyer_account_id)
        )
    );

-- return_items
CREATE POLICY "Buyers can view own return items"
    ON public.return_items FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.returns r
            JOIN public.orders o ON o.id = r.order_id
            WHERE r.id = return_id AND private.owns_account(o.buyer_account_id)
        )
    );

-- refunds
CREATE POLICY "Buyers can view own refunds"
    ON public.refunds FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.payments p
            WHERE p.id = payment_id AND private.owns_account(p.buyer_account_id)
        )
    );

-- seller_payouts
CREATE POLICY "Sellers can view own payouts"
    ON public.seller_payouts FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.seller_profiles sp
            JOIN public.accounts a ON a.id = sp.account_id
            WHERE sp.id = seller_id AND a.user_id = auth.uid()
        )
    );

-- reviews: both visible publicly, writable only by buyer
CREATE POLICY "Anyone can view seller reviews"
    ON public.seller_reviews FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Buyers can write seller reviews for own orders"
    ON public.seller_reviews FOR INSERT TO authenticated
    WITH CHECK (private.owns_account(buyer_id));

CREATE POLICY "Anyone can view listing reviews"
    ON public.listing_reviews FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Buyers can write listing reviews for own orders"
    ON public.listing_reviews FOR INSERT TO authenticated
    WITH CHECK (private.owns_account(buyer_id));


-- ================================================================
-- NOTIFICATION TEMPLATES (order & fulfillment events)
-- ================================================================

INSERT INTO public.notification_templates
    (type, channel, locale, version, is_active, subject_template, body_template)
VALUES
(
    'order.placed',
    'in_app', 'en', 1, true, NULL,
    'Your order #{{order_number}} has been placed successfully.'
),
(
    'order.placed',
    'email', 'en', 1, true,
    'Order confirmed: #{{order_number}}',
    '<p>Hi {{name}},</p><p>Your order <strong>#{{order_number}}</strong> has been confirmed.</p><p>Total: <strong>{{currency}} {{total}}</strong></p>'
),
(
    'order.seller_new_order',
    'in_app', 'en', 1, true, NULL,
    'New order #{{order_number}} received for "{{listing_title}}".'
),
(
    'order.shipped',
    'in_app', 'en', 1, true, NULL,
    'Your order #{{order_number}} has shipped. Tracking: {{tracking_number}}.'
),
(
    'order.shipped',
    'email', 'en', 1, true,
    'Your order #{{order_number}} is on its way!',
    '<p>Hi {{name}},</p><p>Your order <strong>#{{order_number}}</strong> has shipped.</p><p>Carrier: {{carrier}}<br>Tracking: <a href="{{tracking_url}}">{{tracking_number}}</a></p>'
),
(
    'order.delivered',
    'in_app', 'en', 1, true, NULL,
    'Your order #{{order_number}} has been delivered. Leave a review!'
),
(
    'return.requested',
    'in_app', 'en', 1, true, NULL,
    'Return request for order #{{order_number}} has been submitted.'
),
(
    'refund.issued',
    'in_app', 'en', 1, true, NULL,
    'Refund of {{currency}} {{amount}} for order #{{order_number}} has been issued.'
),
(
    'refund.issued',
    'email', 'en', 1, true,
    'Refund issued for order #{{order_number}}',
    '<p>Hi {{name}},</p><p>A refund of <strong>{{currency}} {{amount}}</strong> for order <strong>#{{order_number}}</strong> has been processed.</p>'
),
(
    'payout.completed',
    'in_app', 'en', 1, true, NULL,
    'Payout of {{currency}} {{amount}} has been sent to your account.'
);


-- ================================================================
-- RBAC PERMISSIONS FOR MARKETPLACE
-- ================================================================

INSERT INTO public.permissions (key, name, description, scope) VALUES
    ('listing.create',       'Create Listing',         'Create new marketplace listings',          'organization'),
    ('listing.manage',       'Manage Listings',         'Edit, publish, and delete own listings',   'organization'),
    ('order.view',           'View Orders',             'View own orders as buyer or seller',       'organization'),
    ('order.manage',         'Manage Orders',           'Process, ship, and update orders',         'organization'),
    ('marketplace.moderate', 'Moderate Marketplace',    'Admin-level marketplace moderation',       'platform')
ON CONFLICT (key) DO NOTHING;
