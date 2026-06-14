/**
 * RLS tests for the entitlements system.
 *
 * Tables under test:
 *   subscription_entitlements
 *
 *
 * Notes:
 *   - Entitlements are org-scoped; members can only read their own org's data.
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
import { createEntitlementsDb } from './entitlements'

// ── subscription_entitlements RLS ─────────────────────────────────────────────

describe('subscription_entitlements — listForOrg RLS', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('ent-list-org-member')
    outsider = await createTestUser('ent-list-org-outsider')
    org = await createTestOrg(member.accountId, uniqueSlug('ent-list-org'))
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('org member can list entitlements for their org', async () => {
    const db = createEntitlementsDb(member.client)
    const { data, error } = await db.listForOrg(org.id)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('non-member cannot see entitlements for another org', async () => {
    const db = createEntitlementsDb(outsider.client)
    const { data, error } = await db.listForOrg(org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('entitlements are ordered by feature_key ascending', async () => {
    const db = createEntitlementsDb(member.client)
    const { data, error } = await db.listForOrg(org.id)
    expect(error).toBeNull()
    const keys = data!.map(e => e.feature_key)
    expect(keys).toEqual([...keys].sort())
  })

  it('each entitlement includes feature details', async () => {
    const db = createEntitlementsDb(member.client)
    const { data, error } = await db.listForOrg(org.id)
    expect(error).toBeNull()
    for (const ent of data!) {
      expect(ent).toHaveProperty('features')
    }
  })
})

// ── listForSubscription ───────────────────────────────────────────────────────

describe('subscription_entitlements — listForSubscription RLS', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg
  let subscriptionId: number | null = null

  beforeAll(async () => {
    member = await createTestUser('ent-list-sub-member')
    outsider = await createTestUser('ent-list-sub-outsider')
    org = await createTestOrg(member.accountId, uniqueSlug('ent-list-sub'))
    await addOrgMember(org.id, member.accountId, 'member')

    // attempt to find an existing subscription for this org (may not exist in test env)
    const { data: subs } = await admin
      .from('subscriptions')
      .select('id')
      .eq('organization_id', org.id)
      .limit(1)
      .maybeSingle()

    subscriptionId = subs?.id ?? null
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('org member can list entitlements for a subscription (empty is fine)', async () => {
    if (subscriptionId === null) return

    const db = createEntitlementsDb(member.client)
    const { data, error } = await db.listForSubscription(subscriptionId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('non-member cannot see entitlements for another org subscription', async () => {
    if (subscriptionId === null) return

    const db = createEntitlementsDb(outsider.client)
    const { data, error } = await db.listForSubscription(subscriptionId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })
})

// ── checkFeature ──────────────────────────────────────────────────────────────

describe('subscription_entitlements — checkFeature', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('ent-check-member')
    outsider = await createTestUser('ent-check-outsider')
    org = await createTestOrg(member.accountId, uniqueSlug('ent-check'))
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('returns null when feature is not entitled for the org', async () => {
    const db = createEntitlementsDb(member.client)
    const { data, error } = await db.checkFeature(org.id, 'nonexistent.feature.key')
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('non-member cannot check features for another org', async () => {
    const db = createEntitlementsDb(outsider.client)
    const { data, error } = await db.checkFeature(org.id, 'any.feature')
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})

// ── real-data coverage: listForSubscription + checkFeature (positive case) ────

describe('subscription_entitlements — with real subscription data', () => {
  let member: TestUser
  let org: TestOrg
  let subscriptionId: number
  let featureId: number
  let featureKey: string
  let entitlementId: number
  let planVersionId: number
  let planId: number

  beforeAll(async () => {
    member = await createTestUser('ent-real-member')
    org = await createTestOrg(member.accountId, uniqueSlug('ent-real'))
    await addOrgMember(org.id, member.accountId, 'member')

    featureKey = `test.cov.ent.${Date.now()}`
    const { data: feat, error: featErr } = await admin
      .from('features')
      .insert({ key: featureKey, name: 'Coverage Ent Feature', type: 'boolean' })
      .select('id')
      .single()
    if (!feat) throw new Error(`feature insert failed: ${featErr?.message}`)
    featureId = feat.id

    const { data: plan, error: planErr } = await admin
      .from('plans')
      .insert({ name: 'Ent Plan', slug: uniqueSlug('ent-plan') })
      .select('id')
      .single()
    if (!plan) throw new Error(`plan insert failed: ${planErr?.message}`)
    planId = plan.id

    const { data: pv, error: pvErr } = await admin
      .from('plan_versions')
      .insert({ plan_id: planId, version_number: 1, price_amount: 0 })
      .select('id')
      .single()
    if (!pv) throw new Error(`plan_version insert failed: ${pvErr?.message}`)
    planVersionId = pv.id

    const { data: sub, error: subErr } = await admin
      .from('subscriptions')
      .insert({ organization_id: org.id, plan_version_id: planVersionId, status: 'active' })
      .select('id')
      .single()
    if (!sub) throw new Error(`subscription insert failed: ${subErr?.message}`)
    subscriptionId = sub.id

    const { data: ent, error: entErr } = await admin
      .from('subscription_entitlements')
      .insert({
        feature_id:      featureId,
        feature_key:     featureKey,
        organization_id: org.id,
        subscription_id: subscriptionId,
        value_boolean:   true,
      })
      .select('id')
      .single()
    if (!ent) throw new Error(`entitlement insert failed: ${entErr?.message}`)
    entitlementId = ent.id
  })

  afterAll(async () => {
    await admin.from('subscription_entitlements').delete().eq('id', entitlementId)
    await admin.from('subscriptions').delete().eq('id', subscriptionId)
    await admin.from('plan_versions').delete().eq('id', planVersionId)
    await admin.from('plans').delete().eq('id', planId)
    await admin.from('features').delete().eq('key', featureKey)
    await deleteTestUser(member.id)
  })

  it('listForSubscription returns entitlements for a subscription', async () => {
    const db = createEntitlementsDb(member.client)
    const { data, error } = await db.listForSubscription(subscriptionId)
    expect(error).toBeNull()
    expect(data!.some(e => e.id === entitlementId)).toBe(true)
  })

  it('checkFeature returns the entitlement when the org has it', async () => {
    const db = createEntitlementsDb(member.client)
    const { data, error } = await db.checkFeature(org.id, featureKey)
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.feature_key).toBe(featureKey)
  })
})
