CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.accounts (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.accounts TO authenticated, service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_create_account()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_create_account
BEFORE INSERT ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION private.on_create_account();

CREATE TABLE public.account_names (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id  BIGINT       NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    name        TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    created_at  TIMESTAMPTZ  NOT NULL
);
GRANT ALL ON TABLE public.account_names TO authenticated, service_role;

CREATE INDEX ON public.account_names(account_id, created_at DESC);

CREATE TABLE public.account_avatars (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id  BIGINT       NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    url         TEXT         NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
    created_at  TIMESTAMPTZ  NOT NULL
);
GRANT ALL ON TABLE public.account_avatars TO authenticated, service_role;

CREATE INDEX ON public.account_avatars(account_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.on_insert_account_name()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_account_name
BEFORE INSERT ON public.account_names
FOR EACH ROW EXECUTE FUNCTION private.on_insert_account_name();

CREATE OR REPLACE FUNCTION private.on_insert_account_avatar()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_account_avatar
BEFORE INSERT ON public.account_avatars
FOR EACH ROW EXECUTE FUNCTION private.on_insert_account_avatar();

ALTER TABLE public.account_names   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_avatars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account owners can view their own accounts"
    ON public.accounts
    FOR SELECT
    USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION private.owns_account(p_account_id BIGINT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.accounts a
        WHERE a.id = p_account_id
          AND a.user_id = auth.uid()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

CREATE POLICY "Account owners can insert their own names"
    ON public.account_names
    FOR INSERT
    WITH CHECK (private.owns_account(account_id));

CREATE POLICY "Account owners can insert their own avatars"
    ON public.account_avatars
    FOR INSERT
    WITH CHECK (private.owns_account(account_id));

CREATE POLICY "Account owners can view their own names"
    ON public.account_names
    FOR SELECT
    USING (private.owns_account(account_id));

CREATE POLICY "Account owners can view their own avatars"
    ON public.account_avatars
    FOR SELECT
    USING (private.owns_account(account_id));

CREATE TABLE public.organization_members (
    id                      BIGINT                 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id         BIGINT                 NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    account_id              BIGINT                 NOT NULL REFERENCES public.accounts(id)        ON DELETE CASCADE,
    invited_by_account_id   BIGINT                 REFERENCES public.accounts(id) ON DELETE SET NULL,
    joined_at               TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, account_id)
);
GRANT ALL ON TABLE public.organization_members TO authenticated, service_role;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_org_members_account ON public.organization_members(account_id);
CREATE INDEX idx_org_members_org  ON public.organization_members(organization_id);
CREATE OR REPLACE FUNCTION private.on_insert_organization_members() RETURNS TRIGGER AS $$ BEGIN NEW.joined_at = NOW(); NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_organization_members_inserted BEFORE INSERT ON public.organization_members FOR EACH ROW EXECUTE FUNCTION private.on_insert_organization_members();

CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id BIGINT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members om
        JOIN public.accounts a ON a.id = om.account_id
        WHERE om.organization_id = p_org_id
          AND a.user_id = auth.uid()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

CREATE POLICY "Allow members to view their organization"
    ON public.organizations FOR SELECT
    TO authenticated
    USING (private.is_org_member(id));

-- Allow any org member to SELECT rows from organization_members for their org.
CREATE POLICY "Allow members to view org roster"
    ON public.organization_members FOR SELECT
    TO authenticated
    USING (private.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION private.on_auth_user_created()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.accounts (user_id, created_at)
        VALUES (
            NEW.id,
            NOW()
        )
        ON CONFLICT (user_id) DO NOTHING;
    -- Create an organization for the new account
    INSERT INTO public.organizations (slug, created_at)
        VALUES ('org-' || NEW.id, NOW())
        ON CONFLICT (slug) DO NOTHING;
    -- Add the account to the organization
    INSERT INTO public.organization_members (organization_id, account_id, joined_at, created_at)
        SELECT o.id, a.id, NOW(), NOW()
        FROM public.organizations o
        JOIN public.accounts a ON a.user_id = NEW.id
        WHERE o.slug = 'org-' || NEW.id
        ON CONFLICT (organization_id, account_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION private.on_auth_user_created();


-- Allow org members to view accounts/names/avatars of other members of the same org.
-- TODO