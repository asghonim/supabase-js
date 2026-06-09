/**
 * Tests for the wallet ledger system.
 *
 * Tables under test:
 *   ledger_accounts, wallets, journal_entries, journal_lines, wallet_holds
 *
 * Notes:
 *   - Money movement (deposit, spend, transfer) is done via service_role RPCs.
 *   - Authenticated users can only read their own wallet data (RLS enforced).
 *   - All amounts are NUMERIC(20,4); the JS client returns them as strings.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  admin,
  createTestUser,
  createTestOrg,
  deleteTestUser,
  uniqueSlug,
  type TestUser,
  type TestOrg,
} from './helpers'
import { createWalletsDb, createAdminWalletsDb } from './wallets'

// ── helpers ───────────────────────────────────────────────────────────────────

async function getSystemAccount(name: string) {
  const { data, error } = await admin
    .from('ledger_accounts')
    .select('id')
    .eq('name', name)
    .eq('currency', 'USD')
    .single()
  if (error || !data) throw new Error(`system account "${name}" not found: ${error?.message}`)
  return data.id
}

// ── wallets RLS ───────────────────────────────────────────────────────────────

describe('wallets RLS', () => {
  let owner: TestUser
  let outsider: TestUser
  let adminDb: ReturnType<typeof createAdminWalletsDb>

  beforeAll(async () => {
    owner    = await createTestUser('wallet-rls-owner')
    outsider = await createTestUser('wallet-rls-outsider')
    adminDb  = createAdminWalletsDb(admin)
    await adminDb.createWallet('account', owner.accountId, 'USD')
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
    await deleteTestUser(outsider.id)
  })

  it('owner can retrieve their own wallet', async () => {
    const db = createWalletsDb(owner.client)
    const { data, error } = await db.getWalletByOwner('account', owner.accountId)
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.owner_id).toBe(owner.accountId)
  })

  it('outsider cannot see another user\'s wallet', async () => {
    const db = createWalletsDb(outsider.client)
    const { data, error } = await db.getWalletByOwner('account', owner.accountId)
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('org members can view their org wallet', async () => {
    const org = await createTestOrg(owner.accountId, uniqueSlug('wallet-org'))
    await adminDb.createWallet('organization', org.id, 'USD')

    const db = createWalletsDb(owner.client)
    const { data, error } = await db.getWalletByOwner('organization', org.id)
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.owner_id).toBe(org.id)
  })

  it('non-member cannot view an org wallet', async () => {
    const org = await createTestOrg(owner.accountId, uniqueSlug('wallet-nonmember-org'))
    await adminDb.createWallet('organization', org.id, 'USD')

    const db = createWalletsDb(outsider.client)
    const { data, error } = await db.getWalletByOwner('organization', org.id)
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})

// ── ledger accounts ───────────────────────────────────────────────────────────

describe('ledger_accounts RLS', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('wallet-ledger-acct')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('authenticated users can read active non-wallet system accounts', async () => {
    const db = createWalletsDb(user.client)
    const { data, error } = await db.listSystemLedgerAccounts('USD')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every(a => a.account_type !== 'wallet')).toBe(true)
  })

  it('authenticated users cannot read wallet-type ledger accounts', async () => {
    const db = createWalletsDb(user.client)
    const { data, error } = await db.listSystemLedgerAccounts('USD')
    expect(error).toBeNull()
    const walletAccounts = data!.filter(a => a.account_type === 'wallet')
    expect(walletAccounts).toHaveLength(0)
  })
})

// ── deposit ───────────────────────────────────────────────────────────────────

describe('deposit', () => {
  let user: TestUser
  let adminDb: ReturnType<typeof createAdminWalletsDb>
  let walletId: number
  let bankAccountId: number

  beforeAll(async () => {
    user        = await createTestUser('wallet-deposit')
    adminDb     = createAdminWalletsDb(admin)
    bankAccountId = await getSystemAccount('Bank (USD)')

    const { data: wallet } = await adminDb.createWallet('account', user.accountId)
    if (!wallet) throw new Error('failed to create test wallet')
    walletId = wallet.id
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('deposit increases wallet balance', async () => {
    const { data: before } = await adminDb.getWallet(walletId)
    const balanceBefore = Number(before!.current_balance)

    const { data: entryId, error } = await adminDb.deposit(
      walletId, 100, bankAccountId, 'Test deposit',
      { idempotencyKey: `deposit-test-${Date.now()}` },
    )
    expect(error).toBeNull()
    expect(typeof entryId).toBe('number')

    const { data: after } = await adminDb.getWallet(walletId)
    expect(Number(after!.current_balance)).toBe(balanceBefore + 100)
  })

  it('deposit is idempotent on idempotency_key', async () => {
    const key = `idem-deposit-${Date.now()}`

    const { data: entry1 } = await adminDb.deposit(walletId, 50, bankAccountId, 'Idem test', { idempotencyKey: key })
    const { data: entry2 } = await adminDb.deposit(walletId, 50, bankAccountId, 'Idem test', { idempotencyKey: key })

    expect(entry1).toBe(entry2)
  })

  it('owner can see journal lines after deposit', async () => {
    const db = createWalletsDb(user.client)
    const { data, error } = await db.listJournalLines(walletId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    expect(data!.length).toBeGreaterThan(0)
  })
})

// ── spend ─────────────────────────────────────────────────────────────────────

describe('spend', () => {
  let user: TestUser
  let adminDb: ReturnType<typeof createAdminWalletsDb>
  let walletId: number
  let bankAccountId: number
  let revenueAccountId: number

  beforeAll(async () => {
    user              = await createTestUser('wallet-spend')
    adminDb           = createAdminWalletsDb(admin)
    bankAccountId     = await getSystemAccount('Bank (USD)')
    revenueAccountId  = await getSystemAccount('Revenue (USD)')

    const { data: wallet } = await adminDb.createWallet('account', user.accountId)
    if (!wallet) throw new Error('failed to create test wallet')
    walletId = wallet.id

    await adminDb.deposit(walletId, 200, bankAccountId, 'Fund for spend tests')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('spend decreases wallet balance', async () => {
    const { data: before } = await adminDb.getWallet(walletId)
    const balanceBefore = Number(before!.current_balance)

    const { data: entryId, error } = await adminDb.spend(
      walletId, 30, revenueAccountId, 'Test purchase',
      { idempotencyKey: `spend-test-${Date.now()}` },
    )
    expect(error).toBeNull()
    expect(typeof entryId).toBe('number')

    const { data: after } = await adminDb.getWallet(walletId)
    expect(Number(after!.current_balance)).toBe(balanceBefore - 30)
  })

  it('spend is rejected when balance is insufficient', async () => {
    const { error } = await adminDb.spend(
      walletId, 999999, revenueAccountId, 'Should fail',
    )
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/insufficient balance/i)
  })

  it('spend is idempotent on idempotency_key', async () => {
    const key = `idem-spend-${Date.now()}`

    const { data: entry1 } = await adminDb.spend(walletId, 5, revenueAccountId, 'Idem spend', { idempotencyKey: key })
    const { data: entry2 } = await adminDb.spend(walletId, 5, revenueAccountId, 'Idem spend', { idempotencyKey: key })

    expect(entry1).toBe(entry2)
  })
})

// ── transfer ──────────────────────────────────────────────────────────────────

describe('transfer', () => {
  let userA: TestUser
  let userB: TestUser
  let adminDb: ReturnType<typeof createAdminWalletsDb>
  let walletA: number
  let walletB: number
  let bankAccountId: number

  beforeAll(async () => {
    userA         = await createTestUser('wallet-transfer-a')
    userB         = await createTestUser('wallet-transfer-b')
    adminDb       = createAdminWalletsDb(admin)
    bankAccountId = await getSystemAccount('Bank (USD)')

    const { data: wa } = await adminDb.createWallet('account', userA.accountId)
    const { data: wb } = await adminDb.createWallet('account', userB.accountId)
    if (!wa || !wb) throw new Error('failed to create test wallets')
    walletA = wa.id
    walletB = wb.id

    await adminDb.deposit(walletA, 100, bankAccountId, 'Fund A for transfer test')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('transfer moves balance from A to B', async () => {
    const { data: aBefore } = await adminDb.getWallet(walletA)
    const { data: bBefore } = await adminDb.getWallet(walletB)

    const { error } = await adminDb.transfer(walletA, walletB, 40, 'Test transfer')
    expect(error).toBeNull()

    const { data: aAfter } = await adminDb.getWallet(walletA)
    const { data: bAfter } = await adminDb.getWallet(walletB)

    expect(Number(aAfter!.current_balance)).toBe(Number(aBefore!.current_balance) - 40)
    expect(Number(bAfter!.current_balance)).toBe(Number(bBefore!.current_balance) + 40)
  })

  it('transfer fails when source has insufficient balance', async () => {
    const { error } = await adminDb.transfer(walletA, walletB, 999999, 'Should fail')
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/insufficient balance/i)
  })
})

// ── available balance & holds ─────────────────────────────────────────────────

describe('holds and available balance', () => {
  let user: TestUser
  let adminDb: ReturnType<typeof createAdminWalletsDb>
  let walletId: number
  let bankAccountId: number
  let revenueAccountId: number

  beforeAll(async () => {
    user             = await createTestUser('wallet-holds')
    adminDb          = createAdminWalletsDb(admin)
    bankAccountId    = await getSystemAccount('Bank (USD)')
    revenueAccountId = await getSystemAccount('Revenue (USD)')

    const { data: wallet } = await adminDb.createWallet('account', user.accountId)
    if (!wallet) throw new Error('failed to create test wallet')
    walletId = wallet.id

    await adminDb.deposit(walletId, 100, bankAccountId, 'Fund for hold tests')
  })

  afterAll(async () => {
    await deleteTestUser(user.id)
  })

  it('createHold reduces available balance', async () => {
    const { data: hold, error } = await adminDb.createHold(walletId, 40, 'Test hold')
    expect(error).toBeNull()
    expect(hold!.status).toBe('active')

    const { data: available } = await adminDb.availableBalance(walletId)
    expect(Number(available)).toBeLessThanOrEqual(60)

    await adminDb.updateHoldStatus(hold!.id, 'released')
  })

  it('spend is blocked when available balance is insufficient (hold in place)', async () => {
    const { data: hold } = await adminDb.createHold(walletId, 90, 'Large hold')
    expect(hold).not.toBeNull()

    const { error } = await adminDb.spend(walletId, 50, revenueAccountId, 'Should be blocked by hold')
    expect(error).not.toBeNull()

    await adminDb.updateHoldStatus(hold!.id, 'released')
  })

  it('owner can list their active holds', async () => {
    const { data: hold } = await adminDb.createHold(walletId, 10, 'Visible hold')
    expect(hold).not.toBeNull()

    const db = createWalletsDb(user.client)
    const { data, error } = await db.listActiveHolds(walletId)
    expect(error).toBeNull()
    expect(data!.some(h => h.id === hold!.id)).toBe(true)

    await adminDb.updateHoldStatus(hold!.id, 'released')
  })

  it('released hold does not appear in active holds', async () => {
    const { data: hold } = await adminDb.createHold(walletId, 5, 'Will be released')
    await adminDb.updateHoldStatus(hold!.id, 'released')

    const db = createWalletsDb(user.client)
    const { data } = await db.listActiveHolds(walletId)
    expect(data!.some(h => h.id === hold!.id)).toBe(false)
  })
})

// ── admin wallet management ───────────────────────────────────────────────────

describe('admin wallet management', () => {
  it('createWallet creates ledger account + wallet in one call', async () => {
    const user   = await createTestUser('wallet-admin-create')
    const adminDb = createAdminWalletsDb(admin)

    try {
      const { data, error } = await adminDb.createWallet('account', user.accountId, 'USD', 'Test Wallet')
      expect(error).toBeNull()
      expect(data).not.toBeNull()
      expect(data!.owner_type).toBe('account')
      expect(data!.owner_id).toBe(user.accountId)
      expect(data!.currency).toBe('USD')
      expect(Number(data!.current_balance)).toBe(0)

      const { data: ledger } = await adminDb.getLedgerAccount(data!.ledger_account_id)
      expect(ledger!.account_type).toBe('wallet')
      expect(ledger!.name).toBe('Test Wallet')
    } finally {
      await deleteTestUser(user.id)
    }
  })

  it('createWallet is unique per (owner_type, owner_id, currency)', async () => {
    const user    = await createTestUser('wallet-unique')
    const adminDb = createAdminWalletsDb(admin)

    try {
      await adminDb.createWallet('account', user.accountId, 'USD')
      const { data, error } = await adminDb.createWallet('account', user.accountId, 'USD')
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    } finally {
      await deleteTestUser(user.id)
    }
  })

  it('getLedgerAccountByName finds a seeded system account', async () => {
    const adminDb = createAdminWalletsDb(admin)
    const { data, error } = await adminDb.getLedgerAccountByName('Bank (USD)')
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.account_type).toBe('bank')
  })
})
