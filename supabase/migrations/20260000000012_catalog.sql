-- ================================================================
-- PRODUCT CATALOG & INVENTORY
--
-- Layered catalog architecture:
--   product_categories      — hierarchical category tree
--   products                — base sellable items
--   product_variants        — per-variant SKUs (size, color, etc.)
--   attributes              — attribute definitions (Color, Size)
--   attribute_values        — per-attribute options (Red, XL)
--   variant_attribute_values — junction: variant ↔ attribute_value
--   warehouses              — physical storage locations
--   inventory_transactions  — ledger-style stock movements (append-only)
--   prices                  — time-bounded, currency-aware pricing
--
-- Design principles:
--   * Inventory is a running SUM of quantity_change — never a single column
--   * Prices are immutable records; create new rows for changes
--   * Catalog reads are public; writes are service_role only
--   * variant_id is the primary FK used by listings and order_items
-- ================================================================


-- ================================================================
-- ENUMS
-- ================================================================

CREATE TYPE public.product_status AS ENUM (
    'draft',
    'active',
    'archived'
);

CREATE TYPE public.variant_status AS ENUM (
    'active',
    'inactive',
    'discontinued'
);


-- ================================================================
-- PRODUCT CATEGORIES  (self-referential tree)
-- ================================================================

CREATE TABLE public.product_categories (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    parent_id   BIGINT      REFERENCES public.product_categories(id) ON DELETE SET NULL,
    slug        TEXT        NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 100),
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description TEXT        CHECK (char_length(description) <= 1000),
    sort_order  INT         NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.product_categories TO authenticated, service_role;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_product_categories_parent ON public.product_categories(parent_id);
CREATE INDEX idx_product_categories_active ON public.product_categories(is_active, sort_order);

CREATE OR REPLACE FUNCTION private.on_insert_product_categories()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_product_categories
    BEFORE INSERT ON public.product_categories
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_product_categories();


-- ================================================================
-- PRODUCTS
-- ================================================================

