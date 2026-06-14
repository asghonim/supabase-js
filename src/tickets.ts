import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

export type TicketStatus   = Database['public']['Enums']['ticket_status']
export type TicketPriority = Database['public']['Enums']['ticket_priority']

export type TicketRow    = Database['public']['Tables']['tickets']['Row']
export type TicketInsert = Database['public']['Tables']['tickets']['Insert']
export type TicketUpdate = Database['public']['Tables']['tickets']['Update']

export function createTicketDb(supabase: SupabaseClient<Database>) {
  return {
    list(opts?: {
      status?:  TicketStatus
      limit?:   number
      offset?:  number
      search?:  string
    }) {
      let q = supabase
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false })

      if (opts?.status) q = q.eq('status', opts.status)
      if (opts?.search) q = q.ilike('message', `%${opts.search}%`)
      if (opts?.limit  !== undefined) q = q.limit(opts.limit)
      if (opts?.offset !== undefined) q = q.range(opts.offset, opts.offset + (opts.limit ?? 20) - 1)

      return q
    },

    get(id: number) {
      return supabase.from('tickets').select('*').eq('id', id).single()
    },

    updateStatus(
      id: number,
      status: TicketStatus,
      extra?: Partial<Pick<TicketInsert, 'resolved_at' | 'first_response_at'>>,
    ) {
      return supabase
        .from('tickets')
        .update({ status, ...extra })
        .eq('id', id)
        .select()
        .single()
    },

    assignTo(id: number, accountId: number | null) {
      return supabase
        .from('tickets')
        .update({ assigned_to_account_id: accountId })
        .eq('id', id)
        .select()
        .single()
    },
  }
}

export type TicketDb = ReturnType<typeof createTicketDb>
