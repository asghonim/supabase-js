import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './database'

type ContentTypeRow    = Database['public']['Tables']['content_types']['Row']
type ContentRow        = Database['public']['Tables']['contents']['Row']
type ContentVersionRow = Database['public']['Tables']['content_versions']['Row']
type ContentBlockRow   = Database['public']['Tables']['content_blocks']['Row']
type ContentHistoryRow = Database['public']['Tables']['content_history']['Row']

export type ContentStatus        = 'draft' | 'review' | 'published' | 'archived'
export type ContentHistoryAction = 'created' | 'edited' | 'published' | 'unpublished' | 'archived' | 'deleted'

export type ContentBlockInsert = {
  block_order: number
  block_type: string
  data_json?: Json
}

export function createContentDb(supabase: SupabaseClient<Database>) {
  return {

    // ── Content Types ────────────────────────────────────────────────

    listContentTypes(orgId?: number) {
      const q = supabase.from('content_types').select('*').order('name')
      return orgId !== undefined
        ? q.or(`organization_id.is.null,organization_id.eq.${orgId}`)
        : q.is('organization_id', null)
    },

    createContentType(orgId: number, data: { slug: string; name: string; description?: string }) {
      return supabase
        .from('content_types')
        .insert({ ...data, organization_id: orgId })
        .select()
        .single()
    },

    // ── Contents ─────────────────────────────────────────────────────

    list(orgId: number, options?: { status?: ContentStatus; contentTypeId?: number }) {
      let q = supabase
        .from('contents')
        .select('*')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (options?.status)        q = q.eq('status', options.status)
      if (options?.contentTypeId) q = q.eq('content_type_id', options.contentTypeId)
      return q
    },

    getById(id: number) {
      return supabase.from('contents').select('*').eq('id', id).is('deleted_at', null).single()
    },

    getBySlug(orgId: number, slug: string) {
      return supabase
        .from('contents')
        .select('*')
        .eq('organization_id', orgId)
        .eq('slug', slug)
        .is('deleted_at', null)
        .single()
    },

    create(
      orgId: number,
      data: {
        content_type_id: number
        slug: string
        title: string
        status?: ContentStatus
      },
    ) {
      return supabase
        .from('contents')
        .insert({ ...data, organization_id: orgId })
        .select()
        .single()
    },

    /**
     * Updates a content row's editable fields through the update_content RPC.
     * Users may not UPDATE contents directly (the AGENTS rule). update_content
     * overwrites slug/title/content_type_id/publish_at/unpublish_at, so the
     * current row is read first to preserve fields the caller did not supply.
     * Status/published_version_id transitions go through publish/unpublish/archive.
     */
    async update(
      id: number,
      data: {
        slug?: string
        title?: string
        publish_at?: string | null
        unpublish_at?: string | null
      },
    ) {
      const { data: current, error: readError } = await supabase
        .from('contents')
        .select('slug, title, content_type_id, publish_at, unpublish_at')
        .eq('id', id)
        .is('deleted_at', null)
        .single()
      if (readError) return { data: null, error: readError }

      const { error } = await supabase.rpc('update_content', {
        p_id: id,
        p_slug: data.slug ?? current.slug,
        p_title: data.title ?? current.title,
        p_content_type_id: current.content_type_id,
        p_publish_at: (data.publish_at ?? current.publish_at) ?? undefined,
        p_unpublish_at: (data.unpublish_at ?? current.unpublish_at) ?? undefined,
      })
      if (error) return { data: null, error }
      return supabase.from('contents').select().eq('id', id).is('deleted_at', null).single()
    },

    async publish(id: number, versionId: number) {
      const { error } = await supabase.rpc('publish_content', {
        p_content_id: id,
        p_version_id: versionId,
      })
      if (error) return { data: null, error }
      return supabase.from('contents').select().eq('id', id).is('deleted_at', null).single()
    },

    async unpublish(id: number) {
      const { error } = await supabase.rpc('unpublish_content', { p_content_id: id })
      if (error) return { data: null, error }
      return supabase.from('contents').select().eq('id', id).is('deleted_at', null).single()
    },

    async archive(id: number) {
      const { error } = await supabase.rpc('archive_content', { p_content_id: id })
      if (error) return { data: null, error }
      return supabase.from('contents').select().eq('id', id).is('deleted_at', null).single()
    },

    /**
     * Soft-deletes a content row through the soft_delete_content RPC. Returns the
     * RPC response — once deleted the row is hidden from the caller by RLS, so
     * there is no row to return.
     */
    delete(id: number) {
      return supabase.rpc('soft_delete_content', { p_content_id: id })
    },

    deleteMedia(id: number) {
      return supabase.rpc('soft_delete_media', { p_media_id: id })
    },

    // ── Content Versions ──────────────────────────────────────────────

    listVersions(contentId: number) {
      return supabase
        .from('content_versions')
        .select('*')
        .eq('content_id', contentId)
        .order('version_number', { ascending: false })
    },

    getVersion(id: number) {
      return supabase.from('content_versions').select('*').eq('id', id).single()
    },

    createVersion(
      contentId: number,
      data: {
        title: string
        body_json?: Json
        summary?: string
        seo_title?: string
        seo_description?: string
      },
    ) {
      // Only the columns granted to authenticated may be inserted; version_number
      // and created_by_account_id are assigned by BEFORE INSERT triggers, so they
      // are omitted here (the cast satisfies the generated Insert type, which
      // still lists the trigger-populated version_number as required).
      const payload = {
        content_id:      contentId,
        title:           data.title,
        summary:         data.summary,
        seo_title:       data.seo_title,
        seo_description: data.seo_description,
        body_json:       data.body_json,
      } as Database['public']['Tables']['content_versions']['Insert']
      return supabase
        .from('content_versions')
        .insert(payload)
        .select()
        .single()
    },

    // ── Content Blocks ────────────────────────────────────────────────

    listBlocks(versionId: number) {
      return supabase
        .from('content_blocks')
        .select('*')
        .eq('content_version_id', versionId)
        .order('block_order')
    },

    /**
     * Replaces all blocks for a version via the replace_content_blocks RPC.
     * Users may not DELETE content_blocks directly, so the delete-then-insert is
     * done in a SECURITY DEFINER function behind a content.edit check. The updated
     * set is read back afterwards.
     */
    async replaceBlocks(versionId: number, blocks: ContentBlockInsert[]) {
      const { error } = await supabase.rpc('replace_content_blocks', {
        p_content_version_id: versionId,
        p_blocks: blocks.map((b) => ({
          block_order: b.block_order,
          block_type:  b.block_type,
          data_json:   b.data_json ?? {},
        })) as unknown as Json,
      })
      if (error) return { data: null, error }

      return supabase
        .from('content_blocks')
        .select()
        .eq('content_version_id', versionId)
        .order('block_order')
    },

    // ── Content History ───────────────────────────────────────────────

    listHistory(contentId: number) {
      return supabase
        .from('content_history')
        .select('*')
        .eq('content_id', contentId)
        .order('created_at', { ascending: false })
    },

  }
}

export type ContentDb = ReturnType<typeof createContentDb>
export type { ContentTypeRow, ContentRow, ContentVersionRow, ContentBlockRow, ContentHistoryRow }
