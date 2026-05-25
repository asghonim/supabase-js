import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { getSupabaseAdminClient } from './admin'
import type { Database } from './database'

export const admin = getSupabaseAdminClient()

export type TestUser = {
  id: string
  email: string
  accountId: number
  client: ReturnType<typeof createClient<Database>>
}

export type TestOrg = {
  id: number
  slug: string
}

function makePublicClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Creates a real auth user, waits for the trigger to create their account row,
 * then signs them in so the returned client has a user-scoped JWT for RLS tests.
 */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `test-${label}-${Date.now()}@example.com`
  const password = 'TestPass123!'

  const { data: { user }, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !user) throw new Error(`createUser(${label}): ${error?.message}`)

  const { data: account, error: accErr } = await admin
    .from('accounts')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (accErr || !account) throw new Error(`getAccount(${label}): ${accErr?.message}`)

  const client = makePublicClient()
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`signIn(${label}): ${signInErr.message}`)

  return { id: user.id, email, accountId: account.id, client }
}

export async function deleteTestUser(userId: string) {
  await admin.auth.admin.deleteUser(userId)
}

/**
 * Creates an organization row (bypasses RLS via admin).
 */
export async function createTestOrg(ownerAccountId: number, slug: string): Promise<TestOrg> {
  const { data: org, error } = await admin
    .from('organizations')
    .insert({ owner_account_id: ownerAccountId, slug })
    .select('id, slug')
    .single()
  if (error || !org) throw new Error(`createOrg(${slug}): ${error?.message}`)
  return org
}

/**
 * Adds an account to an organization with the given system role.
 * Uses admin client so it bypasses RLS.
 */
export async function addOrgMember(
  orgId: number,
  accountId: number,
  roleKey: 'owner' | 'admin' | 'member' | 'billing',
) {
  const { data: role, error: roleErr } = await admin
    .from('organization_roles')
    .select('id')
    .eq('key', roleKey)
    .is('organization_id', null)
    .single()
  if (roleErr || !role) throw new Error(`getRole(${roleKey}): ${roleErr?.message}`)

  const { error } = await admin.from('organization_members').insert({
    organization_id: orgId,
    account_id: accountId,
    organization_role_id: role.id,
  })
  if (error) throw new Error(`addMember(org=${orgId}, acct=${accountId}): ${error.message}`)
}

/**
 * Grants a platform role to an account using the admin client.
 */
export async function grantPlatformRole(accountId: number, roleKey: 'super_admin' | 'support' | 'auditor') {
  const { data: role, error: roleErr } = await admin
    .from('platform_roles')
    .select('id')
    .eq('key', roleKey)
    .single()
  if (roleErr || !role) throw new Error(`getPlatformRole(${roleKey}): ${roleErr?.message}`)

  const { error } = await admin.from('account_platform_roles').insert({
    account_id: accountId,
    platform_role_id: role.id,
  })
  if (error) throw new Error(`grantPlatformRole: ${error.message}`)
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Unique suffix for data created in a test file to avoid slug conflicts across parallel runs. */
export function uniqueSlug(base: string): string {
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
