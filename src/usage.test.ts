/**
 * RLS tests for the usage tracking system.
 *
 * Tables under test:
 *   usage_records, usage_summaries
 *
 * Notes:
 *   - Usage data is org-scoped; members can only read their own org's records.
 *   - Summaries are maintained by a DB trigger after each `usage_records` insert.
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
import { createUsageDb } from './usage'

// ── usage_records RLS ─────────────────────────────────────────────────────────

describe('usage_records — listRecords RLS', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('usage-list-member')
    outsider = await createTestUser('usage-list-outsider')
    org = await createTestOrg(member.accountId, uniqueSlug('usage-list'))
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('org member can list usage records for their org (empty is fine)', async () => {
    const db = createUsageDb(member.client)
    const { data, error } = await db.listRecords(org.id)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('non-member cannot see usage records from another org', async () => {
    const db = createUsageDb(outsider.client)
    const { data, error } = await db.listRecords(org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('listRecords orders by recorded_at descending', async () => {
    const db = createUsageDb(member.client)
    const { data, error } = await db.listRecords(org.id)
    expect(error).toBeNull()
    const timestamps = data!.map(r => r.recorded_at)
    expect(timestamps).toEqual([...timestamps].sort((a, b) => (b ?? '').localeCompare(a ?? '')))
  })
})

// ── usage_records filtering ────────────────────────────────────────────────────

describe('usage_records — listRecords filtering', () => {
  let member: TestUser
  let org: TestOrg
  let featureKey: string
  let recordId: number | null = null

  beforeAll(async () => {
    member = await createTestUser('usage-filter-member')
    org = await createTestOrg(member.accountId, uniqueSlug('usage-filter'))
    await addOrgMember(org.id, member.accountId, 'member')
    featureKey = `test.feature.${Date.now()}`

    // insert a record directly via admin to enable filter tests
    const { data: rec } = await admin
      .from('usage_records')
      .insert({
        organization_id: org.id,
        feature_key: featureKey,
        quantity: 5,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
      })
      .select('id')
      .single()

    recordId = rec?.id ?? null
  })

  afterAll(async () => {
    if (recordId) await admin.from('usage_records').delete().eq('id', recordId)
    await deleteTestUser(member.id)
  })

  it('can filter by feature_key', async () => {
    if (!recordId) return

    const db = createUsageDb(member.client)
    const { data, error } = await db.listRecords(org.id, { featureKey })
    expect(error).toBeNull()
    expect(data!.every(r => r.feature_key === featureKey)).toBe(true)
    expect(data!.some(r => r.id === recordId)).toBe(true)
  })

  it('can filter by periodStart', async () => {
    if (!recordId) return

    const db = createUsageDb(member.client)
    const { data, error } = await db.listRecords(org.id, { periodStart: '2026-01-01' })
    expect(error).toBeNull()
    expect(data!.every(r => (r.period_start ?? '') >= '2026-01-01')).toBe(true)
  })

  it('can filter by periodEnd', async () => {
    if (!recordId) return

    const db = createUsageDb(member.client)
    const { data, error } = await db.listRecords(org.id, { periodEnd: '2026-01-31' })
    expect(error).toBeNull()
    expect(data!.every(r => (r.period_end ?? '').slice(0, 10) <= '2026-01-31')).toBe(true)
  })

  it('can limit the number of results', async () => {
    if (!recordId) return

    const db = createUsageDb(member.client)
    const { data, error } = await db.listRecords(org.id, { limit: 1 })
    expect(error).toBeNull()
    expect(data!.length).toBeLessThanOrEqual(1)
  })

  it('each record includes feature details', async () => {
    if (!recordId) return

    const db = createUsageDb(member.client)
    const { data, error } = await db.listRecords(org.id, { featureKey })
    expect(error).toBeNull()
    for (const rec of data!) {
      expect(rec).toHaveProperty('features')
    }
  })
})

// ── usage_records — record (insert) ───────────────────────────────────────────

describe('usage_records — record', () => {
  let member: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('usage-record-member')
    org = await createTestOrg(member.accountId, uniqueSlug('usage-record'))
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
  })

  it('org member can record a usage event for their org', async () => {
    const db = createUsageDb(member.client)
    const featureKey = `test.record.${Date.now()}`
    const { data, error } = await db.record({
      organization_id: org.id,
      feature_key: featureKey,
      quantity: 1,
      period_start: '2026-01-01',
      period_end: '2026-01-31',
    })
    expect(error).toBeNull()
    expect(data!.organization_id).toBe(org.id)
    expect(data!.feature_key).toBe(featureKey)

    await admin.from('usage_records').delete().eq('id', data!.id)
  })

  it('record with idempotency_key prevents double-counting on retry', async () => {
    const db = createUsageDb(member.client)
    const featureKey = `test.idempotent.${Date.now()}`
    const idempotencyKey = `idem-${Date.now()}`

    const { data: first } = await db.record({
      organization_id: org.id,
      feature_key: featureKey,
      quantity: 3,
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      idempotency_key: idempotencyKey,
    })

    // second insert with same idempotency key should conflict and not double-insert
    const { error: secondError } = await db.record({
      organization_id: org.id,
      feature_key: featureKey,
      quantity: 3,
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      idempotency_key: idempotencyKey,
    })

    // DB should reject or return the existing row; either outcome is acceptable
    if (!secondError) {
      const { data: recs } = await admin
        .from('usage_records')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
      expect(recs!.length).toBe(1)
    }

    if (first) await admin.from('usage_records').delete().eq('id', first.id)
  })
})

// ── usage_summaries RLS ───────────────────────────────────────────────────────

describe('usage_summaries — listSummaries RLS', () => {
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    member = await createTestUser('usage-summary-member')
    outsider = await createTestUser('usage-summary-outsider')
    org = await createTestOrg(member.accountId, uniqueSlug('usage-summary'))
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('org member can list usage summaries for their org', async () => {
    const db = createUsageDb(member.client)
    const { data, error } = await db.listSummaries(org.id)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('non-member cannot see usage summaries from another org', async () => {
    const db = createUsageDb(outsider.client)
    const { data, error } = await db.listSummaries(org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('getSummary returns null when no summary exists for the given period', async () => {
    const db = createUsageDb(member.client)
    const { data, error } = await db.getSummary(
      org.id,
      -1,
      'nonexistent.feature',
      '2000-01-01',
      '2000-01-31',
    )
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})
