import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

export function createAddonsDb(supabase: SupabaseClient<Database>) {
  return {
    // ── Addons ───────────────────────────────────────────────────────

    listActive() {
      return supabase
        .from('addons')
        .select('*, addon_versions(*)')
        .eq('is_active', true)
        .order('name', { ascending: true })
    },

    getById(id: number) {
      return supabase
        .from('addons')
        .select('*, addon_versions(*)')
        .eq('id', id)
        .single()
    },

    getByKey(key: string) {
      return supabase
        .from('addons')
        .select('*, addon_versions(*)')
        .eq('key', key)
        .single()
    },

    // ── Addon versions ───────────────────────────────────────────────

    getVersionById(versionId: number) {
      return supabase
        .from('addon_versions')
        .select('*, addons(*)')
        .eq('id', versionId)
        .single()
    },

    /** The current active version for an addon (latest effective_from). */
    getActiveVersion(addonId: number) {
      return supabase
        .from('addon_versions')
        .select('*')
        .eq('addon_id', addonId)
        .eq('is_active', true)
        .order('effective_from', { ascending: false })
        .limit(1)
        .single()
    },

    getVersionByProviderId(providerPriceId: string) {
      return supabase
        .from('addon_versions')
        .select('*, addons(*)')
        .eq('billing_provider_price_id', providerPriceId)
        .single()
    },

    // ── Addon feature entitlements ────────────────────────────────────

    listEntitlementsForVersion(addonVersionId: number) {
      return supabase
        .from('addon_feature_entitlements')
        .select('*, features(*)')
        .eq('addon_version_id', addonVersionId)
    },
  }
}

export type AddonsDb = ReturnType<typeof createAddonsDb>
