import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

export function createEntitlementsDb(supabase: SupabaseClient<Database>) {
  return {
    /**
     * All current entitlements for an org. This is the table to check
     * at runtime — never branch on plan name or plan_version_id.
     */
    listForOrg(orgId: number) {
      return supabase
        .from('subscription_entitlements')
        .select('*, features(*)')
        .eq('organization_id', orgId)
        .order('feature_key', { ascending: true })
    },

    listForSubscription(subscriptionId: number) {
      return supabase
        .from('subscription_entitlements')
        .select('*, features(*)')
        .eq('subscription_id', subscriptionId)
        .order('feature_key', { ascending: true })
    },

    /**
     * Single feature gate check. Returns null when the org has no
     * entitlement for the given feature key.
     */
    checkFeature(orgId: number, featureKey: string) {
      return supabase
        .from('subscription_entitlements')
        .select('*')
        .eq('organization_id', orgId)
        .eq('feature_key', featureKey)
        .maybeSingle()
    },

    /**
     * Calls the `recompute_entitlements` DB function. Must be called
     * after a subscription is created or changed, an addon is added or
     * removed, or any override/promotion is applied.
     */
    recompute(subscriptionId: number) {
      return supabase.rpc('recompute_entitlements', {
        p_subscription_id: subscriptionId,
      })
    },
  }
}

export type EntitlementsDb = ReturnType<typeof createEntitlementsDb>
