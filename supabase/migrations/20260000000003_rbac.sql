CREATE TABLE public.organizations (
    id                           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                          UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    slug                         TEXT        NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 100),
    metadata                     JSONB       NOT NULL DEFAULT '{}',
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.organizations TO service_role;


CREATE TABLE public.accounts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID         NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    user_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.accounts TO service_role;

CREATE OR REPLACE FUNCTION public.my_account_id()
    RETURNS BIGINT AS $$
    SELECT id FROM public.accounts WHERE user_id = auth.uid()
    $$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

CREATE OR REPLACE FUNCTION private.owns_account(p_account_id BIGINT)
    RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.accounts a
        WHERE a.id = p_account_id
          AND a.user_id = auth.uid()
    );
    $$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


GRANT SELECT ON TABLE public.accounts TO authenticated;
CREATE POLICY "Account owners can view their own accounts"
    ON public.accounts
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());


CREATE TABLE public.permissions (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    key         TEXT        NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 1 AND 100),
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description TEXT        CHECK (char_length(description) <= 1000),
    scope       TEXT        NOT NULL CHECK (scope IN ('platform', 'organization', 'project', 'api')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX idx_permissions_scope ON public.permissions(scope);
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.permissions TO service_role;
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


GRANT SELECT ON public.permissions TO authenticated;
CREATE POLICY "Authenticated users can view permissions"
    ON public.permissions FOR SELECT TO authenticated USING (TRUE);


CREATE TABLE public.platform_roles (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid         UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    key         TEXT        NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 1 AND 100),
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description TEXT        CHECK (char_length(description) <= 1000),
    is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.platform_roles TO service_role;
INSERT INTO public.platform_roles (key, name, description, is_system) VALUES
    ('super_admin', 'Super Administrator', 'Unrestricted access to all platform resources', TRUE),
    ('support',     'Support Agent',       'Read-only cross-org support access',             TRUE),
    ('auditor',     'Auditor',             'Compliance and security audit access',            TRUE);


GRANT SELECT ON TABLE public.platform_roles TO authenticated;
CREATE POLICY "Authenticated users can view platform roles"
    ON public.platform_roles FOR SELECT TO authenticated USING (TRUE);


CREATE TABLE public.platform_role_permissions (
    platform_role_id BIGINT      NOT NULL REFERENCES public.platform_roles(id) ON DELETE CASCADE,
    permission_id    BIGINT      NOT NULL REFERENCES public.permissions(id)     ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (platform_role_id, permission_id)
    );
CREATE INDEX idx_platform_role_perms_role ON public.platform_role_permissions(platform_role_id);
ALTER TABLE public.platform_role_permissions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.platform_role_permissions TO service_role;
INSERT INTO public.platform_role_permissions (platform_role_id, permission_id) -- super_admin → every permission
    SELECT pr.id, p.id
    FROM public.platform_roles pr, public.permissions p
    WHERE pr.key = 'super_admin';
INSERT INTO public.platform_role_permissions (platform_role_id, permission_id)
    SELECT pr.id, p.id
    FROM public.platform_roles pr
    JOIN public.permissions p ON p.key IN ('platform.support', 'analytics.view', 'audit.view')
    WHERE pr.key = 'support';
INSERT INTO public.platform_role_permissions (platform_role_id, permission_id)
    SELECT pr.id, p.id
    FROM public.platform_roles pr
    JOIN public.permissions p ON p.key IN ('audit.view', 'security.review')
    WHERE pr.key = 'auditor';


GRANT SELECT ON TABLE public.platform_role_permissions TO authenticated;
CREATE POLICY "Authenticated users can view platform role permissions"
    ON public.platform_role_permissions FOR SELECT TO authenticated USING (TRUE);


CREATE TABLE public.account_platform_roles (
    account_id            BIGINT      NOT NULL REFERENCES public.accounts(id)       ON DELETE CASCADE,
    platform_role_id      BIGINT      NOT NULL REFERENCES public.platform_roles(id) ON DELETE CASCADE,
    granted_by_account_id BIGINT               REFERENCES public.accounts(id)       ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, platform_role_id)
    );
CREATE INDEX idx_account_platform_roles_account ON public.account_platform_roles(account_id);
ALTER TABLE public.account_platform_roles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.account_platform_roles TO service_role;


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


