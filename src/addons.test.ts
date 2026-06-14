/**
 * RLS tests for the addons system.
 *
 * Tables under test:
 *   addons, addon_versions, addon_feature_entitlements
 *
 * Notes:
 *   - Addon catalog data is readable by any authenticated user.
 *   - Tests assume seed data exists (at least one active addon).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, createTestUser, deleteTestUser, uniqueSlug, type TestUser } from './helpers'
import { createAddonsDb } from './addons'

// ── addons RLS ────────────────────────────────────────────────────────────────

describe('addons — listActive', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('addons-list-active')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('authenticated user can list active addons', async () => {
    const db = createAddonsDb(user.client)
    const { data, error } = await db.listActive()
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('active addons are ordered by name ascending', async () => {
    const db = createAddonsDb(user.client)
    const { data, error } = await db.listActive()
    expect(error).toBeNull()
    const names = data!.map(a => a.name)
    expect(names).toEqual([...names].sort())
  })

  it('each addon includes its versions', async () => {
    const db = createAddonsDb(user.client)
    const { data, error } = await db.listActive()
    expect(error).toBeNull()
    for (const addon of data!) {
      expect(addon).toHaveProperty('addon_versions')
      expect(Array.isArray(addon.addon_versions)).toBe(true)
    }
  })

  it('all returned addons have is_active = true', async () => {
    const db = createAddonsDb(user.client)
    const { data, error } = await db.listActive()
    expect(error).toBeNull()
    expect(data!.every(a => a.is_active === true)).toBe(true)
  })
})

// ── getById / getByKey ────────────────────────────────────────────────────────

describe('addons — getById / getByKey', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('addons-get-single')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('getById returns the same addon as getByKey', async () => {
    const db = createAddonsDb(user.client)
    const { data: list } = await db.listActive()
    if (!list?.length) return

    const first = list[0]
    const { data: byId, error: errById } = await db.getById(first.id)
    expect(errById).toBeNull()
    expect(byId!.id).toBe(first.id)

    const { data: byKey, error: errByKey } = await db.getByKey(first.key)
    expect(errByKey).toBeNull()
    expect(byKey!.id).toBe(first.id)
  })
})

// ── addon_versions ────────────────────────────────────────────────────────────

describe('addons — versions', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('addons-versions')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('getActiveVersion returns the most recent active version for an addon', async () => {
    const db = createAddonsDb(user.client)
    const { data: list } = await db.listActive()
    if (!list?.length) return

    const first = list[0]
    const { data, error } = await db.getActiveVersion(first.id)
    expect(error).toBeNull()
    expect(data!.addon_id).toBe(first.id)
    expect(data!.is_active).toBe(true)
  })

  it('getVersionById returns the version with its parent addon', async () => {
    const db = createAddonsDb(user.client)
    const { data: list } = await db.listActive()
    if (!list?.length) return

    const addon = list.find(a => a.addon_versions.length > 0)
    if (!addon) return

    const versionId = (addon.addon_versions as Array<{ id: number }>)[0].id
    const { data, error } = await db.getVersionById(versionId)
    expect(error).toBeNull()
    expect(data!.id).toBe(versionId)
    expect(data!.addons).toBeTruthy()
  })
})

// ── addon_feature_entitlements ────────────────────────────────────────────────

describe('addons — listEntitlementsForVersion', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('addons-entitlements')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('returns entitlements with feature details for a version', async () => {
    const db = createAddonsDb(user.client)
    const { data: list } = await db.listActive()
    if (!list?.length) return

    const addon = list.find(a => a.addon_versions.length > 0)
    if (!addon) return

    const versionId = (addon.addon_versions as Array<{ id: number }>)[0].id
    const { data, error } = await db.listEntitlementsForVersion(versionId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    for (const ent of data!) {
      expect(ent).toHaveProperty('features')
    }
  })
})

// ── seeded-data coverage (admin client, no test user needed) ──────────────────

describe('createAddonsDb — seeded data coverage', () => {
  const adminDb = createAddonsDb(admin)
  let addonId: number
  let addonVersionId: number

  beforeAll(async () => {
    const { data: addon, error: addonErr } = await admin
      .from('addons')
      .insert({ name: 'Coverage Addon', key: uniqueSlug('cov-addon'), is_active: true })
      .select('id')
      .single()
    if (!addon) throw new Error(`addon insert failed: ${addonErr?.message}`)
    addonId = addon.id

    const { data: av, error: avErr } = await admin
      .from('addon_versions')
      .insert({ addon_id: addonId, price_amount: 0, is_active: true })
      .select('id')
      .single()
    if (!av) throw new Error(`addon_version insert failed: ${avErr?.message}`)
    addonVersionId = av.id
  })

  afterAll(async () => {
    await admin.from('addon_versions').delete().eq('id', addonVersionId)
    await admin.from('addons').delete().eq('id', addonId)
  })

  it('getById returns the addon with its versions', async () => {
    const { data, error } = await adminDb.getById(addonId)
    expect(error).toBeNull()
    expect(data!.id).toBe(addonId)
    expect(Array.isArray(data!.addon_versions)).toBe(true)
  })

  it('getByKey returns the addon by key', async () => {
    const { data: meta } = await admin.from('addons').select('key').eq('id', addonId).single()
    const { data, error } = await adminDb.getByKey(meta!.key)
    expect(error).toBeNull()
    expect(data!.id).toBe(addonId)
  })

  it('getActiveVersion returns the active version for the addon', async () => {
    const { data, error } = await adminDb.getActiveVersion(addonId)
    expect(error).toBeNull()
    expect(data!.addon_id).toBe(addonId)
    expect(data!.is_active).toBe(true)
  })

  it('getVersionById returns the version with its parent addon', async () => {
    const { data, error } = await adminDb.getVersionById(addonVersionId)
    expect(error).toBeNull()
    expect(data!.id).toBe(addonVersionId)
    expect(data!.addons).toBeTruthy()
  })

  it('getVersionByProviderId returns the version by billing_provider_price_id', async () => {
    const providerId = `cov-provider-${Date.now()}`
    await admin.from('addon_versions').update({ billing_provider_price_id: providerId }).eq('id', addonVersionId)

    const { data, error } = await adminDb.getVersionByProviderId(providerId)
    expect(error).toBeNull()
    expect(data!.id).toBe(addonVersionId)
  })

  it('listEntitlementsForVersion returns an array (empty if none)', async () => {
    const { data, error } = await adminDb.listEntitlementsForVersion(addonVersionId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})
