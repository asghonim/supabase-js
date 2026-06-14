CREATE TABLE public.permissions (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    key         TEXT        NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 1 AND 100),
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description TEXT        CHECK (char_length(description) <= 1000),
    scope       TEXT        NOT NULL CHECK (scope IN ('platform', 'organization', 'project', 'api')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.permissions TO authenticated, service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_permissions_scope ON public.permissions(scope);

CREATE OR REPLACE FUNCTION private.on_insert_permissions() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_permissions BEFORE INSERT ON public.permissions FOR EACH ROW EXECUTE FUNCTION private.on_insert_permissions();

CREATE TABLE public.platform_roles (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    key         TEXT        NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 1 AND 100),
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description TEXT        CHECK (char_length(description) <= 1000),
    is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.platform_roles TO authenticated, service_role;
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.on_insert_platform_roles() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_platform_roles BEFORE INSERT ON public.platform_roles FOR EACH ROW EXECUTE FUNCTION private.on_insert_platform_roles();

CREATE TABLE public.platform_role_permissions (
    platform_role_id BIGINT      NOT NULL REFERENCES public.platform_roles(id) ON DELETE CASCADE,
    permission_id    BIGINT      NOT NULL REFERENCES public.permissions(id)     ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (platform_role_id, permission_id)
);
GRANT ALL ON TABLE public.platform_role_permissions TO authenticated, service_role;
ALTER TABLE public.platform_role_permissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_platform_role_perms_role ON public.platform_role_permissions(platform_role_id);

CREATE OR REPLACE FUNCTION private.on_insert_platform_role_permissions() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_platform_role_permissions BEFORE INSERT ON public.platform_role_permissions FOR EACH ROW EXECUTE FUNCTION private.on_insert_platform_role_permissions();

CREATE TABLE public.account_platform_roles (
    account_id            BIGINT      NOT NULL REFERENCES public.accounts(id)       ON DELETE CASCADE,
    platform_role_id      BIGINT      NOT NULL REFERENCES public.platform_roles(id) ON DELETE CASCADE,
    granted_by_account_id BIGINT               REFERENCES public.accounts(id)       ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, platform_role_id)
);
GRANT ALL ON TABLE public.account_platform_roles TO authenticated, service_role;
ALTER TABLE public.account_platform_roles ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_account_platform_roles_account ON public.account_platform_roles(account_id);

CREATE OR REPLACE FUNCTION private.on_insert_account_platform_roles() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_account_platform_roles BEFORE INSERT ON public.account_platform_roles FOR EACH ROW EXECUTE FUNCTION private.on_insert_account_platform_roles();

-- organization_id IS NULL → system role (available to every org).
-- organization_id IS NOT NULL → custom role scoped to that org.
CREATE TABLE public.organization_roles (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT               REFERENCES public.organizations(id) ON DELETE CASCADE,
    key             TEXT        NOT NULL CHECK (char_length(key) BETWEEN 1 AND 100),
    name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description     TEXT        CHECK (char_length(description) <= 1000),
    is_system       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.organization_roles TO authenticated, service_role;
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX uq_org_role_key_scoped ON public.organization_roles(organization_id, key) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX uq_org_role_key_system ON public.organization_roles(key) WHERE organization_id IS NULL;
CREATE INDEX idx_org_roles_org ON public.organization_roles(organization_id);

CREATE OR REPLACE FUNCTION private.on_insert_organization_roles() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_organization_roles BEFORE INSERT ON public.organization_roles FOR EACH ROW EXECUTE FUNCTION private.on_insert_organization_roles();

CREATE TABLE public.organization_role_permissions (
    organization_role_id BIGINT      NOT NULL REFERENCES public.organization_roles(id) ON DELETE CASCADE,
    permission_id        BIGINT      NOT NULL REFERENCES public.permissions(id)         ON DELETE CASCADE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_role_id, permission_id)
);
GRANT ALL ON TABLE public.organization_role_permissions TO authenticated, service_role;
ALTER TABLE public.organization_role_permissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_org_role_perms_role ON public.organization_role_permissions(organization_role_id);

CREATE OR REPLACE FUNCTION private.on_insert_organization_role_permissions() RETURNS TRIGGER AS $$ BEGIN NEW.created_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public, private;
CREATE TRIGGER on_insert_organization_role_permissions BEFORE INSERT ON public.organization_role_permissions FOR EACH ROW EXECUTE FUNCTION private.on_insert_organization_role_permissions();

INSERT INTO public.organization_roles (organization_id, key, name, description, is_system) VALUES
    (NULL, 'owner',   'Owner',           'Full organizational control; cannot be removed without transferring ownership', TRUE),
    (NULL, 'admin',   'Administrator',   'Manage members, settings, and billing',                                         TRUE),
    (NULL, 'member',  'Member',          'Standard team member access',                                                   TRUE),
    (NULL, 'billing', 'Billing Manager', 'Billing and invoice access only',                                               TRUE);

CREATE OR REPLACE FUNCTION private.default_member_role_id()
RETURNS BIGINT AS $$
    SELECT id FROM public.organization_roles WHERE key = 'member' AND organization_id IS NULL
