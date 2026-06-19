CREATE TABLE public.organization_names (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_organization_names_organization ON public.organization_names(organization_id);
ALTER TABLE public.organization_names ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.organization_names TO service_role;


GRANT SELECT ON TABLE public.organization_names TO authenticated;
CREATE POLICY "Allow org admins and owners to view organization names"
    ON public.organization_names FOR SELECT
    TO authenticated
    USING (
        private.is_org_admin(organization_id)
        OR private.has_org_role(organization_id, 'owner')
        OR public.has_permission('view', 'organization', organization_id)
    );

GRANT INSERT (organization_id, name) ON TABLE public.organization_names TO authenticated;
CREATE POLICY "Allow owner to insert organization name"
    ON public.organization_names FOR INSERT
    TO authenticated
    WITH CHECK (
        exists(SELECT 1 FROM public.organizations o WHERE o.id = public.organization_names.organization_id AND (private.is_org_admin(o.id) OR private.has_org_role(o.id, 'owner')))
        OR public.has_permission('edit', 'organization', organization_id)
    );


CREATE TABLE public.account_names (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID         NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    account_id  BIGINT       NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    name        TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_account_names_account ON public.account_names(account_id, created_at DESC);
ALTER TABLE public.account_names ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.account_names TO service_role;


GRANT SELECT ON TABLE public.account_names TO authenticated;
CREATE POLICY "Account owners can view their own names"
    ON public.account_names
    FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id) OR public.has_permission('view', 'account_name', id));


GRANT INSERT (account_id, name) ON TABLE public.account_names TO authenticated;
CREATE POLICY "Account owners can insert their own names"
    ON public.account_names
    FOR INSERT
    TO authenticated
    WITH CHECK (private.owns_account(account_id) OR public.has_permission('edit', 'account_name', NULL));


CREATE TABLE public.account_avatars (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID         NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    account_id  BIGINT       NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    url         TEXT         NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_account_avatars_account ON public.account_avatars(account_id, created_at DESC);
ALTER TABLE public.account_avatars ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.account_avatars TO service_role;


GRANT SELECT ON TABLE public.account_avatars TO authenticated;
CREATE POLICY "Account owners can view their own avatars"
    ON public.account_avatars
    FOR SELECT
    TO authenticated
    USING (private.owns_account(account_id) OR public.has_permission('view', 'account_avatar', id));


GRANT INSERT (account_id, url) ON TABLE public.account_avatars TO authenticated;
CREATE POLICY "Account owners can insert their own avatars"
    ON public.account_avatars
    FOR INSERT
    TO authenticated
    WITH CHECK (private.owns_account(account_id) OR public.has_permission('edit', 'account_avatar', NULL));
