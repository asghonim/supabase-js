import type { SupabaseClient, PostgrestSingleResponse, PostgrestResponse } from '@supabase/supabase-js'
import type { Database } from './database'

type SB<T>  = PromiseLike<PostgrestSingleResponse<T>>
type SBL<T> = PromiseLike<PostgrestResponse<T>>

type PermissionRow          = Database['public']['Tables']['permissions']['Row']
type PlatformRoleRow        = Database['public']['Tables']['platform_roles']['Row']
type AccountPlatformRoleRow = Database['public']['Tables']['account_platform_roles']['Row']
type OrgRoleRow             = Database['public']['Tables']['organization_roles']['Row']
type OrgRolePermissionRow   = Database['public']['Tables']['organization_role_permissions']['Row']

type PlatformRoleWithPermissions = PlatformRoleRow & {
  platform_role_permissions: Array<{ permission_id: number; permissions: PermissionRow | null }>
}
type AccountPlatformRoleWithRole = AccountPlatformRoleRow & { platform_roles: PlatformRoleRow | null }
type OrgRoleWithPermissions = OrgRoleRow & {
  organization_role_permissions: Array<{ permission_id: number; permissions: PermissionRow | null }>
}

export interface RbacDb {
  // ── Permissions ────────────────────────────────────────────────────────────
  listPermissions(scope?: 'platform' | 'organization'): SBL<PermissionRow>

  // ── Platform roles ─────────────────────────────────────────────────────────
  listPlatformRoles(): SBL<PlatformRoleRow & {
    platform_role_permissions: Array<{ permission_id: number; permissions: PermissionRow | null }>
  }>
  getMyPlatformPermissions(): SB<string[]>
  getAccountPlatformRoles(accountId: number): SBL<AccountPlatformRoleRow & { platform_roles: PlatformRoleRow | null }>
  assignPlatformRole(accountId: number, platformRoleId: number, grantedByAccountId: number): SB<AccountPlatformRoleRow>
  revokePlatformRole(accountId: number, platformRoleId: number): SB<null>

  // ── Organization roles ─────────────────────────────────────────────────────
  listOrgRoles(orgId: number): SBL<OrgRoleRow & {
    organization_role_permissions: Array<{ permission_id: number; permissions: PermissionRow | null }>
  }>
  createOrgRole(orgId: number, data: { key: string; name: string; description?: string }): SB<OrgRoleRow>
  deleteOrgRole(orgRoleId: number): SB<null>
  assignOrgRolePermission(orgRoleId: number, permissionId: number): SB<OrgRolePermissionRow>
  removeOrgRolePermission(orgRoleId: number, permissionId: number): SB<null>
  getMyOrgPermissions(orgId: number): SB<string[]>
}

export function createRbacDb(supabase: SupabaseClient<Database>): RbacDb {
  const db = supabase

  return {
    // ── Permissions ────────────────────────────────────────────────

    listPermissions(scope?: 'platform' | 'organization') {
      const q = db.from('permissions').select('*').order('scope').order('key')
      return scope ? q.eq('scope', scope) : q
    },

    // ── Platform roles ─────────────────────────────────────────────

    listPlatformRoles() {
      return db
        .from('platform_roles')
        .select('*, platform_role_permissions(permission_id, permissions(*))')
        .order('key') as unknown as PromiseLike<PostgrestSingleResponse<PlatformRoleWithPermissions[]>>
    },

    getMyPlatformPermissions() {
      return db.rpc('get_my_platform_permissions')
    },

    getAccountPlatformRoles(accountId: number) {
      return db
        .from('account_platform_roles')
        .select('*, platform_roles(*)')
        .eq('account_id', accountId) as unknown as PromiseLike<PostgrestSingleResponse<AccountPlatformRoleWithRole[]>>
    },

    assignPlatformRole(
      accountId: number,
      platformRoleId: number,
      grantedByAccountId: number,
    ) {
      return db
        .from('account_platform_roles')
        .insert({
          account_id: accountId,
          platform_role_id: platformRoleId,
          granted_by_account_id: grantedByAccountId,
        })
        .select()
        .single()
    },

    revokePlatformRole(accountId: number, platformRoleId: number) {
      return db
        .from('account_platform_roles')
        .delete()
        .eq('account_id', accountId)
        .eq('platform_role_id', platformRoleId)
    },

    // ── Organization roles ─────────────────────────────────────────

    listOrgRoles(orgId: number) {
      return db
        .from('organization_roles')
        .select('*, organization_role_permissions(permission_id, permissions(*))')
        .or(`organization_id.eq.${orgId},organization_id.is.null`)
        .order('key') as unknown as PromiseLike<PostgrestSingleResponse<OrgRoleWithPermissions[]>>
    },

    createOrgRole(
      orgId: number,
      data: { key: string; name: string; description?: string },
    ) {
      return db
        .from('organization_roles')
        .insert({ organization_id: orgId, ...data })
        .select()
        .single()
    },

    deleteOrgRole(orgRoleId: number) {
      return db.from('organization_roles').delete().eq('id', orgRoleId)
    },

    assignOrgRolePermission(orgRoleId: number, permissionId: number) {
      return db
        .from('organization_role_permissions')
        .insert({ organization_role_id: orgRoleId, permission_id: permissionId })
        .select()
        .single()
    },

    removeOrgRolePermission(orgRoleId: number, permissionId: number) {
      return db
        .from('organization_role_permissions')
        .delete()
        .eq('organization_role_id', orgRoleId)
        .eq('permission_id', permissionId)
    },

    getMyOrgPermissions(orgId: number) {
      return db.rpc('get_my_org_permissions', { p_org_id: orgId })
    },
  }
}
