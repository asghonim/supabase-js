import type { SupabaseClient, PostgrestSingleResponse } from '@supabase/supabase-js'
import type { Database } from './database'

export type TagRow      = Database['public']['Tables']['tags']['Row']
export type CategoryRow = Database['public']['Tables']['categories']['Row']

type ContentTagRow      = Database['public']['Tables']['content_tags']['Row']
type ContentCategoryRow = Database['public']['Tables']['content_categories']['Row']

type ContentTagWithTag = ContentTagRow & { tags: TagRow | null }
type ContentCategoryWithCategory = ContentCategoryRow & { categories: CategoryRow | null }

export interface TaxonomyDb {
  // ── Tags ──────────────────────────────────────────────────────────

  listTags(orgId: number): PromiseLike<PostgrestSingleResponse<TagRow[]>>
  createTag(orgId: number, data: { name: string; slug: string }): PromiseLike<PostgrestSingleResponse<TagRow>>
  deleteTag(id: number): PromiseLike<PostgrestSingleResponse<null>>
  addTagsToContent(contentId: number, tagIds: number[]): PromiseLike<PostgrestSingleResponse<ContentTagRow[]>>
  removeTagsFromContent(contentId: number, tagIds: number[]): PromiseLike<PostgrestSingleResponse<null>>
  listContentTags(contentId: number): PromiseLike<PostgrestSingleResponse<ContentTagWithTag[]>>

  // ── Categories ────────────────────────────────────────────────────

  listCategories(orgId: number, parentCategoryId?: number | null): PromiseLike<PostgrestSingleResponse<CategoryRow[]>>
  createCategory(orgId: number, data: { name: string; slug: string; parent_category_id?: number }): PromiseLike<PostgrestSingleResponse<CategoryRow>>
  deleteCategory(id: number): PromiseLike<PostgrestSingleResponse<null>>
  addCategoriesToContent(contentId: number, categoryIds: number[]): PromiseLike<PostgrestSingleResponse<ContentCategoryRow[]>>
  removeCategoriesFromContent(contentId: number, categoryIds: number[]): PromiseLike<PostgrestSingleResponse<null>>
  listContentCategories(contentId: number): PromiseLike<PostgrestSingleResponse<ContentCategoryWithCategory[]>>
}

export function createTaxonomyDb(supabase: SupabaseClient<Database>): TaxonomyDb {
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
        .eq('content_id', contentId) as unknown as PromiseLike<PostgrestSingleResponse<ContentTagWithTag[]>>
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
        .eq('content_id', contentId) as unknown as PromiseLike<PostgrestSingleResponse<ContentCategoryWithCategory[]>>
    },

  }
}