$$ LANGUAGE sql STABLE SET search_path = public, private;

ALTER TABLE public.organization_members
    ADD COLUMN organization_role_id BIGINT NOT NULL DEFAULT private.default_member_role_id()
    REFERENCES public.organization_roles(id) ON DELETE RESTRICT;

CREATE INDEX idx_org_members_org_role ON public.organization_members(organization_role_id);

-- ================================================================
-- SEED: PERMISSIONS
-- ================================================================

INSERT INTO public.permissions (key, name, description, scope) VALUES
    -- platform
    ('platform.admin',       'Platform Administrator',   'Full platform access; bypasses all org and project checks',          'platform'),
    ('platform.support',     'Platform Support Access',  'Read-only support access across all resources',                      'platform'),
    -- organization
    ('organization.manage',  'Manage Organization',      'Update org settings, slug, and metadata',                            'organization'),
    ('users.invite',         'Invite Users',             'Send org membership invitations',                                    'organization'),
    ('billing.manage',       'Manage Billing',           'View and update billing, plans, and invoices',                       'organization'),
    ('analytics.view',       'View Analytics',           'Access analytics and usage dashboards',                              'organization'),
    ('audit.view',           'View Audit Logs',          'Read audit trails and access logs',                                  'organization'),
    ('security.review',      'Security Review',          'Review security settings and security events',                       'organization'),
    ('wallet.view',          'View Wallet',              'View organization wallet balance and transaction history',            'organization'),
    -- project
    ('qr.view',              'View QR Codes',            'Read QR code resources',                                             'project'),
    ('qr.create',            'Create QR Codes',          'Create new QR code resources',                                       'project'),
    ('qr.update',            'Update QR Codes',          'Modify existing QR code resources',                                  'project'),
    ('qr.delete',            'Delete QR Codes',          'Delete QR code resources',                                           'project'),
    ('apikey.create',        'Create API Keys',          'Generate new API keys for programmatic access',                      'project'),
    ('webhooks.manage',      'Manage Webhooks',          'Configure and manage webhook endpoints',                              'project'),
    -- api
    ('api:read',             'API Read',                 'Read-only access via API key',                                       'api'),
    ('api:write',            'API Write',                'Read and write access via API key',                                  'api');

-- ================================================================
-- SEED: PLATFORM ROLES
-- ================================================================

INSERT INTO public.platform_roles (key, name, description, is_system) VALUES
    ('super_admin', 'Super Administrator', 'Unrestricted access to all platform resources', TRUE),
    ('support',     'Support Agent',       'Read-only cross-org support access',             TRUE),
    ('auditor',     'Auditor',             'Compliance and security audit access',            TRUE);

-- super_admin → every permission
INSERT INTO public.platform_role_permissions (platform_role_id, permission_id)
SELECT pr.id, p.id
FROM public.platform_roles pr, public.permissions p
WHERE pr.key = 'super_admin';

-- support
INSERT INTO public.platform_role_permissions (platform_role_id, permission_id)
SELECT pr.id, p.id
FROM public.platform_roles pr
JOIN public.permissions p ON p.key IN ('platform.support', 'analytics.view', 'audit.view')
WHERE pr.key = 'support';

-- auditor
INSERT INTO public.platform_role_permissions (platform_role_id, permission_id)
SELECT pr.id, p.id
FROM public.platform_roles pr
JOIN public.permissions p ON p.key IN ('audit.view', 'security.review')
WHERE pr.key = 'auditor';


-- owner → everything
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
SELECT r.id, p.id
FROM public.organization_roles r
JOIN public.permissions p ON p.key IN (
    'organization.manage', 'users.invite', 'billing.manage',
    'analytics.view', 'audit.view', 'security.review',
    'wallet.view', 'apikey.create'
)
WHERE r.key = 'owner' AND r.organization_id IS NULL;

-- admin
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
SELECT r.id, p.id
FROM public.organization_roles r
JOIN public.permissions p ON p.key IN (
    'organization.manage', 'users.invite', 'billing.manage', 'analytics.view',
    'wallet.view', 'apikey.create'
)
WHERE r.key = 'admin' AND r.organization_id IS NULL;

-- member
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
SELECT r.id, p.id
FROM public.organization_roles r
JOIN public.permissions p ON p.key IN ('analytics.view')
WHERE r.key = 'member' AND r.organization_id IS NULL;

-- billing
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
SELECT r.id, p.id
FROM public.organization_roles r
JOIN public.permissions p ON p.key IN ('billing.manage', 'wallet.view', 'analytics.view')
WHERE r.key = 'billing' AND r.organization_id IS NULL;

