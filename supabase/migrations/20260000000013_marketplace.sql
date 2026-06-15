-- ================================================================
-- MARKETPLACE: SELLERS, LISTINGS & AUCTIONS
--
-- Module overview:
--   seller_profiles         — account opt-in to sell
--   listings                — what sellers are offering (fixed_price or auction)
--   listing_images          — ordered image gallery per listing
--   listing_attributes      — freeform key/value for condition, warranty, etc.
--   auctions                — auction config for auction-type listings
--   auction_bids            — every bid stored (ledger-style, never mutated)
--   proxy_bids              — max-bid amounts for automatic bidding (eBay-style)
--   auction_statistics      — cached highest-bid snapshot; updated by trigger
--   listing_watchers        — watchlist / saved listings
--   carts                   — buyer shopping cart (one active per account)
--   cart_items              — items in a cart; totals computed dynamically
--   checkout_sessions       — frozen price snapshot when checkout begins
--   checkout_items          — line items with captured unit price
--   inventory_reservations  — holds stock during checkout / auction win
--   promotions              — discount codes and automatic promotions
--   promotion_redemptions   — usage ledger per customer/order
--
-- Integration points:
--   * Buyer-seller messaging: create a conversation with target_type='listing'
--     using existing conversations + conversation_targets tables (migration 8)
--   * Notifications: fire notification_events (migration 4) for bid placed,
--     outbid, auction ending, auction won, etc.
--   * Seller wallet: use existing wallets with owner_type='account' (migration 10)
--   * Inventory stock: ledger in inventory_transactions (migration 11)
-- ================================================================


-- ================================================================
-- ENUMS
-- ================================================================

CREATE TYPE public.listing_type AS ENUM (
    'fixed_price',
    'auction'
);

CREATE TYPE public.listing_status AS ENUM (
    'draft',
    'active',
    'sold',
    'ended',
    'ended_no_sale',
    'cancelled'
);

CREATE TYPE public.auction_status AS ENUM (
    'scheduled',
    'active',
    'ended',
    'cancelled'
);

CREATE TYPE public.cart_status AS ENUM (
    'active',
    'converted',
    'abandoned'
);

CREATE TYPE public.checkout_status AS ENUM (
    'pending',
    'payment_pending',
    'completed',
    'expired',
    'cancelled'
);

CREATE TYPE public.reservation_status AS ENUM (
    'active',
    'released',
    'consumed',
    'expired'
);

CREATE TYPE public.promotion_type AS ENUM (
    'percentage',
    'fixed_amount',
    'free_shipping'
);


-- ================================================================
-- SELLER PROFILES
-- ================================================================

CREATE TABLE public.seller_profiles (
    id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid          UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    account_id   BIGINT      NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
    display_name TEXT        NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 255),
    bio          TEXT        CHECK (char_length(bio) <= 2000),
    status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
    rating       NUMERIC(3,2) CHECK (rating BETWEEN 0 AND 5),
    review_count INT          NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.seller_profiles TO authenticated, service_role;
ALTER TABLE public.seller_profiles ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_seller_profiles_account ON public.seller_profiles(account_id);
CREATE INDEX idx_seller_profiles_status  ON public.seller_profiles(status);

CREATE OR REPLACE FUNCTION private.on_insert_seller_profiles()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_seller_profiles
    BEFORE INSERT ON public.seller_profiles
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_seller_profiles();


-- ================================================================
-- LISTINGS
--
-- variant_id is nullable: a listing may reference a catalog variant
-- (migration 11) or be a standalone item with its own title/description.
-- ================================================================

