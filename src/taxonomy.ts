import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

type TagRow      = Database['public']['Tables']['tags']['Row']
type CategoryRow = Database['public']['Tables']['categories']['Row']

export function createTaxonomyDb(supabase: SupabaseClient<Database>) {
  return {

    // ── Tags ──────────────────────────────────────────────────────────

    listTags(orgId: number) {
      return supabase.from('tags').select('*').eq('organization_id', orgId).order('name')
    },

    createTag(orgId: number, data: { name: string; slug: string }) {
      return supabase
        .from('tags')
        .insert({ ...data, organization_id: orgId })
        .select()
        .single()
    },

    deleteTag(id: number) {
      return supabase.from('tags').delete().eq('id', id)
    },

    addTagsToContent(contentId: number, tagIds: number[]) {
      return supabase
        .from('content_tags')
        .insert(tagIds.map((tag_id) => ({ content_id: contentId, tag_id })))
        .select()
    },

    removeTagsFromContent(contentId: number, tagIds: number[]) {
      return supabase
        .from('content_tags')
        .delete()
        .eq('content_id', contentId)
        .in('tag_id', tagIds)
    },

    listContentTags(contentId: number) {
      return supabase
        .from('content_tags')
        .select('*, tags(*)')
        .eq('content_id', contentId)
    },

    // ── Categories ────────────────────────────────────────────────────

    listCategories(orgId: number, parentCategoryId?: number | null) {
      const q = supabase
        .from('categories')
        .select('*')
        .eq('organization_id', orgId)
        .order('name')
      if (parentCategoryId === undefined) return q
      return parentCategoryId === null
        ? q.is('parent_category_id', null)
        : q.eq('parent_category_id', parentCategoryId)
    },

    createCategory(
      orgId: number,
      data: { name: string; slug: string; parent_category_id?: number },
    ) {
      return supabase
        .from('categories')
        .insert({ ...data, organization_id: orgId })
        .select()
        .single()
    },

    deleteCategory(id: number) {
      return supabase.from('categories').delete().eq('id', id)
    },

    addCategoriesToContent(contentId: number, categoryIds: number[]) {
      return supabase
        .from('content_categories')
        .insert(categoryIds.map((category_id) => ({ content_id: contentId, category_id })))
        .select()
    },

    removeCategoriesFromContent(contentId: number, categoryIds: number[]) {
      return supabase
        .from('content_categories')
        .delete()
        .eq('content_id', contentId)
        .in('category_id', categoryIds)
    },

    listContentCategories(contentId: number) {
      return supabase
        .from('content_categories')
        .select('*, categories(*)')
        .eq('content_id', contentId)
    },

  }
}

export type TaxonomyDb = ReturnType<typeof createTaxonomyDb>
export type { TagRow, CategoryRow }