GRANT SELECT ON TABLE public.account_platform_roles TO authenticated;
CREATE POLICY "Users can view their own platform roles"
    ON public.account_platform_roles FOR SELECT TO authenticated
    USING (
        private.is_platform_admin()
        OR account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
    );


CREATE TABLE public.organization_roles (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    -- organization_id IS NULL → system role (available to every org).
    -- organization_id IS NOT NULL → custom role scoped to that org.
    organization_id BIGINT               REFERENCES public.organizations(id) ON DELETE CASCADE,
    key             TEXT        NOT NULL CHECK (char_length(key) BETWEEN 1 AND 100),
    name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    description     TEXT        CHECK (char_length(description) <= 1000),
    is_system       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE UNIQUE INDEX uq_org_role_key_scoped ON public.organization_roles(organization_id, key) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX uq_org_role_key_system ON public.organization_roles(key) WHERE organization_id IS NULL;
CREATE INDEX idx_org_roles_org ON public.organization_roles(organization_id);
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.organization_roles TO service_role;
INSERT INTO public.organization_roles (organization_id, key, name, description, is_system) VALUES
    (NULL, 'owner',   'Owner',           'Full organizational control; cannot be removed without transferring ownership', TRUE),
    (NULL, 'admin',   'Administrator',   'Manage members, settings, and billing',                                         TRUE),
    (NULL, 'member',  'Member',          'Standard team member access',                                                   TRUE),
    (NULL, 'billing', 'Billing Manager', 'Billing and invoice access only',                                               TRUE);


CREATE TABLE public.organization_role_permissions (
    organization_role_id BIGINT      NOT NULL REFERENCES public.organization_roles(id) ON DELETE CASCADE,
    permission_id        BIGINT      NOT NULL REFERENCES public.permissions(id)         ON DELETE CASCADE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_role_id, permission_id)
    );
CREATE INDEX idx_org_role_perms_role ON public.organization_role_permissions(organization_role_id);
ALTER TABLE public.organization_role_permissions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.organization_role_permissions TO service_role;
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
    SELECT r.id, p.id
    FROM public.organization_roles r
    JOIN public.permissions p ON p.key IN (
        'organization.manage', 'users.invite', 'billing.manage',
        'analytics.view', 'audit.view', 'security.review',
        'wallet.view', 'apikey.create'
    )
    WHERE r.key = 'owner' AND r.organization_id IS NULL;
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
    SELECT r.id, p.id
    FROM public.organization_roles r
    JOIN public.permissions p ON p.key IN (
        'organization.manage', 'users.invite', 'billing.manage', 'analytics.view',
        'wallet.view', 'apikey.create'
    )
    WHERE r.key = 'admin' AND r.organization_id IS NULL;
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
    SELECT r.id, p.id
    FROM public.organization_roles r
    JOIN public.permissions p ON p.key IN ('analytics.view')
    WHERE r.key = 'member' AND r.organization_id IS NULL;
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
    SELECT r.id, p.id
    FROM public.organization_roles r
    JOIN public.permissions p ON p.key IN ('billing.manage', 'wallet.view', 'analytics.view')
    WHERE r.key = 'billing' AND r.organization_id IS NULL;


CREATE OR REPLACE FUNCTION private.default_member_role_id()
    RETURNS BIGINT AS $$
        SELECT id FROM public.organization_roles WHERE key = 'member' AND organization_id IS NULL
    $$ LANGUAGE sql STABLE SET search_path = public, private;


CREATE TABLE public.organization_members (
    id                      BIGINT                 GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                     UUID                   NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id         BIGINT                 NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    account_id              BIGINT                 NOT NULL REFERENCES public.accounts(id)        ON DELETE CASCADE,
    invited_by_account_id   BIGINT                 REFERENCES public.accounts(id) ON DELETE SET NULL,
    joined_at               TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    organization_role_id    BIGINT                 NOT NULL DEFAULT private.default_member_role_id() REFERENCES public.organization_roles(id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, account_id)
    );
CREATE INDEX idx_org_members_account ON public.organization_members(account_id);
CREATE INDEX idx_org_members_org     ON public.organization_members(organization_id);
CREATE INDEX idx_org_members_org_role ON public.organization_members(organization_role_id);
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.organization_members TO service_role;


CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id BIGINT)
    RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members om
        JOIN public.accounts a ON a.id = om.account_id
        WHERE om.organization_id = p_org_id
          AND a.user_id = auth.uid()
    );
    $$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


GRANT SELECT ON TABLE public.organization_members TO authenticated;
CREATE POLICY "Allow members to view org roster"
    ON public.organization_members FOR SELECT
    TO authenticated
    USING (private.is_org_member(organization_id));


GRANT SELECT ON TABLE public.organization_roles TO authenticated;
CREATE POLICY "Org members can view their organization roles"
    ON public.organization_roles FOR SELECT TO authenticated
    USING (
        organization_id IS NULL
        OR private.is_org_member(organization_id)
    );


GRANT SELECT ON TABLE public.organization_role_permissions TO authenticated;
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


CREATE OR REPLACE FUNCTION private.on_auth_user_inserted()
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
CREATE OR REPLACE TRIGGER on_auth_user_inserted
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION private.on_auth_user_inserted();


GRANT SELECT ON TABLE public.organizations TO authenticated;
CREATE POLICY "Allow members to view their organization"
    ON public.organizations FOR SELECT
    TO authenticated
    USING (private.is_org_member(id));


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


CREATE OR REPLACE FUNCTION private.has_org_role(p_org_id BIGINT, r_role_key TEXT)
    RETURNS BOOLEAN AS $$
    SELECT
        private.is_platform_admin()
        OR EXISTS (
            SELECT 1
            FROM public.organization_members om
            JOIN public.organization_roles   r  ON r.id  = om.organization_role_id
            JOIN public.accounts             a  ON a.id  = om.account_id
            WHERE om.organization_id = p_org_id
              AND a.user_id          = auth.uid()
              AND r.key              = r_role_key
        );
    $$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


CREATE OR REPLACE FUNCTION private.is_org_admin(p_org_id BIGINT)
    RETURNS BOOLEAN AS $$
    SELECT private.has_org_permission(p_org_id, 'organization.manage');
    $$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;


-- CREATE POLICY "Allow admins to manage org membership"
--     ON public.organization_members FOR ALL
--     TO authenticated
--     USING (private.is_org_admin(organization_id));


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





-- CREATE POLICY "Platform admins can manage account platform roles"
--     ON public.account_platform_roles FOR ALL TO authenticated
--     USING (private.is_platform_admin())
--     WITH CHECK (private.is_platform_admin());





-- CREATE POLICY "Org admins can manage custom roles"
--     ON public.organization_roles FOR ALL TO authenticated
--     USING (organization_id IS NOT NULL AND private.is_org_admin(organization_id))
--     WITH CHECK (organization_id IS NOT NULL AND private.is_org_admin(organization_id));



-- CREATE POLICY "Org admins can manage custom role permissions"
--     ON public.organization_role_permissions FOR ALL TO authenticated
--     USING (
--         EXISTS (
--             SELECT 1 FROM public.organization_roles r
--             WHERE r.id = organization_role_id
--               AND r.organization_id IS NOT NULL
--               AND private.is_org_admin(r.organization_id)
--         )
--     )
--     WITH CHECK (
--         EXISTS (
--             SELECT 1 FROM public.organization_roles r
--             WHERE r.id = organization_role_id
--               AND r.organization_id IS NOT NULL
--               AND private.is_org_admin(r.organization_id)
--         )
--     );


-- ===========================================================================
-- ACL / ABAC LAYER
--
-- Extends RBAC with:
--   • Polymorphic ACLs  — principal + action + resource
--   • Resource hierarchy — permissions inherited from parent resources
--   • ABAC conditions   — runtime attribute checks on condition_json
--   • Explicit DENY     — DENY always beats ALLOW
--   • Temporal grants   — valid_from / valid_until
--   • Multi-tenancy     — organization_id on every table
--
-- Resolution order (first match wins; DENY trumps ALLOW at any level):
--   1. Explicit DENY  — direct or group-inherited, specific or wildcard resource
--   2. Explicit ALLOW — direct or group-inherited, specific or wildcard resource
--   3. Default DENY
--
-- Usage in RLS policies:
--   USING (private.has_permission(auth.uid(), 'read', 'invoice', id))
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Principals
-- Unified subject abstraction: users, groups, roles, api_keys, service_accounts.
-- Every auth.users → accounts row automatically gets a 'user' principal.
-- ---------------------------------------------------------------------------
CREATE TABLE public.principals (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    principal_type  TEXT        NOT NULL CHECK (principal_type IN ('user','group','role','api_key','service_account')),
    account_id      BIGINT      REFERENCES public.accounts(id)       ON DELETE CASCADE,
    organization_id BIGINT      REFERENCES public.organizations(id)  ON DELETE CASCADE,
    name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_user_principal_has_account
        CHECK (principal_type != 'user' OR account_id IS NOT NULL)
    );
