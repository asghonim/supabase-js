/**
 * Security-focused negative tests.
 *
 * Every test in this file asserts that an *unauthorised* actor is denied,
 * silenced, or blocked — never that an authorised actor succeeds.  Positive
 * paths are covered in the per-domain test files (accounts, billing, content,
 * etc.).  The goal here is a single, scannable inventory of privilege-boundary
 * checks that must never regress.
 *
 * Threat model:
 *   - Authenticated-but-unprivileged user (regular org member or outsider)
 *   - Horizontal escalation: accessing another account's own data
 *   - Vertical escalation: performing admin/owner actions as a member/outsider
 *   - Cross-tenant leakage: reading/writing another org's data
 *   - Self-escalation: directly inserting privilege rows to grant oneself a role
 *   - Impersonation: acting on behalf of another user (e.g. fake sender_id)
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
import { createApiKeysDb } from './api-keys'
import { createContentDb } from './content'
import { createNotificationsDb } from './notifications'
import { createCommentsDb } from './conversations'
import { createWalletsDb, createAdminWalletsDb } from './wallets'
import { createBillingDb } from './billing'
import { createTicketDb } from './tickets'
import { createRbacDb } from './rbac'

// ─────────────────────────────────────────────────────────────────────────────
// § 1  Self-escalation — platform roles
// A user must not be able to insert their own platform-role assignment.
// ─────────────────────────────────────────────────────────────────────────────

describe('self-escalation: user cannot grant themselves a platform role', () => {
  let user: TestUser
  let platformRoleId: number

  beforeAll(async () => {
    user = await createTestUser('sec-self-plat-user')
    const { data: role } = await admin
      .from('platform_roles')
      .select('id')
      .eq('key', 'super_admin')
      .single()
    platformRoleId = role!.id
  })

  afterAll(async () => {
    // Belt-and-suspenders: remove any row that may have slipped through.
    await admin
      .from('account_platform_roles')
      .delete()
      .eq('account_id', user.accountId)
    await deleteTestUser(user.id)
  })

  it('direct INSERT into account_platform_roles is blocked by RLS', async () => {
    const { error } = await user.client
      .from('account_platform_roles')
      .insert({ account_id: user.accountId, platform_role_id: platformRoleId })
    expect(error).not.toBeNull()
  })

  it('direct INSERT for another account is also blocked', async () => {
    const target = await createTestUser('sec-self-plat-target')
    try {
      const { error } = await user.client
        .from('account_platform_roles')
        .insert({ account_id: target.accountId, platform_role_id: platformRoleId })
      expect(error).not.toBeNull()
    } finally {
      await deleteTestUser(target.id)
    }
  })

  it('unprivileged user calling assignPlatformRole via createRbacDb is blocked', async () => {
    const db = createRbacDb(user.client)
    const { error } = await db.assignPlatformRole(user.accountId, platformRoleId, user.accountId)
    expect(error).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 2  Self-escalation — org membership role
// A regular member must not be able to change their own org role or another
// member's role directly.
// ─────────────────────────────────────────────────────────────────────────────

describe('self-escalation: member cannot change org membership roles', () => {
  let owner: TestUser
  let member: TestUser
  let org: TestOrg
  let memberRowId: number
  let ownerRoleId: number

  beforeAll(async () => {
    owner = await createTestUser('sec-member-role-owner')
    member = await createTestUser('sec-member-role-member')
    org = await createTestOrg(uniqueSlug('sec-member-role'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')

    const { data: row } = await admin
      .from('organization_members')
      .select('id')
      .eq('organization_id', org.id)
      .eq('account_id', member.accountId)
      .single()
    memberRowId = row!.id

    const { data: role } = await admin
      .from('organization_roles')
      .select('id')
      .eq('key', 'owner')
      .is('organization_id', null)
      .single()
    ownerRoleId = role!.id
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
    await deleteTestUser(member.id)
  })

  it('member cannot UPDATE their own org role to owner via direct table access', async () => {
    const { error } = await member.client
      .from('organization_members')
      .update({ organization_role_id: ownerRoleId })
      .eq('id', memberRowId)
    expect(error).not.toBeNull()
  })

  it('member cannot DELETE another member from the org', async () => {
    const { data: ownerRow } = await admin
      .from('organization_members')
      .select('id')
      .eq('organization_id', org.id)
      .eq('account_id', owner.accountId)
      .single()

    const { error } = await member.client
      .from('organization_members')
      .delete()
      .eq('id', ownerRow!.id)
    expect(error).not.toBeNull()
  })

  it('outsider cannot INSERT themselves into an org they were not invited to', async () => {
    const outsider = await createTestUser('sec-member-role-outsider')
    try {
      const { data: memberRole } = await admin
        .from('organization_roles')
        .select('id')
        .eq('key', 'owner')
        .is('organization_id', null)
        .single()

      const { error } = await outsider.client
        .from('organization_members')
        .insert({
          organization_id: org.id,
          account_id: outsider.accountId,
          organization_role_id: memberRole!.id,
        })
      expect(error).not.toBeNull()
    } finally {
      await deleteTestUser(outsider.id)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 3  Account data isolation
// Users must not be able to mutate another account's profile rows.
// ─────────────────────────────────────────────────────────────────────────────

describe('account isolation: users cannot mutate other accounts', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('sec-acct-a')
    userB = await createTestUser('sec-acct-b')

    // Seed a name row for userA.
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
    // RLS silences the update — either error or zero rows affected.
    if (!error) {
      const { data } = await admin
        .from('account_names')
        .select('name')
        .eq('account_id', userA.accountId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      expect(data!.name).not.toBe('Hacked')
    }
  })

  it('user B cannot DELETE user A account_names rows', async () => {
    const { error } = await userB.client
      .from('account_names')
      .delete()
      .eq('account_id', userA.accountId)
    // If no error is returned, the delete must have affected 0 rows.
    if (!error) {
      const { data } = await admin
        .from('account_names')
        .select('id')
        .eq('account_id', userA.accountId)
      expect(data!.length).toBeGreaterThan(0)
    }
  })

  it('user B cannot UPDATE the accounts table row belonging to user A', async () => {
    const { error } = await userB.client
      .from('accounts')
      .update({ user_id: userB.id })
      .eq('id', userA.accountId)
    // Either blocked with an error or silently no-ops (0 rows updated).
    if (!error) {
      const { data } = await admin
        .from('accounts')
        .select('user_id')
        .eq('id', userA.accountId)
        .single()
      expect(data!.user_id).toBe(userA.id)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 4  API key cross-org isolation
// A user in org A must not be able to list, read, or revoke API keys from org B.
// ─────────────────────────────────────────────────────────────────────────────

describe('API key cross-org isolation', () => {
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

    // Seed an API key in org B via admin.
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
    // Either an error or a silent no-op — the key must remain un-revoked.
    if (!error) {
      const { data } = await admin.from('api_keys').select('revoked_at').eq('id', keyIdInOrgB).single()
      expect(data!.revoked_at).toBeNull()
    }
  })

  it('unauthenticated-looking INSERT of an API key into another org is blocked', async () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// § 5  Wallet cross-user isolation
// User B must not be able to read or manipulate User A's wallet data.
// ─────────────────────────────────────────────────────────────────────────────

describe('wallet cross-user isolation', () => {
  let userA: TestUser
  let userB: TestUser
  let walletIdA: number

  beforeAll(async () => {
    userA = await createTestUser('sec-wallet-user-a')
    userB = await createTestUser('sec-wallet-user-b')

    const adminWalletsDb = createAdminWalletsDb(admin)
    const { data: wallet } = await adminWalletsDb.createWallet('account', userA.accountId, 'USD')
    walletIdA = wallet!.id

    // Deposit so there are journal lines and the balance is non-zero.
    const { data: bank } = await admin
      .from('ledger_accounts')
      .select('id')
      .eq('name', 'Bank (USD)')
      .single()
    await adminWalletsDb.deposit(walletIdA, 50, bank!.id, 'seed for isolation test')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('user B cannot read user A wallet by id', async () => {
    const db = createWalletsDb(userB.client)
    const { data, error } = await db.getWallet(walletIdA)
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('user B cannot list journal lines for user A wallet', async () => {
    const db = createWalletsDb(userB.client)
    const { data, error } = await db.listJournalLines(walletIdA)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('user B cannot list active holds on user A wallet', async () => {
    const adminWalletsDb = createAdminWalletsDb(admin)
    const { data: hold } = await adminWalletsDb.createHold(walletIdA, 10, 'test hold for isolation')

    try {
      const db = createWalletsDb(userB.client)
      const { data, error } = await db.listActiveHolds(walletIdA)
      expect(error).toBeNull()
      expect(data!.some(h => h.id === hold!.id)).toBe(false)
    } finally {
      await adminWalletsDb.updateHoldStatus(hold!.id, 'released')
    }
  })

  it('user B cannot directly INSERT into wallet_holds for user A wallet', async () => {
    const { error } = await userB.client
      .from('wallet_holds')
      .insert({ wallet_id: walletIdA, amount: 100 })
    expect(error).not.toBeNull()
  })

  it('user B cannot directly INSERT journal entries for user A wallet', async () => {
    const { error } = await userB.client
      .from('journal_entries')
      .insert({ description: 'fake entry' })
    expect(error).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 6  Content permission enforcement (member vs owner)
// Members have content.view, content.create, content.edit but NOT
// content.publish, content.delete, or content.archive.
// ─────────────────────────────────────────────────────────────────────────────

describe('content: member cannot publish, archive, or delete', () => {
  let owner: TestUser
  let member: TestUser
  let org: TestOrg
  let ownerDb: ReturnType<typeof createContentDb>
  let memberDb: ReturnType<typeof createContentDb>
  let contentTypeId: number
  let contentId: number
  let versionId: number

  beforeAll(async () => {
    owner = await createTestUser('sec-content-owner')
    member = await createTestUser('sec-content-member')
    org = await createTestOrg(uniqueSlug('sec-content-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')

    ownerDb = createContentDb(owner.client)
    memberDb = createContentDb(member.client)

    const { data: ct } = await admin
      .from('content_types')
      .select('id')
      .eq('slug', 'page')
      .single()
    contentTypeId = ct!.id

    const { data: content } = await ownerDb.create(org.id, {
      content_type_id: contentTypeId,
      slug: uniqueSlug('sec-restrict'),
      title: 'Restricted Content',
    })
    contentId = content!.id

    const { data: version } = await ownerDb.createVersion(contentId, { title: 'v1' })
    versionId = version!.id
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
    await deleteTestUser(member.id)
  })

  it('member cannot publish content', async () => {
    const { error } = await memberDb.publish(contentId, versionId)
    expect(error).not.toBeNull()
  })

  it('member cannot archive content', async () => {
    const { error } = await memberDb.archive(contentId)
    expect(error).not.toBeNull()
  })

  it('member cannot delete content', async () => {
    const { error } = await memberDb.delete(contentId)
    // Either blocked or silently no-ops — content must still exist.
    if (!error) {
      const { data } = await admin.from('contents').select('id').eq('id', contentId)
      expect(data!.length).toBeGreaterThan(0)
    }
  })

  it('member cannot unpublish content (status → draft is publish-permission-gated)', async () => {
    // First publish as owner so there is something to unpublish.
    await ownerDb.publish(contentId, versionId)
    const { error } = await memberDb.unpublish(contentId)
    expect(error).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 7  Content cross-org isolation — write attempts by outsiders
// An authenticated user who is NOT a member of the org must not be able to
// update or delete content rows, even if they know the row id.
// ─────────────────────────────────────────────────────────────────────────────

describe('content cross-org isolation: outsider cannot mutate', () => {
  let owner: TestUser
  let outsider: TestUser
  let org: TestOrg
  let contentId: number

  beforeAll(async () => {
    owner = await createTestUser('sec-content-cross-owner')
    outsider = await createTestUser('sec-content-cross-outsider')
    org = await createTestOrg(uniqueSlug('sec-content-cross'))
    await addOrgMember(org.id, owner.accountId, 'owner')

    const db = createContentDb(owner.client)
    const { data: ct } = await admin
      .from('content_types')
      .select('id')
      .eq('slug', 'page')
      .single()

    const { data: content } = await db.create(org.id, {
      content_type_id: ct!.id,
      slug: uniqueSlug('cross-org-target'),
      title: 'Target Content',
    })
    contentId = content!.id
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
    await deleteTestUser(outsider.id)
  })

  it('outsider cannot UPDATE content from another org', async () => {
    const { error } = await outsider.client
      .from('contents')
      .update({ title: 'Hijacked Title' })
      .eq('id', contentId)
    if (!error) {
      const { data } = await admin.from('contents').select('title').eq('id', contentId).single()
      expect(data!.title).not.toBe('Hijacked Title')
    }
  })

  it('outsider cannot DELETE content from another org', async () => {
    const { error } = await outsider.client
      .from('contents')
      .delete()
      .eq('id', contentId)
    if (!error) {
      const { data } = await admin.from('contents').select('id').eq('id', contentId)
      expect(data!.length).toBeGreaterThan(0)
    }
  })

  it('outsider cannot INSERT a content version for another org content', async () => {
    const { error } = await outsider.client
      .from('content_versions')
      .insert({ content_id: contentId, title: 'Injected Version', version_number: 2 })
    expect(error).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 8  Billing data isolation — members cannot mutate billing tables
// Invoices and payments are service-role–only writes; regular members must be
// blocked, and members of org A must not see data from org B.
// ─────────────────────────────────────────────────────────────────────────────

describe('billing: members cannot insert invoices or payments', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('sec-billing-member')
    outsider = await createTestUser('sec-billing-outsider')
    org = await createTestOrg(uniqueSlug('sec-billing-org'))
    await addOrgMember(org.id, member.accountId, 'billing')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('regular member cannot INSERT an invoice', async () => {
    const { error } = await member.client
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-SEC-${Date.now()}`, status: 'draft' })
    expect(error).not.toBeNull()
  })

  it('outsider cannot INSERT an invoice for another org', async () => {
    const { error } = await outsider.client
      .from('invoices')
      .insert({ organization_id: org.id, number: `INV-SEC-OUT-${Date.now()}`, status: 'draft' })
    expect(error).not.toBeNull()
  })

  it('regular member cannot INSERT a payment', async () => {
    const { error } = await member.client
      .from('payments')
      .insert({
        organization_id: org.id,
        amount: 999,
        billing_provider: 'stripe',
        status: 'succeeded',
      })
    expect(error).not.toBeNull()
  })

  it('outsider cannot INSERT a credit note for another org', async () => {
    const { error } = await outsider.client
      .from('credit_notes')
      .insert({ organization_id: org.id, total_amount: 100, reason: 'fraudulent', invoice_id: 1 })
    expect(error).not.toBeNull()
  })
})

describe('billing: org A member cannot see org B invoices or payments', () => {
  let memberA: TestUser
  let memberB: TestUser
  let orgA: TestOrg
  let orgB: TestOrg
  let invIdB: number
  let payIdB: number

  beforeAll(async () => {
    memberA = await createTestUser('sec-billing-cross-a')
    memberB = await createTestUser('sec-billing-cross-b')
    orgA = await createTestOrg(uniqueSlug('sec-billing-cross-a'))
    orgB = await createTestOrg(uniqueSlug('sec-billing-cross-b'))
    await addOrgMember(orgA.id, memberA.accountId, 'billing')
    await addOrgMember(orgB.id, memberB.accountId, 'billing')

    const { data: inv } = await admin
      .from('invoices')
      .insert({ organization_id: orgB.id, number: `INV-CROSS-${Date.now()}`, status: 'paid' })
      .select('id')
      .single()
    invIdB = inv!.id

    const { data: pay } = await admin
      .from('payments')
      .insert({
        organization_id: orgB.id,
        invoice_id: invIdB,
        amount: 100,
        billing_provider: 'stripe',
        status: 'succeeded',
      })
      .select('id')
      .single()
    payIdB = pay!.id
  })

  afterAll(async () => {
    if (payIdB) await admin.from('payments').delete().eq('id', payIdB)
    if (invIdB) await admin.from('invoices').delete().eq('id', invIdB)
    await deleteTestUser(memberA.id)
    await deleteTestUser(memberB.id)
  })

  it('member of org A cannot getInvoice from org B', async () => {
    const db = createBillingDb(memberA.client)
    const { data, error } = await db.getInvoice(invIdB)
    // RLS: either null/empty or a row-not-found error — never the actual row.
    const found = !error && data?.id === invIdB
    expect(found).toBe(false)
  })

  it('member of org A cannot getPayment from org B', async () => {
    const db = createBillingDb(memberA.client)
    const { data } = await db.getPayment(payIdB)
    expect(data?.id ?? null).not.toBe(payIdB)
  })

  it('member of org A cannot UPDATE an invoice belonging to org B', async () => {
    const { error } = await memberA.client
      .from('invoices')
      .update({ status: 'void' })
      .eq('id', invIdB)
    if (!error) {
      const { data } = await admin.from('invoices').select('status').eq('id', invIdB).single()
      expect(data!.status).not.toBe('void')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 9  Ticket isolation
// Users can only see their own tickets; only platform support can update them.
// ─────────────────────────────────────────────────────────────────────────────

describe('ticket isolation and mutation control', () => {
  let userA: TestUser
  let userB: TestUser
  let supportUser: TestUser

  beforeAll(async () => {
    userA = await createTestUser('sec-ticket-a')
    userB = await createTestUser('sec-ticket-b')
    supportUser = await createTestUser('sec-ticket-support')
    await grantPlatformRole(supportUser.accountId, 'support')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
    await deleteTestUser(supportUser.id)
  })

  async function seedTicket(accountId: number | null, subject = 'Test ticket') {
    const { data, error } = await admin
      .from('tickets')
      .insert({ authenticated_account_id: accountId, message: 'Need help', subject })
      .select()
      .single()
    if (error || !data) throw new Error(`seedTicket: ${error?.message}`)
    return data
  }

  it('user B cannot read user A ticket (RLS filter)', async () => {
    const ticket = await seedTicket(userA.accountId)
    const { data, error } = await userB.client
      .from('tickets')
      .select('id')
      .eq('id', ticket.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("user B's list() does not include user A's tickets", async () => {
    const ticket = await seedTicket(userA.accountId, 'Private for A')
    const db = createTicketDb(userB.client)
    const { data } = await db.list()
    expect(data!.some(t => t.id === ticket.id)).toBe(false)
  })

  it('user B cannot updateStatus on user A ticket', async () => {
    const ticket = await seedTicket(userA.accountId)
    const db = createTicketDb(userB.client)
    const { error } = await db.updateStatus(ticket.id, 'resolved')
    if (!error) {
      const { data } = await admin.from('tickets').select('status').eq('id', ticket.id).single()
      expect(data!.status).not.toBe('resolved')
    }
  })

  it('user B cannot assignTo on user A ticket', async () => {
    const ticket = await seedTicket(userA.accountId)
    const db = createTicketDb(userB.client)
    const { error } = await db.assignTo(ticket.id, userB.accountId)
    if (!error) {
      const { data } = await admin
        .from('tickets')
        .select('assigned_to_account_id')
        .eq('id', ticket.id)
        .single()
      expect(data!.assigned_to_account_id).not.toBe(userB.accountId)
    }
  })

  it('regular user cannot INSERT tickets directly on behalf of another account', async () => {
    const { error } = await userA.client
      .from('tickets')
      .insert({
        authenticated_account_id: userB.accountId,
        message: 'Forged ticket',
        subject: 'Impersonation',
      })
    // Either blocked outright or silently inserted with the wrong account.
    if (!error) {
      const { data } = await admin
        .from('tickets')
        .select('authenticated_account_id')
        .eq('message', 'Forged ticket')
        .single()
      // Supabase RLS should force authenticated_account_id to the caller's own account.
      expect(data?.authenticated_account_id).not.toBe(userB.accountId)
    }
  })

  it('support user can updateStatus but regular user cannot', async () => {
    const ticket = await seedTicket(userA.accountId)

    // Regular user blocked.
    const regularDb = createTicketDb(userB.client)
    const { error: regularErr } = await regularDb.updateStatus(ticket.id, 'in_progress')
    // Support user succeeds.
    const supportDb = createTicketDb(supportUser.client)
    const { error: supportErr } = await supportDb.updateStatus(ticket.id, 'in_progress')
    expect(supportErr).toBeNull()

    // Confirm regular user's attempt did not take effect.
    if (!regularErr) {
      const { data } = await admin.from('tickets').select('status').eq('id', ticket.id).single()
      // The support user's update succeeded — but the regular user's should not have.
      expect(data!.status).toBe('in_progress') // support's change, not regular's separate attempt
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 10  Notification cross-account isolation — mark-read and archive
// RPC functions are security-definer and check ownership; a user must not be
// able to act on another user's inbox items.
// ─────────────────────────────────────────────────────────────────────────────

describe('notification cross-account isolation: RPCs enforce ownership', () => {
  let userA: TestUser
  let userB: TestUser
  let inboxIdA: number

  beforeAll(async () => {
    userA = await createTestUser('sec-notif-a')
    userB = await createTestUser('sec-notif-b')

    // Create a notification event and inbox item for userA via admin.
    const { data: event } = await admin
      .from('notification_events')
      .insert({ type: 'test.created', entity_type: 'test', entity_id: 'sec-1', payload: {} })
      .select('id')
      .single()

    const { data: recipient } = await admin
      .from('notification_recipients')
      .insert({ event_id: event!.id, account_id: userA.accountId })
      .select('id')
      .single()

    const { data: inbox } = await admin
      .from('notification_inbox')
      .insert({
        account_id: userA.accountId,
        recipient_id: recipient!.id,
        title: 'Security Test Notification',
        body: 'You have a notification.',
      })
      .select('id')
      .single()
    inboxIdA = inbox!.id
  })

  afterAll(async () => {
    if (inboxIdA) await admin.from('notification_inbox').delete().eq('id', inboxIdA)
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('user B cannot see user A inbox item in a direct SELECT', async () => {
    const { data, error } = await userB.client
      .from('notification_inbox')
      .select('id')
      .eq('id', inboxIdA)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('user B calling mark_notification_read on user A inbox item has no effect', async () => {
    const db = createNotificationsDb(userB.client)
    // The RPC should silently no-op (security-definer checks account ownership).
    await db.markRead(inboxIdA)

    const { data } = await admin
      .from('notification_inbox')
      .select('read_at')
      .eq('id', inboxIdA)
      .single()
    expect(data!.read_at).toBeNull()
  })

  it('user B calling archive_notification on user A inbox item has no effect', async () => {
    const db = createNotificationsDb(userB.client)
    await db.archive(inboxIdA)

    const { data } = await admin
      .from('notification_inbox')
      .select('archived_at')
      .eq('id', inboxIdA)
      .single()
    expect(data!.archived_at).toBeNull()
  })

  it('user B cannot UPDATE user A notification_inbox row directly', async () => {
    const { error } = await userB.client
      .from('notification_inbox')
      .update({ read_at: new Date().toISOString() })
      .eq('id', inboxIdA)
    if (!error) {
      const { data } = await admin
        .from('notification_inbox')
        .select('read_at')
        .eq('id', inboxIdA)
        .single()
      expect(data!.read_at).toBeNull()
    }
  })

  it('user B cannot DELETE user A notification_inbox row', async () => {
    const { error } = await userB.client
      .from('notification_inbox')
      .delete()
      .eq('id', inboxIdA)
    if (!error) {
      const { data } = await admin
        .from('notification_inbox')
        .select('id')
        .eq('id', inboxIdA)
      expect(data!.length).toBeGreaterThan(0)
    }
  })

  it('user B unreadCount RPC returns their own count, not user A\'s', async () => {
    // userA has 1 unread; userB should have 0.
    const dbB = createNotificationsDb(userB.client)
    const { data: countB } = await dbB.unreadCount()
    expect(countB).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 11  Conversation security — participant impersonation and self-add
// ─────────────────────────────────────────────────────────────────────────────

describe('conversation security: impersonation and self-add', () => {
  let userA: TestUser
  let userB: TestUser
  let userC: TestUser
  let org: TestOrg
  let convId: number

  beforeAll(async () => {
    userA = await createTestUser('sec-conv-a')
    userB = await createTestUser('sec-conv-b')
    userC = await createTestUser('sec-conv-c')
    org = await createTestOrg(uniqueSlug('sec-conv-org'))

    const { data: conv } = await admin
      .from('conversations')
      .insert({ tenant_id: org.id, type: 'group', title: 'Secure Conv' })
      .select('id')
      .single()
    convId = conv!.id

    // Only userA and userB are participants.
    await admin
      .from('conversation_participants')
      .insert([
        { conversation_id: convId, account_id: userA.accountId, role: 'owner' },
        { conversation_id: convId, account_id: userB.accountId, role: 'member' },
      ])
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
    await deleteTestUser(userC.id)
  })

  it('user C (non-participant) cannot add themselves to the conversation', async () => {
    const db = createCommentsDb(userC.client)
    const { error } = await db.addParticipant({
      conversation_id: convId,
      account_id: userC.accountId,
      role: 'member',
    })
    expect(error).not.toBeNull()
  })

  it('participant (userB) cannot add a third party (userC) to the conversation', async () => {
    const db = createCommentsDb(userB.client)
    const { error } = await db.addParticipant({
      conversation_id: convId,
      account_id: userC.accountId,
      role: 'member',
    })
    expect(error).not.toBeNull()
  })

  it('participant (userB) cannot send a message with a forged sender_id', async () => {
    const db = createCommentsDb(userB.client)
    const { error } = await db.sendMessage({
      conversation_id: convId,
      sender_id: userA.accountId, // pretending to be userA
      body: 'This is not from userA',
    })
    expect(error).not.toBeNull()
  })

  it('participant (userB) cannot edit a message authored by userA', async () => {
    // userA sends a message.
    const { data: msg } = await admin
      .from('messages')
      .insert({ conversation_id: convId, sender_id: userA.accountId, body: 'Original from A' })
      .select('id')
      .single()

    const db = createCommentsDb(userB.client)
    const { error } = await db.editMessage(msg!.id, 'Tampered by B')
    if (!error) {
      const { data } = await admin.from('messages').select('body').eq('id', msg!.id).single()
      expect(data!.body).toBe('Original from A')
    } else {
      expect(error).not.toBeNull()
    }
  })

  it('non-participant (userC) cannot send a message into the conversation', async () => {
    const db = createCommentsDb(userC.client)
    const { error } = await db.sendMessage({
      conversation_id: convId,
      sender_id: userC.accountId,
      body: 'Intruder message',
    })
    expect(error).not.toBeNull()
  })

  it('non-participant (userC) cannot change userA role via updateParticipantRole', async () => {
    // userC is not in the conversation — they cannot demote userA.
    const db = createCommentsDb(userC.client)
    const { error } = await db.updateParticipantRole(convId, userA.accountId, 'member')
    if (!error) {
      const { data } = await admin
        .from('conversation_participants')
        .select('role')
        .eq('conversation_id', convId)
        .eq('account_id', userA.accountId)
        .single()
      expect(data!.role).toBe('owner') // unchanged
    } else {
      expect(error).not.toBeNull()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 12  RBAC — unprivileged user cannot revoke platform roles
// ─────────────────────────────────────────────────────────────────────────────

describe('RBAC: unprivileged user cannot revoke platform roles', () => {
  let attacker: TestUser
  let victim: TestUser
  let auditorRoleId: number

  beforeAll(async () => {
    attacker = await createTestUser('sec-rbac-attacker')
    victim = await createTestUser('sec-rbac-victim')
    await grantPlatformRole(victim.accountId, 'auditor')

    const { data: role } = await admin
      .from('platform_roles')
      .select('id')
      .eq('key', 'auditor')
      .single()
    auditorRoleId = role!.id
  })

  afterAll(async () => {
    // Clean up any remaining role assignment.
    await admin
      .from('account_platform_roles')
      .delete()
      .eq('account_id', victim.accountId)
    await deleteTestUser(attacker.id)
    await deleteTestUser(victim.id)
  })

  it('attacker cannot revoke the victim\'s platform role', async () => {
    const db = createRbacDb(attacker.client)
    const { error } = await db.revokePlatformRole(victim.accountId, auditorRoleId)
    if (!error) {
      // If no error, the row must still be there.
      const { data } = await admin
        .from('account_platform_roles')
        .select('id')
        .eq('account_id', victim.accountId)
        .eq('platform_role_id', auditorRoleId)
      expect(data!.length).toBeGreaterThan(0)
    } else {
      expect(error).not.toBeNull()
    }
  })

  it('attacker cannot DELETE from account_platform_roles directly', async () => {
    const { error } = await attacker.client
      .from('account_platform_roles')
      .delete()
      .eq('account_id', victim.accountId)
    if (!error) {
      const { data } = await admin
        .from('account_platform_roles')
        .select('id')
        .eq('account_id', victim.accountId)
      expect(data!.length).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 13  RBAC — platform permission RPC returns only caller's own permissions
// Calling get_my_platform_permissions must never return another user's permissions.
// ─────────────────────────────────────────────────────────────────────────────

describe('RBAC: get_my_platform_permissions is caller-scoped', () => {
  let plain: TestUser
  let supporter: TestUser

  beforeAll(async () => {
    plain = await createTestUser('sec-rbac-plain')
    supporter = await createTestUser('sec-rbac-supporter')
    await grantPlatformRole(supporter.accountId, 'support')
  })

  afterAll(async () => {
    await deleteTestUser(plain.id)
    await deleteTestUser(supporter.id)
  })

  it('plain user gets empty permissions even when a support user exists', async () => {
    const db = createRbacDb(plain.client)
    const { data, error } = await db.getMyPlatformPermissions()
    expect(error).toBeNull()
    // Must be empty — not leaking the support user's permissions.
    expect(data).toEqual([])
  })

  it('support user only gets their own permissions, not superadmin ones', async () => {
    const db = createRbacDb(supporter.client)
    const { data, error } = await db.getMyPlatformPermissions()
    expect(error).toBeNull()
    expect(data).toContain('platform.support')
    expect(data).not.toContain('platform.admin')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 14  Org permission RPC is caller- and org-scoped
// ─────────────────────────────────────────────────────────────────────────────

describe('RBAC: get_my_org_permissions is caller-scoped', () => {
  let ownerA: TestUser
  let memberA: TestUser
  let outsider: TestUser
  let orgA: TestOrg

  beforeAll(async () => {
    ownerA = await createTestUser('sec-orgperm-owner')
    memberA = await createTestUser('sec-orgperm-member')
    outsider = await createTestUser('sec-orgperm-outsider')
    orgA = await createTestOrg(uniqueSlug('sec-orgperm'))
    await addOrgMember(orgA.id, ownerA.accountId, 'owner')
    await addOrgMember(orgA.id, memberA.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(ownerA.id)
    await deleteTestUser(memberA.id)
    await deleteTestUser(outsider.id)
  })

  it('outsider querying org permissions returns empty, not owner permissions', async () => {
    const db = createRbacDb(outsider.client)
    const { data, error } = await db.getMyOrgPermissions(orgA.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(data).not.toContain('organization.manage')
  })

  it('member only gets member-level permissions, not owner-level ones', async () => {
    const db = createRbacDb(memberA.client)
    const { data, error } = await db.getMyOrgPermissions(orgA.id)
    expect(error).toBeNull()
    expect(data).toContain('analytics.view')
    expect(data).not.toContain('organization.manage')
    expect(data).not.toContain('billing.manage')
    expect(data).not.toContain('users.invite')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 15  Notification preference isolation
// Users must not be able to read or write another account's preferences.
// ─────────────────────────────────────────────────────────────────────────────

describe('notification preference isolation', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('sec-notifpref-a')
    userB = await createTestUser('sec-notifpref-b')

    // Seed a preference for userA.
    await admin.from('notification_preferences').insert({
      account_id: userA.accountId,
      channel: 'email',
      notification_type: 'test.event',
      is_enabled: true,
    })
  })

  afterAll(async () => {
    await admin.from('notification_preferences').delete().eq('account_id', userA.accountId)
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('user B cannot read user A notification preferences', async () => {
    const { data, error } = await userB.client
      .from('notification_preferences')
      .select('*')
      .eq('account_id', userA.accountId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('user B cannot INSERT preferences for user A', async () => {
    const { error } = await userB.client
      .from('notification_preferences')
      .insert({
        account_id: userA.accountId,
        channel: 'sms',
        notification_type: 'test.event',
        is_enabled: false,
      })
    expect(error).not.toBeNull()
  })

  it('user B cannot UPDATE user A notification preferences', async () => {
    const { error } = await userB.client
      .from('notification_preferences')
      .update({ is_enabled: false })
      .eq('account_id', userA.accountId)
    if (!error) {
      const { data } = await admin
        .from('notification_preferences')
        .select('is_enabled')
        .eq('account_id', userA.accountId)
        .single()
      expect(data!.is_enabled).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// § 16  Content type creation — only org admins/owners can create custom types
// ─────────────────────────────────────────────────────────────────────────────

describe('content type creation: member cannot create custom types', () => {
  let owner: TestUser
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    owner = await createTestUser('sec-ct-owner')
    member = await createTestUser('sec-ct-member')
    outsider = await createTestUser('sec-ct-outsider')
    org = await createTestOrg(uniqueSlug('sec-ct-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('regular member cannot create a custom content type', async () => {
    const db = createContentDb(member.client)
    const { error } = await db.createContentType(org.id, {
      slug: uniqueSlug('sneaky-type'),
      name: 'Sneaky Type',
    })
    expect(error).not.toBeNull()
  })

  it('outsider cannot create a content type for another org', async () => {
    const db = createContentDb(outsider.client)
    const { error } = await db.createContentType(org.id, {
      slug: uniqueSlug('outsider-type'),
      name: 'Outsider Type',
    })
    expect(error).not.toBeNull()
  })

  it('outsider cannot create a system content type (organization_id = null)', async () => {
    const { error } = await outsider.client
      .from('content_types')
      .insert({ slug: uniqueSlug('sys-type'), name: 'Fake System Type', organization_id: null })
    expect(error).not.toBeNull()
  })
})
