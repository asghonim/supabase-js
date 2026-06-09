-- ================================================================
-- WALLET LEDGER SYSTEM
--
-- Double-entry accounting: every financial event writes balanced
-- journal lines that sum to zero. Wallet balances are derived from
-- the ledger; current_balance is a performance cache only.
--
-- Convention:
--   Positive amount on a wallet ledger account = balance increases
--   Negative amount on a wallet ledger account = balance decreases
--
--   Deposit $100 → Wallet +100 / Bank -100     (net = 0)
--   Purchase $20 → Wallet -20  / Revenue +20   (net = 0)
--
-- Core tables:
--   ledger_accounts  — chart of accounts
--   wallets          — owner-facing containers (account / org)
--   journal_entries  — one record per financial event
--   journal_lines    — debit/credit lines; SUM per entry must = 0
--   wallet_holds     — temporary reservations against available balance
-- ================================================================

-- ================================================================
-- ENUMS
-- ================================================================

CREATE TYPE public.ledger_account_type AS ENUM (
    'wallet',          -- user / org wallet
    'bank',            -- external bank / payment gateway
    'revenue',         -- platform revenue
    'platform_fee',    -- fees retained by platform
    'escrow',          -- funds held pending release
    'refund_reserve',  -- reserve for anticipated refunds
    'system'           -- misc internal accounts
);

CREATE TYPE public.wallet_owner_type AS ENUM (
    'account',
    'organization'
);

CREATE TYPE public.wallet_hold_status AS ENUM (
    'active',
    'released',
    'consumed',
    'expired'
);

-- ================================================================
-- LEDGER ACCOUNTS  (chart of accounts)
--
-- Each wallet maps to exactly one ledger account (type = 'wallet').
-- System accounts (bank, revenue, etc.) live here too and are
-- seeded at the bottom of this file.
-- ================================================================

