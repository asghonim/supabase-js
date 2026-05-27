/**
 * RLS tests for the API keys system.
 *
 * Tables under test:
 *   api_scopes
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestUser,
  deleteTestUser,
  type TestUser,
} from './helpers'
import { createApiKeysDb } from './api-keys';

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
