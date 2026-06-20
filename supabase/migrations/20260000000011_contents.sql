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
-- CONTENT TYPES
-- ================================================================
-- organization_id NULL  = system type visible to all orgs
-- organization_id NOT NULL = custom type scoped to one org

CREATE TABLE public.content_types (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT      REFERENCES public.organizations(id) ON DELETE RESTRICT,
    slug            TEXT        NOT NULL CHECK (char_length(slug)  BETWEEN 1 AND 100),
    name            TEXT        NOT NULL CHECK (char_length(name)  BETWEEN 1 AND 255),
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_type_slug_system ON public.content_types(slug)                  WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_type_slug_org    ON public.content_types(organization_id, slug) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_types_org ON public.content_types(organization_id);
ALTER TABLE public.content_types ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_types TO service_role;
GRANT INSERT (organization_id, slug, name, description) ON TABLE public.content_types TO authenticated;

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
    uid                   UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id       BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    content_type_id       BIGINT      NOT NULL REFERENCES public.content_types(id) ON DELETE RESTRICT,
    slug                  TEXT        NOT NULL CHECK (char_length(slug)  BETWEEN 1 AND 500),
    title                 TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
    status                TEXT        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft', 'review', 'published', 'archived')),
    published_version_id  BIGINT,     -- FK to content_versions added below (circular reference)
    publish_at            TIMESTAMPTZ,
    unpublish_at          TIMESTAMPTZ,
    created_by_account_id BIGINT      NOT NULL DEFAULT public.my_account_id() REFERENCES public.accounts(id) ON DELETE RESTRICT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at            TIMESTAMPTZ,
    UNIQUE (organization_id, slug)
    );
