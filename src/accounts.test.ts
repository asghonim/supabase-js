/**
 * RLS tests for account_names and account_avatars.
 *
 * Policy under test:
 *   - Owners can INSERT their own names/avatars (private.owns_account check)
 *   - Owners can SELECT their own names/avatars
 *   - Users CANNOT insert into or read another user's rows
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, createTestUser, deleteTestUser, type TestUser } from './helpers'

describe('account_names and account_avatars RLS', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('acct-a')
    userB = await createTestUser('acct-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  // ─── account_names ──────────────────────────────────────────────────────────

  describe('account_names', () => {
    it('owner can insert their own name', async () => {
      const { error } = await userA.client
        .from('account_names')
        .insert({ account_id: userA.accountId, name: 'Alice' })
      expect(error).toBeNull()
    })

    it('owner can read their own names', async () => {
      const { data, error } = await userA.client
        .from('account_names')
        .select('name')
        .eq('account_id', userA.accountId)
      expect(error).toBeNull()
      expect(data?.some(r => r.name === 'Alice')).toBe(true)
    })

    it('user cannot insert into another account', async () => {
      const { error } = await userB.client
        .from('account_names')
        .insert({ account_id: userA.accountId, name: 'Hacker' })
      expect(error).not.toBeNull()
      expect(error!.code).toBe('42501') // RLS violation
    })

    it('user cannot read another account\'s names (empty result, no error)', async () => {
      // RLS silently filters rows on SELECT — no 403, just empty
      const { data, error } = await userB.client
        .from('account_names')
        .select('*')
        .eq('account_id', userA.accountId)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })

    it('admin can read any account\'s names (bypasses RLS)', async () => {
      const { data, error } = await admin
        .from('account_names')
        .select('name')
        .eq('account_id', userA.accountId)
      expect(error).toBeNull()
      expect(data?.some(r => r.name === 'Alice')).toBe(true)
    })

    it('created_at is populated automatically via DEFAULT NOW()', async () => {
      const { data, error } = await admin
        .from('account_names')
        .select('created_at')
        .eq('account_id', userA.accountId)
        .limit(1)
        .single()
      expect(error).toBeNull()
      expect(data!.created_at).toBeTruthy()
      expect(new Date(data!.created_at).getTime()).toBeGreaterThan(0)
    })

    it('cannot supply created_at explicitly — column privilege denied', async () => {
      const { error } = await userA.client
        .from('account_names')
        .insert({ account_id: userA.accountId, name: 'TimestampHack', created_at: '1999-01-01T00:00:00Z' })
      expect(error).not.toBeNull()
      expect(error!.code).toBe('42501')
    })
  })

  // ─── account_avatars ─────────────────────────────────────────────────────────

  describe('account_avatars', () => {
    const avatarUrl = 'https://example.com/avatar.png'

    it('owner can insert their own avatar', async () => {
      const { error } = await userA.client
        .from('account_avatars')
        .insert({ account_id: userA.accountId, url: avatarUrl })
      expect(error).toBeNull()
    })

    it('owner can read their own avatars', async () => {
      const { data, error } = await userA.client
        .from('account_avatars')
        .select('url')
        .eq('account_id', userA.accountId)
      expect(error).toBeNull()
      expect(data?.some(r => r.url === avatarUrl)).toBe(true)
    })

    it('user cannot insert avatar into another account', async () => {
      const { error } = await userB.client
        .from('account_avatars')
        .insert({ account_id: userA.accountId, url: 'https://evil.com/hack.png' })
      expect(error).not.toBeNull()
      expect(error!.code).toBe('42501')
    })

    it('user cannot read another account\'s avatars', async () => {
      const { data, error } = await userB.client
        .from('account_avatars')
        .select('*')
        .eq('account_id', userA.accountId)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })

    it('url must be between 1 and 2048 characters (check constraint)', async () => {
      const { error } = await admin
        .from('account_avatars')
        .insert({ account_id: userA.accountId, url: 'x'.repeat(2049) })
      expect(error).not.toBeNull()
    })

    it('cannot supply created_at explicitly — column privilege denied', async () => {
      const { error } = await userA.client
        .from('account_avatars')
        .insert({ account_id: userA.accountId, url: 'https://example.com/ts-hack.png', created_at: '1999-01-01T00:00:00Z' })
      expect(error).not.toBeNull()
      expect(error!.code).toBe('42501')
    })
  })

  // ─── accounts table itself ───────────────────────────────────────────────────

  describe('accounts table (no RLS policies — service-role only writes)', () => {
    it('user can read their own account via admin', async () => {
      const { data, error } = await admin
        .from('accounts')
        .select('id, user_id')
        .eq('id', userA.accountId)
        .single()
      expect(error).toBeNull()
      expect(data!.user_id).toBe(userA.id)
    })

    it('account is created automatically when auth user is created', async () => {
      const { data, error } = await admin
        .from('accounts')
        .select('id')
        .eq('user_id', userB.id)
        .single()
      expect(error).toBeNull()
      expect(data!.id).toBe(userB.accountId)
    })
  })
})

// ── security: account mutation isolation ─────────────────────────────────────

describe('security: users cannot mutate other accounts', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('sec-acct-a')
    userB = await createTestUser('sec-acct-b')

    await admin
      .from('account_names')
      .insert({ account_id: userA.accountId, name: 'Alice', created_at: new Date().toISOString() })
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('user B cannot UPDATE user A account_names row', async () => {
    const { error } = await userB.client
      .from('account_names')
      .update({ name: 'Hacked' })
      .eq('account_id', userA.accountId)
    expect(error).not.toBeNull()
    const { data } = await admin
      .from('account_names')
      .select('name')
      .eq('account_id', userA.accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    expect(data!.name).not.toBe('Hacked')
  })

  it('user B cannot DELETE user A account_names rows', async () => {
    const { error } = await userB.client
      .from('account_names')
      .delete()
      .eq('account_id', userA.accountId)
    expect(error).not.toBeNull()
    const { data } = await admin
      .from('account_names')
      .select('id')
      .eq('account_id', userA.accountId)
    expect(data!.length).toBeGreaterThan(0)
  })

  it('user B cannot UPDATE the accounts table row belonging to user A', async () => {
    const { error } = await userB.client
      .from('accounts')
      .update({ user_id: null })
      .eq('id', userA.accountId)
    expect(error).not.toBeNull()
    const { data } = await admin
      .from('accounts')
      .select('user_id')
      .eq('id', userA.accountId)
      .single()
    expect(data!.user_id).toBe(userA.id)
  })
})
