import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

// ── Enum types (defined in database.ts) ──────────────────────────────────────

export type ConversationType            = Database['public']['Enums']['conversation_type']
export type ConversationParticipantRole = Database['public']['Enums']['conversation_participant_role']

// ── Internal schema ───────────────────────────────────────────────────────────
// Kept separate from database.ts to avoid pushing the shared Database type past
// TypeScript's declaration-serialization limit (TS7056).  Inline object literal
// types are used here because they satisfy the GenericTable constraint
// (extends Record<string, unknown>); named interfaces do not.

type CommentsSchema = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      conversations: {
        Row: {
          id:                  string
          tenant_id:           number | null
          type:                ConversationType
          title:               string | null
          message_count:       number
          last_message_at:     string | null
          last_message_number: number | null
          created_at:          string
          created_by:          number | null
        }
        Insert: {
          id?:                  string
          tenant_id?:           number | null
          type?:                ConversationType
          title?:               string | null
          message_count?:       number
          last_message_at?:     string | null
          last_message_number?: number | null
          created_at?:          string
          created_by?:          number | null
        }
        Update: {
          id?:                  string
          tenant_id?:           number | null
          type?:                ConversationType
          title?:               string | null
          message_count?:       number
          last_message_at?:     string | null
          last_message_number?: number | null
          created_at?:          string
          created_by?:          number | null
        }
        Relationships: []
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          account_id:      number
          role:            ConversationParticipantRole
          joined_at:       string
        }
        Insert: {
          conversation_id: string
          account_id:      number
          role?:           ConversationParticipantRole
          joined_at?:      string
        }
        Update: {
          conversation_id?: string
          account_id?:      number
          role?:            ConversationParticipantRole
          joined_at?:       string
        }
        Relationships: []
      }
      conversation_targets: {
        Row: {
          conversation_id: string
          target_type:     string
          target_id:       string
        }
        Insert: {
          conversation_id: string
          target_type:     string
          target_id:       string
        }
        Update: {
          conversation_id?: string
          target_type?:     string
          target_id?:       string
        }
        Relationships: []
      }
      messages: {
        Row: {
          id:                string
          conversation_id:   string
          sender_id:         number
          body:              string | null
          parent_message_id: string | null
          message_number:    number
          created_at:        string
          edited_at:         string | null
          deleted_at:        string | null
        }
        Insert: {
          id?:                string
          conversation_id:    string
          sender_id:          number
          body?:              string | null
          parent_message_id?: string | null
          message_number?:    number
          created_at?:        string
          edited_at?:         string | null
          deleted_at?:        string | null
        }
        Update: {
          id?:                string
          conversation_id?:   string
          sender_id?:         number
          body?:              string | null
          parent_message_id?: string | null
          message_number?:    number
          created_at?:        string
          edited_at?:         string | null
          deleted_at?:        string | null
        }
        Relationships: []
      }
      message_attachments: {
        Row: {
          id:           string
          message_id:   string
          storage_key:  string
          file_name:    string
          content_type: string | null
          size:         number | null
          created_at:   string
        }
        Insert: {
          id?:          string
          message_id:   string
          storage_key:  string
          file_name:    string
          content_type?: string | null
          size?:         number | null
          created_at?:   string
        }
        Update: {
          id?:           string
          message_id?:   string
          storage_key?:  string
          file_name?:    string
          content_type?: string | null
          size?:         number | null
          created_at?:   string
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          message_id: string
          account_id: number
          reaction:   string
        }
        Insert: {
          message_id: string
          account_id: number
          reaction:   string
        }
        Update: {
          message_id?: string
          account_id?: number
          reaction?:   string
        }
        Relationships: []
      }
      conversation_reads: {
        Row: {
          conversation_id:          string
          account_id:               number
          last_read_message_id:     string | null
          last_read_message_number: number | null
          last_read_at:             string
        }
        Insert: {
          conversation_id:           string
          account_id:                number
          last_read_message_id?:     string | null
          last_read_message_number?: number | null
          last_read_at?:             string
        }
        Update: {
          conversation_id?:          string
          account_id?:               number
          last_read_message_id?:     string | null
          last_read_message_number?: number | null
          last_read_at?:             string
        }
        Relationships: []
      }
      message_versions: {
        Row: {
          id:         string
          message_id: string
          body:       string
          created_at: string
        }
        Insert: {
          id?:         string
          message_id:  string
          body:        string
          created_at?: string
        }
        Update: {
          id?:         string
          message_id?: string
          body?:       string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views:          { [_ in never]: never }
    Functions:      { [_ in never]: never }
    Enums: {
      conversation_type:            ConversationType
      conversation_participant_role: ConversationParticipantRole
    }
    CompositeTypes: { [_ in never]: never }
  }
}

