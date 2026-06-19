-- ================================================================
-- API KEYS
--
-- API keys allow programmatic access to the API, scoped to an
-- organization. Any org member may create, and revoke keys.
--
-- Security model:
--   * Only the SHA-256 hash of the key is stored — plaintext is
--     shown once at creation time and never persisted.
--   * key_prefix (first 16 chars) is stored for display only.
--   * RLS restricts access to members of the owning organization.
-- ================================================================
CREATE TABLE public.api_scopes (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    key         TEXT        NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 1 AND 100),
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description TEXT        CHECK (char_length(description) <= 1000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
ALTER TABLE public.api_scopes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.api_scopes TO service_role;
INSERT INTO public.api_scopes (key, name, description) VALUES
    ('read',           'Read',           'Read-only access to all resources'),
    ('write',          'Write',          'Read and write access to all resources'),
    ('qr:read',        'QR Read',        'Read QR code resources'),
    ('qr:write',       'QR Write',       'Create and update QR code resources'),
    ('analytics:read', 'Analytics Read', 'Access analytics data'),
    ('webhooks:write', 'Webhooks Write', 'Manage webhook endpoints'),
    ('billing:read',   'Billing Read',   'Read billing and invoice data');


GRANT SELECT ON TABLE public.api_scopes TO authenticated;
CREATE POLICY "Authenticated users can view api scopes"
    ON public.api_scopes FOR SELECT TO authenticated USING (TRUE);


CREATE TABLE public.api_keys (
    id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid          UUID         NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    org_id       BIGINT       NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    account_id   BIGINT       NOT NULL REFERENCES public.accounts(id)      ON DELETE CASCADE,
    name         TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    key_prefix   TEXT         NOT NULL,
    key_hash     TEXT         NOT NULL UNIQUE,
    scopes       TEXT[]       NOT NULL DEFAULT '{}',
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_api_keys_org     ON public.api_keys(org_id);
CREATE INDEX idx_api_keys_account ON public.api_keys(account_id);
CREATE INDEX idx_api_keys_hash    ON public.api_keys(key_hash);
CREATE INDEX idx_api_keys_active  ON public.api_keys(key_hash) WHERE revoked_at IS NULL;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.api_keys TO service_role;

-- GRANT INSERT (org_id, account_id, name, key_prefix, key_hash, scopes, expires_at, last_used_at, revoked_at) ON TABLE public.api_keys TO authenticated;


GRANT SELECT ON TABLE public.api_keys TO authenticated;
CREATE POLICY "Org members with apikey.create can view api keys"
    ON public.api_keys FOR SELECT TO authenticated
    USING (
        private.has_org_permission(org_id, 'apikey.create')
        OR public.has_permission('view', 'api_key', id)
    );


-- Revoking is the only mutation users may perform on an api key, and it must
-- go through this function rather than a direct UPDATE/DELETE on the table.
CREATE OR REPLACE FUNCTION public.revoke_api_key(p_api_key_id BIGINT) RETURNS void AS $$
	DECLARE
		v_org_id BIGINT;
	BEGIN
		SELECT org_id INTO v_org_id FROM public.api_keys WHERE id = p_api_key_id AND revoked_at IS NULL;
		IF v_org_id IS NULL THEN
			RETURN;
		END IF;
		IF NOT (private.has_org_permission(v_org_id, 'apikey.create') OR public.has_permission('delete', 'api_key', p_api_key_id)) THEN
			RAISE EXCEPTION 'Insufficient permissions to revoke api key';
		END IF;
		UPDATE public.api_keys SET revoked_at = NOW() WHERE id = p_api_key_id AND revoked_at IS NULL;
	END;
	$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.revoke_api_key(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(BIGINT) TO authenticated;