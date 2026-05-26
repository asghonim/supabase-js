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
    org = await createTestOrg(orgAdmin.accountId, uniqueSlug('org-billing'))
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
      .insert({ organization_id: org.id, billing_email: 'billing@acme.com', created_at: new Date().toISOString() })
    expect(error).toBeNull()
  })

  it('regular member cannot insert a billing email', async () => {
    const { error } = await member.client
      .from('organization_billing_emails')
      .insert({ organization_id: org.id, billing_email: 'hack@evil.com', created_at: new Date().toISOString() })
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
    org = await createTestOrg(orgOwner.accountId, uniqueSlug('sub-db'))
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

    it('trigger overwrites a client-supplied created_at with server NOW()', async () => {
      const fakeDate = '1999-01-01T00:00:00Z'
      const before = new Date()

      const { data, error } = await admin
        .from('organization_billing_emails')
        .insert({ organization_id: org.id, billing_email: 'trigger-test@acme.com', created_at: fakeDate })
        .select()
        .single()

      expect(error).toBeNull()
      const after = new Date()
      const storedAt = new Date(data!.created_at)
      expect(storedAt >= before).toBe(true)
      expect(storedAt <= after).toBe(true)
    })

    it('regular member cannot insert via RLS', async () => {
      const subDb = createSubscriptionsDb(member.client)
      const { error } = await subDb.createOrganizationBillingEmail(org.id, 'hack@evil.com')
      expect(error).not.toBeNull()
    })
  })
})
