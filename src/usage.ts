import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

type UsageRecordInsert = Database['public']['Tables']['usage_records']['Insert']

export function createAdminUsageDb(supabase: SupabaseClient<Database>) {
  return {
    record(data: UsageRecordInsert) {
      return supabase
        .from('usage_records')
        .insert(data)
        .select()
        .single()
    },
  }
}

export type AdminUsageDb = ReturnType<typeof createAdminUsageDb>

export function createUsageDb(supabase: SupabaseClient<Database>) {
  return {
    // ── Queries ───────────────────────────────────────────────────────

    listRecords(
      orgId: number,
      options?: {
        subscriptionId?: number
        featureKey?: string
        periodStart?: string
        periodEnd?: string
        limit?: number
      },
    ) {
      let query = supabase
        .from('usage_records')
        .select('*, features(*)')
        .eq('organization_id', orgId)
        .order('recorded_at', { ascending: false })

      if (options?.subscriptionId) {
        query = query.eq('subscription_id', options.subscriptionId)
      }

      if (options?.featureKey) {
        query = query.eq('feature_key', options.featureKey)
      }

      if (options?.periodStart) {
        query = query.gte('period_start', options.periodStart)
      }

      if (options?.periodEnd) {
        query = query.lte('period_end', options.periodEnd)
      }

      if (options?.limit) {
        query = query.limit(options.limit)
      }

      return query
    },

    // ── Summaries (aggregated per billing period) ─────────────────────

    /**
     * Returns the pre-aggregated summary for a feature in a given
     * period. Prefer this over summing usage_records at runtime.
     */
    getSummary(
      orgId: number,
      subscriptionId: number,
      featureKey: string,
      periodStart: string,
      periodEnd: string,
    ) {
      return supabase
        .from('usage_summaries')
        .select('*')
        .eq('organization_id', orgId)
        .eq('subscription_id', subscriptionId)
        .eq('feature_key', featureKey)
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .maybeSingle()
    },

    listSummaries(
      orgId: number,
      options?: {
        subscriptionId?: number
        featureKey?: string
        periodStart?: string
        periodEnd?: string
      },
    ) {
      let query = supabase
        .from('usage_summaries')
        .select('*')
        .eq('organization_id', orgId)
        .order('period_start', { ascending: false })

      if (options?.subscriptionId) {
        query = query.eq('subscription_id', options.subscriptionId)
      }

      if (options?.featureKey) {
        query = query.eq('feature_key', options.featureKey)
      }

      if (options?.periodStart) {
        query = query.gte('period_start', options.periodStart)
      }

      if (options?.periodEnd) {
        query = query.lte('period_end', options.periodEnd)
      }

      return query
    },
  }
}

export type UsageDb = ReturnType<typeof createUsageDb>
