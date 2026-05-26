import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

type ChangeRequestInsert =
  Database['public']['Tables']['subscription_change_requests']['Insert']
type SubscriptionStatus = Database['public']['Enums']['subscription_status']
type ChangeRequestStatus = Database['public']['Enums']['change_request_status']

export function createSubscriptionsDb(supabase: SupabaseClient<Database>) {
  return {
    // ── Billing emails ───────────────────────────────────────────────

    createOrganizationBillingEmail(orgId: number, billingEmail: string) {
      return supabase
        .from('organization_billing_emails')
        .insert({ organization_id: orgId, billing_email: billingEmail })
        .select()
        .single()
    },

    // ── Subscriptions ────────────────────────────────────────────────

    getById(id: number) {
      return supabase
        .from('subscriptions')
        .select('*, plan_versions(*, plans(*))')
        .eq('id', id)
        .single()
    },

    /** The active (or trialing) subscription for an organization. */
    getActiveForOrg(orgId: number) {
      return supabase
        .from('subscriptions')
        .select('*, plan_versions(*, plans(*))')
        .eq('organization_id', orgId)
        .in('status', ['active', 'trialing'] satisfies SubscriptionStatus[])
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
    },

    /** All subscriptions for an org (including cancelled/expired). */
    listForOrg(orgId: number) {
      return supabase
        .from('subscriptions')
        .select('*, plan_versions(*, plans(*))')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
    },

    getByProviderSubscriptionId(providerSubscriptionId: string) {
      return supabase
        .from('subscriptions')
        .select('*, plan_versions(*)')
        .eq('billing_provider_subscription_id', providerSubscriptionId)
        .single()
    },

    // ── Subscription addons ──────────────────────────────────────────

    listAddons(subscriptionId: number) {
      return supabase
        .from('subscription_addons')
        .select('*, addon_versions(*, addons(*))')
        .eq('subscription_id', subscriptionId)
        .order('started_at', { ascending: true })
    },

    getActiveAddons(subscriptionId: number) {
      return supabase
        .from('subscription_addons')
        .select('*, addon_versions(*, addons(*))')
        .eq('subscription_id', subscriptionId)
        .eq('status', 'active')
    },

    // ── Subscription change requests ─────────────────────────────────

    /**
     * Create a change request. All subscription mutations (upgrade,
     * downgrade, cancel, seat change, addon add/remove) must go through
     * this — never UPDATE subscriptions directly.
     */
    createChangeRequest(data: ChangeRequestInsert) {
      return supabase
        .from('subscription_change_requests')
        .insert(data)
        .select()
        .single()
    },

    getChangeRequest(id: number) {
      return supabase
        .from('subscription_change_requests')
        .select('*')
        .eq('id', id)
        .single()
    },

    getChangeRequestByIdempotencyKey(key: string) {
      return supabase
        .from('subscription_change_requests')
        .select('*')
        .eq('idempotency_key', key)
        .single()
    },

    listChangeRequests(
      subscriptionId: number,
      options?: { status?: ChangeRequestStatus },
    ) {
      let query = supabase
        .from('subscription_change_requests')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('created_at', { ascending: false })

      if (options?.status) {
        query = query.eq('status', options.status)
      }

      return query
    },

    listOrgChangeRequests(
      orgId: number,
      options?: { status?: ChangeRequestStatus },
    ) {
      let query = supabase
        .from('subscription_change_requests')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })

      if (options?.status) {
        query = query.eq('status', options.status)
      }

      return query
    },

    // ── Subscription events (audit trail) ────────────────────────────

    listEvents(orgId: number, options?: { subscriptionId?: number; limit?: number }) {
      let query = supabase
        .from('subscription_events')
        .select('*')
        .eq('organization_id', orgId)
        .order('occurred_at', { ascending: false })

      if (options?.subscriptionId) {
        query = query.eq('subscription_id', options.subscriptionId)
      }

      if (options?.limit) {
        query = query.limit(options.limit)
      }

      return query
    },

    // ── Contracts ────────────────────────────────────────────────────

    listContracts(orgId: number) {
      return supabase
        .from('subscription_contracts')
        .select('*')
        .eq('organization_id', orgId)
        .order('start_date', { ascending: false })
    },

    getContract(id: number) {
      return supabase
        .from('subscription_contracts')
        .select('*')
        .eq('id', id)
        .single()
    },
  }
}

export type SubscriptionsDb = ReturnType<typeof createSubscriptionsDb>
