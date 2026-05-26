/**
 * RLS and helper tests for the organization system.
 *
 * Tables under test:
 *   organizations, organization_members, organization_names,
 *   organization_billing_emails
 *
 * Policies under test:
 *   - Members can SELECT their own organization and its roster
 *   - Non-members are filtered out silently (empty result, no error)
 *   - Org admins can INSERT names and billing emails; regular members cannot
 *   - Org admins can manage membership; regular members cannot
 *   - Timestamps are set correctly by triggers
 *   - slug uniqueness is enforced
 *
 * Notes:
 *   - organizations has no user INSERT/UPDATE/DELETE policy; mutations go
 *     through the admin/service-role client.
 *   - organization_names and organization_billing_emails have no SELECT
 *     policy; createOrganizationName / createOrganizationBillingEmail must
 *     be called from the admin client in production (RETURNING would be empty
 *     for a user-scoped session). The RLS restriction on INSERT is tested
 *     directly without relying on RETURNING.
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
import { createOrganizationsDb } from './organizations'

// ── organizations RLS ─────────────────────────────────────────────────────────

describe('organizations RLS', () => {
  let owner: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    owner = await createTestUser('org-rls-owner')
    outsider = await createTestUser('org-rls-outsider')
    org = await createTestOrg(owner.accountId, uniqueSlug('org-rls'))
    await addOrgMember(org.id, owner.accountId, 'owner')
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
    await deleteTestUser(outsider.id)
  })

  it('member can view their organization', async () => {
    const { data, error } = await owner.client
      .from('organizations')
      .select('id, slug')
      .eq('id', org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(org.id)
  })

  it('non-member cannot view the organization (empty result, no error)', async () => {
    const { data, error } = await outsider.client
      .from('organizations')
      .select('id')
      .eq('id', org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('created_at and updated_at are set by triggers', async () => {
    const { data, error } = await admin
      .from('organizations')
      .select('created_at, updated_at')
      .eq('id', org.id)
      .single()
    expect(error).toBeNull()
    expect(new Date(data!.created_at).getTime()).toBeGreaterThan(0)
    expect(new Date(data!.updated_at).getTime()).toBeGreaterThan(0)
  })

  it('slug must be unique', async () => {
    const { error } = await admin
      .from('organizations')
      .insert({ owner_account_id: owner.accountId, slug: org.slug })
    expect(error).not.toBeNull()
  })
})

// ── organization_members RLS ──────────────────────────────────────────────────

describe('organization_members RLS', () => {
  let orgOwner: TestUser
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    orgOwner = await createTestUser('org-members-owner')
    member = await createTestUser('org-members-member')
    outsider = await createTestUser('org-members-outsider')
    org = await createTestOrg(orgOwner.accountId, uniqueSlug('org-members'))
    await addOrgMember(org.id, orgOwner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(orgOwner.id)
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('member can view the full org roster', async () => {
    const { data, error } = await member.client
      .from('organization_members')
      .select('account_id')
      .eq('organization_id', org.id)
    expect(error).toBeNull()
    const accountIds = data!.map(r => r.account_id)
    expect(accountIds).toContain(orgOwner.accountId)
    expect(accountIds).toContain(member.accountId)
  })

  it('non-member cannot view the roster (empty result, no error)', async () => {
    const { data, error } = await outsider.client
      .from('organization_members')
      .select('id')
      .eq('organization_id', org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('regular member cannot add another member', async () => {
    const { error } = await member.client
      .from('organization_members')
      .insert({ organization_id: org.id, account_id: outsider.accountId })
    expect(error).not.toBeNull()
  })

  it('org admin can add a member', async () => {
    const newUser = await createTestUser('org-members-new')
    try {
      const db = createOrganizationsDb(orgOwner.client)
      const { data, error } = await db.addMember(org.id, newUser.accountId)
      expect(error).toBeNull()
      expect(data!.account_id).toBe(newUser.accountId)
    } finally {
      await deleteTestUser(newUser.id)
    }
  })

  it('joined_at and created_at are set by trigger on insert', async () => {
    const { data, error } = await admin
      .from('organization_members')
      .select('created_at, joined_at')
      .eq('organization_id', org.id)
      .eq('account_id', orgOwner.accountId)
      .single()
    expect(error).toBeNull()
    expect(new Date(data!.created_at).getTime()).toBeGreaterThan(0)
    expect(new Date(data!.joined_at).getTime()).toBeGreaterThan(0)
  })
})

// ── organization_names RLS ────────────────────────────────────────────────────

describe('organization_names RLS', () => {
  let orgAdmin: TestUser
  let member: TestUser
  let org: TestOrg

  beforeAll(async () => {
    orgAdmin = await createTestUser('org-names-admin')
    member = await createTestUser('org-names-member')
    org = await createTestOrg(orgAdmin.accountId, uniqueSlug('org-names'))
    await addOrgMember(org.id, orgAdmin.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(orgAdmin.id)
    await deleteTestUser(member.id)
  })

  it('org admin can insert an organization name', async () => {
    const { error } = await orgAdmin.client
      .from('organization_names')
      .insert({ organization_id: org.id, name: 'Acme Corp', created_at: new Date().toISOString() })
    expect(error).toBeNull()
  })

  it('regular member cannot insert an organization name', async () => {
    const { error } = await member.client
      .from('organization_names')
      .insert({ organization_id: org.id, name: 'Unauthorized Name', created_at: new Date().toISOString() })
    expect(error).not.toBeNull()
  })

  it('created_at is set by trigger', async () => {
    const { data, error } = await admin
      .from('organization_names')
      .select('created_at')
      .eq('organization_id', org.id)
      .limit(1)
      .single()
    expect(error).toBeNull()
    expect(new Date(data!.created_at).getTime()).toBeGreaterThan(0)
  })
})

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

// ── createOrganizationsDb ─────────────────────────────────────────────────────

describe('createOrganizationsDb', () => {
  let orgOwner: TestUser
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg
  const adminDb = createOrganizationsDb(admin)

  beforeAll(async () => {
    orgOwner = await createTestUser('org-db-owner')
    member = await createTestUser('org-db-member')
    outsider = await createTestUser('org-db-outsider')
    org = await createTestOrg(orgOwner.accountId, uniqueSlug('org-db'))
    await addOrgMember(org.id, orgOwner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(orgOwner.id)
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  describe('getById', () => {
    it('returns the org for a member', async () => {
      const db = createOrganizationsDb(member.client)
      const { data, error } = await db.getById(org.id)
      expect(error).toBeNull()
      expect(data!.id).toBe(org.id)
    })

    it('returns null for a non-member (RLS)', async () => {
      const db = createOrganizationsDb(outsider.client)
      const { data, error } = await db.getById(org.id)
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    })
  })

  describe('getBySlug', () => {
    it('returns the org for a member', async () => {
      const db = createOrganizationsDb(member.client)
      const { data, error } = await db.getBySlug(org.slug)
      expect(error).toBeNull()
      expect(data!.slug).toBe(org.slug)
    })

    it('returns null for a non-member (RLS)', async () => {
      const db = createOrganizationsDb(outsider.client)
      const { data, error } = await db.getBySlug(org.slug)
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    })
  })

  describe('listByAccountId', () => {
    it("returns orgs the given account belongs to", async () => {
      const db = createOrganizationsDb(member.client)
      const { data, error } = await db.listByAccountId(member.accountId)
      expect(error).toBeNull()
      expect(data!.map(o => o.id)).toContain(org.id)
    })

    it("does not return orgs the account is not a member of", async () => {
      const db = createOrganizationsDb(outsider.client)
      const { data, error } = await db.listByAccountId(outsider.accountId)
      expect(error).toBeNull()
      expect(data!.map(o => o.id)).not.toContain(org.id)
    })

    it("only shows orgs visible to the calling user even if querying another accountId", async () => {
      // memberA queries memberB's orgs — only shared orgs should appear
      const db = createOrganizationsDb(member.client)
      const { data, error } = await db.listByAccountId(outsider.accountId)
      expect(error).toBeNull()
      expect(data!.map(o => o.id)).not.toContain(org.id)
    })
  })

  describe('listMembers', () => {
    it('returns all members ordered by joined_at ascending', async () => {
      const db = createOrganizationsDb(member.client)
      const { data, error } = await db.listMembers(org.id)
      expect(error).toBeNull()
      const accountIds = data!.map(m => m.account_id)
      expect(accountIds).toContain(orgOwner.accountId)
      expect(accountIds).toContain(member.accountId)
      const times = data!.map(m => new Date(m.joined_at).getTime())
      expect(times).toEqual([...times].sort((a, b) => a - b))
    })

    it('returns empty for a non-member', async () => {
      const db = createOrganizationsDb(outsider.client)
      const { data, error } = await db.listMembers(org.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  describe('getMember', () => {
    it('returns the member record when the caller is also a member', async () => {
      const db = createOrganizationsDb(member.client)
      const { data, error } = await db.getMember(org.id, member.accountId)
      expect(error).toBeNull()
      expect(data!.account_id).toBe(member.accountId)
      expect(data!.organization_id).toBe(org.id)
    })
  })

  describe('addMember / updateMemberRole / removeMember', () => {
    it('org admin can add, update, and remove a member', async () => {
      const transient = await createTestUser('org-db-transient')
      try {
        const db = createOrganizationsDb(orgOwner.client)

        const { data: added, error: addErr } = await db.addMember(org.id, transient.accountId)
        expect(addErr).toBeNull()
        expect(added!.account_id).toBe(transient.accountId)

        const { data: roleRow } = await admin
          .from('organization_roles')
          .select('id')
          .eq('key', 'admin')
          .is('organization_id', null)
          .single()

        const { data: updated, error: updateErr } = await db.updateMemberRole(added!.id, roleRow!.id)
        expect(updateErr).toBeNull()
        expect(updated!.organization_role_id).toBe(roleRow!.id)

        const { error: removeErr } = await db.removeMember(added!.id)
        expect(removeErr).toBeNull()

        const { data: afterRemoval } = await admin
          .from('organization_members')
          .select('id')
          .eq('id', added!.id)
        expect(afterRemoval).toHaveLength(0)
      } finally {
        await deleteTestUser(transient.id)
      }
    })
  })

  describe('createOrganizationName', () => {
    it('inserts and returns the name record (admin client)', async () => {
      const { data, error } = await adminDb.createOrganizationName(org.id, 'Acme Inc.')
      expect(error).toBeNull()
      expect(data!.name).toBe('Acme Inc.')
      expect(data!.organization_id).toBe(org.id)
    })

    it('regular member cannot insert via RLS', async () => {
      const db = createOrganizationsDb(member.client)
      const { error } = await db.createOrganizationName(org.id, 'Sneaky Name')
      expect(error).not.toBeNull()
    })
  })

  describe('createOrganizationBillingEmail', () => {
    it('inserts and returns the billing email record (admin client)', async () => {
      const { data, error } = await adminDb.createOrganizationBillingEmail(org.id, 'finance@acme.com')
      expect(error).toBeNull()
      expect(data!.billing_email).toBe('finance@acme.com')
      expect(data!.organization_id).toBe(org.id)
    })

    it('regular member cannot insert via RLS', async () => {
      const db = createOrganizationsDb(member.client)
      const { error } = await db.createOrganizationBillingEmail(org.id, 'hack@evil.com')
      expect(error).not.toBeNull()
    })
  })
})
