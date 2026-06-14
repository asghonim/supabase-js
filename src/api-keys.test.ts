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
    org = await createTestOrg(orgOwner.accountId, uniqueSlug('api-keys-crud'))
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
    const { data, error } = await adminDb.revoke(keyId)
    expect(error).toBeNull()
    expect(data!.revoked_at).toBeTruthy()
  })

  it('verify returns null for a revoked key', async () => {
    const { data, error } = await adminDb.verify(fakeHash)
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})
