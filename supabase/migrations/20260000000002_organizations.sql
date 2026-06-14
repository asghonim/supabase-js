CREATE TABLE public.organizations (
    id                           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                          UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    slug                         TEXT        NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 100),
    metadata                     JSONB       NOT NULL DEFAULT '{}',
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.organizations TO authenticated, service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_insert_organizations() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_organizations BEFORE INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.on_insert_organizations();

CREATE TABLE public.organization_names (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.organization_names TO authenticated, service_role;
ALTER TABLE public.organization_names ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_organization_names_organization ON public.organization_names(organization_id);

CREATE OR REPLACE FUNCTION private.on_insert_organization_names() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_organization_names BEFORE INSERT ON public.organization_names FOR EACH ROW EXECUTE FUNCTION private.on_insert_organization_names();
