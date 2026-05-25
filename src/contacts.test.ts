/**
 * RLS and helper tests for the contact submission system.
 *
 * Tables under test:
 *   contact_submissions, contact_messages
 *
 * Submissions are seeded via the admin client (no user INSERT policy).
 * User clients are tested for SELECT access governed by RLS.
 * Admin-only mutations (updateStatus, assignTo, addMessage) are tested
 * against the admin client directly via createContactDb.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, createTestUser, deleteTestUser, type TestUser } from './helpers'
import { createContactDb } from './contacts'

// ── seed helpers ──────────────────────────────────────────────────────────────

async function seedSubmission(
  accountId: number | null,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await admin
    .from('contact_submissions')
    .insert({
      authenticated_account_id: accountId,
      message: 'Hello, I need help.',
      subject: 'Support request',
      ...overrides,
    })
    .select()
    .single()
  if (error || !data) throw new Error(`seedSubmission: ${error?.message}`)
  return data
}

async function seedMessage(
  submissionId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await admin
    .from('contact_messages')
    .insert({
      submission_id: submissionId,
      sender_type: 'agent',
      body: 'Thanks for reaching out.',
      is_internal: false,
      ...overrides,
    })
    .select()
    .single()
  if (error || !data) throw new Error(`seedMessage: ${error?.message}`)
  return data
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('contact_submissions RLS', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('contacts-a')
    userB = await createTestUser('contacts-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('user can view their own submission', async () => {
    const sub = await seedSubmission(userA.accountId)

    const { data, error } = await userA.client
      .from('contact_submissions')
      .select('id')
      .eq('id', sub.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('user cannot view another account\'s submission', async () => {
    const sub = await seedSubmission(userB.accountId)

    const { data, error } = await userA.client
      .from('contact_submissions')
      .select('id')
      .eq('id', sub.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('unauthenticated submission (null account) is invisible to any user', async () => {
    const sub = await seedSubmission(null)

    const { data, error } = await userA.client
      .from('contact_submissions')
      .select('id')
      .eq('id', sub.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('admin can read any submission', async () => {
    const sub = await seedSubmission(userB.accountId)

    const { data, error } = await admin
      .from('contact_submissions')
      .select('id')
      .eq('id', sub.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('updated_at is refreshed by trigger on update', async () => {
    const sub = await seedSubmission(userA.accountId)

    await admin
      .from('contact_submissions')
      .update({ status: 'reviewed' })
      .eq('id', sub.id)

    const { data } = await admin
      .from('contact_submissions')
      .select('updated_at')
      .eq('id', sub.id)
      .single()
    expect(new Date(data!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(sub.updated_at).getTime(),
    )
  })
})

// ── contact_messages ──────────────────────────────────────────────────────────

describe('contact_messages RLS', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('contacts-msg-a')
    userB = await createTestUser('contacts-msg-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('user can view non-internal messages on their own submission', async () => {
    const sub = await seedSubmission(userA.accountId)
    const msg = await seedMessage(sub.id, { is_internal: false })

    const { data, error } = await userA.client
      .from('contact_messages')
      .select('id')
      .eq('id', msg.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('user cannot view internal messages on their own submission', async () => {
    const sub = await seedSubmission(userA.accountId)
    const msg = await seedMessage(sub.id, { is_internal: true })

    const { data, error } = await userA.client
      .from('contact_messages')
      .select('id')
      .eq('id', msg.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('user cannot view messages on another account\'s submission', async () => {
    const sub = await seedSubmission(userB.accountId)
    const msg = await seedMessage(sub.id, { is_internal: false })

    const { data, error } = await userA.client
      .from('contact_messages')
      .select('id')
      .eq('id', msg.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('admin can view internal messages', async () => {
    const sub = await seedSubmission(userA.accountId)
    const msg = await seedMessage(sub.id, { is_internal: true })

    const { data, error } = await admin
      .from('contact_messages')
      .select('id, is_internal')
      .eq('id', msg.id)
      .single()
    expect(error).toBeNull()
    expect(data!.is_internal).toBe(true)
  })
})

// ── createContactDb ───────────────────────────────────────────────────────────

describe('createContactDb', () => {
  let userA: TestUser
  let userB: TestUser
  const adminDb = createContactDb(admin)

  beforeAll(async () => {
    userA = await createTestUser('contacts-db-a')
    userB = await createTestUser('contacts-db-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  describe('listSubmissions', () => {
    it('returns only the calling user\'s own submissions', async () => {
      const subA = await seedSubmission(userA.accountId)
      await seedSubmission(userB.accountId)

      const userADb = createContactDb(userA.client)
      const { data, error } = await userADb.listSubmissions()
      expect(error).toBeNull()
      const ids = data!.map(r => r.id)
      expect(ids).toContain(subA.id)
      expect(ids).not.toContain(expect.not.stringContaining(subA.id))
      data!.forEach(r => expect(r.authenticated_account_id).toBe(userA.accountId))
    })

    it('filters by status', async () => {
      await seedSubmission(userA.accountId, { status: 'resolved' })
      await seedSubmission(userA.accountId, { status: 'new' })

      const userADb = createContactDb(userA.client)
      const { data, error } = await userADb.listSubmissions({ status: 'resolved' })
      expect(error).toBeNull()
      data!.forEach(r => expect(r.status).toBe('resolved'))
    })

    it('respects limit', async () => {
      for (let i = 0; i < 3; i++) await seedSubmission(userA.accountId)

      const userADb = createContactDb(userA.client)
      const { data, error } = await userADb.listSubmissions({ limit: 2 })
      expect(error).toBeNull()
      expect(data!.length).toBeLessThanOrEqual(2)
    })

    it('searches within message body', async () => {
      const unique = `uniquetoken${Date.now()}`
      await seedSubmission(userA.accountId, { message: `Contains ${unique} inside` })

      const userADb = createContactDb(userA.client)
      const { data, error } = await userADb.listSubmissions({ search: unique })
      expect(error).toBeNull()
      expect(data!.length).toBeGreaterThanOrEqual(1)
      expect(data!.every(r => r.message.includes(unique))).toBe(true)
    })
  })

  describe('getSubmission', () => {
    it('returns own submission', async () => {
      const sub = await seedSubmission(userA.accountId)

      const userADb = createContactDb(userA.client)
      const { data, error } = await userADb.getSubmission(sub.id)
      expect(error).toBeNull()
      expect(data!.id).toBe(sub.id)
    })

    it('returns null for another account\'s submission (RLS)', async () => {
      const sub = await seedSubmission(userB.accountId)

      const userADb = createContactDb(userA.client)
      const { data, error } = await userADb.getSubmission(sub.id)
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    })
  })

  describe('updateStatus', () => {
    it('admin can update submission status', async () => {
      const sub = await seedSubmission(userA.accountId)

      const { data, error } = await adminDb.updateStatus(sub.id, 'in_progress')
      expect(error).toBeNull()
      expect(data!.status).toBe('in_progress')
    })

    it('sets resolved_at when provided', async () => {
      const sub = await seedSubmission(userA.accountId)
      const resolvedAt = new Date().toISOString()

      const { data, error } = await adminDb.updateStatus(sub.id, 'resolved', {
        resolved_at: resolvedAt,
      })
      expect(error).toBeNull()
      expect(data!.resolved_at).toBeTruthy()
    })
  })

  describe('assignTo', () => {
    it('admin can assign a submission to an account', async () => {
      const sub = await seedSubmission(userA.accountId)

      const { data, error } = await adminDb.assignTo(sub.id, userB.accountId)
      expect(error).toBeNull()
      expect(data!.assigned_to_account_id).toBe(userB.accountId)
    })

    it('can clear assignment by setting to null', async () => {
      const sub = await seedSubmission(userA.accountId, {
        assigned_to_account_id: userB.accountId,
      })

      const { data, error } = await adminDb.assignTo(sub.id, null)
      expect(error).toBeNull()
      expect(data!.assigned_to_account_id).toBeNull()
    })
  })

  describe('listMessages', () => {
    it('returns messages ordered by created_at ascending', async () => {
      const sub = await seedSubmission(userA.accountId)
      await seedMessage(sub.id, { body: 'First' })
      await seedMessage(sub.id, { body: 'Second' })

      const userADb = createContactDb(userA.client)
      const { data, error } = await userADb.listMessages(sub.id)
      expect(error).toBeNull()
      expect(data!.length).toBeGreaterThanOrEqual(2)
      const times = data!.map(r => new Date(r.created_at).getTime())
      expect(times).toEqual([...times].sort((a, b) => a - b))
    })

    it('does not return internal messages to the user', async () => {
      const sub = await seedSubmission(userA.accountId)
      const internal = await seedMessage(sub.id, { body: 'Agent note', is_internal: true })

      const userADb = createContactDb(userA.client)
      const { data, error } = await userADb.listMessages(sub.id)
      expect(error).toBeNull()
      expect(data!.map(r => r.id)).not.toContain(internal.id)
    })
  })

  describe('addMessage', () => {
    it('admin can add a message to a submission', async () => {
      const sub = await seedSubmission(userA.accountId)

      const { data, error } = await adminDb.addMessage({
        submission_id: sub.id,
        sender_type: 'agent',
        sender_account_id: userB.accountId,
        body: 'We are looking into this.',
        is_internal: false,
      })
      expect(error).toBeNull()
      expect(data!.body).toBe('We are looking into this.')
      expect(data!.sender_account_id).toBe(userB.accountId)
    })

    it('user cannot insert messages (no INSERT policy)', async () => {
      const sub = await seedSubmission(userA.accountId)

      const userADb = createContactDb(userA.client)
      const { error } = await userADb.addMessage({
        submission_id: sub.id,
        sender_type: 'customer',
        sender_account_id: userA.accountId,
        body: 'Any update?',
        is_internal: false,
      })
      expect(error).not.toBeNull()
    })
  })
})
