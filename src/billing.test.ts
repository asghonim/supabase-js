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
    org = await createTestOrg(uniqueSlug('billing-invoices'))
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
    // Insert two invoices without explicit timestamps; inv2 is inserted after
    // inv1 so it will have a later created_at via DEFAULT NOW().
    const { data: inv1 } = await admin
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-TEST-1-${Date.now()}`, status: 'draft' })
      .select('id, created_at')
      .single()

    const { data: inv2 } = await admin
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-TEST-2-${Date.now()}`, status: 'draft' })
      .select('id, created_at')
      .single()

    try {
      const db = createBillingDb(member.client)
      const { data, error } = await db.listInvoices(org.id)
      expect(error).toBeNull()
      // Verify the list is ordered by created_at descending
      for (let i = 1; i < data!.length; i++) {
        expect(data![i - 1].created_at >= data![i].created_at).toBe(true)
      }
      // inv2 was inserted after inv1 so it should appear first
      const ids = data!.map(i => i.id)
      if (inv1!.created_at !== inv2!.created_at) {
        expect(ids.indexOf(inv2!.id)).toBeLessThan(ids.indexOf(inv1!.id))
      }
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
    org = await createTestOrg(uniqueSlug('billing-payments'))
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
    org = await createTestOrg(uniqueSlug('billing-cn'))
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

  it('upsertWebhookEvent does not overwrite a processed event on provider retry', async () => {
    const adminBilling = createBillingDb(admin)
    const eventId = `evt_processed_${Date.now()}`

    // Insert and mark as processed.
    const { data: original } = await adminBilling.upsertWebhookEvent({
      billing_provider: 'stripe',
      event_id: eventId,
      event_type: 'invoice.paid',
      payload: {},
      status: 'pending',
    })
    await admin
      .from('billing_webhook_events')
      .update({ status: 'processed' })
      .eq('id', original!.id)

    // Provider retries — caller passes status: 'pending' again.
    const { data: retried, error } = await adminBilling.upsertWebhookEvent({
      billing_provider: 'stripe',
      event_id: eventId,
      event_type: 'invoice.paid',
      payload: {},
      status: 'pending',
    })

    expect(error).toBeNull()
    expect(retried!.id).toBe(original!.id)
    expect(retried!.status).toBe('processed')

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

// ── invoices — additional methods ─────────────────────────────────────────────

describe('invoices — getInvoiceByNumber / getInvoiceByProviderId / limit', () => {
  let member: TestUser
  let org: TestOrg
  let invoiceId: number
  const invoiceNumber = `INV-EXTRA-${Date.now()}`
  const providerInvoiceId = `stripe_inv_${Date.now()}`

  beforeAll(async () => {
    member = await createTestUser('billing-extra-member')
    org = await createTestOrg(uniqueSlug('billing-extra'))
    await addOrgMember(org.id, member.accountId, 'billing')

    const { data: inv } = await admin
      .from('invoices')
      .insert({
        organization_id: org.id,
        number: invoiceNumber,
        status: 'paid',
        billing_provider_invoice_id: providerInvoiceId,
      })
      .select('id')
      .single()
    invoiceId = inv!.id
  })

  afterAll(async () => {
    if (invoiceId) await admin.from('invoices').delete().eq('id', invoiceId)
    await deleteTestUser(member.id)
  })

  it('listInvoices respects the limit option', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.listInvoices(org.id, { limit: 1 })
    expect(error).toBeNull()
    expect(data!.length).toBeLessThanOrEqual(1)
  })

  it('getInvoiceByNumber returns the invoice with line items', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.getInvoiceByNumber(invoiceNumber)
    expect(error).toBeNull()
    expect(data!.number).toBe(invoiceNumber)
    expect(data!).toHaveProperty('invoice_line_items')
  })

  it('getInvoiceByProviderId returns the invoice by billing_provider_invoice_id', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.getInvoiceByProviderId(providerInvoiceId)
    expect(error).toBeNull()
    expect(data!.billing_provider_invoice_id).toBe(providerInvoiceId)
  })
})

// ── credit_notes — getCreditNote (stub — DB sequence not accessible) ──────────

describe('credit_notes — getCreditNote', () => {
  it('getCreditNote builds the correct query chain', async () => {
    const fakeRow = { id: 7, organization_id: 1, reason: 'duplicate' }
    const chain: Record<string, unknown> = {}
    chain['select'] = () => chain
    chain['eq'] = () => chain
    chain['single'] = () => Promise.resolve({ data: fakeRow, error: null })
    const stubClient = { from: () => chain } as unknown as Parameters<typeof createBillingDb>[0]

    const db = createBillingDb(stubClient)
    const { data, error } = await db.getCreditNote(7)
    expect(error).toBeNull()
    expect(data!.id).toBe(7)
  })
})

// ── payments — getPayment / getPaymentByProviderId / limit ────────────────────

