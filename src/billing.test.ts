/**
 * RLS tests for the billing system.
 *
 * Tables under test:
 *   invoices, invoice_line_items, credit_notes, payments,
 *   billing_webhook_events, idempotency_keys
 *
 * Notes:
 *   - Billing data is scoped to an organization; members can only see
 *     their own org's records.
 *   - Webhook events and idempotency keys are service-level — tested
 *     via the admin client.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  admin,
  addOrgMember,
  createTestOrg,
  createTestUser,
  deleteTestUser,
  uniqueSlug,
  type TestOrg,
  type TestUser,
} from './helpers'
import { createBillingDb } from './billing'

// ── invoices RLS ──────────────────────────────────────────────────────────────

describe('invoices RLS', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('billing-invoice-member')
    outsider = await createTestUser('billing-invoice-outsider')
    org = await createTestOrg(member.accountId, uniqueSlug('billing-invoices'))
    await addOrgMember(org.id, member.accountId, 'billing')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('org member can list invoices for their org (empty is fine)', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.listInvoices(org.id)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('non-member cannot see invoices from another org', async () => {
    const db = createBillingDb(outsider.client)
    const { data, error } = await db.listInvoices(org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('listInvoices orders by created_at descending', async () => {
    // create two invoices via admin to verify ordering
    const now = new Date()
    const earlier = new Date(now.getTime() - 60_000).toISOString()
    const later = now.toISOString()

    const { data: inv1 } = await admin
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-TEST-1-${Date.now()}`, status: 'draft', created_at: earlier })
      .select('id')
      .single()

    const { data: inv2 } = await admin
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-TEST-2-${Date.now()}`, status: 'draft', created_at: later })
      .select('id')
      .single()

    try {
      const db = createBillingDb(member.client)
      const { data, error } = await db.listInvoices(org.id)
      expect(error).toBeNull()
      const ids = data!.map(i => i.id)
      expect(ids.indexOf(inv2!.id)).toBeLessThan(ids.indexOf(inv1!.id))
    } finally {
      if (inv1) await admin.from('invoices').delete().eq('id', inv1.id)
      if (inv2) await admin.from('invoices').delete().eq('id', inv2.id)
    }
  })

  it('listInvoices can filter by status', async () => {
    const { data: inv } = await admin
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-PAID-${Date.now()}`, status: 'paid' })
      .select('id')
      .single()

    try {
      const db = createBillingDb(member.client)
      const { data, error } = await db.listInvoices(org.id, { status: 'paid' })
      expect(error).toBeNull()
      expect(data!.every(i => i.status === 'paid')).toBe(true)
    } finally {
      if (inv) await admin.from('invoices').delete().eq('id', inv.id)
    }
  })

  it('getInvoice returns invoice with line items and credit notes', async () => {
    const { data: inv } = await admin
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-DETAIL-${Date.now()}`, status: 'draft' })
      .select('id')
      .single()

    try {
      const db = createBillingDb(member.client)
      const { data, error } = await db.getInvoice(inv!.id)
      expect(error).toBeNull()
      expect(data!.id).toBe(inv!.id)
      expect(data!).toHaveProperty('invoice_line_items')
      expect(data!).toHaveProperty('credit_notes')
    } finally {
      if (inv) await admin.from('invoices').delete().eq('id', inv.id)
    }
  })
})

// ── payments RLS ──────────────────────────────────────────────────────────────

describe('payments RLS', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('billing-payments-member')
    outsider = await createTestUser('billing-payments-outsider')
    org = await createTestOrg(member.accountId, uniqueSlug('billing-payments'))
    await addOrgMember(org.id, member.accountId, 'billing')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('org member can list payments for their org', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.listPayments(org.id)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('non-member cannot see payments from another org', async () => {
    const db = createBillingDb(outsider.client)
    const { data, error } = await db.listPayments(org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('listPayments can filter by status', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.listPayments(org.id, { status: 'succeeded' })
    expect(error).toBeNull()
    expect(data!.every(p => p.status === 'succeeded')).toBe(true)
  })
})

// ── credit notes RLS ──────────────────────────────────────────────────────────

describe('credit_notes RLS', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('billing-cn-member')
    outsider = await createTestUser('billing-cn-outsider')
    org = await createTestOrg(member.accountId, uniqueSlug('billing-cn'))
    await addOrgMember(org.id, member.accountId, 'billing')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('org member can list credit notes for their org', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.listCreditNotes(org.id)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('non-member cannot see credit notes from another org', async () => {
    const db = createBillingDb(outsider.client)
    const { data, error } = await db.listCreditNotes(org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })
})

// ── billing_webhook_events ─────────────────────────────────────────────────────

describe('billing_webhook_events', () => {
  it('upsertWebhookEvent inserts a new event', async () => {
    const adminBilling = createBillingDb(admin)
    const eventId = `evt_test_${Date.now()}`
    const { data, error } = await adminBilling.upsertWebhookEvent({
      billing_provider: 'stripe',
      event_id: eventId,
      event_type: 'invoice.paid',
      payload: {},
      status: 'pending',
    })
    expect(error).toBeNull()
    expect(data!.event_id).toBe(eventId)

    await admin.from('billing_webhook_events').delete().eq('event_id', eventId)
  })

  it('upsertWebhookEvent is idempotent on (billing_provider, event_id)', async () => {
    const adminBilling = createBillingDb(admin)
    const eventId = `evt_idempotent_${Date.now()}`

    const { data: first } = await adminBilling.upsertWebhookEvent({
      billing_provider: 'stripe',
      event_id: eventId,
      event_type: 'invoice.paid',
      payload: {},
      status: 'pending',
    })

    const { data: second, error } = await adminBilling.upsertWebhookEvent({
      billing_provider: 'stripe',
      event_id: eventId,
      event_type: 'invoice.paid',
      payload: {},
      status: 'pending',
    })

    expect(error).toBeNull()
    expect(second!.id).toBe(first!.id)

    await admin.from('billing_webhook_events').delete().eq('event_id', eventId)
  })

  it('getWebhookEvent retrieves by provider and event_id', async () => {
    const adminBilling = createBillingDb(admin)
    const eventId = `evt_get_${Date.now()}`

    await adminBilling.upsertWebhookEvent({
      billing_provider: 'stripe',
      event_id: eventId,
      event_type: 'payment.succeeded',
      payload: {},
      status: 'pending',
    })

    const { data, error } = await adminBilling.getWebhookEvent('stripe', eventId)
    expect(error).toBeNull()
    expect(data!.event_id).toBe(eventId)

    await admin.from('billing_webhook_events').delete().eq('event_id', eventId)
  })

  it('listPendingWebhookEvents returns only pending events', async () => {
    const adminBilling = createBillingDb(admin)
    const { data, error } = await adminBilling.listPendingWebhookEvents()
    expect(error).toBeNull()
    expect(data!.every(e => e.status === 'pending')).toBe(true)
  })

  it('listPendingWebhookEvents can filter by provider', async () => {
    const adminBilling = createBillingDb(admin)
    const { data, error } = await adminBilling.listPendingWebhookEvents('stripe')
    expect(error).toBeNull()
    expect(data!.every(e => e.billing_provider === 'stripe')).toBe(true)
  })
})

// ── idempotency_keys ──────────────────────────────────────────────────────────

describe('idempotency_keys', () => {
  it('getIdempotencyKey returns null for an unknown key', async () => {
    const adminBilling = createBillingDb(admin)
    const { data, error } = await adminBilling.getIdempotencyKey('nonexistent-key')
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})
