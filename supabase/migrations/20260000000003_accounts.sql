CREATE TABLE public.accounts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID         NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    user_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.accounts TO authenticated, service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_insert_accounts()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_accounts
BEFORE INSERT ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION private.on_insert_accounts();

CREATE TABLE public.account_names (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID         NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    account_id  BIGINT       NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    name        TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    created_at  TIMESTAMPTZ  NOT NULL
);
GRANT ALL ON TABLE public.account_names TO authenticated, service_role;
ALTER TABLE public.account_names ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_account_names_account ON public.account_names(account_id, created_at DESC);

CREATE TABLE public.account_avatars (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID         NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    account_id  BIGINT       NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    url         TEXT         NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
    created_at  TIMESTAMPTZ  NOT NULL
);
GRANT ALL ON TABLE public.account_avatars TO authenticated, service_role;
ALTER TABLE public.account_avatars ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_account_avatars_account ON public.account_avatars(account_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.on_insert_account_names()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_account_names
BEFORE INSERT ON public.account_names
FOR EACH ROW EXECUTE FUNCTION private.on_insert_account_names();

CREATE OR REPLACE FUNCTION private.on_insert_account_avatars()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER on_insert_account_avatars
BEFORE INSERT ON public.account_avatars
FOR EACH ROW EXECUTE FUNCTION private.on_insert_account_avatars();

CREATE POLICY "Account owners can view their own accounts"
    ON public.accounts
    FOR SELECT
    TO authenticated
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
    TO authenticated
    WITH CHECK (private.owns_account(account_id));

CREATE POLICY "Account owners can insert their own avatars"
    ON public.account_avatars
    FOR INSERT
    TO authenticated
    WITH CHECK (private.owns_account(account_id));

CREATE POLICY "Account owners can view their own names"
    ON public.account_names
    FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id));

CREATE POLICY "Account owners can view their own avatars"
    ON public.account_avatars
    FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id));

CREATE TABLE public.organization_members (
    id                      BIGINT                 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                     UUID                   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
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
CREATE INDEX idx_org_members_org     ON public.organization_members(organization_id);

CREATE OR REPLACE FUNCTION private.on_insert_organization_members() RETURNS TRIGGER AS $$ BEGIN NEW.joined_at = NOW(); NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_organization_members BEFORE INSERT ON public.organization_members FOR EACH ROW EXECUTE FUNCTION private.on_insert_organization_members();

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

CREATE POLICY "Allow members to view org roster"
    ON public.organization_members FOR SELECT
    TO authenticated
    USING (private.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION private.on_auth_users_inserted()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.accounts (user_id, created_at)
        VALUES (NEW.id, NOW())
        ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.organizations (slug, created_at)
        VALUES ('org-' || NEW.id, NOW())
        ON CONFLICT (slug) DO NOTHING;
    INSERT INTO public.organization_members (organization_id, account_id, joined_at, created_at)
        SELECT o.id, a.id, NOW(), NOW()
        FROM public.organizations o
        JOIN public.accounts a ON a.user_id = NEW.id
        WHERE o.slug = 'org-' || NEW.id
        ON CONFLICT (organization_id, account_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE OR REPLACE TRIGGER on_auth_users_inserted
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION private.on_auth_users_inserted();


-- Allow org members to view accounts/names/avatars of other members of the same org.
-- TODO