// ── Exported Row / Insert / Update types ──────────────────────────────────────
// Derived from CommentsSchema so the types always stay in sync.

type Tables = CommentsSchema['public']['Tables']

export type ConversationRow    = Tables['conversations']['Row']
export type ConversationInsert = Tables['conversations']['Insert']
export type ConversationUpdate = Tables['conversations']['Update']

export type ParticipantRow    = Tables['conversation_participants']['Row']
export type ParticipantInsert = Tables['conversation_participants']['Insert']

export type ConversationTargetRow    = Tables['conversation_targets']['Row']
export type ConversationTargetInsert = Tables['conversation_targets']['Insert']

export type MessageRow    = Tables['messages']['Row']
export type MessageInsert = Tables['messages']['Insert']
export type MessageUpdate = Tables['messages']['Update']

export type AttachmentRow    = Tables['message_attachments']['Row']
export type AttachmentInsert = Tables['message_attachments']['Insert']

export type ReactionRow    = Tables['message_reactions']['Row']
export type ReactionInsert = Tables['message_reactions']['Insert']

export type ConversationReadRow    = Tables['conversation_reads']['Row']
export type ConversationReadInsert = Tables['conversation_reads']['Insert']

export type MessageVersionRow = Tables['message_versions']['Row']

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCommentsDb(supabase: SupabaseClient<Database>) {
  const q = supabase as unknown as SupabaseClient<CommentsSchema>

  return {
    // ── Conversations ──────────────────────────────────────────────────

    listConversations(opts?: {
      tenantId?: number
      type?:     ConversationType
      limit?:    number
      offset?:   number
    }) {
      let query = q
        .from('conversations')
        .select('*')
        .order('last_message_at', { ascending: false, nullsFirst: false })

      if (opts?.tenantId !== undefined) query = query.eq('tenant_id', opts.tenantId)
      if (opts?.type)                   query = query.eq('type', opts.type)
      if (opts?.limit !== undefined)    query = query.limit(opts.limit)
      if (opts?.offset !== undefined)   query = query.range(opts.offset, opts.offset + (opts.limit ?? 20) - 1)

      return query
    },

    getConversation(id: string) {
      return q.from('conversations').select('*').eq('id', id).single()
    },

    createConversation(data: ConversationInsert) {
      return q.from('conversations').insert(data).select().single()
    },

    updateConversation(id: string, data: ConversationUpdate) {
      return q.from('conversations').update(data).eq('id', id).select().single()
    },

    deleteConversation(id: string) {
      return q.from('conversations').delete().eq('id', id)
    },

    // ── Participants ───────────────────────────────────────────────────

    listParticipants(conversationId: string) {
      return q
        .from('conversation_participants')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('joined_at', { ascending: true })
    },

    addParticipant(data: ParticipantInsert) {
      return q.from('conversation_participants').insert(data).select().single()
    },

    updateParticipantRole(
      conversationId: string,
      accountId: number,
      role: ConversationParticipantRole,
    ) {
      return q
        .from('conversation_participants')
        .update({ role })
        .eq('conversation_id', conversationId)
        .eq('account_id', accountId)
        .select()
        .single()
    },

    removeParticipant(conversationId: string, accountId: number) {
      return q
        .from('conversation_participants')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('account_id', accountId)
    },

    // ── Conversation targets ───────────────────────────────────────────

    getTarget(conversationId: string) {
      return q
        .from('conversation_targets')
        .select('*')
        .eq('conversation_id', conversationId)
        .single()
    },

    setTarget(data: ConversationTargetInsert) {
      return q
        .from('conversation_targets')
        .upsert(data, { onConflict: 'conversation_id' })
        .select()
        .single()
    },

    findByTarget(targetType: string, targetId: string) {
      return q
        .from('conversation_targets')
        .select('*')
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .single()
    },

    // ── Messages ───────────────────────────────────────────────────────

    listMessages(
      conversationId: string,
      opts?: {
        limit?:           number
        before?:          number
        after?:           number
        parentMessageId?: string | null
      },
    ) {
      let query = q
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('message_number', { ascending: true })

      if (opts?.parentMessageId !== undefined) {
        if (opts.parentMessageId === null) {
          query = query.is('parent_message_id', null)
        } else {
          query = query.eq('parent_message_id', opts.parentMessageId)
        }
      }

      if (opts?.before !== undefined) query = query.lt('message_number', opts.before)
      if (opts?.after  !== undefined) query = query.gt('message_number', opts.after)
      if (opts?.limit  !== undefined) query = query.limit(opts.limit)

      return query
    },

    getMessage(id: string) {
      return q.from('messages').select('*').eq('id', id).single()
    },

    sendMessage(data: Omit<MessageInsert, 'message_number'>) {
      return q.from('messages').insert(data as MessageInsert).select().single()
    },

    editMessage(id: string, body: string) {
      return q
        .from('messages')
        .update({ body, edited_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
    },

    softDeleteMessage(id: string) {
      return q
        .from('messages')
        .update({ deleted_at: new Date().toISOString(), body: null })
        .eq('id', id)
        .select()
        .single()
    },

    // ── Attachments ────────────────────────────────────────────────────

    listAttachments(messageId: string) {
      return q.from('message_attachments').select('*').eq('message_id', messageId)
    },

    addAttachment(data: AttachmentInsert) {
      return q.from('message_attachments').insert(data).select().single()
    },

    removeAttachment(id: string) {
      return q.from('message_attachments').delete().eq('id', id)
    },

    // ── Reactions ──────────────────────────────────────────────────────

    listReactions(messageId: string) {
      return q.from('message_reactions').select('*').eq('message_id', messageId)
    },

    addReaction(data: ReactionInsert) {
      return q
        .from('message_reactions')
        .upsert(data, { onConflict: 'message_id,account_id,reaction' })
        .select()
        .single()
    },

    removeReaction(messageId: string, accountId: number, reaction: string) {
      return q
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('account_id', accountId)
        .eq('reaction', reaction)
    },

    // ── Read state ─────────────────────────────────────────────────────

    getReadState(conversationId: string, accountId: number) {
      return q
        .from('conversation_reads')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('account_id', accountId)
        .single()
    },

    markRead(
      conversationId: string,
      accountId: number,
      lastReadMessageId: string,
      lastReadMessageNumber: number,
    ) {
      return q
        .from('conversation_reads')
        .upsert(
          {
            conversation_id:           conversationId,
            account_id:                accountId,
            last_read_message_id:      lastReadMessageId,
            last_read_message_number:  lastReadMessageNumber,
            last_read_at:              new Date().toISOString(),
          },
          { onConflict: 'conversation_id,account_id' },
        )
        .select()
        .single()
    },

    // ── Message versions ───────────────────────────────────────────────

    listVersions(messageId: string) {
      return q
        .from('message_versions')
        .select('*')
        .eq('message_id', messageId)
        .order('created_at', { ascending: true })
    },

    snapshotVersion(messageId: string, body: string) {
      return q
        .from('message_versions')
        .insert({ message_id: messageId, body })
        .select()
        .single()
    },
  }
}

export type CommentsDb = ReturnType<typeof createCommentsDb>
