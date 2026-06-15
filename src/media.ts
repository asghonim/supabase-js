import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

type MediaRow       = Database['public']['Tables']['media']['Row']
type MediaFolderRow = Database['public']['Tables']['media_folders']['Row']

export function createMediaDb(supabase: SupabaseClient<Database>) {
  return {

    // ── Folders ───────────────────────────────────────────────────────

    listFolders(orgId: number, parentFolderId?: number | null) {
      const q = supabase
        .from('media_folders')
        .select('*')
        .eq('organization_id', orgId)
        .order('name')
      if (parentFolderId === undefined) return q
      return parentFolderId === null
        ? q.is('parent_folder_id', null)
        : q.eq('parent_folder_id', parentFolderId)
    },

    createFolder(orgId: number, name: string, parentFolderId?: number) {
      return supabase
        .from('media_folders')
        .insert({ organization_id: orgId, name, parent_folder_id: parentFolderId ?? null })
        .select()
        .single()
    },

    deleteFolder(id: number) {
      return supabase.from('media_folders').delete().eq('id', id)
    },

    // ── Media ─────────────────────────────────────────────────────────

    list(orgId: number, options?: { folderId?: number | null; mimeType?: string }) {
      let q = supabase
        .from('media')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
      if (options?.folderId !== undefined) {
        q = options.folderId === null
          ? q.is('folder_id', null)
          : q.eq('folder_id', options.folderId)
      }
      if (options?.mimeType) q = q.eq('mime_type', options.mimeType)
      return q
    },

    getById(id: number) {
      return supabase.from('media').select('*').eq('id', id).single()
    },

    insert(
      orgId: number,
      data: {
        filename: string
        mime_type: string
        storage_path: string
        folder_id?: number
        width?: number
        height?: number
        size_bytes?: number
        created_by_account_id?: number
      },
    ) {
      return supabase
        .from('media')
        .insert({ ...data, organization_id: orgId })
        .select()
        .single()
    },

    delete(id: number) {
      return supabase.from('media').delete().eq('id', id)
    },

  }
}

export type MediaDb = ReturnType<typeof createMediaDb>
export type { MediaRow, MediaFolderRow }
