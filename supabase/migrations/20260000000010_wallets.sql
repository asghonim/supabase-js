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
    'wallet',
    'bank',
    'revenue',
    'platform_fee',
    'escrow',
    'refund_reserve',
    'system'
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
-- ================================================================

CREATE TABLE public.ledger_accounts (
    id           BIGINT                     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid          UUID                       NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    account_type public.ledger_account_type NOT NULL,
    currency     CHAR(3)                    NOT NULL DEFAULT 'USD',
    name         TEXT                       NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description  TEXT                       CHECK (char_length(description) <= 1000),
    is_active    BOOLEAN                    NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ                NOT NULL DEFAULT NOW()
    );
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_type     ON public.ledger_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_currency ON public.ledger_accounts(currency);
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.ledger_accounts TO service_role;

GRANT SELECT ON TABLE public.ledger_accounts TO authenticated;
CREATE POLICY "Authenticated users can read active system ledger accounts"
    ON public.ledger_accounts FOR SELECT
    TO authenticated
    USING (is_active = TRUE AND account_type <> 'wallet');

-- ================================================================
-- WALLETS  (owner-facing containers)
-- ================================================================

CREATE TABLE public.wallets (
    id                BIGINT                   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid               UUID                     NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    ledger_account_id BIGINT                   NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
    owner_type        public.wallet_owner_type NOT NULL,
    owner_id          BIGINT                   NOT NULL,
    currency          CHAR(3)                  NOT NULL DEFAULT 'USD',
    current_balance   NUMERIC(20,4)            NOT NULL DEFAULT 0,
    is_active         BOOLEAN                  NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
    UNIQUE (owner_type, owner_id, currency)
    );
CREATE INDEX IF NOT EXISTS idx_wallets_ledger_account ON public.wallets(ledger_account_id);
CREATE INDEX IF NOT EXISTS idx_wallets_owner          ON public.wallets(owner_type, owner_id);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.wallets TO service_role;
GRANT INSERT (ledger_account_id, owner_type, owner_id, currency, current_balance, is_active) ON TABLE public.wallets TO authenticated;

CREATE OR REPLACE FUNCTION private.on_insert_wallets()
	RETURNS TRIGGER AS $$
		BEGIN
			IF NEW.owner_type = 'account' THEN
				IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = NEW.owner_id) THEN
					RAISE EXCEPTION 'wallet owner_id % does not exist in accounts', NEW.owner_id;
				END IF;
			ELSIF NEW.owner_type = 'organization' THEN
				IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.owner_id) THEN
					RAISE EXCEPTION 'wallet owner_id % does not exist in organizations', NEW.owner_id;
				END IF;
			END IF;
			RETURN NEW;
		END;
	$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_wallets
    BEFORE INSERT ON public.wallets
    FOR EACH ROW EXECUTE FUNCTION private.on_insert_wallets();

CREATE OR REPLACE FUNCTION private.owns_wallet(p_wallet_id BIGINT)
	RETURNS BOOLEAN AS $$
		SELECT EXISTS (
			SELECT 1
			FROM   public.wallets w
			JOIN   public.accounts a ON a.id = w.owner_id
			WHERE  w.id          = p_wallet_id
				AND  w.owner_type  = 'account'
				AND  a.user_id     = auth.uid()
			UNION ALL
			SELECT 1
			FROM   public.wallets w
			WHERE  w.id         = p_wallet_id
				AND  w.owner_type = 'organization'
				AND  private.has_org_permission(w.owner_id, 'wallet.view')
		);
	$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

GRANT SELECT ON TABLE public.wallets TO authenticated;
CREATE POLICY "Wallet owners can view their own wallets"
    ON public.wallets FOR SELECT
    TO authenticated
    USING (private.owns_wallet(id) OR public.has_permission('view', 'wallet', id));

-- ================================================================
-- JOURNAL ENTRIES  (one per financial event)
-- ================================================================

