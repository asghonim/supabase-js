import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

type AccountRow = Database['public']['Tables']['accounts']['Row']
type AccountNameRow = Database['public']['Tables']['account_names']['Row']
type AccountAvatarRow = Database['public']['Tables']['account_avatars']['Row']

export function createAccountsDb(supabase: SupabaseClient<Database>) {
  return {
    getById(id: number) {
      return supabase
        .from('accounts')
        .select('*')
        .eq('id', id)
        .single()
    },

    getByUserId(userId: string) {
      return supabase
        .from('accounts')
        .select('*')
        .eq('user_id', userId)
        .single()
    },

    /** Returns the account for the currently authenticated user. */
    getCurrent() {
      return supabase
        .from('accounts')
        .select('*')
        .single()
    },

    // ── Names ────────────────────────────────────────────────────

    insertName(accountId: number, name: string) {
      return supabase
        .from('account_names')
        .insert({ account_id: accountId, name, created_at: new Date().toISOString() })
        .select()
        .single()
    },

    listNames(accountId: number) {
      return supabase
        .from('account_names')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
    },

    latestName(accountId: number) {
      return supabase
        .from('account_names')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
    },

    // ── Avatars ──────────────────────────────────────────────────

    insertAvatar(accountId: number, url: string) {
      return supabase
        .from('account_avatars')
        .insert({ account_id: accountId, url, created_at: new Date().toISOString() })
        .select()
        .single()
    },

    listAvatars(accountId: number) {
      return supabase
        .from('account_avatars')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
    },

    latestAvatar(accountId: number) {
      return supabase
        .from('account_avatars')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
    },
  }
}

export type AccountsDb = ReturnType<typeof createAccountsDb>
export type { AccountRow, AccountNameRow, AccountAvatarRow }
