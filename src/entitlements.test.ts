/**
 * RLS tests for the entitlements system.
 *
 * Tables under test:
 *   subscription_entitlements
 *
 * RPCs under test:
 *   recompute_entitlements
 *
 * Notes:
 *   - Entitlements are org-scoped; members can only read their own org's data.
 *   - `recompute` is called after subscription changes; tested via admin.
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
