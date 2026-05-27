import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

type InvoiceStatus = Database['public']['Enums']['invoice_status']
type PaymentStatus = Database['public']['Enums']['payment_status']
type WebhookEventStatus = Database['public']['Enums']['webhook_event_status']
type BillingProvider = Database['public']['Enums']['billing_provider']
type WebhookInsert = Database['public']['Tables']['billing_webhook_events']['Insert']

export function createBillingDb(supabase: SupabaseClient<Database>) {
  return {
    // ── Invoices ─────────────────────────────────────────────────────

    listInvoices(orgId: number, options?: { status?: InvoiceStatus; limit?: number }) {
      let query = supabase
        .from('invoices')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })

      if (options?.status) {
        query = query.eq('status', options.status)
      }

      if (options?.limit) {
        query = query.limit(options.limit)
      }

      return query
    },

    getInvoice(id: number) {
      return supabase
        .from('invoices')
        .select('*, invoice_line_items(*), credit_notes(*)')
        .eq('id', id)
        .single()
    },

    getInvoiceByNumber(number: string) {
      return supabase
        .from('invoices')
        .select('*, invoice_line_items(*)')
        .eq('number', number)
        .single()
    },

    getInvoiceByProviderId(providerInvoiceId: string) {
      return supabase
        .from('invoices')
        .select('*, invoice_line_items(*)')
        .eq('billing_provider_invoice_id', providerInvoiceId)
        .single()
    },

    // ── Credit notes ─────────────────────────────────────────────────

    listCreditNotes(orgId: number) {
      return supabase
        .from('credit_notes')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
    },

    getCreditNote(id: number) {
      return supabase
        .from('credit_notes')
        .select('*')
        .eq('id', id)
        .single()
    },

    // ── Payments ─────────────────────────────────────────────────────

    listPayments(orgId: number, options?: { status?: PaymentStatus; limit?: number }) {
      let query = supabase
        .from('payments')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })

      if (options?.status) {
        query = query.eq('status', options.status)
      }

      if (options?.limit) {
        query = query.limit(options.limit)
      }

      return query
    },

    getPayment(id: number) {
      return supabase
        .from('payments')
        .select('*, invoices(*)')
        .eq('id', id)
        .single()
    },

    getPaymentByProviderId(providerPaymentId: string) {
      return supabase
        .from('payments')
        .select('*')
        .eq('billing_provider_payment_id', providerPaymentId)
        .single()
    },

    // ── Webhook events ────────────────────────────────────────────────

    /**
     * Upsert an inbound provider webhook — idempotent on
     * (billing_provider, event_id). Returns the existing row when
     * a duplicate arrives, so callers can skip re-processing.
     */
    upsertWebhookEvent(data: WebhookInsert) {
      return supabase
        .from('billing_webhook_events')
        .upsert(data, { onConflict: 'billing_provider,event_id' })
        .select()
        .single()
    },

    getWebhookEvent(provider: BillingProvider, eventId: string) {
      return supabase
        .from('billing_webhook_events')
        .select('*')
        .eq('billing_provider', provider)
        .eq('event_id', eventId)
        .single()
    },

    listPendingWebhookEvents(provider?: BillingProvider) {
      let query = supabase
        .from('billing_webhook_events')
        .select('*')
        .eq('status', 'pending' satisfies WebhookEventStatus)
        .order('created_at', { ascending: true })

      if (provider) {
        query = query.eq('billing_provider', provider)
      }

      return query
    },

    // ── Idempotency keys ─────────────────────────────────────────────

    getIdempotencyKey(key: string) {
      return supabase
        .from('idempotency_keys')
        .select('*')
        .eq('key', key)
        .maybeSingle()
    },
  }
}

export type BillingDb = ReturnType<typeof createBillingDb>