CREATE UNIQUE INDEX uq_principals_user_account ON public.principals(account_id) WHERE principal_type = 'user';
CREATE INDEX idx_principals_account ON public.principals(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX idx_principals_org ON public.principals(organization_id) WHERE organization_id IS NOT NULL;
ALTER TABLE public.principals ENABLE ROW LEVEL SECURITY;
GRANT ALL   ON TABLE public.principals TO service_role;


GRANT SELECT ON TABLE public.principals TO authenticated;
CREATE POLICY "principals_select"
    ON public.principals FOR SELECT TO authenticated
    USING (
        private.is_platform_admin()
        OR account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
    );

CREATE OR REPLACE FUNCTION private.on_account_inserted()
    RETURNS TRIGGER AS $$
    BEGIN
        INSERT INTO public.principals (principal_type, account_id, name)
            VALUES ('user', NEW.id, 'user:' || NEW.uid::TEXT)
            ON CONFLICT (account_id) WHERE principal_type = 'user' DO NOTHING;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
CREATE OR REPLACE TRIGGER on_account_inserted AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION private.on_account_inserted();

-- Backfill principals for any accounts that pre-date this migration
INSERT INTO public.principals (principal_type, account_id, name)
    SELECT 'user', a.id, 'user:' || a.uid::TEXT
    FROM public.accounts a
    ON CONFLICT (account_id) WHERE principal_type = 'user' DO NOTHING;


-- ---------------------------------------------------------------------------
-- Principal Memberships
-- Nested groups and role hierarchies; RBAC becomes a special case of ACL.
--   Ahmed → Managers → Finance → Org Admins
-- ---------------------------------------------------------------------------
CREATE TABLE public.principal_memberships (
    member_principal_id BIGINT      NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
    parent_principal_id BIGINT      NOT NULL REFERENCES public.principals(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (member_principal_id, parent_principal_id),
    CONSTRAINT chk_no_self_membership CHECK (member_principal_id != parent_principal_id)
    );
CREATE INDEX idx_pmembers_member ON public.principal_memberships(member_principal_id);
CREATE INDEX idx_pmembers_parent ON public.principal_memberships(parent_principal_id);
ALTER TABLE public.principal_memberships ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON TABLE public.principal_memberships TO service_role;


GRANT SELECT ON TABLE public.principal_memberships TO authenticated;
CREATE POLICY "pmemberships_select"
    ON public.principal_memberships FOR SELECT TO authenticated
    USING (
        private.is_platform_admin()
        OR member_principal_id IN (
            SELECT id FROM public.principals
            WHERE account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
        )
    );


-- ---------------------------------------------------------------------------
-- Resources
-- Polymorphic resource registry with parent→child hierarchy.
-- Only resources that participate in hierarchy or need explicit ACL entries
-- need a row here; all other records are addressed by type + their own PK.
--   e.g. (resource_type='project', resource_id=99, parent_id → org row)
-- ---------------------------------------------------------------------------
CREATE TABLE public.resources (
    id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    resource_type    TEXT        NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 100),
    resource_id      BIGINT,                 -- PK of the referenced business entity
    parent_id        BIGINT      REFERENCES public.resources(id)      ON DELETE SET NULL,
    organization_id  BIGINT      REFERENCES public.organizations(id)  ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (resource_type, resource_id)
    );
CREATE INDEX idx_resources_type_id ON public.resources(resource_type, resource_id);
CREATE INDEX idx_resources_parent  ON public.resources(parent_id)        WHERE parent_id IS NOT NULL;
CREATE INDEX idx_resources_org     ON public.resources(organization_id)  WHERE organization_id IS NOT NULL;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON TABLE public.resources TO service_role;


GRANT SELECT ON TABLE public.resources TO authenticated;
CREATE POLICY "resources_select"
    ON public.resources FOR SELECT TO authenticated
    USING (
        private.is_platform_admin()
        OR organization_id IS NULL
        OR private.is_org_member(organization_id)
    );


-- ---------------------------------------------------------------------------
-- ACL Entries
-- Heart of the authorization system.
-- resource_id = NULL means "all records of this type" (wildcard).
-- resource_id is NOT a FK — it references the business entity's PK polymorphically.
-- condition_json is evaluated at runtime via private.eval_acl_condition().
-- ---------------------------------------------------------------------------
CREATE TABLE public.acl_entries (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    principal_id    BIGINT      NOT NULL REFERENCES public.principals(id)     ON DELETE CASCADE,
    action          TEXT        NOT NULL CHECK (char_length(action)        BETWEEN 1 AND 100),
    resource_type   TEXT        NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 100),
    resource_id     BIGINT,     -- NULL = wildcard (all records); no FK (polymorphic)
    effect          TEXT        NOT NULL CHECK (effect IN ('ALLOW','DENY')),
    priority        INTEGER     NOT NULL DEFAULT 0,
    condition_json  JSONB,
    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    organization_id BIGINT      REFERENCES public.organizations(id)  ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_valid_temporal
        CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until)
    );
