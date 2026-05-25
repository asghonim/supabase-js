import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

// Types derived directly from the generated schema — no manual duplicates
export type ContactStatus      = Database['public']['Enums']['contact_status']
export type ContactPriority    = Database['public']['Enums']['contact_priority']
export type ContactSenderType  = Database['public']['Enums']['contact_sender_type']

export type ContactSubmissionRow    = Database['public']['Tables']['contact_submissions']['Row']
export type ContactSubmissionInsert = Database['public']['Tables']['contact_submissions']['Insert']
export type ContactMessageRow       = Database['public']['Tables']['contact_messages']['Row']
export type ContactMessageInsert    = Database['public']['Tables']['contact_messages']['Insert']

export function createContactDb(supabase: SupabaseClient<Database>) {
  return {
    listSubmissions(opts?: {
      status?:  ContactStatus
      limit?:   number
      offset?:  number
      search?:  string
    }) {
      let q = supabase
        .from('contact_submissions')
        .select('*')
        .order('created_at', { ascending: false })

      if (opts?.status) q = q.eq('status', opts.status)
      if (opts?.search) q = q.ilike('message', `%${opts.search}%`)
      if (opts?.limit)  q = q.limit(opts.limit)
      if (opts?.offset != null && opts.limit != null)
        q = q.range(opts.offset, opts.offset + opts.limit - 1)

      return q
    },

    getSubmission(id: string) {
      return supabase
        .from('contact_submissions')
        .select('*')
        .eq('id', id)
        .single()
    },

    updateStatus(
      id: string,
      status: ContactStatus,
      extra?: Partial<Pick<ContactSubmissionInsert, 'resolved_at' | 'first_response_at'>>,
    ) {
      return supabase
        .from('contact_submissions')
        .update({ status, ...extra })
        .eq('id', id)
        .select()
        .single()
    },

    assignTo(id: string, accountId: number | null) {
      return supabase
        .from('contact_submissions')
        .update({ assigned_to_account_id: accountId })
        .eq('id', id)
        .select()
        .single()
    },

    listMessages(submissionId: string) {
      return supabase
        .from('contact_messages')
        .select('*')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: true })
    },

    addMessage(data: Pick<ContactMessageInsert, 'submission_id' | 'sender_type' | 'sender_account_id' | 'body' | 'is_internal'>) {
      return supabase
        .from('contact_messages')
        .insert(data)
        .select()
        .single()
    },
  }
}

export type ContactDb = ReturnType<typeof createContactDb>