CREATE TABLE public.journal_entries (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    description     TEXT        CHECK (char_length(description) <= 1000),
    reference_type  TEXT        CHECK (char_length(reference_type) <= 50),
    reference_id    BIGINT,
    idempotency_key TEXT        UNIQUE CHECK (char_length(idempotency_key) <= 255),
    posted_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX IF NOT EXISTS idx_journal_entries_reference ON public.journal_entries(reference_type, reference_id)
    WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entries_posted    ON public.journal_entries(posted_at DESC)
    WHERE posted_at IS NOT NULL;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.journal_entries TO service_role;
GRANT INSERT (description, reference_type, reference_id, idempotency_key, posted_at) ON TABLE public.journal_entries TO authenticated;

-- ================================================================
-- JOURNAL LINES  (the actual debit / credit rows)
-- ================================================================

CREATE TABLE public.journal_lines (
    id                BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid               UUID          NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    journal_entry_id  BIGINT        NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
    ledger_account_id BIGINT        NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
    amount            NUMERIC(20,4) NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry           ON public.journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_ledger_account  ON public.journal_lines(ledger_account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account_created ON public.journal_lines(ledger_account_id, created_at DESC);
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.journal_lines TO service_role;
GRANT INSERT (journal_entry_id, ledger_account_id, amount) ON TABLE public.journal_lines TO authenticated;

-- Update the cached wallet balance whenever a journal line lands
-- for a wallet-type ledger account.
CREATE OR REPLACE FUNCTION private.on_journal_lines_inserted()
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
	CREATE TRIGGER on_journal_lines_inserted AFTER INSERT ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION private.on_journal_lines_inserted();


GRANT SELECT ON TABLE public.journal_entries TO authenticated;
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
        OR public.has_permission('view', 'journal_entry', id)
    );


GRANT SELECT ON TABLE public.journal_lines TO authenticated;
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
        OR public.has_permission('view', 'journal_line', id)
    );

-- ================================================================
-- WALLET HOLDS  (temporary reservations)
-- ================================================================

CREATE TABLE public.wallet_holds (
    id              BIGINT                    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID                      NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
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
CREATE INDEX IF NOT EXISTS idx_wallet_holds_wallet    ON public.wallet_holds(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_holds_active    ON public.wallet_holds(wallet_id, status)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_wallet_holds_reference ON public.wallet_holds(reference_type, reference_id)
    WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_holds_expires   ON public.wallet_holds(expires_at)
    WHERE status = 'active' AND expires_at IS NOT NULL;
ALTER TABLE public.wallet_holds ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.wallet_holds TO service_role;
GRANT INSERT (wallet_id, amount, status, reference_type, reference_id, idempotency_key, description, expires_at, released_at) ON TABLE public.wallet_holds TO authenticated;

CREATE OR REPLACE FUNCTION private.on_update_wallet_holds()
	RETURNS TRIGGER AS $$
		BEGIN
			IF OLD.status = 'active' AND NEW.status <> 'active' AND NEW.released_at IS NULL THEN
				NEW.released_at = NOW();
			END IF;
			RETURN NEW;
		END;
	$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_update_wallet_holds
    BEFORE UPDATE ON public.wallet_holds
    FOR EACH ROW EXECUTE FUNCTION private.on_update_wallet_holds();

-- Releasing a hold is the only mutation users may perform, and it must go
-- through this function. The on_update_wallet_holds trigger sets released_at.
CREATE OR REPLACE FUNCTION public.release_wallet_hold(p_hold_id BIGINT) RETURNS void AS $$
	DECLARE
		v_wallet_id BIGINT;
	BEGIN
		SELECT wallet_id INTO v_wallet_id FROM public.wallet_holds WHERE id = p_hold_id AND status = 'active';
		IF v_wallet_id IS NULL THEN
			RETURN;
		END IF;
		IF NOT (private.owns_wallet(v_wallet_id) OR public.has_permission('edit', 'wallet_hold', p_hold_id)) THEN
			RAISE EXCEPTION 'Insufficient permissions to release wallet hold';
		END IF;
		UPDATE public.wallet_holds SET status = 'released' WHERE id = p_hold_id AND status = 'active';
	END;
	$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.release_wallet_hold(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_wallet_hold(BIGINT) TO authenticated;

GRANT SELECT ON TABLE public.wallet_holds TO authenticated;
CREATE POLICY "Wallet owners can view their own holds"
    ON public.wallet_holds FOR SELECT
    TO authenticated
    USING (private.owns_wallet(wallet_id) OR public.has_permission('view', 'wallet_hold', id));

-- ================================================================
-- HELPER FUNCTIONS
-- ================================================================

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
GRANT EXECUTE ON FUNCTION private.post_journal_entry(BIGINT) TO service_role;

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
GRANT EXECUTE ON FUNCTION private.wallet_available_balance(BIGINT) TO service_role;

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
GRANT EXECUTE ON FUNCTION private.verify_wallet_balances() TO service_role;

CREATE OR REPLACE FUNCTION private.deposit_to_wallet(
    p_wallet_id         BIGINT,
    p_amount            NUMERIC(20,4),
    p_source_account_id BIGINT,
    p_description       TEXT,
    p_idempotency_key   TEXT    DEFAULT NULL,
    p_reference_type    TEXT    DEFAULT NULL,
    p_reference_id      BIGINT  DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION private.deposit_to_wallet(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

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
GRANT EXECUTE ON FUNCTION private.spend_from_wallet(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

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
		v_from_acct      BIGINT;
		v_from_currency  CHAR(3);
		v_to_acct        BIGINT;
		v_to_currency    CHAR(3);
		v_available      NUMERIC(20,4);
		v_entry_id       BIGINT;
		v_lock_first     BIGINT;
		v_lock_second    BIGINT;
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
				w.ledger_account_id,
				w.currency
		INTO   v_available, v_from_acct, v_from_currency
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

		SELECT ledger_account_id, currency
		INTO   v_to_acct, v_to_currency
		FROM   public.wallets
		WHERE  id = p_to_wallet_id
			AND  is_active = TRUE;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'destination wallet % not found or inactive', p_to_wallet_id;
		END IF;

		IF v_from_currency <> v_to_currency THEN
			RAISE EXCEPTION 'currency mismatch: source wallet is %, destination wallet is % — cross-currency transfers are not supported',
				v_from_currency, v_to_currency;
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
GRANT EXECUTE ON FUNCTION private.transfer_between_wallets(BIGINT, BIGINT, NUMERIC, TEXT, TEXT, TEXT, BIGINT) TO service_role;

-- ================================================================
-- SEED: SYSTEM LEDGER ACCOUNTS
-- ================================================================

INSERT INTO public.ledger_accounts (account_type, currency, name, description) VALUES
    ('bank',           'USD', 'Bank (USD)',           'External bank / payment gateway — USD'),
    ('revenue',        'USD', 'Revenue (USD)',         'Platform revenue account — USD'),
    ('platform_fee',   'USD', 'Platform Fees (USD)',   'Fees retained by the platform — USD'),
    ('escrow',         'USD', 'Escrow (USD)',          'Funds held pending release — USD'),
    ('refund_reserve', 'USD', 'Refund Reserve (USD)',  'Reserve for anticipated refunds — USD');

-- ================================================================
-- PUBLIC RPC WRAPPERS
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
GRANT EXECUTE ON FUNCTION public.wallet_deposit(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

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
GRANT EXECUTE ON FUNCTION public.wallet_spend(BIGINT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

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
GRANT EXECUTE ON FUNCTION public.wallet_transfer(BIGINT, BIGINT, NUMERIC, TEXT, TEXT, TEXT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.wallet_available_balance(p_wallet_id BIGINT)
	RETURNS NUMERIC(20,4) AS $$
		SELECT private.wallet_available_balance(p_wallet_id);
	$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION public.wallet_available_balance(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_available_balance(BIGINT) TO service_role;

-- ================================================================
-- ATOMIC WALLET PROVISIONING
-- ================================================================

CREATE OR REPLACE FUNCTION private.create_wallet(
    p_owner_type public.wallet_owner_type,
    p_owner_id   BIGINT,
    p_currency   CHAR(3) DEFAULT 'USD',
    p_name       TEXT    DEFAULT NULL
	)
	RETURNS BIGINT AS $$
	DECLARE
		v_name      TEXT;
		v_ledger_id BIGINT;
		v_wallet_id BIGINT;
	BEGIN
		v_name := COALESCE(
			p_name,
			p_owner_type::text || ':' || p_owner_id::text || ' wallet (' || p_currency || ')'
		);

		INSERT INTO public.ledger_accounts (account_type, currency, name)
		VALUES ('wallet', p_currency, v_name)
		RETURNING id INTO v_ledger_id;

		INSERT INTO public.wallets (owner_type, owner_id, currency, ledger_account_id)
		VALUES (p_owner_type, p_owner_id, p_currency, v_ledger_id)
		RETURNING id INTO v_wallet_id;

		RETURN v_wallet_id;
	END;
	$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION private.create_wallet(public.wallet_owner_type, BIGINT, CHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.create_wallet(public.wallet_owner_type, BIGINT, CHAR, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.wallet_create(
    p_owner_type public.wallet_owner_type,
    p_owner_id   BIGINT,
    p_currency   CHAR(3) DEFAULT 'USD',
    p_name       TEXT    DEFAULT NULL
	)
	RETURNS BIGINT AS $$
		SELECT private.create_wallet(p_owner_type, p_owner_id, p_currency, p_name);
	$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, private;

REVOKE EXECUTE ON FUNCTION public.wallet_create(public.wallet_owner_type, BIGINT, CHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_create(public.wallet_owner_type, BIGINT, CHAR, TEXT) TO service_role;
