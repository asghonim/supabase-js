import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

// The ACL tables (principals, principal_memberships, acl_entries, resources)
// are not yet in the generated database types, so we cast through any.
type AnyClient = SupabaseClient<Database>

export interface AclGrantParams {
  principalId: number
  action: string
  resourceType: string
  resourceId?: number | null
  effect?: 'ALLOW' | 'DENY'
  priority?: number
  conditionJson?: Record<string, unknown> | null
  validFrom?: string | null
  validUntil?: string | null
  organizationId?: number | null
}

/**
 * Returns the 'user' principal id for the given account.
 * Every account gets a user principal automatically via the on_account_inserted trigger.
 */
export async function getUserPrincipalId(supabase: AnyClient, accountId: number): Promise<number> {
  const { data, error } = await (supabase as SupabaseClient)
    .from('principals')
    .select('id')
    .eq('account_id', accountId)
    .eq('principal_type', 'user')
    .single()
  if (error || !data) throw new Error(`getUserPrincipalId(${accountId}): ${error?.message}`)
  return data.id
}

/**
 * Creates a group principal and returns its id.
 * Call with the admin client to bypass RLS.
 */
export async function createGroupPrincipal(
  supabase: AnyClient,
  name: string,
  organizationId?: number | null,
): Promise<number> {
  const { data, error } = await (supabase as SupabaseClient)
    .from('principals')
    .insert({ principal_type: 'group', name, organization_id: organizationId ?? null })
    .select('id')
    .single()
  if (error || !data) throw new Error(`createGroupPrincipal(${name}): ${error?.message}`)
  return data.id
}

/**
 * Makes memberPrincipalId a member of parentPrincipalId (group membership / role assignment).
 */
export async function addPrincipalMembership(
  supabase: AnyClient,
  memberPrincipalId: number,
  parentPrincipalId: number,
): Promise<void> {
  const { error } = await (supabase as SupabaseClient)
    .from('principal_memberships')
    .insert({ member_principal_id: memberPrincipalId, parent_principal_id: parentPrincipalId })
  if (error) throw new Error(`addPrincipalMembership: ${error.message}`)
}

/**
 * Inserts an ACL entry and returns its id.
 * Call with the admin client so that RLS is bypassed.
 */
export async function grantAcl(supabase: AnyClient, params: AclGrantParams): Promise<number> {
  const { data, error } = await (supabase as SupabaseClient)
    .from('acl_entries')
    .insert({
      principal_id:    params.principalId,
      action:          params.action,
      resource_type:   params.resourceType,
      resource_id:     params.resourceId ?? null,
      effect:          params.effect ?? 'ALLOW',
      priority:        params.priority ?? 0,
      condition_json:  params.conditionJson ?? null,
      valid_from:      params.validFrom ?? null,
      valid_until:     params.validUntil ?? null,
      organization_id: params.organizationId ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`grantAcl: ${error?.message}`)
  return data.id
}

/**
 * Removes an ACL entry by id.
 */
export async function revokeAcl(supabase: AnyClient, entryId: number): Promise<void> {
  const { error } = await (supabase as SupabaseClient).from('acl_entries').delete().eq('id', entryId)
  if (error) throw new Error(`revokeAcl(${entryId}): ${error.message}`)
}

/**
 * Calls public.has_permission() as the signed-in user represented by supabase.
 * Returns true if the user's principal (or any group they belong to) has an active
 * ALLOW entry that is not overridden by a DENY.
 */
export async function checkPermission(
  supabase: AnyClient,
  action: string,
  resourceType: string,
  resourceId?: number | null,
  organizationId?: number | null,
): Promise<boolean> {
  const { data, error } = await (supabase as SupabaseClient).rpc('has_permission', {
    p_action:          action,
    p_resource_type:   resourceType,
    p_resource_id:     resourceId ?? null,
    p_organization_id: organizationId ?? null,
  })
  if (error) throw new Error(`checkPermission: ${error.message}`)
  return data as boolean
}
