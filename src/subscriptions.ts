import type { SupabaseClient, PostgrestSingleResponse, PostgrestResponse } from '@supabase/supabase-js'
import type { Database } from './database'

type SB<T>  = PromiseLike<PostgrestSingleResponse<T>>
type SBL<T> = PromiseLike<PostgrestResponse<T>>

type OrgBillingEmailRow          = Database['public']['Tables']['organization_billing_emails']['Row']
type SubscriptionRow             = Database['public']['Tables']['subscriptions']['Row']
type PlanVersionRow              = Database['public']['Tables']['plan_versions']['Row']
type PlanRow                     = Database['public']['Tables']['plans']['Row']
type SubscriptionAddonRow        = Database['public']['Tables']['subscription_addons']['Row']
type AddonVersionRow             = Database['public']['Tables']['addon_versions']['Row']
type AddonRow                    = Database['public']['Tables']['addons']['Row']
type SubscriptionChangeRequestRow = Database['public']['Tables']['subscription_change_requests']['Row']
type SubscriptionEventRow        = Database['public']['Tables']['subscription_events']['Row']
type SubscriptionContractRow     = Database['public']['Tables']['subscription_contracts']['Row']

type ChangeRequestInsert  = Database['public']['Tables']['subscription_change_requests']['Insert']
type SubscriptionStatus   = Database['public']['Enums']['subscription_status']
type ChangeRequestStatus  = Database['public']['Enums']['change_request_status']

type SubscriptionWithPlan = SubscriptionRow & {
  plan_versions: (PlanVersionRow & { plans: PlanRow | null }) | null
}

type AddonWithVersion = SubscriptionAddonRow & {
  addon_versions: (AddonVersionRow & { addons: AddonRow | null }) | null
}

export interface SubscriptionsDb {
  // ── Billing emails ──────────────────────────────────────────────────────────
  createOrganizationBillingEmail(orgId: number, billingEmail: string): SB<OrgBillingEmailRow>

  // ── Subscriptions ───────────────────────────────────────────────────────────
  getById(id: number): SB<SubscriptionWithPlan>
  getActiveForOrg(orgId: number): SB<SubscriptionWithPlan>
  listForOrg(orgId: number): SBL<SubscriptionWithPlan>
  getByProviderSubscriptionId(providerSubscriptionId: string): SB<SubscriptionRow & { plan_versions: PlanVersionRow | null }>

  // ── Subscription addons ─────────────────────────────────────────────────────
  listAddons(subscriptionId: number): SBL<AddonWithVersion>
  getActiveAddons(subscriptionId: number): SBL<AddonWithVersion>

  // ── Subscription change requests ────────────────────────────────────────────
  createChangeRequest(data: ChangeRequestInsert): SB<SubscriptionChangeRequestRow>
  getChangeRequest(id: number): SB<SubscriptionChangeRequestRow>
  getChangeRequestByIdempotencyKey(key: string): SB<SubscriptionChangeRequestRow>
  listChangeRequests(subscriptionId: number, options?: { status?: ChangeRequestStatus }): SBL<SubscriptionChangeRequestRow>
  listOrgChangeRequests(orgId: number, options?: { status?: ChangeRequestStatus }): SBL<SubscriptionChangeRequestRow>

  // ── Subscription events (audit trail) ───────────────────────────────────────
  listEvents(orgId: number, options?: { subscriptionId?: number; limit?: number }): SBL<SubscriptionEventRow>

  // ── Contracts ───────────────────────────────────────────────────────────────
  listContracts(orgId: number): SBL<SubscriptionContractRow>
  getContract(id: number): SB<SubscriptionContractRow>
}

export function createSubscriptionsDb(supabase: SupabaseClient<Database>): SubscriptionsDb {
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

