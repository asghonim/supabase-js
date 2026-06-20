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
      conversations: Database['public']['Tables']['conversations']
      conversation_participants: Database['public']['Tables']['conversation_participants']
      conversation_targets: Database['public']['Tables']['conversation_targets']
      messages: Database['public']['Tables']['messages']
      message_attachments: Database['public']['Tables']['message_attachments']
      message_reactions: Database['public']['Tables']['message_reactions']
      conversation_reads: Database['public']['Tables']['conversation_reads']
      message_versions: Database['public']['Tables']['message_versions']
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

    getConversation(id: number) {
      return q.from('conversations').select('*').eq('id', id).single()
    },

    createConversation(data: ConversationInsert) {
      return q.from('conversations').insert(data).select().single()
    },

    updateConversation(id: number, data: ConversationUpdate) {
      return q.from('conversations').update(data).eq('id', id).select().single()
    },

    deleteConversation(id: number) {
      return q.from('conversations').delete().eq('id', id)
    },

    // ── Participants ───────────────────────────────────────────────────

    listParticipants(conversationId: number) {
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
      conversationId: number,
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

    removeParticipant(conversationId: number, accountId: number) {
      return q
        .from('conversation_participants')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('account_id', accountId)
    },

    // ── Conversation targets ───────────────────────────────────────────

    getTarget(conversationId: number) {
      return q
        .from('conversation_targets')
        .select('*')
        .eq('conversation_id', conversationId)
        .single()
    },

    setTarget(data: ConversationTargetInsert) {
      return q
        .from('conversation_targets')
        .upsert(data, { onConflict: 'target_type,target_id' })
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
      conversationId: number,
      opts?: {
        limit?:           number
        before?:          number
        after?:           number
        parentMessageId?: number | null
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

    getMessage(id: number) {
      return q.from('messages').select('*').eq('id', id).single()
    },

    sendMessage(data: Omit<MessageInsert, 'message_number'>) {
      return q.from('messages').insert(data as MessageInsert).select().single()
    },

    /**
     * Edits a message body through the edit_message RPC. Users may not UPDATE
     * messages directly; the function restricts edits to the sender (or a holder
     * of message.edit) and records the prior body in message_versions.
     *
     * Must be called with the acting user's client — service_role has no account
     * context and will be rejected by the permission check.
     */
    async editMessage(id: number, body: string) {
      const { error } = await supabase.rpc('edit_message', { p_message_id: id, p_body: body })
      if (error) return { data: null, error }
      return q.from('messages').select().eq('id', id).single()
    },

    /**
     * Soft-deletes a message through the delete_message RPC. Users may not UPDATE
     * messages directly. Returns the RPC response (no row — the message is no
     * longer visible to the caller once deleted).
     *
     * Must be called with the acting user's client — service_role has no account
     * context and will be rejected by the permission check.
     */
    softDeleteMessage(id: number) {
      return supabase.rpc('delete_message', { p_message_id: id })
    },

    // ── Attachments ────────────────────────────────────────────────────

    listAttachments(messageId: number) {
      return q.from('message_attachments').select('*').eq('message_id', messageId)
    },

    addAttachment(data: AttachmentInsert) {
      return q.from('message_attachments').insert(data).select().single()
    },

    removeAttachment(id: number) {
      return q.from('message_attachments').delete().eq('id', id)
    },

    // ── Reactions ──────────────────────────────────────────────────────

    listReactions(messageId: number) {
      return q.from('message_reactions').select('*').eq('message_id', messageId)
    },

    addReaction(data: ReactionInsert) {
      return q
        .from('message_reactions')
        .upsert(data, { onConflict: 'message_id,account_id,reaction' })
        .select()
        .single()
    },

    /**
     * Removes the calling user's own reaction through the remove_message_reaction
     * RPC. Users may not DELETE message_reactions directly; the function only
     * removes a reaction owned by the caller (or with message_reaction.delete).
     *
     * Must be called with the acting user's client — service_role has no account
     * context and removes nothing.
     */
    removeReaction(messageId: number, reaction: string) {
      return supabase.rpc('remove_message_reaction', { p_message_id: messageId, p_reaction: reaction })
    },

    // ── Read state ─────────────────────────────────────────────────────

    getReadState(conversationId: number, accountId: number) {
      return q
        .from('conversation_reads')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('account_id', accountId)
        .single()
    },

    markRead(
      conversationId: number,
      lastReadMessageId: number,
      lastReadMessageNumber: number,
    ) {
      return q
        .from('conversation_reads')
        .insert(
          {
            conversation_id:           conversationId,
            last_read_message_id:      lastReadMessageId,
            last_read_message_number:  lastReadMessageNumber
          }
        )
        .select()
        .single()
    },

    // ── Message versions ───────────────────────────────────────────────

    listVersions(messageId: number) {
      return q
        .from('message_versions')
        .select('*')
        .eq('message_id', messageId)
        .order('created_at', { ascending: true })
    },

    snapshotVersion(messageId: number, body: string) {
      return q
        .from('message_versions')
        .insert({ message_id: messageId, body })
        .select()
        .single()
    },
  }
}

export type CommentsDb = ReturnType<typeof createCommentsDb>
