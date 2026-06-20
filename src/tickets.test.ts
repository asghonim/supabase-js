/**
 * RLS and helper tests for the tickets system.
 *
 * Table under test: tickets
 *
 * Tickets are seeded via the admin client (no user INSERT policy).
 * User clients are tested for SELECT access governed by RLS.
 * Admin-only mutations (updateStatus, assignTo) are tested via createTicketDb.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, createTestUser, deleteTestUser, type TestUser } from './helpers'
import { createTicketDb } from './tickets'

// ── seed helpers ──────────────────────────────────────────────────────────────

async function seedTicket(
  accountId: number | null,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await admin
    .from('tickets')
    .insert({
      authenticated_account_id: accountId,
      message: 'Hello, I need help.',
      subject: 'Support request',
      ...overrides,
    })
    .select()
    .single()
  if (error || !data) throw new Error(`seedTicket: ${error?.message}`)
  return data
}

// ── tickets RLS ───────────────────────────────────────────────────────────────

describe('tickets RLS', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('tickets-a')
    userB = await createTestUser('tickets-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('user can view their own ticket', async () => {
    const ticket = await seedTicket(userA.accountId)

    const { data, error } = await userA.client
      .from('tickets')
      .select('id')
      .eq('id', ticket.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('user cannot view another account\'s ticket', async () => {
    const ticket = await seedTicket(userB.accountId)

    const { data, error } = await userA.client
      .from('tickets')
      .select('id')
      .eq('id', ticket.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('unauthenticated ticket (null account) is invisible to any user', async () => {
    const ticket = await seedTicket(null)

    const { data, error } = await userA.client
      .from('tickets')
      .select('id')
      .eq('id', ticket.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('admin can read any ticket', async () => {
    const ticket = await seedTicket(userB.accountId)

    const { data, error } = await admin
      .from('tickets')
      .select('id')
      .eq('id', ticket.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})

// ── createTicketDb ────────────────────────────────────────────────────────────

describe('createTicketDb', () => {
  let userA: TestUser
  let userB: TestUser
  const adminDb = createTicketDb(admin)

  beforeAll(async () => {
    userA = await createTestUser('tickets-db-a')
    userB = await createTestUser('tickets-db-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  describe('list', () => {
    it('returns only the calling user\'s own tickets', async () => {
      const ticketA = await seedTicket(userA.accountId)
      const ticketB = await seedTicket(userB.accountId)

      const userADb = createTicketDb(userA.client)
      const { data, error } = await userADb.list()
      expect(error).toBeNull()
      const ids = data!.map(r => r.id)
      expect(ids).toContain(ticketA.id)
      expect(ids).not.toContain(ticketB.id)
      data!.forEach(r => expect(r.authenticated_account_id).toBe(userA.accountId))
    })

    it('filters by status', async () => {
      await seedTicket(userA.accountId, { status: 'resolved' })
      await seedTicket(userA.accountId, { status: 'new' })

      const userADb = createTicketDb(userA.client)
      const { data, error } = await userADb.list({ status: 'resolved' })
      expect(error).toBeNull()
      data!.forEach(r => expect(r.status).toBe('resolved'))
    })

    it('respects limit', async () => {
      for (let i = 0; i < 3; i++) await seedTicket(userA.accountId)

      const userADb = createTicketDb(userA.client)
      const { data, error } = await userADb.list({ limit: 2 })
      expect(error).toBeNull()
      expect(data!.length).toBeLessThanOrEqual(2)
    })

    it('searches within message body', async () => {
      const unique = `uniquetoken${Date.now()}`
      await seedTicket(userA.accountId, { message: `Contains ${unique} inside` })

      const userADb = createTicketDb(userA.client)
      const { data, error } = await userADb.list({ search: unique })
      expect(error).toBeNull()
      expect(data!.length).toBeGreaterThanOrEqual(1)
      expect(data!.every(r => r.message.includes(unique))).toBe(true)
    })
  })

  describe('get', () => {
    it('returns own ticket', async () => {
      const ticket = await seedTicket(userA.accountId)

      const userADb = createTicketDb(userA.client)
      const { data, error } = await userADb.get(ticket.id)
      expect(error).toBeNull()
      expect(data!.id).toBe(ticket.id)
    })

    it('returns null for another account\'s ticket (RLS)', async () => {
      const ticket = await seedTicket(userB.accountId)

      const userADb = createTicketDb(userA.client)
      const { data, error } = await userADb.get(ticket.id)
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    })
  })

  describe('updateStatus', () => {
    // updateStatus now goes through the set_ticket_status RPC, so it runs on the
    // acting user's client (here the submitter), not service_role.
    it('submitter can update ticket status', async () => {
      const ticket = await seedTicket(userA.accountId)

      const userADb = createTicketDb(userA.client)
      const { data, error } = await userADb.updateStatus(ticket.id, 'in_progress')
      expect(error).toBeNull()
      expect(data!.status).toBe('in_progress')
    })

    it('sets resolved_at automatically when resolved', async () => {
      const ticket = await seedTicket(userA.accountId)

      const userADb = createTicketDb(userA.client)
      const { data, error } = await userADb.updateStatus(ticket.id, 'resolved')
      expect(error).toBeNull()
      expect(data!.resolved_at).toBeTruthy()
    })
  })

  describe('assignTo', () => {
    it('admin can assign a ticket to an account', async () => {
      const ticket = await seedTicket(userA.accountId)

      const { data, error } = await adminDb.assignTo(ticket.id, userB.accountId)
      expect(error).toBeNull()
      expect(data!.assigned_to_account_id).toBe(userB.accountId)
    })

    it('can clear assignment by setting to null', async () => {
      const ticket = await seedTicket(userA.accountId, {
        assigned_to_account_id: userB.accountId,
      })

      const { data, error } = await adminDb.assignTo(ticket.id, null)
      expect(error).toBeNull()
      expect(data!.assigned_to_account_id).toBeNull()
    })
  })
})

// ── set_ticket_status RPC ──────────────────────────────────────────────────────
//
// Users may no longer UPDATE tickets directly; status changes go through the
// SECURITY DEFINER public.set_ticket_status() function, which is restricted to
// the submitter, the assignee, or a holder of the ticket.edit permission.

describe('set_ticket_status (RPC)', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('set-status-a')
    userB = await createTestUser('set-status-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  async function statusOf(ticketId: number) {
    const { data } = await admin.from('tickets').select('status, resolved_at').eq('id', ticketId).single()
    return data!
  }

  it('submitter can change the status of their own ticket', async () => {
    const ticket = await seedTicket(userA.accountId)

    const { error } = await userA.client.rpc('set_ticket_status', {
      p_ticket_id: ticket.id,
      p_status: 'in_progress',
    })
    expect(error).toBeNull()
    expect((await statusOf(ticket.id)).status).toBe('in_progress')
  })

  it('assignee can change the status of a ticket assigned to them', async () => {
    const ticket = await seedTicket(userB.accountId, { assigned_to_account_id: userA.accountId })

    const { error } = await userA.client.rpc('set_ticket_status', {
      p_ticket_id: ticket.id,
      p_status: 'waiting_customer',
    })
    expect(error).toBeNull()
    expect((await statusOf(ticket.id)).status).toBe('waiting_customer')
  })

  it('unrelated user cannot change ticket status', async () => {
    const ticket = await seedTicket(userB.accountId)

    const { error } = await userA.client.rpc('set_ticket_status', {
      p_ticket_id: ticket.id,
      p_status: 'closed',
    })
    expect(error).not.toBeNull()
    expect((await statusOf(ticket.id)).status).toBe('new')
  })

  it('on_update_tickets trigger still sets resolved_at when resolved via RPC', async () => {
    const ticket = await seedTicket(userA.accountId)

    const { error } = await userA.client.rpc('set_ticket_status', {
      p_ticket_id: ticket.id,
      p_status: 'resolved',
    })
    expect(error).toBeNull()
    expect((await statusOf(ticket.id)).resolved_at).not.toBeNull()
  })
})