CREATE INDEX IF NOT EXISTS idx_contents_org          ON public.contents(organization_id);
CREATE INDEX IF NOT EXISTS idx_contents_org_status   ON public.contents(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_contents_content_type ON public.contents(content_type_id);
CREATE INDEX IF NOT EXISTS idx_contents_publish_at   ON public.contents(publish_at)   WHERE publish_at   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contents_unpublish_at ON public.contents(unpublish_at) WHERE unpublish_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contents_not_deleted  ON public.contents(organization_id) WHERE deleted_at IS NULL;
ALTER TABLE public.contents ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.contents TO service_role;
GRANT INSERT (organization_id, content_type_id, slug, title, status, publish_at, unpublish_at) ON TABLE public.contents TO authenticated;

-- ================================================================
-- CONTENT VERSIONS
-- ================================================================

CREATE TABLE public.content_versions (
    id                    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                   UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    content_id            BIGINT      NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
    version_number        INTEGER     NOT NULL,
    title                 TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
    summary               TEXT,
    seo_title             TEXT,
    seo_description       TEXT,
    body_json             JSONB       NOT NULL DEFAULT '[]',
    created_by_account_id BIGINT      NOT NULL DEFAULT public.my_account_id() REFERENCES public.accounts(id) ON DELETE RESTRICT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (content_id, version_number)
    );
CREATE INDEX IF NOT EXISTS idx_content_versions_content ON public.content_versions(content_id, version_number DESC);
-- Required so (content_id, id) can serve as a composite FK target below.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_versions_content_id_id ON public.content_versions (content_id, id);
ALTER TABLE public.content_versions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_versions TO service_role;
GRANT INSERT (content_id, title, summary, seo_title, seo_description, body_json) ON TABLE public.content_versions TO authenticated;

-- Resolve the circular reference now that content_versions exists.
-- Composite FK enforces that published_version_id belongs to this content item,
-- preventing an editor from pointing a row at a version from another content item or org.
ALTER TABLE public.contents
    ADD CONSTRAINT fk_contents_published_version
    FOREIGN KEY (id, published_version_id)
    REFERENCES public.content_versions (content_id, id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- ================================================================
-- CONTENT BLOCKS
-- ================================================================

CREATE TABLE public.content_blocks (
    id                 BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    content_version_id BIGINT      NOT NULL REFERENCES public.content_versions(id) ON DELETE CASCADE,
    block_order        INTEGER     NOT NULL,
    block_type         TEXT        NOT NULL CHECK (char_length(block_type) BETWEEN 1 AND 100),
    data_json          JSONB       NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (content_version_id, block_order)
    );
CREATE INDEX IF NOT EXISTS idx_content_blocks_version ON public.content_blocks(content_version_id, block_order);
ALTER TABLE public.content_blocks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_blocks TO service_role;
GRANT INSERT (content_version_id, block_order, block_type, data_json) ON TABLE public.content_blocks TO authenticated;

-- ================================================================
-- HELPER FUNCTIONS (used by RLS policies)
-- ================================================================

-- Resolves organization_id from a content_id
CREATE OR REPLACE FUNCTION private.content_org_id(p_content_id BIGINT)
RETURNS BIGINT AS $$
	SELECT organization_id FROM public.contents WHERE id = p_content_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION private.content_org_id(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.content_org_id(BIGINT) TO authenticated;

-- Resolves organization_id from a content_version_id
CREATE OR REPLACE FUNCTION private.org_id_from_content_version(p_version_id BIGINT)
RETURNS BIGINT AS $$
	SELECT c.organization_id
	FROM public.content_versions cv
	JOIN public.contents c ON c.id = cv.content_id
	WHERE cv.id = p_version_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION private.org_id_from_content_version(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.org_id_from_content_version(BIGINT) TO authenticated;

-- ================================================================
-- MEDIA FOLDERS
-- ================================================================

CREATE TABLE public.media_folders (
    id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id  BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    parent_folder_id BIGINT               REFERENCES public.media_folders(id) ON DELETE CASCADE,
    name             TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX IF NOT EXISTS idx_media_folders_org    ON public.media_folders(organization_id);
CREATE INDEX IF NOT EXISTS idx_media_folders_parent ON public.media_folders(parent_folder_id) WHERE parent_folder_id IS NOT NULL;
ALTER TABLE public.media_folders ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.media_folders TO service_role;
GRANT INSERT (organization_id, parent_folder_id, name) ON TABLE public.media_folders TO authenticated;

-- ================================================================
-- MEDIA
-- ================================================================

CREATE TABLE public.media (
    id                    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                   UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id       BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    folder_id             BIGINT               REFERENCES public.media_folders(id)  ON DELETE SET NULL,
    filename              TEXT        NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 500),
    mime_type             TEXT        NOT NULL,
    storage_path          TEXT        NOT NULL,
    width                 INTEGER,
    height                INTEGER,
    size_bytes            BIGINT,
    created_by_account_id BIGINT      NOT NULL DEFAULT public.my_account_id() REFERENCES public.accounts(id) ON DELETE RESTRICT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at            TIMESTAMPTZ
    );
CREATE INDEX IF NOT EXISTS idx_media_org         ON public.media(organization_id);
CREATE INDEX IF NOT EXISTS idx_media_folder      ON public.media(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_not_deleted ON public.media(organization_id) WHERE deleted_at IS NULL;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.media TO service_role;
GRANT INSERT (organization_id, folder_id, filename, mime_type, storage_path, width, height, size_bytes) ON TABLE public.media TO authenticated;

-- ================================================================
-- CONTENT ↔ MEDIA
-- ================================================================

CREATE TABLE public.content_media (
    id                 BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_version_id BIGINT      NOT NULL REFERENCES public.content_versions(id) ON DELETE CASCADE,
    media_id           BIGINT      NOT NULL REFERENCES public.media(id)             ON DELETE CASCADE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (content_version_id, media_id)
    );
CREATE INDEX IF NOT EXISTS idx_content_media_media   ON public.content_media(media_id);
CREATE INDEX IF NOT EXISTS idx_content_media_version ON public.content_media(content_version_id);
ALTER TABLE public.content_media ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_media TO service_role;
GRANT INSERT (content_version_id, media_id) ON TABLE public.content_media TO authenticated;

-- ================================================================
-- TAGS
-- ================================================================

CREATE TABLE public.tags (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    slug            TEXT        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
    );
CREATE INDEX IF NOT EXISTS idx_tags_org ON public.tags(organization_id);
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.tags TO service_role;
GRANT INSERT (organization_id, name, slug) ON TABLE public.tags TO authenticated;

CREATE TABLE public.content_tags (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_id BIGINT      NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
    tag_id     BIGINT      NOT NULL REFERENCES public.tags(id)     ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (content_id, tag_id)
    );
CREATE INDEX IF NOT EXISTS idx_content_tags_tag     ON public.content_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_content_tags_content ON public.content_tags(content_id);
ALTER TABLE public.content_tags ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_tags TO service_role;
GRANT INSERT (content_id, tag_id) ON TABLE public.content_tags TO authenticated;

-- ================================================================
-- CATEGORIES
-- ================================================================

CREATE TABLE public.categories (
    id                 BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id    BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    parent_category_id BIGINT               REFERENCES public.categories(id)   ON DELETE SET NULL,
    name               TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    slug               TEXT        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 255),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
    );
CREATE INDEX IF NOT EXISTS idx_categories_org    ON public.categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON public.categories(parent_category_id) WHERE parent_category_id IS NOT NULL;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.categories TO service_role;
GRANT INSERT (organization_id, parent_category_id, name, slug) ON TABLE public.categories TO authenticated;

CREATE TABLE public.content_categories (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_id  BIGINT      NOT NULL REFERENCES public.contents(id)   ON DELETE CASCADE,
    category_id BIGINT      NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (content_id, category_id)
    );
CREATE INDEX IF NOT EXISTS idx_content_categories_category ON public.content_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_content_categories_content  ON public.content_categories(content_id);
ALTER TABLE public.content_categories ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_categories TO service_role;
GRANT INSERT (content_id, category_id) ON TABLE public.content_categories TO authenticated;

-- ================================================================
-- CONTENT TRANSLATIONS
-- ================================================================

CREATE TABLE public.content_translations (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    content_id      BIGINT      NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
    language        TEXT        NOT NULL CHECK (char_length(language) BETWEEN 2 AND 10),
    title           TEXT        NOT NULL CHECK (char_length(title)    BETWEEN 1 AND 500),
    body_json       JSONB       NOT NULL DEFAULT '[]',
    seo_title       TEXT,
    seo_description TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (content_id, language)
    );
CREATE INDEX IF NOT EXISTS idx_content_translations_content ON public.content_translations(content_id);
ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_translations TO service_role;
GRANT INSERT (content_id, language, title, body_json, seo_title, seo_description) ON TABLE public.content_translations TO authenticated;

-- ================================================================
-- SEO METADATA
-- ================================================================

CREATE TABLE public.seo_metadata (
    id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid              UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    content_id       BIGINT      NOT NULL UNIQUE REFERENCES public.contents(id) ON DELETE CASCADE,
    meta_title       TEXT,
    meta_description TEXT,
    canonical_url    TEXT,
    og_title         TEXT,
    og_description   TEXT,
    og_image_id      BIGINT      REFERENCES public.media(id) ON DELETE SET NULL,
    robots           TEXT        NOT NULL DEFAULT 'index,follow',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX IF NOT EXISTS idx_seo_metadata_content  ON public.seo_metadata(content_id);
CREATE INDEX IF NOT EXISTS idx_seo_metadata_og_image ON public.seo_metadata(og_image_id) WHERE og_image_id IS NOT NULL;
ALTER TABLE public.seo_metadata ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.seo_metadata TO service_role;
GRANT INSERT (content_id, meta_title, meta_description, canonical_url, og_title, og_description, og_image_id, robots) ON TABLE public.seo_metadata TO authenticated;

-- ================================================================
-- CONTENT HISTORY
-- ================================================================

CREATE TABLE public.content_history (
    id                      BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid                     UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    content_id              BIGINT      NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
    action                  TEXT        NOT NULL
                                        CHECK (action IN ('created', 'edited', 'published', 'unpublished', 'archived', 'deleted')),
    performed_by_account_id BIGINT      NOT NULL DEFAULT public.my_account_id() REFERENCES public.accounts(id) ON DELETE RESTRICT,
    old_values_json         JSONB,
    new_values_json         JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX IF NOT EXISTS idx_content_history_content ON public.content_history(content_id, created_at DESC);
ALTER TABLE public.content_history ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_history TO service_role;

-- ================================================================
-- CONTENT SNIPPETS
-- ================================================================

CREATE TABLE public.content_snippets (
    id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid             UUID        NOT NULL UNIQUE DEFAULT private.gen_uuid_v7(),
    organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    slug            TEXT        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 255),
    data_json       JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
    );
CREATE INDEX IF NOT EXISTS idx_content_snippets_org ON public.content_snippets(organization_id);
ALTER TABLE public.content_snippets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.content_snippets TO service_role;
GRANT INSERT (organization_id, slug, data_json) ON TABLE public.content_snippets TO authenticated;

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
REVOKE ALL ON FUNCTION private.set_content_version_number() FROM PUBLIC;
CREATE OR REPLACE TRIGGER set_content_version_number BEFORE INSERT ON public.content_versions FOR EACH ROW EXECUTE FUNCTION private.set_content_version_number();

-- Overwrite created_by_account_id with the authenticated actor; never trust client input.
CREATE OR REPLACE FUNCTION private.set_content_created_by()
RETURNS TRIGGER AS $$
	BEGIN
		NEW.created_by_account_id = public.my_account_id();
		RETURN NEW;
	END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION private.set_content_created_by() FROM PUBLIC;
CREATE OR REPLACE TRIGGER set_content_created_by BEFORE INSERT ON public.contents FOR EACH ROW EXECUTE FUNCTION private.set_content_created_by();

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
REVOKE ALL ON FUNCTION private.on_content_inserted() FROM PUBLIC;
CREATE OR REPLACE TRIGGER on_content_inserted AFTER INSERT ON public.contents FOR EACH ROW EXECUTE FUNCTION private.on_content_inserted();

-- Record status transitions in history
CREATE OR REPLACE FUNCTION private.on_content_status_changed()
RETURNS TRIGGER AS $$
	BEGIN
		IF OLD.status IS DISTINCT FROM NEW.status THEN
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
				public.my_account_id(),
				jsonb_build_object('status', OLD.status),
				jsonb_build_object('status', NEW.status)
			);
		END IF;
		RETURN NEW;
	END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION private.on_content_status_changed() FROM PUBLIC;
CREATE OR REPLACE TRIGGER on_content_status_changed AFTER UPDATE ON public.contents FOR EACH ROW EXECUTE FUNCTION private.on_content_status_changed();

-- Log soft-delete in history
CREATE OR REPLACE FUNCTION private.on_content_soft_delete()
RETURNS TRIGGER AS $$
	BEGIN
		IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
			INSERT INTO public.content_history (content_id, action, performed_by_account_id, old_values_json)
			VALUES (
				NEW.id,
				'deleted',
				public.my_account_id(),
				jsonb_build_object('title', OLD.title, 'status', OLD.status)
			);
		END IF;
		RETURN NEW;
	END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION private.on_content_soft_delete() FROM PUBLIC;
CREATE OR REPLACE TRIGGER on_content_soft_delete AFTER UPDATE ON public.contents FOR EACH ROW EXECUTE FUNCTION private.on_content_soft_delete();

-- ================================================================
-- MUTATION FUNCTIONS
-- All writes by authenticated users must go through these functions.
-- Each function validates permissions before performing the operation.
-- ================================================================

-- CONTENT TYPES --

CREATE OR REPLACE FUNCTION public.update_content_type(
    p_id          BIGINT,
    p_slug        TEXT,
    p_name        TEXT,
    p_description TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.content_types WHERE id = p_id;
	IF NOT (private.is_org_admin(v_org_id) OR public.has_permission('manage', 'content_type', p_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to update content type';
	END IF;
	UPDATE public.content_types SET slug = p_slug, name = p_name, description = p_description WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.update_content_type(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_content_type(BIGINT, TEXT, TEXT, TEXT) TO authenticated;

-- CONTENTS --

CREATE OR REPLACE FUNCTION public.update_content(
    p_id              BIGINT,
    p_slug            TEXT,
    p_title           TEXT,
    p_content_type_id BIGINT,
    p_publish_at      TIMESTAMPTZ DEFAULT NULL,
    p_unpublish_at    TIMESTAMPTZ DEFAULT NULL
) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.contents WHERE id = p_id AND deleted_at IS NULL;
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('edit', 'content', p_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to edit content';
	END IF;
	UPDATE public.contents SET
		slug            = p_slug,
		title           = p_title,
		content_type_id = p_content_type_id,
		publish_at      = p_publish_at,
		unpublish_at    = p_unpublish_at
	WHERE id = p_id AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.update_content(BIGINT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_content(BIGINT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_content_for_review(p_content_id BIGINT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.contents WHERE id = p_content_id AND deleted_at IS NULL;
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('edit', 'content', p_content_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to submit content for review';
	END IF;
	UPDATE public.contents SET status = 'review' WHERE id = p_content_id AND deleted_at IS NULL AND status = 'draft';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.submit_content_for_review(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_content_for_review(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_content(p_content_id BIGINT, p_version_id BIGINT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.contents WHERE id = p_content_id AND deleted_at IS NULL;
	IF NOT (private.has_org_permission(v_org_id, 'content.publish') OR public.has_permission('publish', 'content', p_content_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to publish content';
	END IF;
	UPDATE public.contents SET status = 'published', published_version_id = p_version_id
	WHERE id = p_content_id AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.publish_content(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_content(BIGINT, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.unpublish_content(p_content_id BIGINT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.contents WHERE id = p_content_id AND deleted_at IS NULL;
	IF NOT (private.has_org_permission(v_org_id, 'content.publish') OR public.has_permission('publish', 'content', p_content_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to unpublish content';
	END IF;
	UPDATE public.contents SET status = 'draft', published_version_id = NULL
	WHERE id = p_content_id AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.unpublish_content(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unpublish_content(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_content(p_content_id BIGINT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.contents WHERE id = p_content_id AND deleted_at IS NULL;
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('edit', 'content', p_content_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to archive content';
	END IF;
	UPDATE public.contents SET status = 'archived' WHERE id = p_content_id AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.archive_content(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_content(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.soft_delete_content(p_content_id BIGINT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.contents WHERE id = p_content_id AND deleted_at IS NULL;
	IF NOT (private.has_org_permission(v_org_id, 'content.delete') OR public.has_permission('delete', 'content', p_content_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to delete content';
	END IF;
	UPDATE public.contents SET deleted_at = NOW() WHERE id = p_content_id AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.soft_delete_content(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_content(BIGINT) TO authenticated;

-- CONTENT BLOCKS --

-- Replaces the full set of blocks for a content version in one call. Users may
-- not DELETE content_blocks directly, so the delete-then-insert is performed
-- here behind a content.edit permission check.
CREATE OR REPLACE FUNCTION public.replace_content_blocks(p_content_version_id BIGINT, p_blocks JSONB)
    RETURNS void AS $$
	DECLARE
		v_org_id BIGINT;
	BEGIN
		v_org_id := private.org_id_from_content_version(p_content_version_id);
		IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('edit', 'content_version', p_content_version_id)) THEN
			RAISE EXCEPTION 'Insufficient permissions to modify content blocks';
		END IF;
		DELETE FROM public.content_blocks WHERE content_version_id = p_content_version_id;
		INSERT INTO public.content_blocks (content_version_id, block_order, block_type, data_json)
		SELECT p_content_version_id,
		       (b->>'block_order')::int,
		       b->>'block_type',
		       COALESCE(b->'data_json', '{}'::jsonb)
		FROM   jsonb_array_elements(COALESCE(p_blocks, '[]'::jsonb)) AS b;
	END;
	$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.replace_content_blocks(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_content_blocks(BIGINT, JSONB) TO authenticated;

-- MEDIA FOLDERS --

CREATE OR REPLACE FUNCTION public.update_media_folder(
    p_id               BIGINT,
    p_parent_folder_id BIGINT DEFAULT NULL,
    p_name             TEXT   DEFAULT NULL
) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.media_folders WHERE id = p_id;
	IF NOT (private.has_org_permission(v_org_id, 'media.manage') OR public.has_permission('manage', 'media_folder', p_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to update media folder';
	END IF;
	UPDATE public.media_folders SET
		parent_folder_id = p_parent_folder_id,
		name             = COALESCE(p_name, name)
	WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.update_media_folder(BIGINT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_media_folder(BIGINT, BIGINT, TEXT) TO authenticated;

-- MEDIA --

CREATE OR REPLACE FUNCTION public.update_media(
    p_id           BIGINT,
    p_folder_id    BIGINT DEFAULT NULL,
    p_filename     TEXT   DEFAULT NULL,
    p_mime_type    TEXT   DEFAULT NULL,
    p_storage_path TEXT   DEFAULT NULL,
    p_width        INTEGER DEFAULT NULL,
    p_height       INTEGER DEFAULT NULL,
    p_size_bytes   BIGINT  DEFAULT NULL
) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.media WHERE id = p_id AND deleted_at IS NULL;
	IF NOT (private.has_org_permission(v_org_id, 'media.manage') OR public.has_permission('edit', 'media', p_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to update media';
	END IF;
	UPDATE public.media SET
		folder_id    = p_folder_id,
		filename     = COALESCE(p_filename,     filename),
		mime_type    = COALESCE(p_mime_type,    mime_type),
		storage_path = COALESCE(p_storage_path, storage_path),
		width        = p_width,
		height       = p_height,
		size_bytes   = p_size_bytes
	WHERE id = p_id AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.update_media(BIGINT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_media(BIGINT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.soft_delete_media(p_media_id BIGINT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.media WHERE id = p_media_id AND deleted_at IS NULL;
	IF NOT (private.has_org_permission(v_org_id, 'media.manage') OR public.has_permission('delete', 'media', p_media_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to delete media';
	END IF;
	UPDATE public.media SET deleted_at = NOW() WHERE id = p_media_id AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.soft_delete_media(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_media(BIGINT) TO authenticated;

-- TAGS --

CREATE OR REPLACE FUNCTION public.update_tag(p_id BIGINT, p_name TEXT, p_slug TEXT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.tags WHERE id = p_id;
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('manage', 'tag', p_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to update tag';
	END IF;
	UPDATE public.tags SET name = p_name, slug = p_slug WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.update_tag(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_tag(BIGINT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_content_tag(p_content_id BIGINT, p_tag_id BIGINT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	v_org_id := private.content_org_id(p_content_id);
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('delete', 'content_tag', p_content_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to remove content tag';
	END IF;
	DELETE FROM public.content_tags WHERE content_id = p_content_id AND tag_id = p_tag_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.remove_content_tag(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_content_tag(BIGINT, BIGINT) TO authenticated;

-- CATEGORIES --

CREATE OR REPLACE FUNCTION public.update_category(
    p_id                 BIGINT,
    p_parent_category_id BIGINT DEFAULT NULL,
    p_name               TEXT   DEFAULT NULL,
    p_slug               TEXT   DEFAULT NULL
) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.categories WHERE id = p_id;
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('manage', 'category', p_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to update category';
	END IF;
	UPDATE public.categories SET
		parent_category_id = p_parent_category_id,
		name               = COALESCE(p_name, name),
		slug               = COALESCE(p_slug, slug)
	WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.update_category(BIGINT, BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_category(BIGINT, BIGINT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_content_category(p_content_id BIGINT, p_category_id BIGINT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	v_org_id := private.content_org_id(p_content_id);
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('delete', 'content_category', p_content_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to remove content category';
	END IF;
	DELETE FROM public.content_categories WHERE content_id = p_content_id AND category_id = p_category_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.remove_content_category(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_content_category(BIGINT, BIGINT) TO authenticated;

-- CONTENT MEDIA --

CREATE OR REPLACE FUNCTION public.remove_content_media(p_content_version_id BIGINT, p_media_id BIGINT) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	v_org_id := private.org_id_from_content_version(p_content_version_id);
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('delete', 'content_media', p_content_version_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to remove content media';
	END IF;
	DELETE FROM public.content_media WHERE content_version_id = p_content_version_id AND media_id = p_media_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.remove_content_media(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_content_media(BIGINT, BIGINT) TO authenticated;

-- CONTENT TRANSLATIONS --

CREATE OR REPLACE FUNCTION public.update_content_translation(
    p_content_id      BIGINT,
    p_language        TEXT,
    p_title           TEXT,
    p_body_json       JSONB,
    p_seo_title       TEXT DEFAULT NULL,
    p_seo_description TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	v_org_id := private.content_org_id(p_content_id);
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('edit', 'content_translation', p_content_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to update content translation';
	END IF;
	UPDATE public.content_translations SET
		title           = p_title,
		body_json       = p_body_json,
		seo_title       = p_seo_title,
		seo_description = p_seo_description
	WHERE content_id = p_content_id AND language = p_language;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.update_content_translation(BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_content_translation(BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;

-- SEO METADATA --

CREATE OR REPLACE FUNCTION public.update_seo_metadata(
    p_content_id       BIGINT,
    p_meta_title       TEXT    DEFAULT NULL,
    p_meta_description TEXT    DEFAULT NULL,
    p_canonical_url    TEXT    DEFAULT NULL,
    p_og_title         TEXT    DEFAULT NULL,
    p_og_description   TEXT    DEFAULT NULL,
    p_og_image_id      BIGINT  DEFAULT NULL,
    p_robots           TEXT    DEFAULT 'index,follow'
) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	v_org_id := private.content_org_id(p_content_id);
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('edit', 'seo_metadata', p_content_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to update SEO metadata';
	END IF;
	UPDATE public.seo_metadata SET
		meta_title       = p_meta_title,
		meta_description = p_meta_description,
		canonical_url    = p_canonical_url,
		og_title         = p_og_title,
		og_description   = p_og_description,
		og_image_id      = p_og_image_id,
		robots           = p_robots
	WHERE content_id = p_content_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.update_seo_metadata(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_seo_metadata(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO authenticated;

-- CONTENT SNIPPETS --

CREATE OR REPLACE FUNCTION public.update_content_snippet(
    p_id        BIGINT,
    p_slug      TEXT,
    p_data_json JSONB
) RETURNS void AS $$
DECLARE
	v_org_id BIGINT;
BEGIN
	SELECT organization_id INTO v_org_id FROM public.content_snippets WHERE id = p_id;
	IF NOT (private.has_org_permission(v_org_id, 'content.edit') OR public.has_permission('edit', 'content_snippet', p_id)) THEN
		RAISE EXCEPTION 'Insufficient permissions to update content snippet';
	END IF;
	UPDATE public.content_snippets SET slug = p_slug, data_json = p_data_json WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;
REVOKE ALL ON FUNCTION public.update_content_snippet(BIGINT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_content_snippet(BIGINT, TEXT, JSONB) TO authenticated;

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

-- CONTENT TYPES --

GRANT SELECT ON TABLE public.content_types TO authenticated;
CREATE POLICY "View system and org content types"
    ON public.content_types FOR SELECT TO authenticated
    USING (
        organization_id IS NULL
        OR private.is_org_member(organization_id)
        OR public.has_permission('view', 'content_type', id)
    );

CREATE POLICY "Org admins can manage custom content types"
    ON public.content_types FOR INSERT TO authenticated
    WITH CHECK (organization_id IS NOT NULL AND private.is_org_admin(organization_id) OR public.has_permission('manage', 'content_type', NULL));

-- CONTENTS --

GRANT SELECT ON TABLE public.contents TO authenticated;
CREATE POLICY "Org members can view content"
    ON public.contents FOR SELECT TO authenticated
    USING (
        deleted_at IS NULL
        AND (private.has_org_permission(organization_id, 'content.view') OR public.has_permission('view', 'content', id))
    );

CREATE POLICY "Org members can create content"
    ON public.contents FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(organization_id, 'content.create') OR public.has_permission('create', 'content', NULL));

-- CONTENT VERSIONS --

GRANT SELECT ON TABLE public.content_versions TO authenticated;
CREATE POLICY "Org members can view content versions"
    ON public.content_versions FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view') OR public.has_permission('view', 'content_version', id));

CREATE POLICY "Org members can create content versions"
    ON public.content_versions FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit') OR public.has_permission('create', 'content_version', NULL));

-- CONTENT BLOCKS --

GRANT SELECT ON TABLE public.content_blocks TO authenticated;
CREATE POLICY "Org members can view content blocks"
    ON public.content_blocks FOR SELECT TO authenticated
    USING (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.view') OR public.has_permission('view', 'content_block', id));

CREATE POLICY "Org members can create content blocks"
    ON public.content_blocks FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.edit') OR public.has_permission('create', 'content_block', NULL));

-- MEDIA FOLDERS --

GRANT SELECT ON TABLE public.media_folders TO authenticated;
CREATE POLICY "Org members can view media folders"
    ON public.media_folders FOR SELECT TO authenticated
    USING (private.is_org_member(organization_id) OR public.has_permission('view', 'media_folder', id));

CREATE POLICY "Org media managers can create media folders"
    ON public.media_folders FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(organization_id, 'media.manage') OR public.has_permission('manage', 'media_folder', NULL));

-- MEDIA --

GRANT SELECT ON TABLE public.media TO authenticated;
CREATE POLICY "Org members can view media"
    ON public.media FOR SELECT TO authenticated
    USING (
        deleted_at IS NULL
        AND (private.is_org_member(organization_id) OR public.has_permission('view', 'media', id))
    );

CREATE POLICY "Org members can upload media"
    ON public.media FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(organization_id, 'media.upload') OR public.has_permission('upload', 'media', NULL));

-- CONTENT MEDIA --

GRANT SELECT ON TABLE public.content_media TO authenticated;
CREATE POLICY "Org members can view content media"
    ON public.content_media FOR SELECT TO authenticated
    USING (private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.view') OR public.has_permission('view', 'content_media', id));

CREATE POLICY "Org members can attach content media"
    ON public.content_media FOR INSERT TO authenticated
    WITH CHECK (
        (
            private.has_org_permission(private.org_id_from_content_version(content_version_id), 'content.edit')
            AND EXISTS (
                SELECT 1 FROM public.media
                WHERE id = media_id
                  AND organization_id = private.org_id_from_content_version(content_version_id)
            )
        )
        OR public.has_permission('create', 'content_media', NULL)
    );

-- TAGS --

GRANT SELECT ON TABLE public.tags TO authenticated;
CREATE POLICY "Org members can view tags"
    ON public.tags FOR SELECT TO authenticated
    USING (private.is_org_member(organization_id) OR public.has_permission('view', 'tag', id));

CREATE POLICY "Org members can create tags"
    ON public.tags FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(organization_id, 'content.edit') OR public.has_permission('manage', 'tag', NULL));

-- CONTENT TAGS --

GRANT SELECT ON TABLE public.content_tags TO authenticated;
CREATE POLICY "Org members can view content tags"
    ON public.content_tags FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view') OR public.has_permission('view', 'content_tag', id));

CREATE POLICY "Org members can add content tags"
    ON public.content_tags FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit') OR public.has_permission('create', 'content_tag', NULL));

-- CATEGORIES --

GRANT SELECT ON TABLE public.categories TO authenticated;
CREATE POLICY "Org members can view categories"
    ON public.categories FOR SELECT TO authenticated
    USING (private.is_org_member(organization_id) OR public.has_permission('view', 'category', id));

CREATE POLICY "Org members can create categories"
    ON public.categories FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(organization_id, 'content.edit') OR public.has_permission('manage', 'category', NULL));

-- CONTENT CATEGORIES --

GRANT SELECT ON TABLE public.content_categories TO authenticated;
CREATE POLICY "Org members can view content categories"
    ON public.content_categories FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view') OR public.has_permission('view', 'content_category', id));

CREATE POLICY "Org members can add content categories"
    ON public.content_categories FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit') OR public.has_permission('create', 'content_category', NULL));

-- CONTENT TRANSLATIONS --

GRANT SELECT ON TABLE public.content_translations TO authenticated;
CREATE POLICY "Org members can view content translations"
    ON public.content_translations FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view') OR public.has_permission('view', 'content_translation', id));

CREATE POLICY "Org members can create content translations"
    ON public.content_translations FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit') OR public.has_permission('edit', 'content_translation', NULL));

-- SEO METADATA --

GRANT SELECT ON TABLE public.seo_metadata TO authenticated;
CREATE POLICY "Org members can view seo metadata"
    ON public.seo_metadata FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view') OR public.has_permission('view', 'seo_metadata', id));

CREATE POLICY "Org members can create seo metadata"
    ON public.seo_metadata FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(private.content_org_id(content_id), 'content.edit') OR public.has_permission('edit', 'seo_metadata', NULL));

-- CONTENT HISTORY (append-only via triggers; users can only read)

GRANT SELECT ON TABLE public.content_history TO authenticated;
CREATE POLICY "Org members can view content history"
    ON public.content_history FOR SELECT TO authenticated
    USING (private.has_org_permission(private.content_org_id(content_id), 'content.view') OR public.has_permission('view', 'content_history', id));

-- CONTENT SNIPPETS --

GRANT SELECT ON TABLE public.content_snippets TO authenticated;
CREATE POLICY "Org members can view content snippets"
    ON public.content_snippets FOR SELECT TO authenticated
    USING (private.is_org_member(organization_id) OR public.has_permission('view', 'content_snippet', id));

CREATE POLICY "Org members can create content snippets"
    ON public.content_snippets FOR INSERT TO authenticated
    WITH CHECK (private.has_org_permission(organization_id, 'content.edit') OR public.has_permission('edit', 'content_snippet', NULL));
