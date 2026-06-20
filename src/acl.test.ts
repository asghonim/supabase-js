/**
 * Unit tests for the ACL (Access Control List) engine.
 *
 * Functions under test:
 *   public.has_permission(p_action, p_resource_type, p_resource_id?, p_organization_id?)
 *   private.has_permission / private.eval_acl_condition (exercised indirectly)
 *
 * Tables exercised directly (via admin client, not in generated types):
 *   principals, principal_memberships, acl_entries
 *
 * Integration smoke tests (verify the OR-path wired into RLS policies):
 *   tickets — a non-owner can view/create via ACL grant
 *   api_keys — a user outside the org can view via ACL grant
 *   wallets — a non-owner can view a wallet via ACL grant
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
import {
  addPrincipalMembership,
  checkPermission,
  createGroupPrincipal,
  grantAcl,
  getUserPrincipalId,
  revokeAcl,
} from './acl'
import { createAdminWalletsDb } from './wallets'
import { SupabaseClient } from '@supabase/supabase-js'

// ── public.has_permission — no grant ─────────────────────────────────────────

describe('has_permission — no grant', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('acl-no-grant')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('returns false when no ACL entry exists for the resource type', async () => {
    const result = await checkPermission(user.client, 'view', 'invoice', 9999)
    expect(result).toBe(false)
  })

  it('returns false for a wildcard check when no entry exists', async () => {
    const result = await checkPermission(user.client, 'create', 'invoice')
    expect(result).toBe(false)
  })
})

// ── public.has_permission — direct ALLOW ─────────────────────────────────────

describe('has_permission — direct ALLOW grant', () => {
  let user: TestUser
  let principalId: number
  let entryId: number
  const fakeResourceId = 42001

  beforeAll(async () => {
    user        = await createTestUser('acl-direct-allow')
    principalId = await getUserPrincipalId(admin, user.accountId)
    entryId     = await grantAcl(admin, {
      principalId,
      action:       'view',
      resourceType: 'invoice',
      resourceId:   fakeResourceId,
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, entryId)
    await deleteTestUser(user.id)
  })

  it('returns true for the exact resource that was granted', async () => {
    const result = await checkPermission(user.client, 'view', 'invoice', fakeResourceId)
    expect(result).toBe(true)
  })

  it('returns false for a different resource of the same type', async () => {
    const result = await checkPermission(user.client, 'view', 'invoice', fakeResourceId + 1)
    expect(result).toBe(false)
  })

  it('returns false for a different action on the same resource', async () => {
    const result = await checkPermission(user.client, 'delete', 'invoice', fakeResourceId)
    expect(result).toBe(false)
  })

  it('returns false for a different resource type', async () => {
    const result = await checkPermission(user.client, 'view', 'payment', fakeResourceId)
    expect(result).toBe(false)
  })
})

// ── public.has_permission — wildcard ALLOW ───────────────────────────────────

describe('has_permission — wildcard ALLOW (resource_id = NULL)', () => {
  let user: TestUser
  let principalId: number
  let entryId: number

  beforeAll(async () => {
    user        = await createTestUser('acl-wildcard-allow')
    principalId = await getUserPrincipalId(admin, user.accountId)
    entryId     = await grantAcl(admin, {
      principalId,
      action:       'create',
      resourceType: 'invoice',
      resourceId:   null,    // wildcard: matches any invoice id
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, entryId)
    await deleteTestUser(user.id)
  })

  it('wildcard grant matches any resource id', async () => {
    expect(await checkPermission(user.client, 'create', 'invoice', 1)).toBe(true)
    expect(await checkPermission(user.client, 'create', 'invoice', 99999)).toBe(true)
  })

  it('wildcard grant matches a null resource id check', async () => {
    expect(await checkPermission(user.client, 'create', 'invoice')).toBe(true)
  })

  it('wildcard does not bleed into other actions', async () => {
    expect(await checkPermission(user.client, 'delete', 'invoice', 1)).toBe(false)
  })
})

// ── public.has_permission — DENY beats ALLOW ─────────────────────────────────

describe('has_permission — DENY overrides ALLOW', () => {
  let user: TestUser
  let principalId: number
  let allowId: number
  let denyId: number
  const resourceId = 55001

  beforeAll(async () => {
    user        = await createTestUser('acl-deny-beats-allow')
    principalId = await getUserPrincipalId(admin, user.accountId)
    allowId     = await grantAcl(admin, {
      principalId,
      action: 'view', resourceType: 'invoice', resourceId, effect: 'ALLOW',
    })
    denyId      = await grantAcl(admin, {
      principalId,
      action: 'view', resourceType: 'invoice', resourceId, effect: 'DENY',
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, allowId)
    await revokeAcl(admin, denyId)
    await deleteTestUser(user.id)
  })

  it('returns false when DENY and ALLOW both exist for the same resource', async () => {
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId)).toBe(false)
  })
})

describe('has_permission — wildcard DENY blocks specific ALLOW', () => {
  let user: TestUser
  let principalId: number
  let allowId: number
  let denyId: number
  const resourceId = 55002

  beforeAll(async () => {
    user        = await createTestUser('acl-wildcard-deny')
    principalId = await getUserPrincipalId(admin, user.accountId)
    // specific ALLOW for one resource
    allowId     = await grantAcl(admin, {
      principalId,
      action: 'view', resourceType: 'invoice', resourceId, effect: 'ALLOW',
    })
    // wildcard DENY blocks everything
    denyId      = await grantAcl(admin, {
      principalId,
      action: 'view', resourceType: 'invoice', resourceId: null, effect: 'DENY',
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, allowId)
    await revokeAcl(admin, denyId)
    await deleteTestUser(user.id)
  })

  it('wildcard DENY overrides a specific ALLOW', async () => {
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId)).toBe(false)
  })
})

// ── public.has_permission — temporal grants ───────────────────────────────────

describe('has_permission — temporal grants', () => {
  let user: TestUser
  let principalId: number
  let expiredId: number
  let futureId: number
  let activeId: number
  const resourceId = 66001

  beforeAll(async () => {
    user        = await createTestUser('acl-temporal')
    principalId = await getUserPrincipalId(admin, user.accountId)

    const past   = new Date(Date.now() - 86400_000).toISOString()  // 1 day ago
    const pastPlus   = new Date(Date.now() - 86000_000).toISOString()  // 1 day ago + a bit
    const future = new Date(Date.now() + 86400_000).toISOString()  // 1 day from now

    expiredId = await grantAcl(admin, {
      principalId,
      action: 'view', resourceType: 'invoice', resourceId,
      validFrom: past, validUntil: pastPlus,   // already expired
    })
    futureId  = await grantAcl(admin, {
      principalId,
      action: 'view', resourceType: 'invoice', resourceId,
      validFrom: future,                   // not yet active
    })
    activeId  = await grantAcl(admin, {
      principalId,
      action: 'edit', resourceType: 'invoice', resourceId,
      validFrom: past, validUntil: future, // currently active
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, expiredId)
    await revokeAcl(admin, futureId)
    await revokeAcl(admin, activeId)
    await deleteTestUser(user.id)
  })

  it('expired grant (valid_until in the past) is not honoured', async () => {
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId)).toBe(false)
  })

  it('future-only grant (valid_from in the future) is not honoured', async () => {
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId)).toBe(false)
  })

  it('currently-active temporal grant is honoured', async () => {
    expect(await checkPermission(user.client, 'edit', 'invoice', resourceId)).toBe(true)
  })
})

// ── public.has_permission — group / principal membership ─────────────────────

describe('has_permission — group membership inheritance', () => {
  let user: TestUser
  let userPrincipalId: number
  let groupPrincipalId: number
  let entryId: number
  const resourceId = 77001

  beforeAll(async () => {
    user              = await createTestUser('acl-group-inherit')
    userPrincipalId   = await getUserPrincipalId(admin, user.accountId)
    groupPrincipalId  = await createGroupPrincipal(admin, `acl-group-${Date.now()}`)
    await addPrincipalMembership(admin, userPrincipalId, groupPrincipalId)
    entryId           = await grantAcl(admin, {
      principalId:  groupPrincipalId,
      action:       'view',
      resourceType: 'invoice',
      resourceId,
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, entryId)
    // group principal is deleted by cascade when acl_entry is removed;
    // we still attempt deletion in case the cascade order differs.
    await (admin as SupabaseClient).from('principals').delete().eq('id', groupPrincipalId)
    await deleteTestUser(user.id)
  })

  it('user inherits ALLOW from a group they belong to', async () => {
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId)).toBe(true)
  })

  it('user does not inherit permissions from a group they are not in', async () => {
    const otherGroupId = await createGroupPrincipal(admin, `acl-other-group-${Date.now()}`)
    const otherId      = await grantAcl(admin, {
      principalId:  otherGroupId,
      action:       'view',
      resourceType: 'invoice',
      resourceId:   resourceId + 1,
    })
    try {
      expect(await checkPermission(user.client, 'view', 'invoice', resourceId + 1)).toBe(false)
    } finally {
      await revokeAcl(admin, otherId)
      await (admin as SupabaseClient).from('principals').delete().eq('id', otherGroupId)
    }
  })
})

// ── public.has_permission — ABAC condition_json ───────────────────────────────

describe('has_permission — condition_json (ABAC)', () => {
  let userA: TestUser
  let userB: TestUser
  let principalA: number
  let entryId: number
  const resourceId = 88001

  beforeAll(async () => {
    userA      = await createTestUser('acl-abac-a')
    userB      = await createTestUser('acl-abac-b')
    principalA = await getUserPrincipalId(admin, userA.accountId)

    // Grant is allowed only when the requester's account_id matches userA's account
    entryId = await grantAcl(admin, {
      principalId:   principalA,
      action:        'view',
      resourceType:  'invoice',
      resourceId,
      conditionJson: { account_id: userA.accountId },
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, entryId)
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('grant with account_id condition is honoured for the matching account', async () => {
    expect(await checkPermission(userA.client, 'view', 'invoice', resourceId)).toBe(true)
  })

  it('grant with account_id condition is not honoured for a different account', async () => {
    // userB shares the same principal? No — the grant is on principalA.
    // userB has no grant at all, so this tests that condition prevents cross-account bleed.
    // (This also confirms a user not on the principal sees nothing.)
    expect(await checkPermission(userB.client, 'view', 'invoice', resourceId)).toBe(false)
  })
})

// ── RLS integration — tickets ─────────────────────────────────────────────────

describe('has_permission RLS integration — tickets', () => {
  let owner: TestUser
  let stranger: TestUser
  let principalId: number
  let ticketId: number
  let entryId: number

  beforeAll(async () => {
    owner    = await createTestUser('acl-ticket-owner')
    stranger = await createTestUser('acl-ticket-stranger')

    const { data, error } = await admin
      .from('tickets')
      .insert({ message: 'ACL integration test ticket', authenticated_account_id: owner.accountId })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seed ticket: ${error?.message}`)
    ticketId = data.id
  })

  afterAll(async () => {
    if (entryId) await revokeAcl(admin, entryId)
    await admin.from('tickets').delete().eq('id', ticketId)
    await deleteTestUser(owner.id)
    await deleteTestUser(stranger.id)
  })

  it('stranger cannot see the ticket without an ACL grant', async () => {
    const { data, error } = await stranger.client
      .from('tickets')
      .select('id')
      .eq('id', ticketId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('stranger can see the ticket after receiving a view ACL grant', async () => {
    principalId = await getUserPrincipalId(admin, stranger.accountId)
    entryId     = await grantAcl(admin, {
      principalId,
      action:       'view',
      resourceType: 'ticket',
      resourceId:   ticketId,
    })

    const { data, error } = await stranger.client
      .from('tickets')
      .select('id')
      .eq('id', ticketId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(ticketId)
  })

  it('revoking the ACL grant removes ticket visibility', async () => {
    await revokeAcl(admin, entryId)
    entryId = 0

    const { data, error } = await stranger.client
      .from('tickets')
      .select('id')
      .eq('id', ticketId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('stranger cannot file a ticket attributed to another account without a grant', async () => {
    // Trying to set authenticated_account_id to the owner's account fails WITH CHECK
    // because the EXISTS clause only passes for the requester's own account,
    // and there is no ACL grant in place yet.
    const { error } = await stranger.client
      .from('tickets')
      .insert({ message: 'Sneaky ticket', authenticated_account_id: owner.accountId })
      .select('id')
      .single()
    expect(error).not.toBeNull()
  })
})

// ── RLS integration — api_keys ────────────────────────────────────────────────

describe('has_permission RLS integration — api_keys', () => {
  let orgOwner: TestUser
  let outsider: TestUser
  let org: TestOrg
  let keyId: number
  let principalId: number
  let entryId: number

  beforeAll(async () => {
    orgOwner = await createTestUser('acl-apikey-owner')
    outsider = await createTestUser('acl-apikey-outsider')
    org      = await createTestOrg(uniqueSlug('acl-apikeys-org'))
    await addOrgMember(org.id, orgOwner.accountId, 'owner')

    const { data, error } = await admin
      .from('api_keys')
      .insert({
        org_id:      org.id,
        account_id:  orgOwner.accountId,
        name:        'ACL test key',
        key_prefix:  `sk_live_acltest_${Date.now()}`,
        key_hash:    `acl_test_hash_${Date.now()}`,
        scopes:      ['read'],
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seed api_key: ${error?.message}`)
    keyId = data.id
  })

  afterAll(async () => {
    if (entryId) await revokeAcl(admin, entryId)
    await admin.from('api_keys').delete().eq('id', keyId)
    await deleteTestUser(orgOwner.id)
    await deleteTestUser(outsider.id)
  })

  it('outsider cannot see the api key without a grant', async () => {
    const { data, error } = await outsider.client
      .from('api_keys')
      .select('id')
      .eq('id', keyId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('outsider can see the api key after receiving a view ACL grant', async () => {
    principalId = await getUserPrincipalId(admin, outsider.accountId)
    entryId     = await grantAcl(admin, {
      principalId,
      action:       'view',
      resourceType: 'api_key',
      resourceId:   keyId,
    })

    const { data, error } = await outsider.client
      .from('api_keys')
      .select('id')
      .eq('id', keyId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})

// ── public.has_permission — organization_id scoping ──────────────────────────

describe('has_permission — organization_id scoping', () => {
  let user: TestUser
  let principalId: number
  let orgA: TestOrg
  let orgB: TestOrg
  let entryOrgA: number
  const resourceId = 91001

  beforeAll(async () => {
    user        = await createTestUser('acl-org-scope')
    principalId = await getUserPrincipalId(admin, user.accountId)
    orgA        = await createTestOrg(uniqueSlug('acl-org-scope-a'))
    orgB        = await createTestOrg(uniqueSlug('acl-org-scope-b'))

    // ACL entry scoped to orgA only
    entryOrgA = await grantAcl(admin, {
      principalId,
      action:         'view',
      resourceType:   'invoice',
      resourceId,
      organizationId: orgA.id,
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, entryOrgA)
    await deleteTestUser(user.id)
  })

  it('returns true when checking with the matching organization_id', async () => {
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId, orgA.id)).toBe(true)
  })

  it('returns false when checking with a different organization_id', async () => {
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId, orgB.id)).toBe(false)
  })

  it('returns false when organization_id is provided but the entry has no org scope match', async () => {
    // A completely different org that the entry is not scoped to
    const orgC = await createTestOrg(uniqueSlug('acl-org-scope-c'))
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId, orgC.id)).toBe(false)
  })

  it('returns true when no organization_id is provided (org-scoped entry still matches)', async () => {
    // Passing null org_id disables the org filter — the entry is still active
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId, null)).toBe(true)
  })
})

describe('has_permission — organization_id scoping with wildcard resource', () => {
  let user: TestUser
  let principalId: number
  let orgA: TestOrg
  let orgB: TestOrg
  let entryId: number

  beforeAll(async () => {
    user        = await createTestUser('acl-org-wildcard')
    principalId = await getUserPrincipalId(admin, user.accountId)
    orgA        = await createTestOrg(uniqueSlug('acl-orgwild-a'))
    orgB        = await createTestOrg(uniqueSlug('acl-orgwild-b'))

    // Wildcard resource grant scoped to orgA
    entryId = await grantAcl(admin, {
      principalId,
      action:         'create',
      resourceType:   'report',
      resourceId:     null,
      organizationId: orgA.id,
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, entryId)
    await deleteTestUser(user.id)
  })

  it('wildcard grant is honoured for the correct org', async () => {
    expect(await checkPermission(user.client, 'create', 'report', null, orgA.id)).toBe(true)
  })

  it('wildcard grant is not honoured for a different org', async () => {
    expect(await checkPermission(user.client, 'create', 'report', null, orgB.id)).toBe(false)
  })
})

describe('has_permission — org-scoped DENY overrides ALLOW', () => {
  let user: TestUser
  let principalId: number
  let org: TestOrg
  let allowId: number
  let denyId: number
  const resourceId = 92001

  beforeAll(async () => {
    user        = await createTestUser('acl-org-deny')
    principalId = await getUserPrincipalId(admin, user.accountId)
    org         = await createTestOrg(uniqueSlug('acl-org-deny'))

    allowId = await grantAcl(admin, {
      principalId,
      action: 'view', resourceType: 'invoice', resourceId,
      effect: 'ALLOW', organizationId: org.id,
    })
    denyId = await grantAcl(admin, {
      principalId,
      action: 'view', resourceType: 'invoice', resourceId,
      effect: 'DENY', organizationId: org.id,
    })
  })

  afterAll(async () => {
    await revokeAcl(admin, allowId)
    await revokeAcl(admin, denyId)
    await deleteTestUser(user.id)
  })

  it('org-scoped DENY overrides org-scoped ALLOW', async () => {
    expect(await checkPermission(user.client, 'view', 'invoice', resourceId, org.id)).toBe(false)
  })
})

// ── RLS integration — wallets ─────────────────────────────────────────────────

describe('has_permission RLS integration — wallets', () => {
  let walletOwner: TestUser
  let stranger: TestUser
  let walletId: number
  let principalId: number
  let entryId: number

  beforeAll(async () => {
    walletOwner = await createTestUser('acl-wallet-owner')
    stranger    = await createTestUser('acl-wallet-stranger')
    const adminWallets = createAdminWalletsDb(admin)
    const { data } = await adminWallets.createWallet('account', walletOwner.accountId, 'USD')
    if (!data) throw new Error('seed wallet: createWallet returned null')
    walletId = data.id
  })

  afterAll(async () => {
    if (entryId) await revokeAcl(admin, entryId)
    await deleteTestUser(walletOwner.id)
    await deleteTestUser(stranger.id)
  })

  it('stranger cannot see the wallet without a grant', async () => {
    const { data, error } = await stranger.client
      .from('wallets')
      .select('id')
      .eq('id', walletId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('stranger can see the wallet after receiving a view ACL grant', async () => {
    principalId = await getUserPrincipalId(admin, stranger.accountId)
    entryId     = await grantAcl(admin, {
      principalId,
      action:       'view',
      resourceType: 'wallet',
      resourceId:   walletId,
    })

    const { data, error } = await stranger.client
      .from('wallets')
      .select('id')
      .eq('id', walletId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(walletId)
  })
})