CREATE INDEX idx_acl_lookup   ON public.acl_entries(principal_id, action, resource_type, resource_id);
CREATE INDEX idx_acl_resource  ON public.acl_entries(resource_type, resource_id);
CREATE INDEX idx_acl_org       ON public.acl_entries(organization_id) WHERE organization_id IS NOT NULL;
ALTER TABLE public.acl_entries ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON TABLE public.acl_entries TO service_role;

GRANT SELECT ON TABLE public.acl_entries TO authenticated;
CREATE POLICY "acl_entries_select"
    ON public.acl_entries FOR SELECT TO authenticated
    USING (
        private.is_platform_admin()
        OR principal_id IN (
            SELECT id FROM public.principals
            WHERE account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
        )
    );


-- ---------------------------------------------------------------------------
-- Condition evaluator
-- Evaluates condition_json against the requesting user's attributes.
-- Supported condition keys:
--   account_id      → request must come from this specific account
--   organization_id → user must be a member of this org
-- Unknown keys are treated as satisfied (permissive) to allow forward-compat.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.eval_acl_condition(
        p_condition JSONB,
        p_user_uid  UUID
    ) RETURNS BOOLEAN AS $$
    DECLARE
        v_account_id BIGINT;
    BEGIN
        IF p_condition IS NULL THEN
            RETURN TRUE;
        END IF;

        SELECT id INTO v_account_id
        FROM public.accounts
        WHERE user_id = p_user_uid;

        IF p_condition ? 'account_id'
        AND v_account_id IS DISTINCT FROM (p_condition->>'account_id')::BIGINT
        THEN
            RETURN FALSE;
        END IF;

        IF p_condition ? 'organization_id'
        AND NOT EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.organization_id = (p_condition->>'organization_id')::BIGINT
                AND om.account_id      = v_account_id
        )
        THEN
            RETURN FALSE;
        END IF;

        RETURN TRUE;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, private;