-- Returns true if the calling user holds the named platform permission.
CREATE OR REPLACE FUNCTION private.has_platform_permission(p_permission_key TEXT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.account_platform_roles   apr
        JOIN public.platform_role_permissions prp ON prp.platform_role_id = apr.platform_role_id
        JOIN public.permissions              p   ON p.id  = prp.permission_id
        JOIN public.accounts                 a   ON a.id  = apr.account_id
        WHERE a.user_id = auth.uid()
          AND p.key     = p_permission_key
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

CREATE OR REPLACE FUNCTION private.is_platform_admin()
RETURNS BOOLEAN AS $$
    SELECT private.has_platform_permission('platform.admin');
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

CREATE OR REPLACE FUNCTION private.has_org_permission(p_org_id BIGINT, p_permission_key TEXT)
RETURNS BOOLEAN AS $$
    SELECT
        private.is_platform_admin()
        OR EXISTS (
            SELECT 1
            FROM public.organization_members         om
            JOIN public.organization_role_permissions orp ON orp.organization_role_id = om.organization_role_id
            JOIN public.permissions                  p   ON p.id  = orp.permission_id
            JOIN public.accounts                     a   ON a.id  = om.account_id
            WHERE om.organization_id = p_org_id
              AND a.user_id          = auth.uid()
              AND p.key              = p_permission_key
        );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


CREATE OR REPLACE FUNCTION private.is_org_admin(p_org_id BIGINT)
RETURNS BOOLEAN AS $$
    SELECT private.has_org_permission(p_org_id, 'organization.manage');
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


CREATE POLICY "Allow admins to manage org membership"
    ON public.organization_members FOR ALL
    TO authenticated
    USING (private.is_org_admin(organization_id));

CREATE POLICY "Allow org admins to view organization names"
    ON public.organization_names FOR SELECT
    TO authenticated
    USING (private.is_org_admin(organization_id));

CREATE POLICY "Allow org owner to view organization names"
    ON public.organization_names FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.organization_members om
            JOIN public.accounts             a ON a.id  = om.account_id
            JOIN public.organization_roles   r ON r.id  = om.organization_role_id
            WHERE om.organization_id = public.organization_names.organization_id
              AND a.user_id          = auth.uid()
              AND r.key              = 'owner'
        )
    );

CREATE POLICY "Allow owner to insert organization name"
    ON public.organization_names FOR INSERT
    TO authenticated
    WITH CHECK (exists(SELECT 1 FROM public.organizations o WHERE o.id = public.organization_names.organization_id AND private.is_org_admin(o.id)));

CREATE OR REPLACE FUNCTION public.get_my_platform_permissions()
RETURNS TEXT[] AS $$
    SELECT COALESCE(ARRAY_AGG(DISTINCT p.key), '{}')
    FROM public.account_platform_roles    apr
    JOIN public.platform_role_permissions prp ON prp.platform_role_id = apr.platform_role_id
    JOIN public.permissions               p   ON p.id = prp.permission_id
    JOIN public.accounts                  a   ON a.id = apr.account_id
    WHERE a.user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

CREATE OR REPLACE FUNCTION public.get_my_org_permissions(p_org_id BIGINT)
RETURNS TEXT[] AS $$
    SELECT COALESCE(ARRAY_AGG(DISTINCT p.key), '{}')
    FROM public.organization_members         om
    JOIN public.organization_role_permissions orp ON orp.organization_role_id = om.organization_role_id
    JOIN public.permissions                  p   ON p.id = orp.permission_id
    JOIN public.accounts                     a   ON a.id = om.account_id
    WHERE om.organization_id = p_org_id
      AND a.user_id          = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


CREATE POLICY "Authenticated users can view permissions"
    ON public.permissions FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Authenticated users can view platform roles"
    ON public.platform_roles FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Authenticated users can view platform role permissions"
    ON public.platform_role_permissions FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Users can view their own platform roles"
    ON public.account_platform_roles FOR SELECT TO authenticated
    USING (
        private.is_platform_admin()
        OR account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
    );
CREATE POLICY "Platform admins can manage account platform roles"
    ON public.account_platform_roles FOR ALL TO authenticated
    USING (private.is_platform_admin())
    WITH CHECK (private.is_platform_admin());

CREATE POLICY "Org members can view their organization roles"
    ON public.organization_roles FOR SELECT TO authenticated
    USING (
        organization_id IS NULL
        OR private.is_org_member(organization_id)
    );
CREATE POLICY "Org admins can manage custom roles"
    ON public.organization_roles FOR ALL TO authenticated
    USING (organization_id IS NOT NULL AND private.is_org_admin(organization_id))
    WITH CHECK (organization_id IS NOT NULL AND private.is_org_admin(organization_id));

CREATE POLICY "Authenticated users can view organization role permissions"
    ON public.organization_role_permissions FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.organization_roles r
            WHERE r.id = organization_role_id
              AND (
                  r.organization_id IS NULL
                  OR private.is_org_member(r.organization_id)
              )
        )
    );
CREATE POLICY "Org admins can manage custom role permissions"
    ON public.organization_role_permissions FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.organization_roles r
            WHERE r.id = organization_role_id
              AND r.organization_id IS NOT NULL
              AND private.is_org_admin(r.organization_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.organization_roles r
            WHERE r.id = organization_role_id
              AND r.organization_id IS NOT NULL
              AND private.is_org_admin(r.organization_id)
        )
    );
