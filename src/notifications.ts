import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

// Values are inserted verbatim — callers must ensure they are already safe for
// the target context (plain text, SQL, etc.).  For HTML templates use renderHtml.
export function render(template: string, vars: Partial<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match)
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

// Like render() but HTML-escapes every substituted value, safe for use with
// body_template / subject_template fields that contain HTML markup.
export function renderHtml(template: string, vars: Partial<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key]
    return value !== undefined ? escapeHtml(value) : match
  })
}

export type NotificationChannel = Database['public']['Enums']['notification_channel']
export type NotificationFrequency = Database['public']['Enums']['notification_frequency']
export type PreferenceInsert = Database['public']['Tables']['notification_preferences']['Insert']
export type EventInsert = Database['public']['Tables']['notification_events']['Insert']
export type RecipientInsert = Database['public']['Tables']['notification_recipients']['Insert']
export type InboxInsert = Database['public']['Tables']['notification_inbox']['Insert']

// Split into three small private groups so that no single const's inferred
// return type exceeds TypeScript's .d.ts serialization limit (TS7056).

const _inboxMethods = (supabase: SupabaseClient<Database>) => ({
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
    return supabase.from('notification_inbox').select('*').eq('id', id).single()
  },

  createInboxItem(data: InboxInsert) {
    return supabase.from('notification_inbox').insert(data).select().single()
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
})

const _eventMethods = (supabase: SupabaseClient<Database>) => ({
  getEvent(id: number) {
    return supabase.from('notification_events').select('*').eq('id', id).single()
  },

  createEvent(data: EventInsert) {
    return supabase.from('notification_events').insert(data).select().single()
  },

  listEventsForEntity(entityType: string, entityId: string) {
    return supabase
      .from('notification_events')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('occurred_at', { ascending: false })
  },

  getRecipient(id: number) {
    return supabase.from('notification_recipients').select('*').eq('id', id).single()
  },

  createRecipient(data: RecipientInsert) {
    return supabase.from('notification_recipients').insert(data).select().single()
  },

  listRecipientsForEvent(eventId: number) {
    return supabase.from('notification_recipients').select('*').eq('event_id', eventId)
  },

  listDeliveries(recipientId: number, options?: { channel?: NotificationChannel }) {
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
})

const _prefMethods = (supabase: SupabaseClient<Database>) => ({
  /** Full preference history for an account, newest first. */
  listPreferences(accountId: number) {
    return supabase
      .from('notification_preferences')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
  },

  /** The current value for a (type, channel) pair — the row with the greatest created_at. */
  latestPreference(accountId: number, notificationType: string, channel: NotificationChannel) {
    return supabase
      .from('notification_preferences')
      .select('*')
      .eq('account_id', accountId)
      .eq('notification_type', notificationType)
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
  },

  /** Sets the current value by inserting a new row — preferences are event sourced, never updated or deleted. */
  insertPreference(data: PreferenceInsert) {
    return supabase
      .from('notification_preferences')
      .insert(data)
      .select()
      .single()
  },

  setChannelEnabled(
    notificationType: string,
    channel: NotificationChannel,
    isEnabled: boolean,
    frequency?: NotificationFrequency,
  ) {
    const data: PreferenceInsert = {
      notification_type: notificationType,
      channel,
      is_enabled: isEnabled,
      ...(frequency ? { frequency } : {}),
    }
    return supabase
      .from('notification_preferences')
      .insert(data)
      .select()
      .single()
  },

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

  async fetchTemplate(type: string, locale = 'en'): Promise<{ subject: string | null; body: string } | null> {
    const { data, error } = await supabase
      .from('notification_templates')
      .select('subject_template, body_template')
      .eq('type', type)
      .eq('channel', 'email')
      .eq('locale', locale)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    if (error) {
      // PGRST116 = "no rows returned" — treat as not found
      if (error.code === 'PGRST116') return null
      throw error
    }
    if (!data) return null
    return { subject: data.subject_template, body: data.body_template }
  },

  listPendingDigests(accountId: number) {
    return supabase
      .from('notification_digests')
      .select('*')
      .eq('account_id', accountId)
      .is('sent_at', null)
      .order('scheduled_for', { ascending: true })
  },
})

export type NotificationsDb =
  ReturnType<typeof _inboxMethods> &
  ReturnType<typeof _eventMethods> &
  ReturnType<typeof _prefMethods>

export function createNotificationsDb(supabase: SupabaseClient<Database>): NotificationsDb {
  return {
    ..._inboxMethods(supabase),
    ..._eventMethods(supabase),
    ..._prefMethods(supabase),
  }
}