CREATE TABLE public.products (
    id          BIGINT                 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID                   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    category_id BIGINT                 REFERENCES public.product_categories(id) ON DELETE SET NULL,
    sku         TEXT                   UNIQUE CHECK (char_length(sku) <= 100),
    name        TEXT                   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
    description TEXT                   CHECK (char_length(description) <= 10000),
    brand       TEXT                   CHECK (char_length(brand) <= 255),
    status      public.product_status  NOT NULL DEFAULT 'draft',
    metadata    JSONB                  NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.products TO authenticated, service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_products_category   ON public.products(category_id);
CREATE INDEX idx_products_status     ON public.products(status);
CREATE INDEX idx_products_name_fts   ON public.products USING gin(name gin_trgm_ops);

CREATE OR REPLACE FUNCTION private.on_insert_products()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_products
    BEFORE INSERT ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_products();

CREATE OR REPLACE FUNCTION private.on_update_products()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_products
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.on_update_products();


-- ================================================================
-- PRODUCT VARIANTS
-- ================================================================

CREATE TABLE public.product_variants (
    id         BIGINT                GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID                  NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    product_id BIGINT                NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    sku        TEXT                  UNIQUE CHECK (char_length(sku) <= 100),
    name       TEXT                  NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    status     public.variant_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.product_variants TO authenticated, service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_product_variants_product ON public.product_variants(product_id);
CREATE INDEX idx_product_variants_status  ON public.product_variants(status);

CREATE OR REPLACE FUNCTION private.on_insert_product_variants()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_product_variants
    BEFORE INSERT ON public.product_variants
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_product_variants();


-- ================================================================
-- ATTRIBUTES & VALUES  (e.g. Color → Red, Size → XL)
-- ================================================================

CREATE TABLE public.attributes (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    name       TEXT        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.attributes TO authenticated, service_role;
ALTER TABLE public.attributes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_insert_attributes()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_attributes
    BEFORE INSERT ON public.attributes
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_attributes();

CREATE TABLE public.attribute_values (
    id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid          UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    attribute_id BIGINT      NOT NULL REFERENCES public.attributes(id) ON DELETE CASCADE,
    value        TEXT        NOT NULL CHECK (char_length(value) BETWEEN 1 AND 255),
    sort_order   INT         NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (attribute_id, value)
);
GRANT ALL ON TABLE public.attribute_values TO authenticated, service_role;
ALTER TABLE public.attribute_values ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_attribute_values_attribute ON public.attribute_values(attribute_id, sort_order);

CREATE OR REPLACE FUNCTION private.on_insert_attribute_values()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_attribute_values
    BEFORE INSERT ON public.attribute_values
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_attribute_values();

-- Junction: which attribute values apply to each variant
CREATE TABLE public.variant_attribute_values (
    variant_id         BIGINT NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
    attribute_value_id BIGINT NOT NULL REFERENCES public.attribute_values(id) ON DELETE CASCADE,
    PRIMARY KEY (variant_id, attribute_value_id)
);
GRANT ALL ON TABLE public.variant_attribute_values TO authenticated, service_role;
ALTER TABLE public.variant_attribute_values ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_variant_attr_values_value ON public.variant_attribute_values(attribute_value_id);


-- ================================================================
-- WAREHOUSES
-- ================================================================

CREATE TABLE public.warehouses (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid        UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    name       TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    address    JSONB       NOT NULL DEFAULT '{}',
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.warehouses TO authenticated, service_role;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_insert_warehouses()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_warehouses
    BEFORE INSERT ON public.warehouses
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_warehouses();


-- ================================================================
-- INVENTORY TRANSACTIONS  (ledger — append-only)
--
-- Current stock = SUM(quantity_change) per (variant_id, warehouse_id).
-- Positive = stock in; negative = stock out.
-- Never UPDATE or DELETE rows — create compensating transactions.
-- ================================================================

CREATE TABLE public.inventory_transactions (
    id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid            UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    variant_id     BIGINT      NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
    warehouse_id   BIGINT      NOT NULL REFERENCES public.warehouses(id)        ON DELETE RESTRICT,
    quantity_change INT        NOT NULL,
    reason         TEXT        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 100),
    reference_type TEXT        CHECK (char_length(reference_type) <= 50),
    reference_id   BIGINT,
    note           TEXT        CHECK (char_length(note) <= 1000),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.inventory_transactions TO authenticated, service_role;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_inventory_txn_variant   ON public.inventory_transactions(variant_id, created_at DESC);
CREATE INDEX idx_inventory_txn_warehouse ON public.inventory_transactions(warehouse_id);
CREATE INDEX idx_inventory_txn_reference ON public.inventory_transactions(reference_type, reference_id)
    WHERE reference_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.on_insert_inventory_transactions()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_inventory_transactions
    BEFORE INSERT ON public.inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_inventory_transactions();


-- ================================================================
-- PRICES  (time-bounded, per variant, per currency)
--
-- To change a price: insert a new row. Old rows stay for history.
-- "Current price" = most recent row where valid_from <= NOW()
-- and valid_until IS NULL OR valid_until > NOW().
-- ================================================================

CREATE TABLE public.prices (
    id          BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    variant_id  BIGINT        NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
    currency    CHAR(3)       NOT NULL DEFAULT 'USD',
    amount      NUMERIC(20,4) NOT NULL CHECK (amount >= 0),
    valid_from  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.prices TO authenticated, service_role;
ALTER TABLE public.prices ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_prices_variant  ON public.prices(variant_id, valid_from DESC);
CREATE INDEX idx_prices_currency ON public.prices(variant_id, currency, valid_from DESC);

CREATE OR REPLACE FUNCTION private.on_insert_prices()
RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_prices
    BEFORE INSERT ON public.prices
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_prices();


-- ================================================================
-- HELPER FUNCTIONS
-- ================================================================

-- Returns the current total stock across all warehouses, or a specific one.
CREATE OR REPLACE FUNCTION public.inventory_stock(
    p_variant_id   BIGINT,
    p_warehouse_id BIGINT DEFAULT NULL
)
RETURNS INT AS $$
    SELECT COALESCE(SUM(quantity_change), 0)::INT
    FROM   public.inventory_transactions
    WHERE  variant_id  = p_variant_id
      AND  (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION public.inventory_stock(BIGINT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.inventory_stock(BIGINT, BIGINT) TO service_role;

-- Returns the current active price for a variant in a given currency.
CREATE OR REPLACE FUNCTION public.current_price(
    p_variant_id BIGINT,
    p_currency   CHAR(3) DEFAULT 'USD'
)
RETURNS NUMERIC(20,4) AS $$
    SELECT amount
    FROM   public.prices
    WHERE  variant_id  = p_variant_id
      AND  currency    = p_currency
      AND  valid_from <= NOW()
      AND  (valid_until IS NULL OR valid_until > NOW())
    ORDER  BY valid_from DESC
    LIMIT  1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION public.current_price(BIGINT, CHAR) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_price(BIGINT, CHAR) TO service_role;

-- Atomically expires the active price for a variant and inserts the new one.
-- Runs as SECURITY DEFINER so RLS on prices cannot silently block the UPDATE
-- and leave a stale active row while the INSERT still succeeds.
CREATE OR REPLACE FUNCTION public.set_current_price(
    p_variant_id BIGINT,
    p_amount     NUMERIC(20,4),
    p_currency   CHAR(3) DEFAULT 'USD'
)
RETURNS public.prices AS $$
DECLARE
    v_now    TIMESTAMPTZ := NOW();
    v_result public.prices;
BEGIN
    UPDATE public.prices
    SET    valid_until = v_now
    WHERE  variant_id  = p_variant_id
      AND  currency    = p_currency
      AND  valid_until IS NULL;

    INSERT INTO public.prices (variant_id, amount, currency, valid_from)
    VALUES (p_variant_id, p_amount, p_currency, v_now)
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION public.set_current_price(BIGINT, NUMERIC, CHAR) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_current_price(BIGINT, NUMERIC, CHAR) TO service_role;


-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

CREATE POLICY "Anyone can view active categories"
    ON public.product_categories FOR SELECT TO authenticated
    USING (is_active = TRUE);

CREATE POLICY "Anyone can view active products"
    ON public.products FOR SELECT TO authenticated
    USING (status = 'active');

CREATE POLICY "Anyone can view variants of active products"
    ON public.product_variants FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.status = 'active'
        )
    );

CREATE POLICY "Anyone can view attributes"
    ON public.attributes FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Anyone can view attribute values"
    ON public.attribute_values FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Anyone can view variant attribute values"
    ON public.variant_attribute_values FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Anyone can view current prices"
    ON public.prices FOR SELECT TO authenticated
    USING (valid_until IS NULL OR valid_until > NOW());

CREATE POLICY "Anyone can view active warehouses"
    ON public.warehouses FOR SELECT TO authenticated USING (is_active = TRUE);
