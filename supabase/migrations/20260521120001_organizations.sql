CREATE TABLE public.organizations (
    id                           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug                         TEXT        NOT NULL UNIQUE,
    owner_account_id             BIGINT      NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    metadata                     JSONB       NOT NULL DEFAULT '{}',
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.organizations TO authenticated, service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_organizations_owner ON public.organizations(owner_account_id);

CREATE OR REPLACE FUNCTION private.on_update_organization() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_update_organization BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.on_update_organization();

CREATE OR REPLACE FUNCTION private.on_insert_organizations() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_organizations_inserted BEFORE INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.on_insert_organizations();

CREATE TABLE public.organization_names (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.organization_names TO authenticated, service_role;
ALTER TABLE public.organization_names ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_organization_names_org ON public.organization_names(organization_id);

CREATE OR REPLACE FUNCTION private.on_insert_organization_names() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_organization_names_inserted BEFORE INSERT ON public.organization_names FOR EACH ROW EXECUTE FUNCTION private.on_insert_organization_names();

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
