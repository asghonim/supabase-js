CREATE TABLE public.organizations (
    id                           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug                         TEXT        NOT NULL UNIQUE,
    metadata                     JSONB       NOT NULL DEFAULT '{}',
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.organizations TO authenticated, service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_insert_organizations() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
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