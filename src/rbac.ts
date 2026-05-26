import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './database'

export function createRbacDb(supabase: SupabaseClient<Database>) {
  const db = supabase

  return {
    // ── Permissions ────────────────────────────────────────────────

    listPermissions(scope?: 'platform' | 'organization' | 'project' | 'api') {
      const q = db.from('permissions').select('*').order('scope').order('key')
      return scope ? q.eq('scope', scope) : q
    },

    // ── Platform roles ─────────────────────────────────────────────

    listPlatformRoles() {
      return db
        .from('platform_roles')
        .select('*, platform_role_permissions(permission_id, permissions(*))')
        .order('key')
    },

    getMyPlatformPermissions() {
      return db.rpc('get_my_platform_permissions')
    },

    getAccountPlatformRoles(accountId: number) {
      return db
        .from('account_platform_roles')
        .select('*, platform_roles(*)')
        .eq('account_id', accountId)
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

    /** System roles (org_id IS NULL) + custom roles for the given org. */
    listOrgRoles(orgId: number) {
      return db
        .from('organization_roles')
        .select('*, organization_role_permissions(permission_id, permissions(*))')
        .or(`organization_id.eq.${orgId},organization_id.is.null`)
        .order('key')
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

    // ── API scopes ─────────────────────────────────────────────────

    listApiScopes() {
      return db.from('api_scopes').select('*').order('key')
    },
  }
}

export type RbacDb = ReturnType<typeof createRbacDb>