CREATE TABLE public.listings (
    id           BIGINT                GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid          UUID                  NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    seller_id    BIGINT                NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
    variant_id   BIGINT                REFERENCES public.product_variants(id) ON DELETE SET NULL,
    listing_type public.listing_type   NOT NULL DEFAULT 'fixed_price',
    status       public.listing_status NOT NULL DEFAULT 'draft',
    title        TEXT                  NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
    description  TEXT                  CHECK (char_length(description) <= 10000),
    price        NUMERIC(20,4)         CHECK (price >= 0),
    currency     CHAR(3)               NOT NULL DEFAULT 'USD',
    quantity     INT                   NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    metadata     JSONB                 NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.listings TO authenticated, service_role;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_listings_seller   ON public.listings(seller_id);
CREATE INDEX idx_listings_variant  ON public.listings(variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX idx_listings_status   ON public.listings(status);
CREATE INDEX idx_listings_type     ON public.listings(listing_type, status);
CREATE INDEX idx_listings_title_fts ON public.listings USING gin(title gin_trgm_ops);

CREATE OR REPLACE FUNCTION private.on_insert_listings()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_listings
    BEFORE INSERT ON public.listings
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_listings();

CREATE OR REPLACE FUNCTION private.on_update_listings()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_listings
    BEFORE UPDATE ON public.listings
    FOR EACH ROW EXECUTE FUNCTION private.on_update_listings();

-- Helper: true when the calling user owns the listing (via their seller profile)
CREATE OR REPLACE FUNCTION private.owns_listing(p_listing_id BIGINT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM   public.listings l
        JOIN   public.seller_profiles sp ON sp.id = l.seller_id
        JOIN   public.accounts a         ON a.id  = sp.account_id
        WHERE  l.id      = p_listing_id
          AND  a.user_id = auth.uid()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


-- ================================================================
-- LISTING IMAGES
-- ================================================================

CREATE TABLE public.listing_images (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    listing_id  BIGINT      NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
    url         TEXT        NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
    sort_order  INT         NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.listing_images TO authenticated, service_role;
ALTER TABLE public.listing_images ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_listing_images_listing ON public.listing_images(listing_id, sort_order);

CREATE OR REPLACE FUNCTION private.on_insert_listing_images()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_listing_images
    BEFORE INSERT ON public.listing_images
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_listing_images();


-- ================================================================
-- LISTING ATTRIBUTES  (freeform key/value, e.g. condition, warranty)
-- ================================================================

CREATE TABLE public.listing_attributes (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    listing_id BIGINT      NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    value      TEXT        NOT NULL CHECK (char_length(value) BETWEEN 1 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (listing_id, name)
);
GRANT ALL ON TABLE public.listing_attributes TO authenticated, service_role;
ALTER TABLE public.listing_attributes ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_listing_attrs_listing ON public.listing_attributes(listing_id);

CREATE OR REPLACE FUNCTION private.on_insert_listing_attributes()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_listing_attributes
    BEFORE INSERT ON public.listing_attributes
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_listing_attributes();


-- ================================================================
-- AUCTIONS
--
-- One row per auction-type listing (enforced by UNIQUE on listing_id).
-- reserve_price: minimum acceptable final bid (invisible to bidders).
-- buy_now_price: bypasses auction and converts listing to immediate sale.
-- extension_minutes: anti-sniping — extends end_time if bid arrives late.
-- ================================================================

CREATE TABLE public.auctions (
    id                BIGINT               GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid               UUID                 NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    listing_id        BIGINT               NOT NULL UNIQUE REFERENCES public.listings(id) ON DELETE CASCADE,
    status            public.auction_status NOT NULL DEFAULT 'scheduled',
    start_time        TIMESTAMPTZ          NOT NULL,
    end_time          TIMESTAMPTZ          NOT NULL,
    original_end_time TIMESTAMPTZ          NOT NULL,
    starting_price    NUMERIC(20,4)        NOT NULL DEFAULT 0 CHECK (starting_price >= 0),
    reserve_price     NUMERIC(20,4)        CHECK (reserve_price >= 0),
    buy_now_price     NUMERIC(20,4)        CHECK (buy_now_price >= 0),
    minimum_increment NUMERIC(20,4)        NOT NULL DEFAULT 1 CHECK (minimum_increment > 0),
    extension_minutes INT                  NOT NULL DEFAULT 10 CHECK (extension_minutes >= 0),
    extended_count    INT                  NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.auctions TO authenticated, service_role;
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_auctions_listing ON public.auctions(listing_id);
CREATE INDEX idx_auctions_status  ON public.auctions(status, end_time);

CREATE OR REPLACE FUNCTION private.on_insert_auctions()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    NEW.original_end_time = NEW.end_time;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_auctions
    BEFORE INSERT ON public.auctions
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_auctions();


-- ================================================================
-- AUCTION BIDS  (immutable — append-only, every bid stored)
-- ================================================================

CREATE TABLE public.auction_bids (
    id         BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    auction_id BIGINT        NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
    bidder_id  BIGINT        NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    amount     NUMERIC(20,4) NOT NULL CHECK (amount > 0),
    is_proxy   BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.auction_bids TO authenticated, service_role;
ALTER TABLE public.auction_bids ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_auction_bids_auction ON public.auction_bids(auction_id, amount DESC);
CREATE INDEX idx_auction_bids_bidder  ON public.auction_bids(bidder_id);

CREATE OR REPLACE FUNCTION private.on_insert_auction_bids()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_auction_bids
    BEFORE INSERT ON public.auction_bids
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_auction_bids();

-- After a bid is inserted: update statistics and apply sniping protection.
CREATE OR REPLACE FUNCTION private.on_auction_bid_inserted()
RETURNS TRIGGER AS $$
DECLARE
    v_end_time         TIMESTAMPTZ;
    v_extension_mins   INT;
    v_new_end_time     TIMESTAMPTZ;
BEGIN
    -- Update the cached statistics
    INSERT INTO public.auction_statistics (auction_id, highest_bid, highest_bidder_id, bid_count)
    VALUES (NEW.auction_id, NEW.amount, NEW.bidder_id, 1)
    ON CONFLICT (auction_id) DO UPDATE
        SET highest_bid        = GREATEST(auction_statistics.highest_bid, NEW.amount),
            highest_bidder_id  = CASE
                WHEN NEW.amount > auction_statistics.highest_bid THEN NEW.bidder_id
                ELSE auction_statistics.highest_bidder_id
            END,
            bid_count          = auction_statistics.bid_count + 1;

    -- Anti-sniping: extend end_time if bid arrives within extension window
    SELECT end_time, extension_minutes
    INTO   v_end_time, v_extension_mins
    FROM   public.auctions
    WHERE  id = NEW.auction_id AND status = 'active';

    IF FOUND AND v_extension_mins > 0 AND
       NOW() > (v_end_time - (v_extension_mins || ' minutes')::INTERVAL) THEN
        v_new_end_time := v_end_time + (v_extension_mins || ' minutes')::INTERVAL;
        UPDATE public.auctions
        SET    end_time      = v_new_end_time,
               extended_count = extended_count + 1
        WHERE  id = NEW.auction_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE TRIGGER on_auction_bid_inserted
    AFTER INSERT ON public.auction_bids
    FOR EACH ROW EXECUTE FUNCTION private.on_auction_bid_inserted();


-- ================================================================
-- PROXY BIDS  (max-bid for automatic bidding)
-- ================================================================

CREATE TABLE public.proxy_bids (
    id             BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid            UUID          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    auction_id     BIGINT        NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
    bidder_id      BIGINT        NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    maximum_amount NUMERIC(20,4) NOT NULL CHECK (maximum_amount > 0),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (auction_id, bidder_id)
);
GRANT ALL ON TABLE public.proxy_bids TO authenticated, service_role;
ALTER TABLE public.proxy_bids ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_proxy_bids_auction ON public.proxy_bids(auction_id);
CREATE INDEX idx_proxy_bids_bidder  ON public.proxy_bids(bidder_id);

CREATE OR REPLACE FUNCTION private.on_insert_proxy_bids()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_proxy_bids
    BEFORE INSERT ON public.proxy_bids
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_proxy_bids();


-- ================================================================
-- AUCTION STATISTICS  (materialized cache; updated by trigger)
-- ================================================================

CREATE TABLE public.auction_statistics (
    auction_id        BIGINT        PRIMARY KEY REFERENCES public.auctions(id) ON DELETE CASCADE,
    highest_bid       NUMERIC(20,4),
    highest_bidder_id BIGINT        REFERENCES public.accounts(id) ON DELETE SET NULL,
    bid_count         INT           NOT NULL DEFAULT 0
);
GRANT ALL ON TABLE public.auction_statistics TO authenticated, service_role;
ALTER TABLE public.auction_statistics ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_auction_stats_bidder ON public.auction_statistics(highest_bidder_id)
    WHERE highest_bidder_id IS NOT NULL;


-- ================================================================
-- LISTING WATCHERS  (saved / watchlist)
-- ================================================================

CREATE TABLE public.listing_watchers (
    listing_id BIGINT      NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
    account_id BIGINT      NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (listing_id, account_id)
);
GRANT ALL ON TABLE public.listing_watchers TO authenticated, service_role;
ALTER TABLE public.listing_watchers ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_listing_watchers_account ON public.listing_watchers(account_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.on_insert_listing_watchers()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_listing_watchers
    BEFORE INSERT ON public.listing_watchers
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_listing_watchers();


-- ================================================================
-- CARTS  (one active cart per account)
-- ================================================================

CREATE TABLE public.carts (
    id         BIGINT             GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID               NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    account_id BIGINT             NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    status     public.cart_status NOT NULL DEFAULT 'active',
    currency   CHAR(3)            NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.carts TO authenticated, service_role;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_carts_account ON public.carts(account_id, status);

CREATE OR REPLACE FUNCTION private.on_insert_carts()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_carts
    BEFORE INSERT ON public.carts
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_carts();

CREATE OR REPLACE FUNCTION private.on_update_carts()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_carts
    BEFORE UPDATE ON public.carts
    FOR EACH ROW EXECUTE FUNCTION private.on_update_carts();


-- ================================================================
-- CART ITEMS  (no stored totals — calculated dynamically)
-- ================================================================

CREATE TABLE public.cart_items (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    cart_id    BIGINT      NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
    listing_id BIGINT      NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
    quantity   INT         NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cart_id, listing_id)
);
GRANT ALL ON TABLE public.cart_items TO authenticated, service_role;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_cart_items_cart    ON public.cart_items(cart_id);
CREATE INDEX idx_cart_items_listing ON public.cart_items(listing_id);

CREATE OR REPLACE FUNCTION private.on_insert_cart_items()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_cart_items
    BEFORE INSERT ON public.cart_items
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_cart_items();


-- ================================================================
-- CHECKOUT SESSIONS  (frozen price snapshot)
--
-- Created when checkout begins; prices are captured at this moment.
-- Expired sessions are abandoned; active sessions block inventory.
-- ================================================================

CREATE TABLE public.checkout_sessions (
    id         BIGINT                  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID                    NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    cart_id    BIGINT                  REFERENCES public.carts(id) ON DELETE SET NULL,
    account_id BIGINT                  NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    status     public.checkout_status  NOT NULL DEFAULT 'pending',
    currency   CHAR(3)                 NOT NULL DEFAULT 'USD',
    subtotal   NUMERIC(20,4)           NOT NULL DEFAULT 0,
    tax        NUMERIC(20,4)           NOT NULL DEFAULT 0,
    discount   NUMERIC(20,4)           NOT NULL DEFAULT 0,
    shipping   NUMERIC(20,4)           NOT NULL DEFAULT 0,
    total      NUMERIC(20,4)           NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ             NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    created_at TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.checkout_sessions TO authenticated, service_role;
ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_checkout_sessions_account ON public.checkout_sessions(account_id, created_at DESC);
CREATE INDEX idx_checkout_sessions_active  ON public.checkout_sessions(status, expires_at)
    WHERE status IN ('pending', 'payment_pending');

CREATE OR REPLACE FUNCTION private.on_insert_checkout_sessions()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_checkout_sessions
    BEFORE INSERT ON public.checkout_sessions
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_checkout_sessions();


-- ================================================================
-- CHECKOUT ITEMS  (frozen line items — immutable after creation)
-- ================================================================

CREATE TABLE public.checkout_items (
    id                  BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                 UUID          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    checkout_session_id BIGINT        NOT NULL REFERENCES public.checkout_sessions(id) ON DELETE CASCADE,
    listing_id          BIGINT        NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
    seller_id           BIGINT        NOT NULL REFERENCES public.seller_profiles(id) ON DELETE RESTRICT,
    snapshot_title      TEXT          NOT NULL CHECK (char_length(snapshot_title) BETWEEN 1 AND 500),
    snapshot_sku        TEXT          CHECK (char_length(snapshot_sku) <= 100),
    unit_price          NUMERIC(20,4) NOT NULL CHECK (unit_price >= 0),
    quantity            INT           NOT NULL DEFAULT 1 CHECK (quantity > 0),
    tax_amount          NUMERIC(20,4) NOT NULL DEFAULT 0,
    discount_amount     NUMERIC(20,4) NOT NULL DEFAULT 0,
    line_total          NUMERIC(20,4) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.checkout_items TO authenticated, service_role;
ALTER TABLE public.checkout_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_checkout_items_session ON public.checkout_items(checkout_session_id);
CREATE INDEX idx_checkout_items_seller  ON public.checkout_items(seller_id);

CREATE OR REPLACE FUNCTION private.on_insert_checkout_items()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_checkout_items
    BEFORE INSERT ON public.checkout_items
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_checkout_items();


-- ================================================================
-- INVENTORY RESERVATIONS  (stock holds during checkout / auction win)
--
-- Released when: checkout expires, payment fails, or order is cancelled.
-- Consumed when: order is confirmed.
-- ================================================================

CREATE TABLE public.inventory_reservations (
    id              BIGINT                     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID                       NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    variant_id      BIGINT                     NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
    warehouse_id    BIGINT                     REFERENCES public.warehouses(id) ON DELETE SET NULL,
    quantity        INT                        NOT NULL CHECK (quantity > 0),
    status          public.reservation_status  NOT NULL DEFAULT 'active',
    reference_type  TEXT                       NOT NULL CHECK (char_length(reference_type) BETWEEN 1 AND 50),
    reference_id    BIGINT                     NOT NULL,
    expires_at      TIMESTAMPTZ,
    released_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ                NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.inventory_reservations TO authenticated, service_role;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_inventory_reservations_variant    ON public.inventory_reservations(variant_id, status);
CREATE INDEX idx_inventory_reservations_reference  ON public.inventory_reservations(reference_type, reference_id);
CREATE INDEX idx_inventory_reservations_expires    ON public.inventory_reservations(expires_at)
    WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION private.on_insert_inventory_reservations()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_inventory_reservations
    BEFORE INSERT ON public.inventory_reservations
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_inventory_reservations();

CREATE OR REPLACE FUNCTION private.on_update_inventory_reservations()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'active' AND NEW.status <> 'active' AND NEW.released_at IS NULL THEN
        NEW.released_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_inventory_reservations
    BEFORE UPDATE ON public.inventory_reservations
    FOR EACH ROW EXECUTE FUNCTION private.on_update_inventory_reservations();


-- ================================================================
-- PROMOTIONS
-- ================================================================

CREATE TABLE public.promotions (
    id                BIGINT                  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid               UUID                    NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    code              TEXT                    UNIQUE CHECK (char_length(code) BETWEEN 1 AND 50),
    name              TEXT                    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description       TEXT                    CHECK (char_length(description) <= 1000),
    promotion_type    public.promotion_type   NOT NULL,
    value             NUMERIC(20,4)           NOT NULL CHECK (value > 0),
    min_order_amount  NUMERIC(20,4)           DEFAULT 0,
    max_uses          INT,
    max_uses_per_user INT,
    uses_count        INT                     NOT NULL DEFAULT 0,
    is_active         BOOLEAN                 NOT NULL DEFAULT TRUE,
    start_date        TIMESTAMPTZ,
    end_date          TIMESTAMPTZ,
    created_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.promotions TO authenticated, service_role;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_promotions_code   ON public.promotions(code) WHERE code IS NOT NULL;
CREATE INDEX idx_promotions_active ON public.promotions(is_active, start_date, end_date);

CREATE OR REPLACE FUNCTION private.on_insert_promotions()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_promotions
    BEFORE INSERT ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_promotions();


-- ================================================================
-- PROMOTION REDEMPTIONS
-- ================================================================

CREATE TABLE public.promotion_redemptions (
    id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid          UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    promotion_id BIGINT      NOT NULL REFERENCES public.promotions(id) ON DELETE RESTRICT,
    account_id   BIGINT      NOT NULL REFERENCES public.accounts(id)   ON DELETE RESTRICT,
    order_id     BIGINT,
    amount_saved NUMERIC(20,4) NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.promotion_redemptions TO authenticated, service_role;
ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_promotion_redemptions_promotion ON public.promotion_redemptions(promotion_id);
CREATE INDEX idx_promotion_redemptions_account   ON public.promotion_redemptions(account_id);
CREATE INDEX idx_promotion_redemptions_order     ON public.promotion_redemptions(order_id) WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.on_insert_promotion_redemptions()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_promotion_redemptions
    BEFORE INSERT ON public.promotion_redemptions
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_promotion_redemptions();

-- Increment uses_count when a redemption is created
CREATE OR REPLACE FUNCTION private.on_promotion_redemption_inserted()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.promotions SET uses_count = uses_count + 1 WHERE id = NEW.promotion_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
CREATE TRIGGER on_promotion_redemption_inserted
    AFTER INSERT ON public.promotion_redemptions
    FOR EACH ROW EXECUTE FUNCTION private.on_promotion_redemption_inserted();


-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

-- seller_profiles: visible to all authenticated; editable only by owner
CREATE POLICY "Anyone can view active seller profiles"
    ON public.seller_profiles FOR SELECT TO authenticated
    USING (status = 'active');

CREATE POLICY "Sellers can update their own profile"
    ON public.seller_profiles FOR UPDATE TO authenticated
    USING (private.owns_account(account_id))
    WITH CHECK (private.owns_account(account_id));

-- listings: active listings visible to all; sellers can manage own drafts
CREATE POLICY "Anyone can view active listings"
    ON public.listings FOR SELECT TO authenticated
    USING (status IN ('active', 'sold', 'ended', 'ended_no_sale'));

CREATE POLICY "Sellers can view their own listings"
    ON public.listings FOR SELECT TO authenticated
    USING (private.owns_listing(id));

CREATE POLICY "Sellers can insert own listings"
    ON public.listings FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.seller_profiles sp
            JOIN public.accounts a ON a.id = sp.account_id
            WHERE sp.id = seller_id AND a.user_id = auth.uid()
        )
    );

CREATE POLICY "Sellers can update own listings"
    ON public.listings FOR UPDATE TO authenticated
    USING (private.owns_listing(id))
    WITH CHECK (private.owns_listing(id));

-- listing_images / listing_attributes
CREATE POLICY "Anyone can view listing images"
    ON public.listing_images FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Sellers can manage own listing images"
    ON public.listing_images FOR ALL TO authenticated
    USING (private.owns_listing(listing_id))
    WITH CHECK (private.owns_listing(listing_id));

CREATE POLICY "Anyone can view listing attributes"
    ON public.listing_attributes FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Sellers can manage own listing attributes"
    ON public.listing_attributes FOR ALL TO authenticated
    USING (private.owns_listing(listing_id))
    WITH CHECK (private.owns_listing(listing_id));

-- auctions / statistics
CREATE POLICY "Anyone can view auctions"
    ON public.auctions FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Anyone can view auction statistics"
    ON public.auction_statistics FOR SELECT TO authenticated USING (TRUE);

-- auction_bids: all bids visible; bidders can see their own max bid but not others'
CREATE POLICY "Anyone can view bids"
    ON public.auction_bids FOR SELECT TO authenticated USING (TRUE);

-- proxy_bids: only the bidder can see their own max bid
CREATE POLICY "Bidders can view own proxy bids"
    ON public.proxy_bids FOR SELECT TO authenticated
    USING (private.owns_account(bidder_id));

CREATE POLICY "Bidders can insert own proxy bids"
    ON public.proxy_bids FOR INSERT TO authenticated
    WITH CHECK (private.owns_account(bidder_id));

CREATE POLICY "Bidders can update own proxy bids"
    ON public.proxy_bids FOR UPDATE TO authenticated
    USING (private.owns_account(bidder_id))
    WITH CHECK (private.owns_account(bidder_id));

-- listing_watchers
CREATE POLICY "Users can view own watchlist"
    ON public.listing_watchers FOR SELECT TO authenticated
    USING (private.owns_account(account_id));

CREATE POLICY "Users can manage own watchlist"
    ON public.listing_watchers FOR ALL TO authenticated
    USING (private.owns_account(account_id))
    WITH CHECK (private.owns_account(account_id));

-- carts
CREATE POLICY "Users can view own carts"
    ON public.carts FOR SELECT TO authenticated
    USING (private.owns_account(account_id));

CREATE POLICY "Users can manage own carts"
    ON public.carts FOR ALL TO authenticated
    USING (private.owns_account(account_id))
    WITH CHECK (private.owns_account(account_id));

-- cart_items
CREATE POLICY "Users can view own cart items"
    ON public.cart_items FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.carts c
            WHERE c.id = cart_id AND private.owns_account(c.account_id)
        )
    );

CREATE POLICY "Users can manage own cart items"
    ON public.cart_items FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.carts c
            WHERE c.id = cart_id AND private.owns_account(c.account_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.carts c
            WHERE c.id = cart_id AND private.owns_account(c.account_id)
        )
    );

-- checkout_sessions / checkout_items
CREATE POLICY "Users can view own checkout sessions"
    ON public.checkout_sessions FOR SELECT TO authenticated
    USING (private.owns_account(account_id));

CREATE POLICY "Users can view own checkout items"
    ON public.checkout_items FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.checkout_sessions cs
            WHERE cs.id = checkout_session_id AND private.owns_account(cs.account_id)
        )
    );

-- promotions: active codes visible to all
CREATE POLICY "Anyone can view active promotions"
    ON public.promotions FOR SELECT TO authenticated
    USING (is_active = TRUE AND (start_date IS NULL OR start_date <= NOW())
                             AND (end_date IS NULL   OR end_date   > NOW()));

-- promotion_redemptions
CREATE POLICY "Users can view own redemptions"
    ON public.promotion_redemptions FOR SELECT TO authenticated
    USING (private.owns_account(account_id));


-- ================================================================
-- NOTIFICATION TEMPLATES (marketplace events)
-- ================================================================

INSERT INTO public.notification_templates
    (type, channel, locale, version, is_active, subject_template, body_template)
VALUES
(
    'auction.bid.outbid',
    'in_app', 'en', 1, true, NULL,
    'You have been outbid on "{{listing_title}}". Current highest bid: {{currency}} {{highest_bid}}.'
),
(
    'auction.bid.outbid',
    'email', 'en', 1, true,
    'You''ve been outbid on {{listing_title}}',
    '<p>Hi {{name}},</p><p>Someone placed a higher bid on <strong>{{listing_title}}</strong>.</p><p>Current bid: <strong>{{currency}} {{highest_bid}}</strong></p><p><a href="{{auction_url}}">Bid again</a></p>'
),
(
    'auction.ending_soon',
    'in_app', 'en', 1, true, NULL,
    '"{{listing_title}}" is ending in {{minutes_remaining}} minutes. Current bid: {{currency}} {{highest_bid}}.'
),
(
    'auction.won',
    'in_app', 'en', 1, true, NULL,
    'Congratulations! You won "{{listing_title}}" for {{currency}} {{final_price}}.'
),
(
    'auction.won',
    'email', 'en', 1, true,
    'You won {{listing_title}}!',
    '<p>Hi {{name}},</p><p>Congratulations! You won the auction for <strong>{{listing_title}}</strong>.</p><p>Winning bid: <strong>{{currency}} {{final_price}}</strong></p><p>Please complete your purchase within 48 hours.</p>'
),
(
    'listing.new_order',
    'in_app', 'en', 1, true, NULL,
    'New order for "{{listing_title}}" from {{buyer_name}}.'
);