CREATE TABLE public.ledger_accounts (
    id           BIGINT                     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_type public.ledger_account_type NOT NULL,
    currency     CHAR(3)                    NOT NULL DEFAULT 'USD',
    name         TEXT                       NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description  TEXT                       CHECK (char_length(description) <= 1000),
    is_active    BOOLEAN                    NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ                NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.ledger_accounts TO authenticated, service_role;
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ledger_accounts_type ON public.ledger_accounts(account_type);
CREATE INDEX idx_ledger_accounts_currency ON public.ledger_accounts(currency);

CREATE OR REPLACE FUNCTION private.on_insert_ledger_accounts()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_ledger_accounts
    BEFORE INSERT ON public.ledger_accounts
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_ledger_accounts();

-- ================================================================
-- WALLETS  (owner-facing containers)
--
-- One wallet per (owner_type, owner_id, currency).
-- current_balance is a cached sum — updated by trigger on
-- journal_lines insert. Source of truth is always the ledger.
-- ================================================================

CREATE TABLE public.wallets (
    id                BIGINT                   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ledger_account_id BIGINT                   NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
    owner_type        public.wallet_owner_type NOT NULL,
    owner_id          BIGINT                   NOT NULL,
    currency          CHAR(3)                  NOT NULL DEFAULT 'USD',
    current_balance   NUMERIC(20,4)            NOT NULL DEFAULT 0,
    is_active         BOOLEAN                  NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
    UNIQUE (owner_type, owner_id, currency)
);
GRANT ALL ON TABLE public.wallets TO authenticated, service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wallets_ledger_account ON public.wallets(ledger_account_id);
CREATE INDEX idx_wallets_owner          ON public.wallets(owner_type, owner_id);

CREATE OR REPLACE FUNCTION private.on_insert_wallets()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_wallets
    BEFORE INSERT ON public.wallets
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_wallets();

-- ================================================================
-- JOURNAL ENTRIES  (one per financial event)
--
-- A draft entry (posted_at IS NULL) accepts line inserts.
-- Call private.post_journal_entry() to verify balance and post.
-- Idempotency key prevents duplicate entries on retried requests.
-- ================================================================

CREATE TABLE public.journal_entries (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    description     TEXT        CHECK (char_length(description) <= 1000),
    reference_type  TEXT        CHECK (char_length(reference_type) <= 50),
    reference_id    BIGINT,
    idempotency_key TEXT        UNIQUE CHECK (char_length(idempotency_key) <= 255),
    posted_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.journal_entries TO authenticated, service_role;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_journal_entries_reference   ON public.journal_entries(reference_type, reference_id)
    WHERE reference_id IS NOT NULL;
CREATE INDEX idx_journal_entries_posted      ON public.journal_entries(posted_at DESC)
    WHERE posted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION private.on_insert_journal_entries()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_journal_entries
    BEFORE INSERT ON public.journal_entries
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_journal_entries();

-- ================================================================
-- JOURNAL LINES  (the actual debit / credit rows)
--
-- The fundamental invariant — enforced by post_journal_entry():
--   SELECT SUM(amount) FROM journal_lines WHERE journal_entry_id = X
--   must equal 0 before an entry can be posted.
--
-- Positive amount on a wallet ledger account → balance goes up.
-- ================================================================

CREATE TABLE public.journal_lines (
    id                BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id  BIGINT        NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
    ledger_account_id BIGINT        NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
    amount            NUMERIC(20,4) NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.journal_lines TO authenticated, service_role;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_journal_lines_entry          ON public.journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_ledger_account ON public.journal_lines(ledger_account_id);
CREATE INDEX idx_journal_lines_account_created ON public.journal_lines(ledger_account_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.on_insert_journal_lines()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_journal_lines
    BEFORE INSERT ON public.journal_lines
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_journal_lines();

-- Update the cached wallet balance whenever a journal line lands
-- for a wallet-type ledger account.
CREATE OR REPLACE FUNCTION private.on_journal_line_inserted_update_wallet_balance()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.wallets
    SET    current_balance = current_balance + NEW.amount
    WHERE  ledger_account_id = NEW.ledger_account_id
      AND  EXISTS (
               SELECT 1 FROM public.ledger_accounts la
               WHERE la.id = NEW.ledger_account_id
                 AND la.account_type = 'wallet'
           );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE TRIGGER on_journal_line_inserted
    AFTER INSERT ON public.journal_lines
    FOR EACH ROW EXECUTE FUNCTION private.on_journal_line_inserted_update_wallet_balance();

-- ================================================================
-- WALLET HOLDS  (temporary reservations)
--
-- Available balance = current_balance - SUM(active holds).
-- A hold is consumed when the corresponding transaction posts,
-- released when the reservation lapses, or expired by a cleanup job.
-- ================================================================

CREATE TABLE public.wallet_holds (
    id              BIGINT                    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    wallet_id       BIGINT                    NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
    amount          NUMERIC(20,4)             NOT NULL CHECK (amount > 0),
    status          public.wallet_hold_status NOT NULL DEFAULT 'active',
    reference_type  TEXT                      CHECK (char_length(reference_type) <= 50),
    reference_id    BIGINT,
    idempotency_key TEXT                      UNIQUE CHECK (char_length(idempotency_key) <= 255),
    description     TEXT                      CHECK (char_length(description) <= 1000),
    expires_at      TIMESTAMPTZ,
    released_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ               NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.wallet_holds TO authenticated, service_role;
ALTER TABLE public.wallet_holds ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wallet_holds_wallet      ON public.wallet_holds(wallet_id);
CREATE INDEX idx_wallet_holds_active      ON public.wallet_holds(wallet_id, status)
    WHERE status = 'active';
CREATE INDEX idx_wallet_holds_reference   ON public.wallet_holds(reference_type, reference_id)
    WHERE reference_id IS NOT NULL;
CREATE INDEX idx_wallet_holds_expires     ON public.wallet_holds(expires_at)
    WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION private.on_insert_wallet_holds()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_wallet_holds
    BEFORE INSERT ON public.wallet_holds
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_wallet_holds();

-- ================================================================
-- HELPER FUNCTIONS
-- ================================================================

-- Verify balance and mark a journal entry as posted.
-- Raises if lines do not sum to zero (unbalanced entry).
CREATE OR REPLACE FUNCTION private.post_journal_entry(p_entry_id BIGINT)
RETURNS VOID AS $$
DECLARE
    v_sum NUMERIC(20,4);
BEGIN
    SELECT COALESCE(SUM(amount), 0)
    INTO   v_sum
    FROM   public.journal_lines
    WHERE  journal_entry_id = p_entry_id;

    IF v_sum <> 0 THEN
        RAISE EXCEPTION 'journal entry % is unbalanced: line sum = % (must be 0)',
            p_entry_id, v_sum;
    END IF;

    UPDATE public.journal_entries
    SET    posted_at = NOW()
    WHERE  id = p_entry_id
      AND  posted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION private.post_journal_entry(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.post_journal_entry(BIGINT) TO service_role;

-- Available balance = cached balance minus active holds.
CREATE OR REPLACE FUNCTION private.wallet_available_balance(p_wallet_id BIGINT)
RETURNS NUMERIC(20,4) AS $$
    SELECT
        w.current_balance - COALESCE(SUM(h.amount), 0)
    FROM  public.wallets w
    LEFT  JOIN public.wallet_holds h
           ON  h.wallet_id = w.id
           AND h.status = 'active'
    WHERE w.id = p_wallet_id
    GROUP BY w.current_balance;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION private.wallet_available_balance(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.wallet_available_balance(BIGINT) TO service_role;

-- Reconcile cached balance against the actual ledger sum.
-- Returns only wallets where the cache has drifted.
CREATE OR REPLACE FUNCTION private.verify_wallet_balances()
RETURNS TABLE (
    wallet_id      BIGINT,
    cached_balance NUMERIC(20,4),
    ledger_balance NUMERIC(20,4),
    drift          NUMERIC(20,4)
) AS $$
    SELECT
        w.id                                                  AS wallet_id,
        w.current_balance                                     AS cached_balance,
        COALESCE(SUM(jl.amount), 0)                          AS ledger_balance,
        w.current_balance - COALESCE(SUM(jl.amount), 0)     AS drift
    FROM  public.wallets w
    LEFT  JOIN public.journal_lines jl ON jl.ledger_account_id = w.ledger_account_id
    GROUP BY w.id, w.current_balance
    HAVING ABS(w.current_balance - COALESCE(SUM(jl.amount), 0)) > 0;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION private.verify_wallet_balances() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.verify_wallet_balances() TO service_role;

-- Deposit into a wallet.
-- Lines: source_account -amount, wallet +amount. Net = 0.
CREATE OR REPLACE FUNCTION private.deposit_to_wallet(
    p_wallet_id         BIGINT,
    p_amount            NUMERIC(20,4),
    p_source_account_id BIGINT,
    p_description       TEXT,
    p_idempotency_key   TEXT    DEFAULT NULL,
    p_reference_type    TEXT    DEFAULT NULL,
    p_reference_id      BIGINT  DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
    v_ledger_acct BIGINT;
    v_entry_id    BIGINT;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'deposit amount must be positive, got %', p_amount;
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_entry_id
        FROM   public.journal_entries
        WHERE  idempotency_key = p_idempotency_key;
        IF FOUND THEN RETURN v_entry_id; END IF;
    END IF;

    SELECT ledger_account_id INTO v_ledger_acct
    FROM   public.wallets
    WHERE  id = p_wallet_id
      AND  is_active = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet % not found or inactive', p_wallet_id;
    END IF;

    INSERT INTO public.journal_entries (description, reference_type, reference_id, idempotency_key)
    VALUES (p_description, p_reference_type, p_reference_id, p_idempotency_key)
    RETURNING id INTO v_entry_id;

    INSERT INTO public.journal_lines (journal_entry_id, ledger_account_id, amount)
    VALUES
        (v_entry_id, p_source_account_id, -p_amount),
        (v_entry_id, v_ledger_acct,        p_amount);

    PERFORM private.post_journal_entry(v_entry_id);

    RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION private.deposit_to_wallet(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.deposit_to_wallet(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

-- Spend from a wallet.
-- Acquires a row lock on the wallet to prevent concurrent overdraft.
-- Lines: wallet -amount, destination_account +amount. Net = 0.
-- Checks available_balance (current_balance - active holds) >= amount.
CREATE OR REPLACE FUNCTION private.spend_from_wallet(
    p_wallet_id          BIGINT,
    p_amount             NUMERIC(20,4),
    p_dest_account_id    BIGINT,
    p_description        TEXT,
    p_idempotency_key    TEXT    DEFAULT NULL,
    p_reference_type     TEXT    DEFAULT NULL,
    p_reference_id       BIGINT  DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
    v_available   NUMERIC(20,4);
    v_ledger_acct BIGINT;
    v_entry_id    BIGINT;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'spend amount must be positive, got %', p_amount;
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_entry_id
        FROM   public.journal_entries
        WHERE  idempotency_key = p_idempotency_key;
        IF FOUND THEN RETURN v_entry_id; END IF;
    END IF;

    -- Row lock prevents concurrent overdraft
    SELECT w.current_balance
               - COALESCE((
                   SELECT SUM(h.amount)
                   FROM   public.wallet_holds h
                   WHERE  h.wallet_id = w.id
                     AND  h.status = 'active'
               ), 0),
           w.ledger_account_id
    INTO   v_available, v_ledger_acct
    FROM   public.wallets w
    WHERE  w.id = p_wallet_id
      AND  w.is_active = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet % not found or inactive', p_wallet_id;
    END IF;

    IF v_available < p_amount THEN
        RAISE EXCEPTION 'insufficient balance: available %, requested %',
            v_available, p_amount;
    END IF;

    INSERT INTO public.journal_entries (description, reference_type, reference_id, idempotency_key)
    VALUES (p_description, p_reference_type, p_reference_id, p_idempotency_key)
    RETURNING id INTO v_entry_id;

    INSERT INTO public.journal_lines (journal_entry_id, ledger_account_id, amount)
    VALUES
        (v_entry_id, v_ledger_acct,      -p_amount),
        (v_entry_id, p_dest_account_id,   p_amount);

    PERFORM private.post_journal_entry(v_entry_id);

    RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION private.spend_from_wallet(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.spend_from_wallet(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

-- Transfer between two wallets atomically.
-- Locks both rows in id order to avoid deadlocks.
CREATE OR REPLACE FUNCTION private.transfer_between_wallets(
    p_from_wallet_id  BIGINT,
    p_to_wallet_id    BIGINT,
    p_amount          NUMERIC(20,4),
    p_description     TEXT,
    p_idempotency_key TEXT    DEFAULT NULL,
    p_reference_type  TEXT    DEFAULT NULL,
    p_reference_id    BIGINT  DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
    v_from_acct   BIGINT;
    v_to_acct     BIGINT;
    v_available   NUMERIC(20,4);
    v_entry_id    BIGINT;
    v_lock_first  BIGINT;
    v_lock_second BIGINT;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'transfer amount must be positive, got %', p_amount;
    END IF;

    IF p_from_wallet_id = p_to_wallet_id THEN
        RAISE EXCEPTION 'cannot transfer to the same wallet';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_entry_id
        FROM   public.journal_entries
        WHERE  idempotency_key = p_idempotency_key;
        IF FOUND THEN RETURN v_entry_id; END IF;
    END IF;

    -- Always lock lower id first to prevent deadlocks
    v_lock_first  := LEAST(p_from_wallet_id, p_to_wallet_id);
    v_lock_second := GREATEST(p_from_wallet_id, p_to_wallet_id);

    PERFORM id FROM public.wallets WHERE id = v_lock_first  FOR UPDATE;
    PERFORM id FROM public.wallets WHERE id = v_lock_second FOR UPDATE;

    SELECT w.current_balance
               - COALESCE((
                   SELECT SUM(h.amount)
                   FROM   public.wallet_holds h
                   WHERE  h.wallet_id = w.id
                     AND  h.status = 'active'
               ), 0),
           w.ledger_account_id
    INTO   v_available, v_from_acct
    FROM   public.wallets w
    WHERE  w.id = p_from_wallet_id
      AND  w.is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'source wallet % not found or inactive', p_from_wallet_id;
    END IF;

    IF v_available < p_amount THEN
        RAISE EXCEPTION 'insufficient balance in wallet %: available %, requested %',
            p_from_wallet_id, v_available, p_amount;
    END IF;

    SELECT ledger_account_id INTO v_to_acct
    FROM   public.wallets
    WHERE  id = p_to_wallet_id
      AND  is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'destination wallet % not found or inactive', p_to_wallet_id;
    END IF;

    INSERT INTO public.journal_entries (description, reference_type, reference_id, idempotency_key)
    VALUES (p_description, p_reference_type, p_reference_id, p_idempotency_key)
    RETURNING id INTO v_entry_id;

    INSERT INTO public.journal_lines (journal_entry_id, ledger_account_id, amount)
    VALUES
        (v_entry_id, v_from_acct, -p_amount),
        (v_entry_id, v_to_acct,    p_amount);

    PERFORM private.post_journal_entry(v_entry_id);

    RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION private.transfer_between_wallets(BIGINT, BIGINT, NUMERIC, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION private.transfer_between_wallets(BIGINT, BIGINT, NUMERIC, TEXT, TEXT, TEXT, BIGINT) TO service_role;

-- Convenience: own_wallet check used in RLS
CREATE OR REPLACE FUNCTION private.owns_wallet(p_wallet_id BIGINT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        -- account-owned wallet
        SELECT 1
        FROM   public.wallets w
        JOIN   public.accounts a ON a.id = w.owner_id
        WHERE  w.id          = p_wallet_id
          AND  w.owner_type  = 'account'
          AND  a.user_id     = auth.uid()
        UNION ALL
        -- org-owned wallet (any org member may view)
        SELECT 1
        FROM   public.wallets w
        WHERE  w.id         = p_wallet_id
          AND  w.owner_type = 'organization'
          AND  private.is_org_member(w.owner_id)
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

-- ================================================================
-- RLS POLICIES
-- ================================================================

-- Ledger accounts are internal; authenticated users may read
-- active non-wallet accounts (for display purposes) but cannot write.
CREATE POLICY "Authenticated users can read active system ledger accounts"
    ON public.ledger_accounts FOR SELECT
    TO authenticated
    USING (is_active = TRUE AND account_type <> 'wallet');

-- Wallets: owners can view their own wallets only.
CREATE POLICY "Wallet owners can view their own wallets"
    ON public.wallets FOR SELECT
    TO authenticated
    USING (private.owns_wallet(id));

-- Journal entries and lines are internal audit records.
-- Authenticated users have no direct access; service_role bypasses RLS.
CREATE POLICY "Wallet owners can view journal entries for their wallets"
    ON public.journal_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM   public.journal_lines jl
            JOIN   public.wallets w ON w.ledger_account_id = jl.ledger_account_id
            WHERE  jl.journal_entry_id = public.journal_entries.id
              AND  private.owns_wallet(w.id)
        )
    );

CREATE POLICY "Wallet owners can view journal lines for their wallets"
    ON public.journal_lines FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM   public.wallets w
            WHERE  w.ledger_account_id = public.journal_lines.ledger_account_id
              AND  private.owns_wallet(w.id)
        )
    );

-- Holds: wallet owners can view their own holds.
CREATE POLICY "Wallet owners can view their own holds"
    ON public.wallet_holds FOR SELECT
    TO authenticated
    USING (private.owns_wallet(wallet_id));

-- ================================================================
-- SEED: SYSTEM LEDGER ACCOUNTS
--
-- One row per well-known system account. These are referenced by
-- deposit_to_wallet / spend_from_wallet callers via their ids.
-- Add a currency variant for each currency you support.
-- ================================================================

INSERT INTO public.ledger_accounts (account_type, currency, name, description) VALUES
    ('bank',           'USD', 'Bank (USD)',           'External bank / payment gateway — USD'),
    ('revenue',        'USD', 'Revenue (USD)',         'Platform revenue account — USD'),
    ('platform_fee',   'USD', 'Platform Fees (USD)',   'Fees retained by the platform — USD'),
    ('escrow',         'USD', 'Escrow (USD)',          'Funds held pending release — USD'),
    ('refund_reserve', 'USD', 'Refund Reserve (USD)',  'Reserve for anticipated refunds — USD');

-- ================================================================
-- PUBLIC RPC WRAPPERS
--
-- PostgREST only exposes the public schema. These thin wrappers
-- delegate to private.* and inherit the same SECURITY DEFINER /
-- service_role-only access. Authenticated (non-service) callers
-- receive a permission-denied error.
-- ================================================================

CREATE OR REPLACE FUNCTION public.wallet_deposit(
    p_wallet_id         BIGINT,
    p_amount            NUMERIC(20,4),
    p_source_account_id BIGINT,
    p_description       TEXT,
    p_idempotency_key   TEXT   DEFAULT NULL,
    p_reference_type    TEXT   DEFAULT NULL,
    p_reference_id      BIGINT DEFAULT NULL
)
RETURNS BIGINT AS $$
    SELECT private.deposit_to_wallet(
        p_wallet_id, p_amount, p_source_account_id, p_description,
        p_idempotency_key, p_reference_type, p_reference_id
    );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION public.wallet_deposit(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_deposit(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.wallet_spend(
    p_wallet_id       BIGINT,
    p_amount          NUMERIC(20,4),
    p_dest_account_id BIGINT,
    p_description     TEXT,
    p_idempotency_key TEXT   DEFAULT NULL,
    p_reference_type  TEXT   DEFAULT NULL,
    p_reference_id    BIGINT DEFAULT NULL
)
RETURNS BIGINT AS $$
    SELECT private.spend_from_wallet(
        p_wallet_id, p_amount, p_dest_account_id, p_description,
        p_idempotency_key, p_reference_type, p_reference_id
    );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION public.wallet_spend(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_spend(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.wallet_transfer(
    p_from_wallet_id  BIGINT,
    p_to_wallet_id    BIGINT,
    p_amount          NUMERIC(20,4),
    p_description     TEXT,
    p_idempotency_key TEXT   DEFAULT NULL,
    p_reference_type  TEXT   DEFAULT NULL,
    p_reference_id    BIGINT DEFAULT NULL
)
RETURNS BIGINT AS $$
    SELECT private.transfer_between_wallets(
        p_from_wallet_id, p_to_wallet_id, p_amount, p_description,
        p_idempotency_key, p_reference_type, p_reference_id
    );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION public.wallet_transfer(BIGINT, BIGINT, NUMERIC, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_transfer(BIGINT, BIGINT, NUMERIC, TEXT, TEXT, TEXT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.wallet_available_balance(p_wallet_id BIGINT)
RETURNS NUMERIC(20,4) AS $$
    SELECT private.wallet_available_balance(p_wallet_id);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION public.wallet_available_balance(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_available_balance(BIGINT) TO service_role;
