import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

export function createPlansDb(supabase: SupabaseClient<Database>) {
  return {
    // ── Plans ────────────────────────────────────────────────────────

    /** All active, public plans — suitable for a pricing page. */
    listPublic() {
      return supabase
        .from('plans')
        .select('*, plan_versions(*)')
        .eq('is_active', true)
        .eq('is_public', true)
        .order('sort_order', { ascending: true })
    },

    listAll() {
      return supabase
        .from('plans')
        .select('*, plan_versions(*)')
        .order('sort_order', { ascending: true })
    },

    getById(id: number) {
      return supabase
        .from('plans')
        .select('*, plan_versions(*)')
        .eq('id', id)
        .single()
    },

    getBySlug(slug: string) {
      return supabase
        .from('plans')
        .select('*, plan_versions(*)')
        .eq('slug', slug)
        .single()
    },

    // ── Plan versions ────────────────────────────────────────────────

    getVersionById(versionId: number) {
      return supabase
        .from('plan_versions')
        .select('*, plans(*)')
        .eq('id', versionId)
        .single()
    },

    /** The currently active version for a plan (latest effective_from). */
    getActiveVersion(planId: number) {
      return supabase
        .from('plan_versions')
        .select('*')
        .eq('plan_id', planId)
        .eq('is_active', true)
        .order('effective_from', { ascending: false })
        .limit(1)
        .single()
    },

    getVersionByProviderId(providerPriceId: string) {
      return supabase
        .from('plan_versions')
        .select('*, plans(*)')
        .eq('billing_provider_price_id', providerPriceId)
        .single()
    },

    // ── Features ─────────────────────────────────────────────────────

    listFeatures() {
      return supabase
        .from('features')
        .select('*')
        .eq('is_active', true)
        .order('key', { ascending: true })
    },

    getFeatureByKey(key: string) {
      return supabase
        .from('features')
        .select('*')
        .eq('key', key)
        .single()
    },

    // ── Plan feature entitlements ─────────────────────────────────────

    /** All feature grants bundled with a specific plan version. */
    listEntitlementsForVersion(planVersionId: number) {
      return supabase
        .from('plan_feature_entitlements')
        .select('*, features(*)')
        .eq('plan_version_id', planVersionId)
    },
  }
}

export type PlansDb = ReturnType<typeof createPlansDb>
