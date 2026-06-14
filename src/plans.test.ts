/**
 * RLS tests for the plans system.
 *
 * Tables under test:
 *   plans, plan_versions, features, plan_feature_entitlements
 *
 * Notes:
 *   - Plan and feature catalog data is readable by any authenticated user.
 *   - Tests assume seed data exists (at least one public plan and one feature).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, createTestUser, deleteTestUser, uniqueSlug, type TestUser } from './helpers'
import { createPlansDb } from './plans'

// ── plans RLS ─────────────────────────────────────────────────────────────────

describe('plans — listPublic', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('plans-list-public')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('authenticated user can list public plans', async () => {
    const db = createPlansDb(user.client)
    const { data, error } = await db.listPublic()
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('all returned plans are active and public', async () => {
    const db = createPlansDb(user.client)
    const { data, error } = await db.listPublic()
    expect(error).toBeNull()
    expect(data!.every(p => p.is_active === true && p.is_public === true)).toBe(true)
  })

  it('plans are ordered by sort_order ascending', async () => {
    const db = createPlansDb(user.client)
    const { data, error } = await db.listPublic()
    expect(error).toBeNull()
    const orders = data!.map(p => p.sort_order)
    expect(orders).toEqual([...orders].sort((a, b) => (a ?? 0) - (b ?? 0)))
  })

  it('each plan includes its versions', async () => {
    const db = createPlansDb(user.client)
    const { data, error } = await db.listPublic()
    expect(error).toBeNull()
    for (const plan of data!) {
      expect(plan).toHaveProperty('plan_versions')
      expect(Array.isArray(plan.plan_versions)).toBe(true)
    }
  })
})

describe('plans — listAll', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('plans-list-all')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('authenticated user can list all plans', async () => {
    const db = createPlansDb(user.client)
    const { data, error } = await db.listAll()
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('listAll returns at least as many plans as listPublic', async () => {
    const db = createPlansDb(user.client)
    const { data: all } = await db.listAll()
    const { data: pub } = await db.listPublic()
    expect(all!.length).toBeGreaterThanOrEqual(pub!.length)
  })
})

// ── getById / getBySlug ───────────────────────────────────────────────────────

describe('plans — getById / getBySlug', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('plans-get-single')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('getById and getBySlug return the same plan', async () => {
    const db = createPlansDb(user.client)
    const { data: list } = await db.listPublic()
    if (!list?.length) return

    const first = list[0]
    const { data: byId, error: errById } = await db.getById(first.id)
    expect(errById).toBeNull()
    expect(byId!.id).toBe(first.id)

    const { data: bySlug, error: errBySlug } = await db.getBySlug(first.slug)
    expect(errBySlug).toBeNull()
    expect(bySlug!.id).toBe(first.id)
  })
})

// ── plan_versions ─────────────────────────────────────────────────────────────

describe('plans — versions', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('plans-versions')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('getActiveVersion returns the most recent active version for a plan', async () => {
    const db = createPlansDb(user.client)
    const { data: list } = await db.listPublic()
    if (!list?.length) return

    const plan = list.find(p => (p.plan_versions as Array<unknown>).length > 0)
    if (!plan) return

    const { data, error } = await db.getActiveVersion(plan.id)
    expect(error).toBeNull()
    expect(data!.plan_id).toBe(plan.id)
    expect(data!.is_active).toBe(true)
  })

  it('getVersionById returns the version with its parent plan', async () => {
    const db = createPlansDb(user.client)
    const { data: list } = await db.listPublic()
    if (!list?.length) return

    const plan = list.find(p => p.plan_versions.length > 0)
    if (!plan) return

    const versionId = (plan.plan_versions as Array<{ id: number }>)[0].id
    const { data, error } = await db.getVersionById(versionId)
    expect(error).toBeNull()
    expect(data!.id).toBe(versionId)
    expect(data!.plans).toBeTruthy()
  })
})

// ── features RLS ──────────────────────────────────────────────────────────────

describe('plans — features', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('plans-features')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('authenticated user can list all active features', async () => {
    const db = createPlansDb(user.client)
    const { data, error } = await db.listFeatures()
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('features are ordered by key ascending', async () => {
    const db = createPlansDb(user.client)
    const { data, error } = await db.listFeatures()
    expect(error).toBeNull()
    const keys = data!.map(f => f.key)
    expect(keys).toEqual([...keys].sort())
  })

  it('all returned features are active', async () => {
    const db = createPlansDb(user.client)
    const { data, error } = await db.listFeatures()
    expect(error).toBeNull()
    expect(data!.every(f => f.is_active === true)).toBe(true)
  })

  it('getFeatureByKey returns the matching feature', async () => {
    const db = createPlansDb(user.client)
    const { data: list } = await db.listFeatures()
    if (!list?.length) return

    const first = list[0]
    const { data, error } = await db.getFeatureByKey(first.key)
    expect(error).toBeNull()
    expect(data!.key).toBe(first.key)
  })
})

// ── plan_feature_entitlements ─────────────────────────────────────────────────

describe('plans — listEntitlementsForVersion', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('plans-pfe')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('returns entitlements with feature details for a plan version', async () => {
    const db = createPlansDb(user.client)
    const { data: list } = await db.listPublic()
    if (!list?.length) return

    const plan = list.find(p => p.plan_versions.length > 0)
    if (!plan) return

    const versionId = (plan.plan_versions as Array<{ id: number }>)[0].id
    const { data, error } = await db.listEntitlementsForVersion(versionId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    for (const ent of data!) {
      expect(ent).toHaveProperty('features')
    }
  })
})

// ── seeded-data coverage (admin client, no test user needed) ──────────────────

describe('createPlansDb — seeded data coverage', () => {
  const adminDb = createPlansDb(admin)
  let planId: number
  let planVersionId: number
  let planSlug: string

  beforeAll(async () => {
    planSlug = uniqueSlug('cov-plan')
    const { data: plan, error: planErr } = await admin
      .from('plans')
      .insert({ name: 'Coverage Plan', slug: planSlug, is_active: true, is_public: true })
      .select('id')
      .single()
    if (!plan) throw new Error(`plan insert failed: ${planErr?.message}`)
    planId = plan.id

    const { data: pv, error: pvErr } = await admin
      .from('plan_versions')
      .insert({ plan_id: planId, version_number: 1, price_amount: 0, is_active: true })
      .select('id')
      .single()
    if (!pv) throw new Error(`plan_version insert failed: ${pvErr?.message}`)
    planVersionId = pv.id
  })

  afterAll(async () => {
    await admin.from('plan_versions').delete().eq('id', planVersionId)
    await admin.from('plans').delete().eq('id', planId)
  })

  it('getById returns the plan with its versions', async () => {
    const { data, error } = await adminDb.getById(planId)
    expect(error).toBeNull()
    expect(data!.id).toBe(planId)
    expect(Array.isArray(data!.plan_versions)).toBe(true)
  })

  it('getBySlug returns the plan by slug', async () => {
    const { data, error } = await adminDb.getBySlug(planSlug)
    expect(error).toBeNull()
    expect(data!.id).toBe(planId)
  })

  it('getActiveVersion returns the active version for the plan', async () => {
    const { data, error } = await adminDb.getActiveVersion(planId)
    expect(error).toBeNull()
    expect(data!.plan_id).toBe(planId)
    expect(data!.is_active).toBe(true)
  })

  it('getVersionById returns the version with its parent plan', async () => {
    const { data, error } = await adminDb.getVersionById(planVersionId)
    expect(error).toBeNull()
    expect(data!.id).toBe(planVersionId)
    expect(data!.plans).toBeTruthy()
  })

  it('getVersionByProviderId returns the version by billing_provider_price_id', async () => {
    const providerId = `cov-plan-provider-${Date.now()}`
    await admin.from('plan_versions').update({ billing_provider_price_id: providerId }).eq('id', planVersionId)

    const { data, error } = await adminDb.getVersionByProviderId(providerId)
    expect(error).toBeNull()
    expect(data!.id).toBe(planVersionId)
  })

  it('listEntitlementsForVersion returns an array (empty if none)', async () => {
    const { data, error } = await adminDb.listEntitlementsForVersion(planVersionId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})
