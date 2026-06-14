-- ================================================================
-- PERMISSIONS: content & media
-- ================================================================

INSERT INTO public.permissions (key, name, description, scope) VALUES
    ('content.view',    'View Content',    'Read content items and versions',        'project'),
    ('content.create',  'Create Content',  'Create new content items',               'project'),
    ('content.edit',    'Edit Content',    'Edit content and manage versions',        'project'),
    ('content.publish', 'Publish Content', 'Publish and unpublish content',           'project'),
    ('content.delete',  'Delete Content',  'Delete content items',                    'project'),
    ('media.upload',    'Upload Media',    'Upload files to the media library',        'project'),
    ('media.manage',    'Manage Media',    'Organise and delete media library assets', 'project');

-- super_admin inherits all permissions (back-fills post-initial seed)
INSERT INTO public.platform_role_permissions (platform_role_id, permission_id)
SELECT pr.id, p.id
FROM public.platform_roles pr
JOIN public.permissions p ON p.key IN (
    'content.view', 'content.create', 'content.edit',
    'content.publish', 'content.delete', 'media.upload', 'media.manage'
)
WHERE pr.key = 'super_admin'
ON CONFLICT DO NOTHING;

-- owner → all content & media permissions
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
SELECT r.id, p.id
FROM public.organization_roles r
JOIN public.permissions p ON p.key IN (
    'content.view', 'content.create', 'content.edit',
    'content.publish', 'content.delete', 'media.upload', 'media.manage'
)
WHERE r.key = 'owner' AND r.organization_id IS NULL;

-- admin → all content & media permissions
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
SELECT r.id, p.id
FROM public.organization_roles r
JOIN public.permissions p ON p.key IN (
    'content.view', 'content.create', 'content.edit',
    'content.publish', 'content.delete', 'media.upload', 'media.manage'
)
WHERE r.key = 'admin' AND r.organization_id IS NULL;

-- member → view, create, edit, upload (no publish or delete)
INSERT INTO public.organization_role_permissions (organization_role_id, permission_id)
SELECT r.id, p.id
FROM public.organization_roles r
JOIN public.permissions p ON p.key IN (
    'content.view', 'content.create', 'content.edit', 'media.upload'
)
WHERE r.key = 'member' AND r.organization_id IS NULL;

-- ================================================================
-- SHARED TRIGGER FUNCTIONS
-- ================================================================

CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public, private;

-- ================================================================
-- CONTENT TYPES
-- ================================================================
-- organization_id NULL  = system type visible to all orgs
-- organization_id NOT NULL = custom type scoped to one org

