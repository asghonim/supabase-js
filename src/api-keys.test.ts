/**
 * RLS tests for the API keys system.
 *
 * Tables under test:
 *   api_scopes
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
import { createApiKeysDb, generateApiKey, hashApiKey } from './api-keys'

// ── seed helper ───────────────────────────────────────────────────────────────

async function seedApiKey(orgId: number, accountId: number) {
  const { data, error } = await admin
    .from('api_keys')
    .insert({
      org_id: orgId,
      account_id: accountId,
      name: 'Seeded key',
      key_prefix: 'sk_live_seeded',
      key_hash: `seed_hash_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    })
    .select('id, revoked_at')
    .single()
  if (error || !data) throw new Error(`seedApiKey: ${error?.message}`)
  return data
}

// ── generateApiKey / hashApiKey (pure functions) ──────────────────────────────

describe('hashApiKey', () => {
  it('throws when API_KEY_HASH_SALT is not set in this environment', () => {
    expect(() => hashApiKey('any-key')).toThrow('Missing API_KEY_HASH_SALT environment variable')
  })
})

describe('generateApiKey and hashApiKey with salt', () => {
  let freshGenerateApiKey: typeof generateApiKey
  let freshHashApiKey: typeof hashApiKey

  beforeAll(async () => {
    vi.resetModules()
    process.env.API_KEY_HASH_SALT = 'test-salt-for-unit-tests'
    const mod = await import('./api-keys')
    freshGenerateApiKey = mod.generateApiKey
    freshHashApiKey = mod.hashApiKey
  })

  afterAll(() => {
    delete process.env.API_KEY_HASH_SALT
    vi.resetModules()
  })

  it('generateApiKey returns a key with the sk_live_ prefix', () => {
    const result = freshGenerateApiKey()
    expect(result.key).toMatch(/^sk_live_/)
  })

  it('generateApiKey returns a 64-char hex hash', () => {
    const result = freshGenerateApiKey()
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generateApiKey prefix has the correct length', () => {
    const result = freshGenerateApiKey()
    expect(result.prefix).toBe(result.key.substring(0, 'sk_live_'.length + 8))
  })

  it('hashApiKey produces consistent output for the same input', () => {
    const h1 = freshHashApiKey('test-key-abc')
    const h2 = freshHashApiKey('test-key-abc')
    expect(h1).toBe(h2)
  })

  it('hashApiKey produces different hashes for different inputs', () => {
    const h1 = freshHashApiKey('key-a')
    const h2 = freshHashApiKey('key-b')
    expect(h1).not.toBe(h2)
  })

  it('hashApiKey output is a 64-char hex string', () => {
    const h = freshHashApiKey('some-key')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── api_scopes RLS ─────────────────────────────────────────────────────────────

describe('api_scopes RLS', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('rbac-api-scopes-user')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('authenticated user can list all api scopes', async () => {
    const db = createApiKeysDb(user.client)
    const { data, error } = await db.listApiScopes()
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    const keys = data!.map(s => s.key)
    expect(keys).toContain('read')
    expect(keys).toContain('write')
  })

  it('api scopes are ordered by key', async () => {
    const db = createApiKeysDb(user.client)
    const { data, error } = await db.listApiScopes()
    expect(error).toBeNull()
    const keys = data!.map(s => s.key)
    expect(keys).toEqual([...keys].sort())
  })
})

// ── createApiKeysDb DB methods ────────────────────────────────────────────────

describe('createApiKeysDb — CRUD', () => {
  let orgOwner: TestUser
  let org: TestOrg
  const adminDb = createApiKeysDb(admin)
  let keyId: number
  const fakeHash = `fake_hash_${Date.now()}`
  const fakePrefix = 'sk_live_testkey'

  beforeAll(async () => {
    orgOwner = await createTestUser('api-keys-crud-owner')
    org = await createTestOrg(uniqueSlug('api-keys-crud'))
    await addOrgMember(org.id, orgOwner.accountId, 'owner')
  })

  afterAll(async () => {
    if (keyId) await admin.from('api_keys').delete().eq('id', keyId)
    await deleteTestUser(orgOwner.id)
  })

  it('create inserts an API key and returns it', async () => {
    const { data, error } = await adminDb.create({
      org_id: org.id,
      account_id: orgOwner.accountId,
      name: 'Test Key',
      key_prefix: fakePrefix,
      key_hash: fakeHash,
      scopes: ['read'],
      expires_at: new Date(Date.now() + 86400_000 * 365).toISOString(),
    })
    expect(error).toBeNull()
    expect(data!.name).toBe('Test Key')
    expect(data!.key_prefix).toBe(fakePrefix)
    keyId = data!.id
  })

  it('getById returns the key by id', async () => {
    const { data, error } = await adminDb.getById(keyId)
    expect(error).toBeNull()
    expect(data!.id).toBe(keyId)
  })

  it('listByOrg returns keys for the org', async () => {
    const { data, error } = await adminDb.listByOrg(org.id)
    expect(error).toBeNull()
    expect(data!.some(k => k.id === keyId)).toBe(true)
  })

  it('updateScopes updates the key scopes', async () => {
    const { data, error } = await adminDb.updateScopes(keyId, ['read', 'write'])
    expect(error).toBeNull()
    expect(data!.scopes).toContain('write')
  })

  it('verify returns the key when hash and expiry match', async () => {
    const { data, error } = await adminDb.verify(fakeHash)
    expect(error).toBeNull()
    expect(data!.id).toBe(keyId)
  })

  it('revoke sets revoked_at on the key', async () => {
    // revoke now goes through the revoke_api_key RPC, which requires the
    // apikey.create org permission, so it runs on the org owner's client.
    const ownerDb = createApiKeysDb(orgOwner.client)
    const { data, error } = await ownerDb.revoke(keyId)
    expect(error).toBeNull()
    expect(data!.revoked_at).toBeTruthy()
  })

  it('verify returns null for a revoked key', async () => {
    const { data, error } = await adminDb.verify(fakeHash)
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})

// ── revoke_api_key RPC ────────────────────────────────────────────────────────
//
// Users may no longer UPDATE api_keys directly; revoking goes through the
// SECURITY DEFINER public.revoke_api_key() function, which requires the
// apikey.create org permission (held by owner/admin roles, not member).

describe('revoke_api_key (RPC)', () => {
  let owner: TestUser
  let member: TestUser
  let org: TestOrg

  beforeAll(async () => {
    owner = await createTestUser('revoke-rpc-owner')
    member = await createTestUser('revoke-rpc-member')
    org = await createTestOrg(uniqueSlug('revoke-rpc'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await admin.from('api_keys').delete().eq('org_id', org.id)
    await deleteTestUser(owner.id)
    await deleteTestUser(member.id)
  })

  it('org member with apikey.create can revoke a key', async () => {
    const key = await seedApiKey(org.id, owner.accountId)

    const { error } = await owner.client.rpc('revoke_api_key', { p_api_key_id: key.id })
    expect(error).toBeNull()

    const { data } = await admin
      .from('api_keys')
      .select('revoked_at')
      .eq('id', key.id)
      .single()
    expect(data!.revoked_at).not.toBeNull()
  })

  it('org member without apikey.create cannot revoke a key', async () => {
    const key = await seedApiKey(org.id, owner.accountId)

    const { error } = await member.client.rpc('revoke_api_key', { p_api_key_id: key.id })
    expect(error).not.toBeNull()

    const { data } = await admin
      .from('api_keys')
      .select('revoked_at')
      .eq('id', key.id)
      .single()
    expect(data!.revoked_at).toBeNull()
  })

  it('revoking an already-revoked key is a no-op (no error)', async () => {
    const key = await seedApiKey(org.id, owner.accountId)
    await owner.client.rpc('revoke_api_key', { p_api_key_id: key.id })

    const { error } = await owner.client.rpc('revoke_api_key', { p_api_key_id: key.id })
    expect(error).toBeNull()
  })
})

// ── security: API key cross-org isolation ─────────────────────────────────────

describe('security: API key cross-org isolation', () => {
  let ownerA: TestUser
  let ownerB: TestUser
  let orgA: TestOrg
  let orgB: TestOrg
  let keyIdInOrgB: number

  beforeAll(async () => {
    ownerA = await createTestUser('sec-apikey-owner-a')
    ownerB = await createTestUser('sec-apikey-owner-b')
    orgA = await createTestOrg(uniqueSlug('sec-apikey-org-a'))
    orgB = await createTestOrg(uniqueSlug('sec-apikey-org-b'))
    await addOrgMember(orgA.id, ownerA.accountId, 'owner')
    await addOrgMember(orgB.id, ownerB.accountId, 'owner')

    const { data: key } = await admin
      .from('api_keys')
      .insert({
        org_id: orgB.id,
        account_id: ownerB.accountId,
        name: 'OrgB Key',
        key_prefix: `sk_live_orgb${Date.now()}`,
        key_hash: `hash_orgb_${Date.now()}`,
        scopes: ['read'],
        expires_at: new Date(Date.now() + 86400_000 * 365).toISOString(),
      })
      .select('id')
      .single()
    keyIdInOrgB = key!.id
  })

  afterAll(async () => {
    if (keyIdInOrgB) await admin.from('api_keys').delete().eq('id', keyIdInOrgB)
    await deleteTestUser(ownerA.id)
    await deleteTestUser(ownerB.id)
  })

  it('member of org A cannot list org B API keys', async () => {
    const db = createApiKeysDb(ownerA.client)
    const { data, error } = await db.listByOrg(orgB.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('member of org A cannot read an org B API key by id', async () => {
    const db = createApiKeysDb(ownerA.client)
    const { data } = await db.getById(keyIdInOrgB)
    expect(data).toBeNull()
  })

  it('member of org A cannot revoke an org B API key', async () => {
    const db = createApiKeysDb(ownerA.client)
    const { error } = await db.revoke(keyIdInOrgB)
    expect(error).not.toBeNull()
    const { data } = await admin.from('api_keys').select('revoked_at').eq('id', keyIdInOrgB).single()
    expect(data!.revoked_at).toBeNull()
  })

  it('member of org A cannot INSERT an API key into org B', async () => {
    const { error } = await ownerA.client
      .from('api_keys')
      .insert({
        org_id: orgB.id,
        account_id: ownerA.accountId,
        name: 'Stolen Key',
        key_prefix: 'sk_live_stolen',
        key_hash: 'stolen_hash',
        scopes: ['read'],
        expires_at: new Date(Date.now() + 86400_000).toISOString(),
      })
    expect(error).not.toBeNull()
  })
})
