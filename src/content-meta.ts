import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './database'

type ContentTranslationRow = Database['public']['Tables']['content_translations']['Row']
type SeoMetadataRow        = Database['public']['Tables']['seo_metadata']['Row']
type ContentSnippetRow     = Database['public']['Tables']['content_snippets']['Row']

export function createContentMetaDb(supabase: SupabaseClient<Database>) {
  return {

    // ── Translations ──────────────────────────────────────────────────

    listTranslations(contentId: number) {
      return supabase
        .from('content_translations')
        .select('*')
        .eq('content_id', contentId)
        .order('language')
    },

    upsertTranslation(
      contentId: number,
      language: string,
      data: {
        title: string
        body_json?: Json
        seo_title?: string
        seo_description?: string
      },
    ) {
      return supabase
        .from('content_translations')
        .upsert({ ...data, content_id: contentId, language })
        .select()
        .single()
    },

    // ── SEO Metadata ──────────────────────────────────────────────────

    getSeo(contentId: number) {
      return supabase.from('seo_metadata').select('*').eq('content_id', contentId).single()
    },

    upsertSeo(
      contentId: number,
      data: {
        meta_title?: string
        meta_description?: string
        canonical_url?: string
        og_title?: string
        og_description?: string
        og_image_id?: number | null
        robots?: string
      },
    ) {
      return supabase
        .from('seo_metadata')
        .upsert({ ...data, content_id: contentId })
        .select()
        .single()
    },

    // ── Content Snippets ──────────────────────────────────────────────

    listSnippets(orgId: number) {
      return supabase
        .from('content_snippets')
        .select('*')
        .eq('organization_id', orgId)
        .order('slug')
    },

    getSnippet(orgId: number, slug: string) {
      return supabase
        .from('content_snippets')
        .select('*')
        .eq('organization_id', orgId)
        .eq('slug', slug)
        .single()
    },

    upsertSnippet(orgId: number, slug: string, data: Json) {
      return supabase
        .from('content_snippets')
        .upsert({ organization_id: orgId, slug, data_json: data })
        .select()
        .single()
    },

  }
}

export type ContentMetaDb = ReturnType<typeof createContentMetaDb>
export type { ContentTranslationRow, SeoMetadataRow, ContentSnippetRow }
