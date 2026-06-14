/**
 * RLS and helper tests for the RBAC system.
 *
 * Tables under test:
 *   permissions, platform_roles, platform_role_permissions,
 *   account_platform_roles, organization_roles, organization_role_permissions
 *
 * RPCs under test:
 *   get_my_platform_permissions, get_my_org_permissions
 *
 * Notes:
 *   - All read policies on permissions/platform_roles are open to
 *     any authenticated user; unauthenticated access is not tested here.
 *   - Platform role assignment requires a platform admin; tests that mutate
 *     account_platform_roles use the admin client directly.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  admin,
  addOrgMember,
  createTestOrg,
  createTestUser,
  deleteTestUser,
  grantPlatformRole,
  uniqueSlug,
  type TestOrg,
  type TestUser,
} from './helpers'
import { createRbacDb } from './rbac'

// ── permissions RLS ───────────────────────────────────────────────────────────

describe('permissions RLS', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('rbac-perms-user')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('authenticated user can list all permissions', async () => {
    const db = createRbacDb(user.client)
    const { data, error } = await db.listPermissions()
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    const keys = data!.map(p => p.key)
    expect(keys).toContain('platform.admin')
    expect(keys).toContain('organization.manage')
  })

  it('can filter permissions by scope', async () => {
    const db = createRbacDb(user.client)
    const { data, error } = await db.listPermissions('organization')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every(p => p.scope === 'organization')).toBe(true)
  })

  it('results are ordered by scope then key', async () => {
    const db = createRbacDb(user.client)
    const { data, error } = await db.listPermissions()
    expect(error).toBeNull()
    const pairs = data!.map(p => `${p.scope}:${p.key}`)
    expect(pairs).toEqual([...pairs].sort())
  })
})

// ── platform_roles RLS ────────────────────────────────────────────────────────

describe('platform_roles RLS', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('rbac-plat-roles-user')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('authenticated user can list platform roles', async () => {
    const db = createRbacDb(user.client)
    const { data, error } = await db.listPlatformRoles()
    expect(error).toBeNull()
    const keys = data!.map(r => r.key)
    expect(keys).toContain('super_admin')
    expect(keys).toContain('support')
    expect(keys).toContain('auditor')
  })

  it('platform roles include their permissions via join', async () => {
    const db = createRbacDb(user.client)
    const { data, error } = await db.listPlatformRoles()
    expect(error).toBeNull()
    const superAdmin = data!.find(r => r.key === 'super_admin')!
    expect(superAdmin.platform_role_permissions.length).toBeGreaterThan(0)
    const permKeys = superAdmin.platform_role_permissions.map(
      (p: { permissions: { key: string } }) => p.permissions.key,
    )
    expect(permKeys).toContain('platform.admin')
  })
})

// ── account_platform_roles RLS ────────────────────────────────────────────────

describe('account_platform_roles RLS', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('rbac-apr-a')
    userB = await createTestUser('rbac-apr-b')
    await grantPlatformRole(userA.accountId, 'support')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('user can see their own platform role assignment', async () => {
    const db = createRbacDb(userA.client)
    const { data, error } = await db.getAccountPlatformRoles(userA.accountId)
    expect(error).toBeNull()
    expect(data!.length).toBe(1)
    expect((data![0] as { platform_roles: { key: string } }).platform_roles.key).toBe('support')
  })

  it('user cannot see another user\'s platform role assignments', async () => {
    const db = createRbacDb(userB.client)
    const { data, error } = await db.getAccountPlatformRoles(userA.accountId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })
})

// ── getMyPlatformPermissions RPC ──────────────────────────────────────────────

describe('getMyPlatformPermissions RPC', () => {
  let plain: TestUser
  let supporter: TestUser

  beforeAll(async () => {
    plain = await createTestUser('rbac-plat-perm-plain')
    supporter = await createTestUser('rbac-plat-perm-support')
    await grantPlatformRole(supporter.accountId, 'support')
  })

  afterAll(async () => {
    await deleteTestUser(plain.id)
    await deleteTestUser(supporter.id)
  })

  it('returns empty array for user with no platform role', async () => {
    const db = createRbacDb(plain.client)
    const { data, error } = await db.getMyPlatformPermissions()
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('returns correct permissions for support role', async () => {
    const db = createRbacDb(supporter.client)
    const { data, error } = await db.getMyPlatformPermissions()
    expect(error).toBeNull()
    expect(data).toContain('platform.support')
    expect(data).toContain('analytics.view')
    expect(data).not.toContain('platform.admin')
  })
})

// ── organization_roles RLS ────────────────────────────────────────────────────

describe('organization_roles RLS', () => {
  let orgAdmin: TestUser
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    orgAdmin = await createTestUser('rbac-org-roles-admin')
    member = await createTestUser('rbac-org-roles-member')
    outsider = await createTestUser('rbac-org-roles-outsider')
    org = await createTestOrg(orgAdmin.accountId, uniqueSlug('rbac-org-roles'))
    await addOrgMember(org.id, orgAdmin.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(orgAdmin.id)
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('org member can see system roles', async () => {
    const db = createRbacDb(member.client)
    const { data, error } = await db.listOrgRoles(org.id)
    expect(error).toBeNull()
    const keys = data!.map(r => r.key)
    expect(keys).toContain('owner')
    expect(keys).toContain('admin')
    expect(keys).toContain('member')
    expect(keys).toContain('billing')
  })

  it('org admin can create a custom role', async () => {
    const db = createRbacDb(orgAdmin.client)
    const { data, error } = await db.createOrgRole(org.id, {
      key: 'reviewer',
      name: 'Reviewer',
      description: 'Can review content',
    })
    expect(error).toBeNull()
    expect(data!.key).toBe('reviewer')
    expect(data!.organization_id).toBe(org.id)

    // custom role is visible to members
    const memberDb = createRbacDb(member.client)
    const { data: roles } = await memberDb.listOrgRoles(org.id)
    expect(roles!.map(r => r.key)).toContain('reviewer')

    // clean up
    await db.deleteOrgRole(data!.id)
  })

  it('regular member cannot create a custom role', async () => {
    const db = createRbacDb(member.client)
    const { error } = await db.createOrgRole(org.id, { key: 'sneaky', name: 'Sneaky' })
    expect(error).not.toBeNull()
  })

  it('outsider cannot see custom roles for an org they are not in', async () => {
    // Create a custom role as admin first
    const adminDb = createRbacDb(orgAdmin.client)
    const { data: role } = await adminDb.createOrgRole(org.id, {
      key: 'internal',
      name: 'Internal',
    })

    try {
      const db = createRbacDb(outsider.client)
      const { data, error } = await db.listOrgRoles(org.id)
      expect(error).toBeNull()
      // outsider can see system roles (organization_id IS NULL) but not the custom one
      expect(data!.map(r => r.key)).not.toContain('internal')
    } finally {
      await adminDb.deleteOrgRole(role!.id)
    }
  })
})

// ── organization_role_permissions RLS ─────────────────────────────────────────

describe('organization_role_permissions RLS', () => {
  let orgAdmin: TestUser
  let member: TestUser
  let org: TestOrg
  let customRoleId: number

  beforeAll(async () => {
    orgAdmin = await createTestUser('rbac-orp-admin')
    member = await createTestUser('rbac-orp-member')
    org = await createTestOrg(orgAdmin.accountId, uniqueSlug('rbac-orp'))
    await addOrgMember(org.id, orgAdmin.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')

    const adminDb = createRbacDb(orgAdmin.client)
    const { data } = await adminDb.createOrgRole(org.id, { key: 'viewer', name: 'Viewer' })
    customRoleId = data!.id
  })

  afterAll(async () => {
    await deleteTestUser(orgAdmin.id)
    await deleteTestUser(member.id)
  })

  it('org admin can assign and remove a permission from a custom role', async () => {
    const db = createRbacDb(orgAdmin.client)

    // find the analytics.view permission id
    const { data: perms } = await db.listPermissions('organization')
    const perm = perms!.find(p => p.key === 'analytics.view')!

    const { data: assigned, error: assignErr } = await db.assignOrgRolePermission(
      customRoleId,
      perm.id,
    )
    expect(assignErr).toBeNull()
    expect(assigned!.organization_role_id).toBe(customRoleId)
    expect(assigned!.permission_id).toBe(perm.id)

    const { error: removeErr } = await db.removeOrgRolePermission(customRoleId, perm.id)
    expect(removeErr).toBeNull()
  })

  it('regular member cannot assign permissions to a custom role', async () => {
    const db = createRbacDb(member.client)
    const { data: perms } = await db.listPermissions('organization')
    const perm = perms!.find(p => p.key === 'analytics.view')!
    const { error } = await db.assignOrgRolePermission(customRoleId, perm.id)
    expect(error).not.toBeNull()
  })
})

// ── getMyOrgPermissions RPC ───────────────────────────────────────────────────

describe('getMyOrgPermissions RPC', () => {
  let orgOwner: TestUser
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    orgOwner = await createTestUser('rbac-org-perms-owner')
    member = await createTestUser('rbac-org-perms-member')
    outsider = await createTestUser('rbac-org-perms-outsider')
    org = await createTestOrg(orgOwner.accountId, uniqueSlug('rbac-org-perms'))
    await addOrgMember(org.id, orgOwner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(orgOwner.id)
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('org owner gets full org permissions', async () => {
    const db = createRbacDb(orgOwner.client)
    const { data, error } = await db.getMyOrgPermissions(org.id)
    expect(error).toBeNull()
    expect(data).toContain('organization.manage')
    expect(data).toContain('users.invite')
    expect(data).toContain('billing.manage')
  })

  it('regular member gets their scoped permissions', async () => {
    const db = createRbacDb(member.client)
    const { data, error } = await db.getMyOrgPermissions(org.id)
    expect(error).toBeNull()
    expect(data).toContain('analytics.view')
    expect(data).not.toContain('organization.manage')
  })

  it('non-member gets empty permissions', async () => {
    const db = createRbacDb(outsider.client)
    const { data, error } = await db.getMyOrgPermissions(org.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

// ── assignPlatformRole / revokePlatformRole ───────────────────────────────────

describe('createRbacDb — assignPlatformRole / revokePlatformRole', () => {
  let user: TestUser
  let auditorRoleId: number

  beforeAll(async () => {
    user = await createTestUser('rbac-assign-plat')
    const { data: roles } = await createRbacDb(admin).listPlatformRoles()
    auditorRoleId = roles!.find(r => r.key === 'auditor')!.id
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('admin can assign a platform role to an account', async () => {
    const db = createRbacDb(admin)
    const { data, error } = await db.assignPlatformRole(user.accountId, auditorRoleId, user.accountId)
    expect(error).toBeNull()
    expect(data!.account_id).toBe(user.accountId)
    expect(data!.platform_role_id).toBe(auditorRoleId)
  })

  it('revokePlatformRole removes the assignment', async () => {
    const db = createRbacDb(admin)
    const { error } = await db.revokePlatformRole(user.accountId, auditorRoleId)
    expect(error).toBeNull()

    const { data } = await admin
      .from('account_platform_roles')
      .select('*')
      .eq('account_id', user.accountId)
      .eq('platform_role_id', auditorRoleId)
    expect(data).toHaveLength(0)
  })
})