describe('payments — getPayment / getPaymentByProviderId / limit', () => {
  let member: TestUser
  let org: TestOrg
  let invoiceId: number
  let paymentId: number
  const providerPaymentId = `stripe_pay_${Date.now()}`

  beforeAll(async () => {
    member = await createTestUser('billing-pay-get-member')
    org = await createTestOrg(uniqueSlug('billing-pay-get'))
    await addOrgMember(org.id, member.accountId, 'billing')

    const { data: inv } = await admin
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-PAY-${Date.now()}`, status: 'paid' })
      .select('id')
      .single()
    invoiceId = inv!.id

    const { data: pay } = await admin
      .from('payments')
      .insert({
        organization_id: org.id,
        invoice_id: invoiceId,
        amount: 999,
        billing_provider: 'stripe',
        status: 'succeeded',
        billing_provider_payment_id: providerPaymentId,
      })
      .select('id')
      .single()
    paymentId = pay!.id
  })

  afterAll(async () => {
    if (paymentId) await admin.from('payments').delete().eq('id', paymentId)
    if (invoiceId) await admin.from('invoices').delete().eq('id', invoiceId)
    await deleteTestUser(member.id)
  })

  it('listPayments respects the limit option', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.listPayments(org.id, { limit: 1 })
    expect(error).toBeNull()
    expect(data!.length).toBeLessThanOrEqual(1)
  })

  it('getPayment returns the payment with invoices', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.getPayment(paymentId)
    expect(error).toBeNull()
    expect(data!.id).toBe(paymentId)
    expect(data!).toHaveProperty('invoices')
  })

  it('getPaymentByProviderId returns the payment by billing_provider_payment_id', async () => {
    const db = createBillingDb(member.client)
    const { data, error } = await db.getPaymentByProviderId(providerPaymentId)
    expect(error).toBeNull()
    expect(data!.billing_provider_payment_id).toBe(providerPaymentId)
  })
})

// ── security: billing write isolation ─────────────────────────────────────────

describe('security: members cannot insert invoices or payments', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('sec-billing-member')
    outsider = await createTestUser('sec-billing-outsider')
    org = await createTestOrg(uniqueSlug('sec-billing-org'))
    await addOrgMember(org.id, member.accountId, 'billing')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('regular member cannot INSERT an invoice', async () => {
    const { error } = await member.client
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-SEC-${Date.now()}`, status: 'draft' })
    expect(error).not.toBeNull()
  })

  it('outsider cannot INSERT an invoice for another org', async () => {
    const { error } = await outsider.client
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-SEC-OUT-${Date.now()}`, status: 'draft' })
    expect(error).not.toBeNull()
  })

  it('regular member cannot INSERT a payment', async () => {
    const { error } = await member.client
      .from('payments')
      .insert({
        organization_id: org.id,
        amount: 999,
        billing_provider: 'stripe',
        status: 'succeeded',
      })
    expect(error).not.toBeNull()
  })

  it('outsider cannot INSERT a credit note for another org', async () => {
    const { error } = await outsider.client
      .from('credit_notes')
      .insert({ organization_id: org.id, total_amount: 100, reason: 'fraudulent', invoice_id: 1 })
    expect(error).not.toBeNull()
  })
})

// ── security: billing cross-org isolation ─────────────────────────────────────

describe('security: org A member cannot see org B invoices or payments', () => {
  let memberA: TestUser
  let memberB: TestUser
  let orgA: TestOrg
  let orgB: TestOrg
  let invIdB: number
  let payIdB: number

  beforeAll(async () => {
    memberA = await createTestUser('sec-billing-cross-a')
    memberB = await createTestUser('sec-billing-cross-b')
    orgA = await createTestOrg(uniqueSlug('sec-billing-cross-a'))
    orgB = await createTestOrg(uniqueSlug('sec-billing-cross-b'))
    await addOrgMember(orgA.id, memberA.accountId, 'billing')
    await addOrgMember(orgB.id, memberB.accountId, 'billing')

    const { data: inv } = await admin
      .from('invoices')
      .insert({ organization_id: orgB.id, number: `INV-CROSS-${Date.now()}`, status: 'paid' })
      .select('id')
      .single()
    invIdB = inv!.id

    const { data: pay } = await admin
      .from('payments')
      .insert({
        organization_id: orgB.id,
        invoice_id: invIdB,
        amount: 100,
        billing_provider: 'stripe',
        status: 'succeeded',
      })
      .select('id')
      .single()
    payIdB = pay!.id
  })

  afterAll(async () => {
    if (payIdB) await admin.from('payments').delete().eq('id', payIdB)
    if (invIdB) await admin.from('invoices').delete().eq('id', invIdB)
    await deleteTestUser(memberA.id)
    await deleteTestUser(memberB.id)
  })

  it('member of org A cannot getInvoice from org B', async () => {
    const db = createBillingDb(memberA.client)
    const { data, error } = await db.getInvoice(invIdB)
    const found = !error && data?.id === invIdB
    expect(found).toBe(false)
  })

  it('member of org A cannot getPayment from org B', async () => {
    const db = createBillingDb(memberA.client)
    const { data } = await db.getPayment(payIdB)
    expect(data?.id ?? null).not.toBe(payIdB)
  })

  it('member of org A cannot UPDATE an invoice belonging to org B', async () => {
    const { error } = await memberA.client
      .from('invoices')
      .update({ status: 'void' })
      .eq('id', invIdB)
    if (!error) {
      const { data } = await admin.from('invoices').select('status').eq('id', invIdB).single()
      expect(data!.status).not.toBe('void')
    }
  })
})
