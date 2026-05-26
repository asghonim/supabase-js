import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

// Unrecognised tokens are left as-is so missing vars are visible in output.
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match)
}

export type NotificationChannel = Database['public']['Enums']['notification_channel']
export type NotificationFrequency = Database['public']['Enums']['notification_frequency']
export type PreferenceInsert = Database['public']['Tables']['notification_preferences']['Insert']
export type PreferenceUpdate = Database['public']['Tables']['notification_preferences']['Update']
export type EventInsert = Database['public']['Tables']['notification_events']['Insert']
export type RecipientInsert = Database['public']['Tables']['notification_recipients']['Insert']
export type InboxInsert = Database['public']['Tables']['notification_inbox']['Insert']

export function createNotificationsDb(supabase: SupabaseClient<Database>) {
  return {
    // ── Inbox ────────────────────────────────────────────────────────

    listInbox(
      accountId: number,
      options?: { limit?: number; offset?: number; includeArchived?: boolean; groupKey?: string },
    ) {
      let query = supabase
        .from('notification_inbox')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })

      if (!options?.includeArchived) {
        query = query.is('archived_at', null)
      }

      if (options?.groupKey) {
        query = query.eq('group_key', options.groupKey)
      }

      if (options?.limit !== undefined) {
        query = query.limit(options.limit)
      }

      if (options?.offset !== undefined) {
        query = query.range(options.offset, options.offset + (options.limit ?? 20) - 1)
      }

      return query
    },

    getInboxItem(id: number) {
      return supabase
        .from('notification_inbox')
        .select('*')
        .eq('id', id)
        .single()
    },

    createInboxItem(data: InboxInsert) {
      return supabase
        .from('notification_inbox')
        .insert(data)
        .select()
        .single()
    },

    markRead(inboxId: number) {
      return supabase.rpc('mark_notification_read', { p_inbox_id: inboxId })
    },

    markAllRead() {
      return supabase.rpc('mark_all_notifications_read')
    },

    archive(inboxId: number) {
      return supabase.rpc('archive_notification', { p_inbox_id: inboxId })
    },

    unreadCount() {
      return supabase.rpc('unread_notification_count')
    },

    // ── Events ───────────────────────────────────────────────────────

    getEvent(id: number) {
      return supabase
        .from('notification_events')
        .select('*')
        .eq('id', id)
        .single()
    },

    createEvent(data: EventInsert) {
      return supabase
        .from('notification_events')
        .insert(data)
        .select()
        .single()
    },

    listEventsForEntity(entityType: string, entityId: string) {
      return supabase
        .from('notification_events')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('occurred_at', { ascending: false })
    },

    // ── Recipients ───────────────────────────────────────────────────

    getRecipient(id: number) {
      return supabase
        .from('notification_recipients')
        .select('*')
        .eq('id', id)
        .single()
    },

    createRecipient(data: RecipientInsert) {
      return supabase
        .from('notification_recipients')
        .insert(data)
        .select()
        .single()
    },

    listRecipientsForEvent(eventId: number) {
      return supabase
        .from('notification_recipients')
        .select('*')
        .eq('event_id', eventId)
    },

    // ── Deliveries ───────────────────────────────────────────────────

    listDeliveries(
      recipientId: number,
      options?: { channel?: NotificationChannel },
    ) {
      let query = supabase
        .from('notification_deliveries')
        .select('*')
        .eq('recipient_id', recipientId)
        .order('created_at', { ascending: false })

      if (options?.channel) {
        query = query.eq('channel', options.channel)
      }

      return query
    },

    // ── Preferences ──────────────────────────────────────────────────

    listPreferences(accountId: number) {
      return supabase
        .from('notification_preferences')
        .select('*')
        .eq('account_id', accountId)
        .order('notification_type', { ascending: true })
    },

    getPreference(accountId: number, notificationType: string, channel: NotificationChannel) {
      return supabase
        .from('notification_preferences')
        .select('*')
        .eq('account_id', accountId)
        .eq('notification_type', notificationType)
        .eq('channel', channel)
        .single()
    },

    upsertPreference(data: PreferenceInsert) {
      return supabase
        .from('notification_preferences')
        .upsert(data, { onConflict: 'account_id,notification_type,channel' })
        .select()
        .single()
    },

    updatePreference(id: number, data: PreferenceUpdate) {
      return supabase
        .from('notification_preferences')
        .update(data)
        .eq('id', id)
        .select()
        .single()
    },

    deletePreference(id: number) {
      return supabase
        .from('notification_preferences')
        .delete()
        .eq('id', id)
    },

    setChannelEnabled(
      accountId: number,
      notificationType: string,
      channel: NotificationChannel,
      isEnabled: boolean,
      frequency?: NotificationFrequency,
    ) {
      const data: PreferenceInsert = {
        account_id: accountId,
        notification_type: notificationType,
        channel,
        is_enabled: isEnabled,
        ...(frequency ? { frequency } : {}),
      }
      return supabase
        .from('notification_preferences')
        .upsert(data, { onConflict: 'account_id,notification_type,channel' })
        .select()
        .single()
    },

    // ── Templates ────────────────────────────────────────────────────

    getTemplate(type: string, channel: NotificationChannel, locale = 'en') {
      return supabase
        .from('notification_templates')
        .select('*')
        .eq('type', type)
        .eq('channel', channel)
        .eq('locale', locale)
        .eq('is_active', true)
        .order('version', { ascending: false })
        .limit(1)
        .single()
    },

    listTemplates(options?: { type?: string; channel?: NotificationChannel }) {
      let query = supabase
        .from('notification_templates')
        .select('*')
        .eq('is_active', true)
        .order('type', { ascending: true })

      if (options?.type) {
        query = query.eq('type', options.type)
      }

      if (options?.channel) {
        query = query.eq('channel', options.channel)
      }

      return query
    },

    /**
     * Fetches the active email template for `type` and returns just the
     * subject/body strings, or null if no active template exists.
     */
    async fetchTemplate(type: string, locale = 'en'): Promise<{ subject: string | null; body: string } | null> {
      const { data } = await supabase
        .from('notification_templates')
        .select('subject_template, body_template')
        .eq('type', type)
        .eq('channel', 'email')
        .eq('locale', locale)
        .eq('is_active', true)
        .order('version', { ascending: false })
        .limit(1)
        .single()

      if (!data) return null
      return { subject: data.subject_template, body: data.body_template }
    },

    // ── Digests ──────────────────────────────────────────────────────

    listPendingDigests(accountId: number) {
      return supabase
        .from('notification_digests')
        .select('*')
        .eq('account_id', accountId)
        .is('sent_at', null)
        .order('scheduled_for', { ascending: true })
    },
  }
}

export type NotificationsDb = ReturnType<typeof createNotificationsDb>
