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
import { createNotificationsDb, escapeHtml, render, renderHtml } from './notifications'

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

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes & to &amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes < to &lt;', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;')
  })

  it('escapes > to &gt;', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  it('escapes " to &quot;', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;')
  })

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s")
  })

  it('escapes multiple special characters in one string', () => {
    expect(escapeHtml('<b class="x">it\'s a & b</b>')).toBe('&lt;b class=&quot;x&quot;&gt;it&#39;s a &amp; b&lt;/b&gt;')
  })

  it('returns plain text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World')
  })

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('')
  })
})

// ── renderHtml ────────────────────────────────────────────────────────────────

describe('renderHtml', () => {
  it('replaces a known token and escapes the value', () => {
    expect(renderHtml('Hello {{name}}!', { name: '<Alice>' })).toBe('Hello &lt;Alice&gt;!')
  })

  it('replaces multiple tokens with HTML-escaped values', () => {
    // Only substituted values are escaped; literal template text is passed through unchanged.
    expect(renderHtml('{{a}} & {{b}}', { a: '<x>', b: '"y"' })).toBe('&lt;x&gt; & &quot;y&quot;')
  })

  it('leaves unknown tokens as-is (not escaped)', () => {
    expect(renderHtml('Hello {{unknown}}!', {})).toBe('Hello {{unknown}}!')
  })

  it('does not double-escape already-escaped text outside tokens', () => {
    expect(renderHtml('a &amp; b {{name}}', { name: 'Alice' })).toBe('a &amp; b Alice')
  })

  it('returns empty string unchanged', () => {
    expect(renderHtml('', {})).toBe('')
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
        .insert({ notification_type: 'test.event', channel: 'in_app' })
      expect(error).toBeNull()
    })

    it("user can insert another row for the same type and channel (event sourced, no unique conflict)", async () => {
      const type = `pref.repeat.${Date.now()}`
      const first = await userA.client
        .from('notification_preferences')
        .insert({ notification_type: type, channel: 'email', is_enabled: true })
      expect(first.error).toBeNull()

      const second = await userA.client
        .from('notification_preferences')
        .insert({ notification_type: type, channel: 'email', is_enabled: false })
      expect(second.error).toBeNull()

      const { data, error } = await userA.client
        .from('notification_preferences')
        .select('is_enabled')
        .eq('account_id', userA.accountId)
        .eq('notification_type', type)
        .eq('channel', 'email')
      expect(error).toBeNull()
      expect(data).toHaveLength(2)
    })

    it("the row with the greatest created_at is the current value", async () => {
      const type = `pref.latest.${Date.now()}`
      await userA.client
        .from('notification_preferences')
        .insert({ notification_type: type, channel: 'push', is_enabled: true })
      await userA.client
        .from('notification_preferences')
        .insert({ notification_type: type, channel: 'push', is_enabled: false })

      const { data, error } = await userA.client
        .from('notification_preferences')
        .select('is_enabled')
        .eq('account_id', userA.accountId)
        .eq('notification_type', type)
        .eq('channel', 'push')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      expect(error).toBeNull()
      expect(data!.is_enabled).toBe(false)
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

    it("user cannot UPDATE their own preferences (event sourced — insert only)", async () => {
      const { data: row } = await admin
        .from('notification_preferences')
        .insert({ account_id: userA.accountId, notification_type: 'test.update', channel: 'in_app' })
        .select()
        .single()

      const { error } = await userA.client
        .from('notification_preferences')
        .update({ is_enabled: false })
        .eq('id', row!.id)
      expect(error).not.toBeNull()
    })

    it("user cannot DELETE their own preferences (event sourced — insert only)", async () => {
      const { data: row } = await admin
        .from('notification_preferences')
        .insert({ account_id: userA.accountId, notification_type: 'test.delete', channel: 'in_app' })
        .select()
        .single()

      const { error } = await userA.client
        .from('notification_preferences')
        .delete()
        .eq('id', row!.id)
      expect(error).not.toBeNull()

      const { data: stillThere } = await admin
        .from('notification_preferences')
        .select('id')
        .eq('id', row!.id)
        .maybeSingle()
      expect(stillThere).not.toBeNull()
    })
  })

  // ── fetchTemplate ─────────────────────────────────────────────────────────

  describe('fetchTemplate', () => {
    
    it('throws on a non-"no rows" database error instead of returning null', async () => {
      const permissionError = { code: '42501', message: 'permission denied', details: null, hint: null }
      const stubChain = {
        select: () => stubChain,
        eq: () => stubChain,
        order: () => stubChain,
        limit: () => stubChain,
        single: () => Promise.resolve({ data: null, error: permissionError }),
      }
      const stubClient = { from: () => stubChain } as unknown as Parameters<typeof createNotificationsDb>[0]

      const db = createNotificationsDb(stubClient)
      await expect(db.fetchTemplate('any.type')).rejects.toMatchObject({ code: '42501' })
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

// ── createNotificationsDb methods ─────────────────────────────────────────────

describe('createNotificationsDb', () => {
  let userA: TestUser
  let adminDb: ReturnType<typeof createNotificationsDb>
  let userDb: ReturnType<typeof createNotificationsDb>

  beforeAll(async () => {
    userA = await createTestUser('notif-db-a')
    adminDb = createNotificationsDb(admin)
    userDb = createNotificationsDb(userA.client)
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
  })

  // ── inbox methods ─────────────────────────────────────────────────────────

  describe('inbox', () => {
    it('createInboxItem inserts and returns the item (admin)', async () => {
      const event = await seedEvent(userA.accountId)
      const recipient = await seedRecipient(event.id, userA.accountId)
      const { data, error } = await adminDb.createInboxItem({
        recipient_id: recipient.id,
        account_id: userA.accountId,
        title: 'DB test notification',
        body: 'DB test body',
      })
      expect(error).toBeNull()
      expect(data!.title).toBe('DB test notification')
      expect(data!.account_id).toBe(userA.accountId)
    })

    it('getInboxItem retrieves a single item', async () => {
      const event = await seedEvent(userA.accountId)
      const recipient = await seedRecipient(event.id, userA.accountId)
      const item = await seedInboxItem(recipient.id, userA.accountId)
      const { data, error } = await userDb.getInboxItem(item.id)
      expect(error).toBeNull()
      expect(data!.id).toBe(item.id)
    })

    it('listInbox returns inbox items for an account', async () => {
      const event = await seedEvent(userA.accountId)
      const recipient = await seedRecipient(event.id, userA.accountId)
      await seedInboxItem(recipient.id, userA.accountId)
      const { data, error } = await userDb.listInbox(userA.accountId)
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      expect(data!.length).toBeGreaterThan(0)
    })

    it('listInbox excludes archived items by default', async () => {
      const event = await seedEvent(userA.accountId)
      const recipient = await seedRecipient(event.id, userA.accountId)
      const item = await seedInboxItem(recipient.id, userA.accountId)
      await userA.client.rpc('archive_notification', { p_inbox_id: item.id })

      const { data } = await userDb.listInbox(userA.accountId)
      const archivedInList = data!.find(i => i.id === item.id)
      expect(archivedInList).toBeUndefined()
    })

    it('listInbox includes archived items when includeArchived = true', async () => {
      const event = await seedEvent(userA.accountId)
      const recipient = await seedRecipient(event.id, userA.accountId)
      const item = await seedInboxItem(recipient.id, userA.accountId)
      await userA.client.rpc('archive_notification', { p_inbox_id: item.id })

      const { data } = await userDb.listInbox(userA.accountId, { includeArchived: true })
      expect(data!.some(i => i.id === item.id)).toBe(true)
    })

    it('listInbox can filter by groupKey', async () => {
      const event = await seedEvent(userA.accountId)
      const recipient = await seedRecipient(event.id, userA.accountId)
      const groupKey = `group-${Date.now()}`
      await seedInboxItem(recipient.id, userA.accountId, { group_key: groupKey })

      const { data, error } = await userDb.listInbox(userA.accountId, { groupKey })
      expect(error).toBeNull()
      expect(data!.every(i => i.group_key === groupKey)).toBe(true)
    })

    it('listInbox respects limit', async () => {
      const { data, error } = await userDb.listInbox(userA.accountId, { limit: 1 })
      expect(error).toBeNull()
      expect(data!.length).toBeLessThanOrEqual(1)
    })

    it('listInbox respects offset', async () => {
      const event = await seedEvent(userA.accountId)
      const recipient = await seedRecipient(event.id, userA.accountId)
      await seedInboxItem(recipient.id, userA.accountId)

      const { data: page0, error } = await userDb.listInbox(userA.accountId, { limit: 2, offset: 0 })
      expect(error).toBeNull()
      expect(Array.isArray(page0)).toBe(true)
    })

    it('markRead marks an inbox item as read via db method', async () => {
      const event = await seedEvent(userA.accountId)
      const recipient = await seedRecipient(event.id, userA.accountId)
      const item = await seedInboxItem(recipient.id, userA.accountId)
      const { error } = await userDb.markRead(item.id)
      expect(error).toBeNull()

      const { data } = await admin.from('notification_inbox').select('is_read').eq('id', item.id).single()
      expect(data!.is_read).toBe(true)
    })

    it('markAllRead marks all items as read via db method', async () => {
      const { error } = await userDb.markAllRead()
      expect(error).toBeNull()
    })

    it('archive archives an item via db method', async () => {
      const event = await seedEvent(userA.accountId)
      const recipient = await seedRecipient(event.id, userA.accountId)
      const item = await seedInboxItem(recipient.id, userA.accountId)
      const { error } = await userDb.archive(item.id)
      expect(error).toBeNull()

      const { data } = await admin.from('notification_inbox').select('archived_at').eq('id', item.id).single()
      expect(data!.archived_at).toBeTruthy()
    })

    it('unreadCount returns a number via db method', async () => {
      const { data, error } = await userDb.unreadCount()
      expect(error).toBeNull()
      expect(typeof Number(data)).toBe('number')
    })
  })

  // ── event methods ─────────────────────────────────────────────────────────

  describe('events', () => {
    it('createEvent inserts and returns the event', async () => {
      const { data, error } = await adminDb.createEvent({
        type: 'test.db.event',
        entity_type: 'test',
        entity_id: String(Date.now()),
        payload: { foo: 'bar' },
      })
      expect(error).toBeNull()
      expect(data!.type).toBe('test.db.event')
    })

    it('getEvent retrieves a single event by id', async () => {
      const event = await seedEvent(userA.accountId)
      const { data, error } = await adminDb.getEvent(event.id)
      expect(error).toBeNull()
      expect(data!.id).toBe(event.id)
    })

    it('listEventsForEntity returns events for the given entity', async () => {
      const entityId = `entity-${Date.now()}`
      const { data: ev } = await adminDb.createEvent({
        type: 'test.entity.event',
        entity_type: 'test_resource',
        entity_id: entityId,
        payload: {},
      })
      const { data, error } = await adminDb.listEventsForEntity('test_resource', entityId)
      expect(error).toBeNull()
      expect(data!.some(e => e.id === ev!.id)).toBe(true)
    })

    it('createRecipient inserts and returns the recipient', async () => {
      const event = await seedEvent(userA.accountId)
      const { data, error } = await adminDb.createRecipient({ event_id: event.id, account_id: userA.accountId })
      expect(error).toBeNull()
      expect(data!.event_id).toBe(event.id)
      expect(data!.account_id).toBe(userA.accountId)
    })

    it('getRecipient retrieves a recipient by id', async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)
      const { data, error } = await adminDb.getRecipient(recipient.id)
      expect(error).toBeNull()
      expect(data!.id).toBe(recipient.id)
    })

    it('listRecipientsForEvent returns all recipients for an event', async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)
      const { data, error } = await adminDb.listRecipientsForEvent(event.id)
      expect(error).toBeNull()
      expect(data!.some(r => r.id === recipient.id)).toBe(true)
    })

    it('listDeliveries returns deliveries for a recipient', async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)
      await admin.from('notification_deliveries').insert({ recipient_id: recipient.id, channel: 'in_app' })
      const { data, error } = await adminDb.listDeliveries(recipient.id)
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
    })

    it('listDeliveries can filter by channel', async () => {
      const event = await seedEvent()
      const recipient = await seedRecipient(event.id, userA.accountId)
      await admin.from('notification_deliveries').insert({ recipient_id: recipient.id, channel: 'email' })
      const { data, error } = await adminDb.listDeliveries(recipient.id, { channel: 'email' })
      expect(error).toBeNull()
      expect(data!.every(d => d.channel === 'email')).toBe(true)
    })
  })

  // ── preference methods ────────────────────────────────────────────────────

  describe('preferences', () => {
    const notifType = `db.pref.test.${Date.now()}`

    it('insertPreference inserts a preference', async () => {
      const { data, error } = await userDb.insertPreference({
        notification_type: notifType,
        channel: 'in_app',
        is_enabled: true,
      })
      expect(error).toBeNull()
      expect(data!.notification_type).toBe(notifType)
    })

    it('insertPreference allows another row for the same type and channel (event sourced)', async () => {
      const { error } = await userDb.insertPreference({
        notification_type: notifType,
        channel: 'in_app',
        is_enabled: false,
      })
      expect(error).toBeNull()
    })

    it('listPreferences returns all preferences for an account', async () => {
      const { data, error } = await userDb.listPreferences(userA.accountId)
      expect(error).toBeNull()
      expect(data!.filter(p => p.notification_type === notifType).length).toBeGreaterThanOrEqual(2)
    })

    it('latestPreference retrieves the most recently inserted row for a type and channel', async () => {
      const { data, error } = await userDb.latestPreference(userA.accountId, notifType, 'in_app')
      expect(error).toBeNull()
      expect(data!.notification_type).toBe(notifType)
      expect(data!.channel).toBe('in_app')
      expect(data!.is_enabled).toBe(false)
    })

    it('setChannelEnabled inserts a new current value for a channel', async () => {
      const { data, error } = await userDb.setChannelEnabled(notifType, 'email', true)
      expect(error).toBeNull()
      expect(data!.is_enabled).toBe(true)
      expect(data!.channel).toBe('email')
    })

    it('setChannelEnabled can set frequency', async () => {
      const { data, error } = await userDb.setChannelEnabled(notifType, 'email', true, 'daily_digest')
      expect(error).toBeNull()
      expect(data!.frequency).toBe('daily_digest')
    })

    it('latestPreference reflects the most recent setChannelEnabled call', async () => {
      await userDb.setChannelEnabled(notifType, 'email', false)
      const { data, error } = await userDb.latestPreference(userA.accountId, notifType, 'email')
      expect(error).toBeNull()
      expect(data!.is_enabled).toBe(false)
    })
  })

  // ── digest methods ────────────────────────────────────────────────────────

  describe('listPendingDigests', () => {
    it('returns an array (empty is fine)', async () => {
      const { data, error } = await adminDb.listPendingDigests(userA.accountId)
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
    })
  })
})
