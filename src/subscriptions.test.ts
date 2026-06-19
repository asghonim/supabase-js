/**
 * RLS and helper tests for the subscription system.
 *
 * Tables under test:
 *   organization_billing_emails
 *
 * Policies under test:
 *   - Org admins can INSERT billing emails; regular members cannot
 *   - Timestamps are set correctly by triggers
 *
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
import { createSubscriptionsDb } from './subscriptions'

// ── organization_billing_emails RLS ──────────────────────────────────────────

describe('organization_billing_emails RLS', () => {
  let orgAdmin: TestUser
  let member: TestUser
  let org: TestOrg

  beforeAll(async () => {
    orgAdmin = await createTestUser('org-billing-admin')
    member = await createTestUser('org-billing-member')
    org = await createTestOrg(uniqueSlug('org-billing'))
    await addOrgMember(org.id, orgAdmin.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(orgAdmin.id)
    await deleteTestUser(member.id)
  })

  it('org admin can insert a billing email', async () => {
    const { error } = await orgAdmin.client
      .from('organization_billing_emails')
      .insert({ organization_id: org.id, billing_email: 'billing@acme.com' })
    expect(error).toBeNull()
  })

  it('regular member cannot insert a billing email', async () => {
    const { error } = await member.client
      .from('organization_billing_emails')
      .insert({ organization_id: org.id, billing_email: 'hack@evil.com' })
    expect(error).not.toBeNull()
  })
})

// ── createSubscriptionsDb ─────────────────────────────────────────────────────

describe('createSubscriptionsDb', () => {
  let orgOwner: TestUser
  let member: TestUser
  let org: TestOrg
  const adminDb = createSubscriptionsDb(admin)

  beforeAll(async () => {
    orgOwner = await createTestUser('sub-db-owner')
    member = await createTestUser('sub-db-member')
    org = await createTestOrg(uniqueSlug('sub-db'))
    await addOrgMember(org.id, orgOwner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(orgOwner.id)
    await deleteTestUser(member.id)
  })

  describe('createOrganizationBillingEmail', () => {
    it('inserts and returns the billing email record (admin client)', async () => {
      const { data, error } = await adminDb.createOrganizationBillingEmail(org.id, 'finance@acme.com')
      expect(error).toBeNull()
      expect(data!.billing_email).toBe('finance@acme.com')
      expect(data!.organization_id).toBe(org.id)
    })

    it('created_at is populated automatically by DEFAULT NOW()', async () => {
      const before = new Date()

      const { data, error } = await admin
        .from('organization_billing_emails')
        .insert({ organization_id: org.id, billing_email: 'auto-ts@acme.com' })
        .select()
        .single()

      expect(error).toBeNull()
      const after = new Date()
      const storedAt = new Date(data!.created_at)
      const storedTime = storedAt.getTime()
      const beforeTime = before.getTime() - 2000 // allow 2s clock skew before
      expect(storedTime >= beforeTime).toBe(true)
      // Allow 60s of clock skew between test runner and DB server
      expect(storedTime <= new Date(after.getTime() + 60_000).getTime()).toBe(true)
    })

    it('regular member cannot insert via RLS', async () => {
      const subDb = createSubscriptionsDb(member.client)
      const { error } = await subDb.createOrganizationBillingEmail(org.id, 'hack@evil.com')
      expect(error).not.toBeNull()
    })

    it('cannot supply created_at explicitly — column privilege denied', async () => {
      const { error } = await orgOwner.client
        .from('organization_billing_emails')
        .insert({ organization_id: org.id, billing_email: 'ts-hack@acme.com', created_at: '1999-01-01T00:00:00Z' })
      expect(error).not.toBeNull()
      expect(error!.code).toBe('42501')
    })
  })
})

// ── subscriptions DB methods ──────────────────────────────────────────────────

describe('createSubscriptionsDb — subscriptions', () => {
  let orgOwner: TestUser
  let org: TestOrg
  const adminDb = createSubscriptionsDb(admin)
  let planId: number
  let planVersionId: number
  let subscriptionId: number
  let addonId: number
  let addonVersionId: number
  let subscriptionAddonId: number

  beforeAll(async () => {
    orgOwner = await createTestUser('sub-methods-owner')
    org = await createTestOrg(uniqueSlug('sub-methods'))

    const { data: plan } = await admin
      .from('plans')
      .insert({ name: 'Test Plan', slug: uniqueSlug('sub-methods-plan') })
      .select('id')
      .single()
    planId = plan!.id

    const { data: pv } = await admin
      .from('plan_versions')
      .insert({ plan_id: planId, version_number: 1, price_amount: 0 })
      .select('id')
      .single()
    planVersionId = pv!.id

    const { data: sub } = await admin
      .from('subscriptions')
      .insert({
        organization_id: org.id,
        plan_version_id: planVersionId,
        status: 'active',
        billing_provider_subscription_id: `fake_sub_${Date.now()}`,
      })
      .select('id')
      .single()
    subscriptionId = sub!.id

    const { data: addon } = await admin
      .from('addons')
      .insert({ name: 'Test Addon', key: uniqueSlug('test-addon') })
      .select('id')
      .single()
    addonId = addon!.id

    const { data: av, error: avErr } = await admin
      .from('addon_versions')
      .insert({ addon_id: addonId, price_amount: 0 })
      .select('id')
      .single()
    if (!av) throw new Error(`addon_version insert failed: ${avErr?.message}`)
    addonVersionId = av.id

    const { data: sa } = await admin
      .from('subscription_addons')
      .insert({ subscription_id: subscriptionId, addon_version_id: addonVersionId, status: 'active' })
      .select('id')
      .single()
    subscriptionAddonId = sa!.id
  })

  afterAll(async () => {
    await admin.from('subscription_addons').delete().eq('id', subscriptionAddonId)
    await admin.from('subscriptions').delete().eq('id', subscriptionId)
    await admin.from('addon_versions').delete().eq('id', addonVersionId)
    await admin.from('addons').delete().eq('id', addonId)
    await admin.from('plan_versions').delete().eq('id', planVersionId)
    await admin.from('plans').delete().eq('id', planId)
    await deleteTestUser(orgOwner.id)
  })

  it('getById returns the subscription with plan version', async () => {
    const { data, error } = await adminDb.getById(subscriptionId)
    expect(error).toBeNull()
    expect(data!.id).toBe(subscriptionId)
    expect(data!.plan_versions).toBeTruthy()
  })

  it('getActiveForOrg returns the active subscription', async () => {
    const { data, error } = await adminDb.getActiveForOrg(org.id)
    expect(error).toBeNull()
    expect(data!.id).toBe(subscriptionId)
    expect(data!.status).toBe('active')
  })

  it('listForOrg returns all subscriptions for the org', async () => {
    const { data, error } = await adminDb.listForOrg(org.id)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    expect(data!.some(s => s.id === subscriptionId)).toBe(true)
  })

  it('getByProviderSubscriptionId returns the subscription by billing provider ID', async () => {
    const { data: sub } = await admin
      .from('subscriptions')
      .select('billing_provider_subscription_id')
      .eq('id', subscriptionId)
      .single()
    const { data, error } = await adminDb.getByProviderSubscriptionId(sub!.billing_provider_subscription_id!)
    expect(error).toBeNull()
    expect(data!.id).toBe(subscriptionId)
  })

  it('listAddons returns all addons for a subscription', async () => {
    const { data, error } = await adminDb.listAddons(subscriptionId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    expect(data!.some(a => a.id === subscriptionAddonId)).toBe(true)
  })

  it('getActiveAddons returns only active addons', async () => {
    const { data, error } = await adminDb.getActiveAddons(subscriptionId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    expect(data!.every(a => a.status === 'active')).toBe(true)
  })
})

// ── subscription_change_requests ──────────────────────────────────────────────

describe('createSubscriptionsDb — change requests', () => {
  let orgOwner: TestUser
  let org: TestOrg
  const adminDb = createSubscriptionsDb(admin)
  let planId: number
  let planVersionId: number
  let subscriptionId: number
  let changeRequestId: number
  const idemKey = `idem-cr-${Date.now()}`

  beforeAll(async () => {
    orgOwner = await createTestUser('sub-cr-owner')
    org = await createTestOrg(uniqueSlug('sub-cr'))

    const { data: plan } = await admin
      .from('plans')
      .insert({ name: 'CR Plan', slug: uniqueSlug('sub-cr-plan') })
      .select('id')
      .single()
    planId = plan!.id

    const { data: pv } = await admin
      .from('plan_versions')
      .insert({ plan_id: planId, version_number: 1, price_amount: 0 })
      .select('id')
      .single()
    planVersionId = pv!.id

    const { data: sub } = await admin
      .from('subscriptions')
      .insert({ organization_id: org.id, plan_version_id: planVersionId, status: 'active' })
      .select('id')
      .single()
    subscriptionId = sub!.id
  })

  afterAll(async () => {
    await admin.from('subscription_change_requests').delete().eq('organization_id', org.id)
    await admin.from('subscriptions').delete().eq('id', subscriptionId)
    await admin.from('plan_versions').delete().eq('id', planVersionId)
    await admin.from('plans').delete().eq('id', planId)
    await deleteTestUser(orgOwner.id)
  })

  it('createChangeRequest inserts and returns the request', async () => {
    const { data, error } = await adminDb.createChangeRequest({
      organization_id: org.id,
      subscription_id: subscriptionId,
      requested_by_account_id: orgOwner.accountId,
      type: 'cancel',
      idempotency_key: idemKey,
    })
    expect(error).toBeNull()
    expect(data!.organization_id).toBe(org.id)
    expect(data!.type).toBe('cancel')
    changeRequestId = data!.id
  })

  it('getChangeRequest returns the change request by id', async () => {
    const { data, error } = await adminDb.getChangeRequest(changeRequestId)
    expect(error).toBeNull()
    expect(data!.id).toBe(changeRequestId)
  })

  it('getChangeRequestByIdempotencyKey returns the request by key', async () => {
    const { data, error } = await adminDb.getChangeRequestByIdempotencyKey(idemKey)
    expect(error).toBeNull()
    expect(data!.idempotency_key).toBe(idemKey)
  })

  it('listChangeRequests returns all requests for a subscription', async () => {
    const { data, error } = await adminDb.listChangeRequests(subscriptionId)
    expect(error).toBeNull()
    expect(data!.some(r => r.id === changeRequestId)).toBe(true)
  })

  it('listChangeRequests can filter by status', async () => {
    const { data, error } = await adminDb.listChangeRequests(subscriptionId, { status: 'pending' })
    expect(error).toBeNull()
    expect(data!.every(r => r.status === 'pending')).toBe(true)
  })

  it('listOrgChangeRequests returns all requests for an org', async () => {
    const { data, error } = await adminDb.listOrgChangeRequests(org.id)
    expect(error).toBeNull()
    expect(data!.some(r => r.id === changeRequestId)).toBe(true)
  })

  it('listOrgChangeRequests can filter by status', async () => {
    const { data, error } = await adminDb.listOrgChangeRequests(org.id, { status: 'pending' })
    expect(error).toBeNull()
    expect(data!.every(r => r.status === 'pending')).toBe(true)
  })
})

// ── subscription_events ───────────────────────────────────────────────────────

describe('createSubscriptionsDb — events', () => {
  let org: TestOrg
  let orgOwner: TestUser
  const adminDb = createSubscriptionsDb(admin)
  let planId: number
  let planVersionId: number
  let subscriptionId: number
  let eventId: number

  beforeAll(async () => {
    orgOwner = await createTestUser('sub-events-owner')
    org = await createTestOrg(uniqueSlug('sub-events'))

    const { data: plan } = await admin
      .from('plans')
      .insert({ name: 'Events Plan', slug: uniqueSlug('sub-events-plan') })
      .select('id')
      .single()
    planId = plan!.id

    const { data: pv } = await admin
      .from('plan_versions')
      .insert({ plan_id: planId, version_number: 1, price_amount: 0 })
      .select('id')
      .single()
    planVersionId = pv!.id

    const { data: sub } = await admin
      .from('subscriptions')
      .insert({ organization_id: org.id, plan_version_id: planVersionId, status: 'active' })
      .select('id')
      .single()
    subscriptionId = sub!.id

    const { data: ev } = await admin
      .from('subscription_events')
      .insert({ organization_id: org.id, subscription_id: subscriptionId, type: 'subscription.activated' })
      .select('id')
      .single()
    eventId = ev!.id
  })

  afterAll(async () => {
    await admin.from('subscription_events').delete().eq('id', eventId)
    await admin.from('subscriptions').delete().eq('id', subscriptionId)
    await admin.from('plan_versions').delete().eq('id', planVersionId)
    await admin.from('plans').delete().eq('id', planId)
    await deleteTestUser(orgOwner.id)
  })

  it('listEvents returns events for an org', async () => {
    const { data, error } = await adminDb.listEvents(org.id)
    expect(error).toBeNull()
    expect(data!.some(e => e.id === eventId)).toBe(true)
  })

  it('listEvents can filter by subscriptionId', async () => {
    const { data, error } = await adminDb.listEvents(org.id, { subscriptionId })
    expect(error).toBeNull()
    expect(data!.every(e => e.subscription_id === subscriptionId)).toBe(true)
  })

  it('listEvents can limit results', async () => {
    const { data, error } = await adminDb.listEvents(org.id, { limit: 1 })
    expect(error).toBeNull()
    expect(data!.length).toBeLessThanOrEqual(1)
  })
})

// ── subscription_contracts ────────────────────────────────────────────────────

describe('createSubscriptionsDb — contracts', () => {
  let org: TestOrg
  let orgOwner: TestUser
  const adminDb = createSubscriptionsDb(admin)
  let contractId: number

  beforeAll(async () => {
    orgOwner = await createTestUser('sub-contracts-owner')
    org = await createTestOrg(uniqueSlug('sub-contracts'))

    const { data: contract } = await admin
      .from('subscription_contracts')
      .insert({ organization_id: org.id, start_date: '2026-01-01', status: 'active' })
      .select('id')
      .single()
    contractId = contract!.id
  })

  afterAll(async () => {
    await admin.from('subscription_contracts').delete().eq('id', contractId)
    await deleteTestUser(orgOwner.id)
  })

  it('listContracts returns all contracts for an org', async () => {
    const { data, error } = await adminDb.listContracts(org.id)
    expect(error).toBeNull()
    expect(data!.some(c => c.id === contractId)).toBe(true)
  })

  it('getContract returns the contract by id', async () => {
    const { data, error } = await adminDb.getContract(contractId)
    expect(error).toBeNull()
    expect(data!.id).toBe(contractId)
    expect(data!.organization_id).toBe(org.id)
  })
})