-- ---------------------------------------------------------------------------
-- has_permission (private)
-- Full permission evaluation: principals × hierarchy × conditions × DENY/ALLOW.
--
-- p_resource_id = NULL checks for type-level (wildcard) grants only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.has_permission(
        p_user_uid      UUID,
        p_action        TEXT,
        p_resource_type TEXT,
        p_resource_id   BIGINT DEFAULT NULL,
        p_organization_id BIGINT DEFAULT NULL
    ) RETURNS BOOLEAN AS $$
    DECLARE
        v_ancestor_ids BIGINT[];
        v_has_deny     BOOLEAN;
        v_has_allow    BOOLEAN;
    BEGIN
        IF p_user_uid IS NULL THEN
             RETURN FALSE;
         END IF;
        -- Collect ancestor resource IDs via the resources hierarchy table.
        -- These propagate inherited permissions from parent resources.
        IF p_resource_id IS NOT NULL THEN
            WITH RECURSIVE anc AS (
                SELECT r.id, r.parent_id
                FROM   public.resources r
                WHERE  r.resource_type = p_resource_type
                AND  r.resource_id   = p_resource_id
                AND  (p_organization_id IS NULL OR r.organization_id = p_organization_id)
                UNION ALL
                SELECT r.id, r.parent_id
                FROM   public.resources r
                JOIN   anc ON r.id = anc.parent_id
            )
            SELECT ARRAY_AGG(DISTINCT r2.resource_id)
            INTO v_ancestor_ids
            FROM anc
            JOIN public.resources r2 ON r2.id = anc.id
            WHERE r2.resource_id IS NOT NULL
            AND r2.resource_id != p_resource_id;
        END IF;

        -- Step 1: Check for any active DENY — DENY always wins.
        SELECT EXISTS (
            WITH RECURSIVE ep AS (
                SELECT pr.id
                FROM   public.principals pr
                JOIN   public.accounts   a  ON a.id = pr.account_id
                WHERE  a.user_id         = p_user_uid
                AND  pr.principal_type = 'user'
                UNION
                SELECT pm.parent_principal_id
                FROM   public.principal_memberships pm
                JOIN   ep ON ep.id = pm.member_principal_id
            )
            SELECT 1
            FROM   public.acl_entries ae
            JOIN   ep ON ep.id = ae.principal_id
            WHERE  ae.action        = p_action
            AND  ae.resource_type = p_resource_type
            AND  (
                ae.resource_id IS NULL
                OR ae.resource_id = p_resource_id
                OR (v_ancestor_ids IS NOT NULL AND ae.resource_id = ANY(v_ancestor_ids))
            )
            AND  ae.effect = 'DENY'
            AND  (ae.valid_from  IS NULL OR ae.valid_from  <= NOW())
            AND  (ae.valid_until IS NULL OR ae.valid_until >  NOW())
            AND  (p_organization_id IS NULL OR ae.organization_id = p_organization_id)
            AND  private.eval_acl_condition(ae.condition_json, p_user_uid)
        ) INTO v_has_deny;

        IF v_has_deny THEN
            RETURN FALSE;
        END IF;

        -- Step 2: Check for any active ALLOW.
        SELECT EXISTS (
            WITH RECURSIVE ep AS (
                SELECT pr.id
                FROM   public.principals pr
                JOIN   public.accounts   a  ON a.id = pr.account_id
                WHERE  a.user_id         = p_user_uid
                AND  pr.principal_type = 'user'
                UNION
                SELECT pm.parent_principal_id
                FROM   public.principal_memberships pm
                JOIN   ep ON ep.id = pm.member_principal_id
            )
            SELECT 1
            FROM   public.acl_entries ae
            JOIN   ep ON ep.id = ae.principal_id
            WHERE  ae.action        = p_action
            AND  ae.resource_type = p_resource_type
            AND  (
                ae.resource_id IS NULL
                OR ae.resource_id = p_resource_id
                OR (v_ancestor_ids IS NOT NULL AND ae.resource_id = ANY(v_ancestor_ids))
            )
            AND  ae.effect = 'ALLOW'
            AND  (ae.valid_from  IS NULL OR ae.valid_from  <= NOW())
            AND  (ae.valid_until IS NULL OR ae.valid_until >  NOW())
            AND  (p_organization_id IS NULL OR ae.organization_id = p_organization_id)
            AND  private.eval_acl_condition(ae.condition_json, p_user_uid)
        ) INTO v_has_allow;

        -- Step 3: Default DENY.
        RETURN COALESCE(v_has_allow, FALSE);
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, private;


-- ---------------------------------------------------------------------------
-- has_permission (public)
-- Convenience wrapper for application code and RLS policies.
-- Usage:  USING (public.has_permission('read', 'invoice', id))
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(
    p_action          TEXT,
    p_resource_type   TEXT,
    p_resource_id     BIGINT DEFAULT NULL,
    p_organization_id BIGINT DEFAULT NULL
    ) RETURNS BOOLEAN AS $$
        SELECT private.has_permission(auth.uid(), p_action, p_resource_type, p_resource_id, p_organization_id);
    $$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, private;

GRANT EXECUTE ON FUNCTION public.has_permission(TEXT, TEXT, BIGINT, BIGINT) TO authenticated;