CREATE TABLE public.content_types (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT      REFERENCES public.organizations(id) ON DELETE CASCADE,
    slug            TEXT        NOT NULL CHECK (char_length(slug)  BETWEEN 1 AND 100),
    name            TEXT        NOT NULL CHECK (char_length(name)  BETWEEN 1 AND 255),
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.content_types TO authenticated, service_role;
CREATE UNIQUE INDEX uq_content_type_slug_system ON public.content_types(slug)                  WHERE organization_id IS NULL;
CREATE UNIQUE INDEX uq_content_type_slug_org    ON public.content_types(organization_id, slug) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_content_types_org ON public.content_types(organization_id);

INSERT INTO public.content_types (organization_id, slug, name, description) VALUES
    (NULL, 'page',         'Page',         'A static web page'),
    (NULL, 'blog_post',    'Blog Post',    'A blog article'),
    (NULL, 'release_note', 'Release Note', 'A product release note'),
    (NULL, 'faq',          'FAQ',          'A frequently asked question'),
    (NULL, 'landing_page', 'Landing Page', 'A marketing landing page'),
    (NULL, 'announcement', 'Announcement', 'A product announcement');

-- ================================================================
-- CONTENTS
-- ================================================================

CREATE TABLE public.contents (
    id                    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id       BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    content_type_id       BIGINT      NOT NULL REFERENCES public.content_types(id) ON DELETE RESTRICT,
    slug                  TEXT        NOT NULL CHECK (char_length(slug)  BETWEEN 1 AND 500),
    title                 TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
    status                TEXT        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft', 'review', 'published', 'archived')),
    published_version_id  BIGINT,     -- FK to content_versions added below (circular reference)
    publish_at            TIMESTAMPTZ,
    unpublish_at          TIMESTAMPTZ,
    created_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
);
GRANT ALL ON TABLE public.contents TO authenticated, service_role;
CREATE INDEX idx_contents_org          ON public.contents(organization_id);
CREATE INDEX idx_contents_org_status   ON public.contents(organization_id, status);
CREATE INDEX idx_contents_content_type ON public.contents(content_type_id);
CREATE INDEX idx_contents_publish_at   ON public.contents(publish_at)   WHERE publish_at   IS NOT NULL;
CREATE INDEX idx_contents_unpublish_at ON public.contents(unpublish_at) WHERE unpublish_at IS NOT NULL;

CREATE TRIGGER on_contents_updated
    BEFORE UPDATE ON public.contents
    FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ================================================================
-- CONTENT VERSIONS
-- ================================================================

CREATE TABLE public.content_versions (
    id                    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_id            BIGINT      NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
    version_number        INTEGER     NOT NULL,
    title                 TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
    summary               TEXT,
    seo_title             TEXT,
    seo_description       TEXT,
    body_json             JSONB       NOT NULL DEFAULT '[]',
    created_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (content_id, version_number)
);
GRANT ALL ON TABLE public.content_versions TO authenticated, service_role;
CREATE INDEX idx_content_versions_content ON public.content_versions(content_id, version_number DESC);

-- Resolve the circular reference now that content_versions exists
ALTER TABLE public.contents
    ADD CONSTRAINT fk_contents_published_version
    FOREIGN KEY (published_version_id)
    REFERENCES public.content_versions(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- ================================================================
-- CONTENT BLOCKS
-- ================================================================

CREATE TABLE public.content_blocks (
    id                 BIGINT  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_version_id BIGINT  NOT NULL REFERENCES public.content_versions(id) ON DELETE CASCADE,
    block_order        INTEGER NOT NULL,
    block_type         TEXT    NOT NULL CHECK (char_length(block_type) BETWEEN 1 AND 100),
    data_json          JSONB   NOT NULL DEFAULT '{}',
    UNIQUE (content_version_id, block_order)
);
GRANT ALL ON TABLE public.content_blocks TO authenticated, service_role;
CREATE INDEX idx_content_blocks_version ON public.content_blocks(content_version_id, block_order);

-- ================================================================
-- HELPER FUNCTIONS (used by RLS policies)
-- ================================================================

-- Resolves organization_id from a content_id
CREATE OR REPLACE FUNCTION private.content_org_id(p_content_id BIGINT)
RETURNS BIGINT AS $$
    SELECT organization_id FROM public.contents WHERE id = p_content_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private;

-- Resolves organization_id from a content_version_id
CREATE OR REPLACE FUNCTION private.org_id_from_content_version(p_version_id BIGINT)
RETURNS BIGINT AS $$
    SELECT c.organization_id
    FROM public.content_versions cv
    JOIN public.contents c ON c.id = cv.content_id
    WHERE cv.id = p_version_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private;

-- ================================================================
-- MEDIA FOLDERS
-- ================================================================

CREATE TABLE public.media_folders (
    id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id  BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    parent_folder_id BIGINT               REFERENCES public.media_folders(id) ON DELETE CASCADE,
    name             TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.media_folders TO authenticated, service_role;
CREATE INDEX idx_media_folders_org    ON public.media_folders(organization_id);
CREATE INDEX idx_media_folders_parent ON public.media_folders(parent_folder_id) WHERE parent_folder_id IS NOT NULL;

-- ================================================================
-- MEDIA
-- ================================================================

CREATE TABLE public.media (
    id                    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id       BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    folder_id             BIGINT               REFERENCES public.media_folders(id)  ON DELETE SET NULL,
    filename              TEXT        NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 500),
    mime_type             TEXT        NOT NULL,
    storage_path          TEXT        NOT NULL,
    width                 INTEGER,
    height                INTEGER,
    size_bytes            BIGINT,
    created_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.media TO authenticated, service_role;
CREATE INDEX idx_media_org    ON public.media(organization_id);
CREATE INDEX idx_media_folder ON public.media(folder_id) WHERE folder_id IS NOT NULL;

-- ================================================================
-- CONTENT ↔ MEDIA
-- ================================================================

CREATE TABLE public.content_media (
    content_version_id BIGINT NOT NULL REFERENCES public.content_versions(id) ON DELETE CASCADE,
    media_id           BIGINT NOT NULL REFERENCES public.media(id)             ON DELETE CASCADE,
    PRIMARY KEY (content_version_id, media_id)
);
GRANT ALL ON TABLE public.content_media TO authenticated, service_role;
CREATE INDEX idx_content_media_media ON public.content_media(media_id);

-- ================================================================
-- TAGS
-- ================================================================

CREATE TABLE public.tags (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    slug            TEXT        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
);
GRANT ALL ON TABLE public.tags TO authenticated, service_role;
CREATE INDEX idx_tags_org ON public.tags(organization_id);

CREATE TABLE public.content_tags (
    content_id BIGINT NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
    tag_id     BIGINT NOT NULL REFERENCES public.tags(id)     ON DELETE CASCADE,
    PRIMARY KEY (content_id, tag_id)
);
GRANT ALL ON TABLE public.content_tags TO authenticated, service_role;
CREATE INDEX idx_content_tags_tag ON public.content_tags(tag_id);

-- ================================================================
-- CATEGORIES
-- ================================================================

CREATE TABLE public.categories (
    id                 BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id    BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    parent_category_id BIGINT               REFERENCES public.categories(id)   ON DELETE SET NULL,
    name               TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    slug               TEXT        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 255),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
);
GRANT ALL ON TABLE public.categories TO authenticated, service_role;
CREATE INDEX idx_categories_org    ON public.categories(organization_id);
CREATE INDEX idx_categories_parent ON public.categories(parent_category_id) WHERE parent_category_id IS NOT NULL;

CREATE TABLE public.content_categories (
    content_id  BIGINT NOT NULL REFERENCES public.contents(id)   ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    PRIMARY KEY (content_id, category_id)
);
GRANT ALL ON TABLE public.content_categories TO authenticated, service_role;
CREATE INDEX idx_content_categories_category ON public.content_categories(category_id);

-- ================================================================
-- CONTENT TRANSLATIONS
-- ================================================================

CREATE TABLE public.content_translations (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_id      BIGINT      NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
    language        TEXT        NOT NULL CHECK (char_length(language) BETWEEN 2 AND 10),
    title           TEXT        NOT NULL CHECK (char_length(title)    BETWEEN 1 AND 500),
    body_json       JSONB       NOT NULL DEFAULT '[]',
    seo_title       TEXT,
    seo_description TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (content_id, language)
);
GRANT ALL ON TABLE public.content_translations TO authenticated, service_role;
CREATE INDEX idx_content_translations_content ON public.content_translations(content_id);

CREATE TRIGGER on_content_translations_updated
    BEFORE UPDATE ON public.content_translations
    FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ================================================================
-- SEO METADATA
-- ================================================================

CREATE TABLE public.seo_metadata (
    content_id       BIGINT      PRIMARY KEY REFERENCES public.contents(id) ON DELETE CASCADE,
    meta_title       TEXT,
    meta_description TEXT,
    canonical_url    TEXT,
    og_title         TEXT,
    og_description   TEXT,
    og_image_id      BIGINT      REFERENCES public.media(id) ON DELETE SET NULL,
    robots           TEXT        NOT NULL DEFAULT 'index,follow',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.seo_metadata TO authenticated, service_role;
CREATE INDEX idx_seo_metadata_og_image ON public.seo_metadata(og_image_id) WHERE og_image_id IS NOT NULL;

CREATE TRIGGER on_seo_metadata_updated
    BEFORE UPDATE ON public.seo_metadata
    FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ================================================================
-- CONTENT HISTORY
-- ================================================================

CREATE TABLE public.content_history (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_id              BIGINT      NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
    action                  TEXT        NOT NULL
                                        CHECK (action IN ('created', 'edited', 'published', 'unpublished', 'archived', 'deleted')),
    performed_by_account_id BIGINT      REFERENCES public.accounts(id) ON DELETE SET NULL,
    old_values_json         JSONB,
    new_values_json         JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON TABLE public.content_history TO authenticated, service_role;
CREATE INDEX idx_content_history_content ON public.content_history(content_id, created_at DESC);

-- ================================================================
-- CONTENT SNIPPETS
-- ================================================================

CREATE TABLE public.content_snippets (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    slug            TEXT        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 255),
    data_json       JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
);
GRANT ALL ON TABLE public.content_snippets TO authenticated, service_role;
CREATE INDEX idx_content_snippets_org ON public.content_snippets(organization_id);

CREATE TRIGGER on_content_snippets_updated
    BEFORE UPDATE ON public.content_snippets
    FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ================================================================
-- AUTOMATION TRIGGERS
-- ================================================================

-- Auto-increment version_number per content item
CREATE OR REPLACE FUNCTION private.set_content_version_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version_number = COALESCE(
        (SELECT MAX(version_number) FROM public.content_versions WHERE content_id = NEW.content_id),
        0
    ) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, private;

CREATE TRIGGER set_content_version_number
    BEFORE INSERT ON public.content_versions
    FOR EACH ROW EXECUTE FUNCTION private.set_content_version_number();

-- Record creation event in history
CREATE OR REPLACE FUNCTION private.on_content_inserted()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.content_history (content_id, action, performed_by_account_id, new_values_json)
    VALUES (
        NEW.id,
        'created',
        NEW.created_by_account_id,
        jsonb_build_object('title', NEW.title, 'status', NEW.status)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE TRIGGER on_content_inserted
    AFTER INSERT ON public.contents
    FOR EACH ROW EXECUTE FUNCTION private.on_content_inserted();

-- Enforce publish permission and record status transitions in history
CREATE OR REPLACE FUNCTION private.on_content_status_changed()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = 'published'
           AND NOT private.has_org_permission(NEW.organization_id, 'content.publish') THEN
            RAISE EXCEPTION 'Insufficient permissions to publish content';
        END IF;

        INSERT INTO public.content_history (
            content_id, action, performed_by_account_id, old_values_json, new_values_json
        )
        VALUES (
            NEW.id,
            CASE NEW.status
                WHEN 'published' THEN 'published'
                WHEN 'archived'  THEN 'archived'
                WHEN 'draft'     THEN 'unpublished'
                ELSE                  'edited'
            END,
            (SELECT id FROM public.accounts WHERE user_id = auth.uid()),
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE TRIGGER on_content_status_changed
    AFTER UPDATE ON public.contents
    FOR EACH ROW EXECUTE FUNCTION private.on_content_status_changed();

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

-- CONTENT TYPES --

ALTER TABLE public.content_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View system and org content types"
    ON public.content_types FOR SELECT TO authenticated
    USING (
        organization_id IS NULL
        OR private.is_org_member(organization_id)
    );

CREATE POLICY "Org admins can manage custom content types"
    ON public.content_types FOR ALL TO authenticated
    USING     (organization_id IS NOT NULL AND private.is_org_admin(organization_id))
    WITH CHECK (organization_id IS NOT NULL AND private.is_org_admin(organization_id));

-- CONTENTS --

ALTER TABLE public.contents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view content"
    ON public.contents FOR SELECT TO authenticated
    USING (private.has_org_permission(organization_id, 'content.view'));

CREATE POLICY "Org members can create content"
    ON public.contents FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(organization_id, 'content.create'));

CREATE POLICY "Org members can edit content"
    ON public.contents FOR UPDATE TO authenticated
    USING     (private.has_org_permission(organization_id, 'content.edit'))
    WITH CHECK (private.has_org_permission(organization_id, 'content.edit'));

CREATE POLICY "Org members can delete content"
    ON public.contents FOR DELETE TO authenticated
    USING (private.has_org_permission(organization_id, 'content.delete'));

-- CONTENT VERSIONS --

ALTER TABLE public.content_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view content versions"
    ON public.content_versions FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view'));

CREATE POLICY "Org members can create content versions"
    ON public.content_versions FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit'));

CREATE POLICY "Org members can delete content versions"
    ON public.content_versions FOR DELETE TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.edit'));

-- CONTENT BLOCKS --

ALTER TABLE public.content_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view content blocks"
    ON public.content_blocks FOR SELECT TO authenticated
    USING (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.view'));

CREATE POLICY "Org members can manage content blocks"
    ON public.content_blocks FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.edit'));

CREATE POLICY "Org members can update content blocks"
    ON public.content_blocks FOR UPDATE TO authenticated
    USING     (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.edit'))
    WITH CHECK (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.edit'));

CREATE POLICY "Org members can delete content blocks"
    ON public.content_blocks FOR DELETE TO authenticated
    USING (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.edit'));

-- MEDIA FOLDERS --

ALTER TABLE public.media_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view media folders"
    ON public.media_folders FOR SELECT TO authenticated
    USING (private.is_org_member(organization_id));

CREATE POLICY "Org media managers can manage media folders"
    ON public.media_folders FOR ALL TO authenticated
    USING     (private.has_org_permission(organization_id, 'media.manage'))
    WITH CHECK (private.has_org_permission(organization_id, 'media.manage'));

-- MEDIA --

ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view media"
    ON public.media FOR SELECT TO authenticated
    USING (private.is_org_member(organization_id));

CREATE POLICY "Org members can upload media"
    ON public.media FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(organization_id, 'media.upload'));

CREATE POLICY "Org media managers can update media"
    ON public.media FOR UPDATE TO authenticated
    USING     (private.has_org_permission(organization_id, 'media.manage'))
    WITH CHECK (private.has_org_permission(organization_id, 'media.manage'));

CREATE POLICY "Org media managers can delete media"
    ON public.media FOR DELETE TO authenticated
    USING (private.has_org_permission(organization_id, 'media.manage'));

-- CONTENT MEDIA --

ALTER TABLE public.content_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view content media"
    ON public.content_media FOR SELECT TO authenticated
    USING (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.view'));

CREATE POLICY "Org members can manage content media"
    ON public.content_media FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.edit'));

CREATE POLICY "Org members can remove content media"
    ON public.content_media FOR DELETE TO authenticated
    USING (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.edit'));

-- TAGS --

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view tags"
    ON public.tags FOR SELECT TO authenticated
    USING (private.is_org_member(organization_id));

CREATE POLICY "Org members can manage tags"
    ON public.tags FOR ALL TO authenticated
    USING     (private.has_org_permission(organization_id, 'content.edit'))
    WITH CHECK (private.has_org_permission(organization_id, 'content.edit'));

-- CONTENT TAGS --

ALTER TABLE public.content_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view content tags"
    ON public.content_tags FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view'));

CREATE POLICY "Org members can manage content tags"
    ON public.content_tags FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit'));

CREATE POLICY "Org members can remove content tags"
    ON public.content_tags FOR DELETE TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.edit'));

-- CATEGORIES --

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view categories"
    ON public.categories FOR SELECT TO authenticated
    USING (private.is_org_member(organization_id));

CREATE POLICY "Org members can manage categories"
    ON public.categories FOR ALL TO authenticated
    USING     (private.has_org_permission(organization_id, 'content.edit'))
    WITH CHECK (private.has_org_permission(organization_id, 'content.edit'));

-- CONTENT CATEGORIES --

ALTER TABLE public.content_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view content categories"
    ON public.content_categories FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view'));

CREATE POLICY "Org members can manage content categories"
    ON public.content_categories FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit'));

CREATE POLICY "Org members can remove content categories"
    ON public.content_categories FOR DELETE TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.edit'));

-- CONTENT TRANSLATIONS --

ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view content translations"
    ON public.content_translations FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view'));

CREATE POLICY "Org members can manage content translations"
    ON public.content_translations FOR ALL TO authenticated
    USING     (private.has_org_permission(private.content_org_id(content_id), 'content.edit'))
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit'));

-- SEO METADATA --

ALTER TABLE public.seo_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view seo metadata"
    ON public.seo_metadata FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view'));

CREATE POLICY "Org members can manage seo metadata"
    ON public.seo_metadata FOR ALL TO authenticated
    USING     (private.has_org_permission(private.content_org_id(content_id), 'content.edit'))
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit'));

-- CONTENT HISTORY (append-only via triggers; users can only read)

ALTER TABLE public.content_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view content history"
    ON public.content_history FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view'));

-- CONTENT SNIPPETS --

ALTER TABLE public.content_snippets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view content snippets"
    ON public.content_snippets FOR SELECT TO authenticated
    USING (private.is_org_member(organization_id));

CREATE POLICY "Org members can manage content snippets"
    ON public.content_snippets FOR ALL TO authenticated
    USING     (private.has_org_permission(organization_id, 'content.edit'))
    WITH CHECK (private.has_org_permission(organization_id, 'content.edit'));
