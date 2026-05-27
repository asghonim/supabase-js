/**
 * RLS and RPC tests for the notification system.
 *
 * Tables under test:
 *   notification_events, notification_recipients, notification_inbox,
 *   notification_deliveries, notification_preferences, notification_templates
 *
 * All writes go through the admin client (service-role) because the system
 * has no user INSERT policies — apps fan out notifications server-side.
 * User clients are tested only for SELECT / UPDATE / RPC access.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, createTestUser, deleteTestUser, type TestUser } from './helpers'
import { createNotificationsDb, render } from './notifications'

// ── render ────────────────────────────────────────────────────────────────────

describe('render', () => {
  it('replaces a known token', () => {
    expect(render('Hello {{name}}!', { name: 'Alice' })).toBe('Hello Alice!')
  })

  it('replaces multiple tokens', () => {
    expect(render('{{greeting}}, {{name}}!', { greeting: 'Hi', name: 'Bob' })).toBe('Hi, Bob!')
  })

  it('replaces the same token multiple times', () => {
    expect(render('{{x}} and {{x}}', { x: 'y' })).toBe('y and y')
  })

  it('leaves unknown tokens as-is', () => {
    expect(render('Hello {{unknown}}!', {})).toBe('Hello {{unknown}}!')
  })

  it('leaves unmatched tokens when only some vars are provided', () => {
    expect(render('{{a}} {{b}}', { a: 'A' })).toBe('A {{b}}')
  })

  it('returns the string unchanged when there are no tokens', () => {
    expect(render('No tokens here.', { name: 'Alice' })).toBe('No tokens here.')
  })

  it('returns an empty string unchanged', () => {
    expect(render('', {})).toBe('')
  })
})

// ── helpers ──────────────────────────────────────────────────────────────────

async function seedEvent(actorAccountId?: number) {
  const { data, error } = await admin
    .from('notification_events')
    .insert({
      type: 'test.event',
      actor_account_id: actorAccountId ?? null,
      entity_type: 'test',
      entity_id: String(Date.now()),
      payload: { msg: 'hello' },
    })
    .select()
    .single()
  if (error || !data) throw new Error(`seedEvent: ${error?.message}`)
  return data
}

async function seedRecipient(eventId: number, accountId: number) {
  const { data, error } = await admin
    .from('notification_recipients')
    .insert({ event_id: eventId, account_id: accountId })
    .select()
    .single()
  if (error || !data) throw new Error(`seedRecipient: ${error?.message}`)
  return data
}

async function seedInboxItem(recipientId: number, accountId: number, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from('notification_inbox')
    .insert({
      recipient_id: recipientId,
      account_id: accountId,
      title: 'Test notification',
      body: 'This is a test body.',
      ...overrides,
    })
    .select()
    .single()
  if (error || !data) throw new Error(`seedInboxItem: ${error?.message}`)
  return data
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('notification system RLS', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('notif-a')
    userB = await createTestUser('notif-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  // ── notification_events ───────────────────────────────────────────────────

  describe('notification_events', () => {
    it("user can see events addressed to them", async () => {
      const event = await seedEvent(userA.accountId)
      await seedRecipient(event.id, userA.accountId)

      const { data, error } = await userA.client
        .from('notification_events')
        .select('id')
        .eq('id', event.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it("user cannot see events addressed only to another user", async () => {
      const event = await seedEvent()
      await seedRecipient(event.id, userB.accountId)

      const { data, error } = await userA.client
        .from('notification_events')
        .select('id')
        .eq('id', event.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  // ── notification_recipients ───────────────────────────────────────────────

  describe('notification_recipients', () => {
    it("user can see their own recipient records", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)

      const { data, error } = await userA.client
        .from('notification_recipients')
        .select('id')
        .eq('id', recipient.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it("user cannot see another user's recipient records", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userB.accountId)

      const { data, error } = await userA.client
        .from('notification_recipients')
        .select('id')
        .eq('id', recipient.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  // ── notification_inbox ────────────────────────────────────────────────────

  describe('notification_inbox', () => {
    it("user can see their own inbox items", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)
      const item = await seedInboxItem(recipient.id, userA.accountId)

      const { data, error } = await userA.client
        .from('notification_inbox')
        .select('id, title')
        .eq('id', item.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].title).toBe('Test notification')
    })

    it("user cannot see another user's inbox items", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userB.accountId)
      const item = await seedInboxItem(recipient.id, userB.accountId)

      const { data, error } = await userA.client
        .from('notification_inbox')
        .select('id')
        .eq('id', item.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })

    it("user cannot INSERT into notification_inbox (no insert policy)", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)

      const { error } = await userA.client
        .from('notification_inbox')
        .insert({ recipient_id: recipient.id, account_id: userA.accountId, title: 'X', body: 'Y' })
      expect(error).not.toBeNull()
    })

    it("inbox items are ordered by created_at descending by default", async () => {
      const event1 = await seedEvent()
      const event2 = await seedEvent()
      const r1 = await seedRecipient(event1.id, userA.accountId)
      const r2 = await seedRecipient(event2.id, userA.accountId)
      await seedInboxItem(r1.id, userA.accountId, { title: 'Older' })
      await seedInboxItem(r2.id, userA.accountId, { title: 'Newer' })

      const { data, error } = await userA.client
        .from('notification_inbox')
        .select('title, created_at')
        .eq('account_id', userA.accountId)
        .order('created_at', { ascending: false })
        .limit(2)
      expect(error).toBeNull()
      expect(data![0].title).toBe('Newer')
    })
  })

  // ── notification_deliveries ───────────────────────────────────────────────

  describe('notification_deliveries', () => {
    it("user can see deliveries for their own recipient records", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)
      const { data: delivery, error: dErr } = await admin
        .from('notification_deliveries')
        .insert({ recipient_id: recipient.id, channel: 'in_app' })
        .select()
        .single()
      expect(dErr).toBeNull()

      const { data, error } = await userA.client
        .from('notification_deliveries')
        .select('id')
        .eq('id', delivery!.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it("user cannot see another user's delivery records", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userB.accountId)
      const { data: delivery } = await admin
        .from('notification_deliveries')
        .insert({ recipient_id: recipient.id, channel: 'email' })
        .select()
        .single()

      const { data, error } = await userA.client
        .from('notification_deliveries')
        .select('id')
        .eq('id', delivery!.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  // ── notification_preferences ──────────────────────────────────────────────

  describe('notification_preferences', () => {
    it("user can insert their own preferences", async () => {
      const { error } = await userA.client
        .from('notification_preferences')
        .insert({ account_id: userA.accountId, notification_type: 'test.event', channel: 'in_app' })
      expect(error).toBeNull()
    })

    it("user can read their own preferences", async () => {
      const { data, error } = await userA.client
        .from('notification_preferences')
        .select('notification_type')
        .eq('account_id', userA.accountId)
        .eq('notification_type', 'test.event')
      expect(error).toBeNull()
      expect(data?.length).toBeGreaterThan(0)
    })

    it("user cannot insert preferences for another account", async () => {
      const { error } = await userB.client
        .from('notification_preferences')
        .insert({ account_id: userA.accountId, notification_type: 'test.event', channel: 'push' })
      expect(error).not.toBeNull()
      expect(error!.code).toBe('42501')
    })

    it("user cannot read another account's preferences", async () => {
      const { data, error } = await userB.client
        .from('notification_preferences')
        .select('*')
        .eq('account_id', userA.accountId)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })

    it("user can update their own preference (toggle off)", async () => {
      const { data: pref } = await admin
        .from('notification_preferences')
        .select('id')
        .eq('account_id', userA.accountId)
        .eq('notification_type', 'test.event')
        .eq('channel', 'in_app')
        .single()

      const { error } = await userA.client
        .from('notification_preferences')
        .update({ is_enabled: false })
        .eq('id', pref!.id)
      expect(error).toBeNull()
    })

    it("user can delete their own preference", async () => {
      const { data: pref } = await admin
        .from('notification_preferences')
        .select('id')
        .eq('account_id', userA.accountId)
        .eq('notification_type', 'test.event')
        .eq('channel', 'in_app')
        .single()

      const { error } = await userA.client
        .from('notification_preferences')
        .delete()
        .eq('id', pref!.id)
      expect(error).toBeNull()
    })

    it("upsert conflict on (account_id, notification_type, channel) updates the row", async () => {
      await admin
        .from('notification_preferences')
        .insert({ account_id: userA.accountId, notification_type: 'upsert.test', channel: 'email', is_enabled: true })

      const { error } = await userA.client
        .from('notification_preferences')
        .upsert(
          { account_id: userA.accountId, notification_type: 'upsert.test', channel: 'email', is_enabled: false },
          { onConflict: 'account_id,notification_type,channel' },
        )
      expect(error).toBeNull()

      const { data } = await admin
        .from('notification_preferences')
        .select('is_enabled')
        .eq('account_id', userA.accountId)
        .eq('notification_type', 'upsert.test')
        .eq('channel', 'email')
        .single()
      expect(data!.is_enabled).toBe(false)
    })
  })

  // ── fetchTemplate ─────────────────────────────────────────────────────────

  describe('fetchTemplate', () => {
    it('returns subject and body for an existing active email template', async () => {
      const type = `fetch.tmpl.${Date.now()}`
      await admin.from('notification_templates').insert({
        type,
        channel: 'email',
        locale: 'en',
        subject_template: 'Hello {{name}}',
        body_template: 'Welcome, {{name}}!',
        is_active: true,
      })

      const db = createNotificationsDb(userA.client)
      const result = await db.fetchTemplate(type)
      expect(result).not.toBeNull()
      expect(result!.subject).toBe('Hello {{name}}')
      expect(result!.body).toBe('Welcome, {{name}}!')
    })

    it('returns null when no active template exists for the type', async () => {
      const type = `fetch.tmpl.missing.${Date.now()}`
      const db = createNotificationsDb(userA.client)
      const result = await db.fetchTemplate(type)
      expect(result).toBeNull()
    })

    it('returns null for an inactive template', async () => {
      const type = `fetch.tmpl.inactive.${Date.now()}`
      await admin.from('notification_templates').insert({
        type,
        channel: 'email',
        locale: 'en',
        body_template: 'Inactive body',
        is_active: false,
      })

      const db = createNotificationsDb(userA.client)
      const result = await db.fetchTemplate(type)
      expect(result).toBeNull()
    })

    it('defaults to en locale and returns null for a missing locale', async () => {
      const type = `fetch.tmpl.locale.${Date.now()}`
      await admin.from('notification_templates').insert({
        type,
        channel: 'email',
        locale: 'fr',
        body_template: 'Bonjour',
        is_active: true,
      })

      const db = createNotificationsDb(userA.client)
      // en locale doesn't exist for this type
      const result = await db.fetchTemplate(type)
      expect(result).toBeNull()

      // but fr does
      const frResult = await db.fetchTemplate(type, 'fr')
      expect(frResult).not.toBeNull()
      expect(frResult!.body).toBe('Bonjour')
    })

    it('returns the highest-version template when multiple versions exist', async () => {
      const type = `fetch.tmpl.version.${Date.now()}`
      await admin.from('notification_templates').insert([
        { type, channel: 'email', locale: 'en', body_template: 'v1 body', is_active: true, version: 1 },
        { type, channel: 'email', locale: 'en', body_template: 'v2 body', is_active: true, version: 2 },
      ])

      const db = createNotificationsDb(userA.client)
      const result = await db.fetchTemplate(type)
      expect(result).not.toBeNull()
      expect(result!.body).toBe('v2 body')
    })

    it('does not return email templates for other channels', async () => {
      const type = `fetch.tmpl.channel.${Date.now()}`
      await admin.from('notification_templates').insert({
        type,
        channel: 'in_app',
        locale: 'en',
        body_template: 'In-app only',
        is_active: true,
      })

      const db = createNotificationsDb(userA.client)
      const result = await db.fetchTemplate(type)
      expect(result).toBeNull()
    })
  })

  // ── notification_templates ────────────────────────────────────────────────

  describe('notification_templates', () => {
    it("authenticated user can read active templates", async () => {
      await admin
        .from('notification_templates')
        .insert({ type: 'test.event', channel: 'email', body_template: 'Hello {{name}}', is_active: true })

      const { data, error } = await userA.client
        .from('notification_templates')
        .select('type')
        .eq('type', 'test.event')
        .eq('is_active', true)
      expect(error).toBeNull()
      expect(data?.length).toBeGreaterThan(0)
    })

    it("inactive templates are filtered by RLS", async () => {
      await admin
        .from('notification_templates')
        .insert({ type: 'test.inactive', channel: 'email', body_template: 'Hi', is_active: false })

      const { data, error } = await userA.client
        .from('notification_templates')
        .select('type')
        .eq('type', 'test.inactive')
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  // ── convenience RPCs ──────────────────────────────────────────────────────

  describe('mark_notification_read RPC', () => {
    it("marks a single inbox item as read", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)
      const item = await seedInboxItem(recipient.id, userA.accountId)
      expect(item.is_read).toBe(false)

      const { error } = await userA.client.rpc('mark_notification_read', { p_inbox_id: item.id })
      expect(error).toBeNull()

      const { data } = await admin
        .from('notification_inbox')
        .select('is_read, read_at')
        .eq('id', item.id)
        .single()
      expect(data!.is_read).toBe(true)
      expect(data!.read_at).toBeTruthy()
    })

    it("does not mark another user's item as read", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userB.accountId)
      const item = await seedInboxItem(recipient.id, userB.accountId)

      await userA.client.rpc('mark_notification_read', { p_inbox_id: item.id })

      const { data } = await admin
        .from('notification_inbox')
        .select('is_read')
        .eq('id', item.id)
        .single()
      expect(data!.is_read).toBe(false)
    })
  })

  describe('mark_all_notifications_read RPC', () => {
    it("marks all unread items for the calling user as read", async () => {
      const event1 = await seedEvent()
      const event2 = await seedEvent()
      const r1 = await seedRecipient(event1.id, userA.accountId)
      const r2 = await seedRecipient(event2.id, userA.accountId)
      await seedInboxItem(r1.id, userA.accountId)
      await seedInboxItem(r2.id, userA.accountId)

      const { error } = await userA.client.rpc('mark_all_notifications_read')
      expect(error).toBeNull()

      const { data } = await admin
        .from('notification_inbox')
        .select('is_read')
        .eq('account_id', userA.accountId)
        .eq('is_read', false)
        .is('archived_at', null)
      expect(data).toHaveLength(0)
    })
  })

  describe('archive_notification RPC', () => {
    it("archives the specified inbox item", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)
      const item = await seedInboxItem(recipient.id, userA.accountId)

      const { error } = await userA.client.rpc('archive_notification', { p_inbox_id: item.id })
      expect(error).toBeNull()

      const { data } = await admin
        .from('notification_inbox')
        .select('archived_at')
        .eq('id', item.id)
        .single()
      expect(data!.archived_at).toBeTruthy()
    })

    it("does not archive another user's inbox item", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userB.accountId)
      const item = await seedInboxItem(recipient.id, userB.accountId)

      await userA.client.rpc('archive_notification', { p_inbox_id: item.id })

      const { data } = await admin
        .from('notification_inbox')
        .select('archived_at')
        .eq('id', item.id)
        .single()
      expect(data!.archived_at).toBeNull()
    })
  })

  describe('unread_notification_count RPC', () => {
    it("returns the correct unread count for the calling user", async () => {
      // Establish a clean baseline: mark everything already in userA's inbox as read
      await userA.client.rpc('mark_all_notifications_read')

      const event1 = await seedEvent()
      const event2 = await seedEvent()
      const r1 = await seedRecipient(event1.id, userA.accountId)
      const r2 = await seedRecipient(event2.id, userA.accountId)
      await seedInboxItem(r1.id, userA.accountId)
      await seedInboxItem(r2.id, userA.accountId)

      const { data, error } = await userA.client.rpc('unread_notification_count')
      expect(error).toBeNull()
      expect(Number(data)).toBeGreaterThanOrEqual(2)
    })

    it("excludes archived items from the unread count", async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)
      const item = await seedInboxItem(recipient.id, userA.accountId)

      const { data: beforeArchive } = await userA.client.rpc('unread_notification_count')
      await userA.client.rpc('archive_notification', { p_inbox_id: item.id })
      const { data: afterArchive } = await userA.client.rpc('unread_notification_count')

      expect(Number(afterArchive)).toBe(Number(beforeArchive) - 1)
    })
  })
})
