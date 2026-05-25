CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.accounts (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_create_account()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_create_account
BEFORE UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION private.on_create_account();


CREATE OR REPLACE FUNCTION private.on_auth_user_created()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.accounts (user_id, created_at, updated_at)
    VALUES (
        NEW.id,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION private.on_auth_user_created();


CREATE TABLE public.account_names (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id  BIGINT       NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    name        TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    created_at  TIMESTAMPTZ  NOT NULL
);

CREATE INDEX ON public.account_names(account_id, created_at DESC);

CREATE TABLE public.account_avatars (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id  BIGINT       NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    url         TEXT         NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
    created_at  TIMESTAMPTZ  NOT NULL
);

CREATE INDEX ON public.account_avatars(account_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.on_insert_account_name()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_insert_account_name
BEFORE INSERT ON public.account_names
FOR EACH ROW EXECUTE FUNCTION private.on_insert_account_name();

CREATE OR REPLACE FUNCTION private.on_insert_account_avatar()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_insert_account_avatar
BEFORE INSERT ON public.account_avatars
FOR EACH ROW EXECUTE FUNCTION private.on_insert_account_avatar();

ALTER TABLE public.account_names   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_avatars ENABLE ROW LEVEL SECURITY;


CREATE OR REPLACE FUNCTION private.owns_account(p_account_id BIGINT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.accounts a
        WHERE a.id = p_account_id
          AND a.user_id = auth.uid()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- Owners can insert their own records
CREATE POLICY "Account owners can insert their own names"
    ON public.account_names
    FOR INSERT
    WITH CHECK (private.owns_account(account_id));

CREATE POLICY "Account owners can insert their own avatars"
    ON public.account_avatars
    FOR INSERT
    WITH CHECK (private.owns_account(account_id));

-- Owners can read their own records
CREATE POLICY "Account owners can view their own names"
    ON public.account_names
    FOR SELECT
    USING (private.owns_account(account_id));

CREATE POLICY "Account owners can view their own avatars"
    ON public.account_avatars
    FOR SELECT
    USING (private.owns_account(account_id));
