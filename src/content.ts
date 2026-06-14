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
        .order('created_at', { ascending: false })
      if (options?.status)        q = q.eq('status', options.status)
      if (options?.contentTypeId) q = q.eq('content_type_id', options.contentTypeId)
      return q
    },

    getById(id: number) {
      return supabase.from('contents').select('*').eq('id', id).single()
    },

    getBySlug(orgId: number, slug: string) {
      return supabase
        .from('contents')
        .select('*')
        .eq('organization_id', orgId)
        .eq('slug', slug)
        .single()
    },

    create(
      orgId: number,
      data: {
        content_type_id: number
        slug: string
        title: string
        status?: ContentStatus
        created_by_account_id?: number
      },
    ) {
      return supabase
        .from('contents')
        .insert({ ...data, organization_id: orgId })
        .select()
        .single()
    },

    update(
      id: number,
      data: {
        slug?: string
        title?: string
        status?: ContentStatus
        published_version_id?: number | null
        publish_at?: string | null
        unpublish_at?: string | null
      },
    ) {
      return supabase.from('contents').update(data).eq('id', id).select().single()
    },

    publish(id: number, versionId: number) {
      return supabase
        .from('contents')
        .update({ status: 'published', published_version_id: versionId })
        .eq('id', id)
        .select()
        .single()
    },

    unpublish(id: number) {
      return supabase
        .from('contents')
        .update({ status: 'draft', published_version_id: null })
        .eq('id', id)
        .select()
        .single()
    },

    archive(id: number) {
      return supabase
        .from('contents')
        .update({ status: 'archived' })
        .eq('id', id)
        .select()
        .single()
    },

    delete(id: number) {
      return supabase.from('contents').delete().eq('id', id)
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
        created_by_account_id?: number
      },
    ) {
      return supabase
        .from('content_versions')
        .insert({ ...data, content_id: contentId, version_number: 0 })
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

    replaceBlocks(versionId: number, blocks: ContentBlockInsert[]) {
      return supabase
        .from('content_blocks')
        .upsert(
          blocks.map((b) => ({ ...b, content_version_id: versionId })),
          { onConflict: 'content_version_id,block_order' },
        )
        .select()
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
