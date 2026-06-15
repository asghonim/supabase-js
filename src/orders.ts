import type { SupabaseClient, PostgrestSingleResponse, PostgrestResponse, PostgrestError } from '@supabase/supabase-js'
import type { Database, Json } from './database'

type SB<T>       = PromiseLike<PostgrestSingleResponse<T>>
type SBL<T>      = PromiseLike<PostgrestResponse<T>>
type PGResult<T> = PromiseLike<{ data: T | null; error: PostgrestError | null }>

export type OrderRow          = Database['public']['Tables']['orders']['Row']
export type OrderUpdate       = Database['public']['Tables']['orders']['Update']
export type OrderItemRow      = Database['public']['Tables']['order_items']['Row']
export type OrderEventRow     = Database['public']['Tables']['order_events']['Row']
export type CommissionRow     = Database['public']['Tables']['commissions']['Row']
export type ShipmentRow       = Database['public']['Tables']['shipments']['Row']
export type ShipmentItemRow   = Database['public']['Tables']['shipment_items']['Row']
export type ReturnRow         = Database['public']['Tables']['returns']['Row']
export type ReturnUpdate      = Database['public']['Tables']['returns']['Update']
export type ReturnItemRow     = Database['public']['Tables']['return_items']['Row']
export type RefundRow         = Database['public']['Tables']['refunds']['Row']
export type RefundUpdate      = Database['public']['Tables']['refunds']['Update']
export type SellerPayoutRow   = Database['public']['Tables']['seller_payouts']['Row']
export type SellerPayoutUpdate = Database['public']['Tables']['seller_payouts']['Update']
export type SellerReviewRow   = Database['public']['Tables']['seller_reviews']['Row']
export type ListingReviewRow  = Database['public']['Tables']['listing_reviews']['Row']
export type OrderStatus       = Database['public']['Enums']['order_status']
export type ShipmentStatus    = Database['public']['Enums']['shipment_status']
export type ReturnStatus      = Database['public']['Enums']['return_status']
export type RefundStatus      = Database['public']['Enums']['refund_status']
export type PayoutStatus      = Database['public']['Enums']['payout_status']

// Local aliases for cross-module row types used in join shapes
type SellerProfileRow = Database['public']['Tables']['seller_profiles']['Row']
type WalletRow        = Database['public']['Tables']['wallets']['Row']
type PaymentRow       = Database['public']['Tables']['payments']['Row']

// ── User-facing (authenticated, RLS-scoped) ───────────────────────────────────

export interface OrdersDb {
  // ── Orders ────────────────────────────────────────────────────────────────
  getOrder(id: number): SB<OrderRow & {
    order_items: Array<OrderItemRow & { seller_profiles: Pick<SellerProfileRow, 'display_name'> | null }>
  }>
  getOrderByNumber(orderNumber: string): SB<OrderRow & {
    order_items: Array<OrderItemRow & { seller_profiles: Pick<SellerProfileRow, 'display_name'> | null }>
  }>
  listMyOrders(buyerAccountId: number, options?: { status?: OrderStatus; limit?: number }): SBL<OrderRow & {
    order_items: Array<Pick<OrderItemRow, 'snapshot_title' | 'quantity' | 'unit_price' | 'line_total'>>
  }>
  listOrderEvents(orderId: number): SBL<OrderEventRow>

  // ── Seller order view ─────────────────────────────────────────────────────
  listSellerOrders(sellerId: number, options?: { limit?: number; offset?: number }): SBL<OrderItemRow & {
    orders: Pick<OrderRow, 'order_number' | 'status' | 'created_at' | 'buyer_account_id' | 'shipping_address'> | null
  }>

  // ── Shipments ─────────────────────────────────────────────────────────────
  getShipment(id: number): SB<ShipmentRow & {
    shipment_items: Array<ShipmentItemRow & { order_items: Pick<OrderItemRow, 'snapshot_title' | 'quantity'> | null }>
  }>
  listOrderShipments(orderId: number): SBL<ShipmentRow & {
    shipment_items: Array<ShipmentItemRow & { order_items: Pick<OrderItemRow, 'snapshot_title'> | null }>
  }>

  // ── Returns ───────────────────────────────────────────────────────────────
  getReturn(id: number): SB<ReturnRow & {
    return_items: Array<ReturnItemRow & { order_items: Pick<OrderItemRow, 'snapshot_title'> | null }>
  }>
  listOrderReturns(orderId: number): SBL<ReturnRow & { return_items: ReturnItemRow[] }>
  createReturn(
    orderId: number,
    reason: string,
    items: Array<{ order_item_id: number; quantity: number; reason?: string }>,
  ): PGResult<ReturnRow>

  // ── Refunds ───────────────────────────────────────────────────────────────
  listOrderRefunds(paymentId: number): SBL<RefundRow>

  // ── Seller payouts ────────────────────────────────────────────────────────
  listMyPayouts(sellerId: number, options?: { status?: PayoutStatus; limit?: number }): SBL<SellerPayoutRow>

  // ── Reviews ───────────────────────────────────────────────────────────────
  getSellerReviews(sellerId: number, options?: { limit?: number }): SBL<SellerReviewRow>
  getListingReviews(listingId: number, options?: { limit?: number }): SBL<ListingReviewRow>
  writeSellerReview(input: Database['public']['Tables']['seller_reviews']['Insert']): SB<SellerReviewRow>
  writeListingReview(input: Database['public']['Tables']['listing_reviews']['Insert']): SB<ListingReviewRow>
}

export function createOrdersDb(supabase: SupabaseClient<Database>): OrdersDb {
  return {
    // ── Orders ────────────────────────────────────────────────────

    getOrder(id: number) {
      return supabase
        .from('orders')
        .select('*, order_items(*, seller_profiles(display_name))')
        .eq('id', id)
        .single()
    },

    getOrderByNumber(orderNumber: string) {
      return supabase
        .from('orders')
        .select('*, order_items(*, seller_profiles(display_name))')
        .eq('order_number', orderNumber)
        .single()
    },

    listMyOrders(buyerAccountId: number, options?: { status?: OrderStatus; limit?: number }) {
      let q = supabase
        .from('orders')
        .select('*, order_items(snapshot_title, quantity, unit_price, line_total)')
        .eq('buyer_account_id', buyerAccountId)
        .order('created_at', { ascending: false })

      if (options?.status) q = q.eq('status', options.status)
      if (options?.limit)  q = q.limit(options.limit)

      return q
    },

    listOrderEvents(orderId: number) {
      return supabase
        .from('order_events')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true })
    },

    // ── Seller order view ─────────────────────────────────────────

    listSellerOrders(sellerId: number, options?: { limit?: number; offset?: number }) {
      let q = supabase
        .from('order_items')
        .select('*, orders(order_number, status, created_at, buyer_account_id, shipping_address)')
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })

      if (options?.limit)  q = q.limit(options.limit)
      if (options?.offset) q = q.range(options.offset, options.offset + (options.limit ?? 20) - 1)

      return q
    },

    // ── Shipments ─────────────────────────────────────────────────

    getShipment(id: number) {
      return supabase
        .from('shipments')
        .select('*, shipment_items(*, order_items(snapshot_title, quantity))')
        .eq('id', id)
        .single()
    },

    listOrderShipments(orderId: number) {
      return supabase
        .from('shipments')
        .select('*, shipment_items(*, order_items(snapshot_title))')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true })
    },

    // ── Returns ───────────────────────────────────────────────────

    getReturn(id: number) {
      return supabase
        .from('returns')
        .select('*, return_items(*, order_items(snapshot_title))')
        .eq('id', id)
        .single()
    },

    listOrderReturns(orderId: number) {
      return supabase
        .from('returns')
        .select('*, return_items(*)')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
    },

    createReturn(
      orderId: number,
      reason: string,
      items: Array<{ order_item_id: number; quantity: number; reason?: string }>,
    ) {
      return supabase
        .from('returns')
        .insert({ order_id: orderId, reason })
        .select()
        .single()
        .then(async ({ data: ret, error }) => {
          if (error || !ret) return { data: null, error }
          const { error: itemsError } = await supabase
            .from('return_items')
            .insert(items.map(i => ({ return_id: ret.id, ...i })))
          if (itemsError) {
            await supabase.from('returns').delete().eq('id', ret.id)
            return { data: null, error: itemsError }
          }
          return { data: ret, error: null }
        })
    },

    // ── Refunds ───────────────────────────────────────────────────

    listOrderRefunds(paymentId: number) {
      return supabase
        .from('refunds')
        .select('*')
        .eq('payment_id', paymentId)
        .order('created_at', { ascending: false })
    },

    // ── Seller payouts ────────────────────────────────────────────

    listMyPayouts(sellerId: number, options?: { status?: PayoutStatus; limit?: number }) {
      let q = supabase
        .from('seller_payouts')
        .select('*')
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })

      if (options?.status) q = q.eq('status', options.status)
      if (options?.limit)  q = q.limit(options.limit)

      return q
    },

    // ── Reviews ───────────────────────────────────────────────────

    getSellerReviews(sellerId: number, options?: { limit?: number }) {
      let q = supabase
        .from('seller_reviews')
        .select('*, buyer_id')
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })
      if (options?.limit) q = q.limit(options.limit)
      return q
    },

    getListingReviews(listingId: number, options?: { limit?: number }) {
      let q = supabase
        .from('listing_reviews')
        .select('*')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: false })
      if (options?.limit) q = q.limit(options.limit)
      return q
    },

    writeSellerReview(input: Database['public']['Tables']['seller_reviews']['Insert']) {
      return supabase.from('seller_reviews').insert(input).select().single()
    },

    writeListingReview(input: Database['public']['Tables']['listing_reviews']['Insert']) {
      return supabase.from('listing_reviews').insert(input).select().single()
    },
  }
}

// ── Admin / service-role operations ──────────────────────────────────────────

export interface AdminOrdersDb {
  // ── Orders ────────────────────────────────────────────────────────────────
  createOrder(input: Database['public']['Tables']['orders']['Insert']): SB<OrderRow>
  updateOrderStatus(id: number, status: OrderStatus, extra?: Omit<OrderUpdate, 'id' | 'status'>): SB<OrderRow>
  addOrderItem(input: Database['public']['Tables']['order_items']['Insert']): SB<OrderItemRow>
  recordOrderEvent(orderId: number, eventType: string, payload?: Json): SB<OrderEventRow>
  listOrdersByStatus(status: OrderStatus, options?: { limit?: number }): SBL<OrderRow & {
    order_items: Array<Pick<OrderItemRow, 'seller_id' | 'snapshot_title' | 'quantity'>>
  }>

  // ── Commissions ───────────────────────────────────────────────────────────
  recordCommission(input: Database['public']['Tables']['commissions']['Insert']): SB<CommissionRow>
  listUnprocessedCommissions(sellerId?: number): SBL<CommissionRow>
  markCommissionProcessed(id: number, journalEntryId: number): SB<CommissionRow>

  // ── Shipments ─────────────────────────────────────────────────────────────
  createShipment(
    input: Database['public']['Tables']['shipments']['Insert'],
    items: Array<{ order_item_id: number; quantity: number }>,
  ): PGResult<ShipmentRow>
  updateShipmentStatus(
    id: number,
    status: ShipmentStatus,
    extra?: { tracking_number?: string; tracking_url?: string; carrier?: string; shipped_at?: string; delivered_at?: string },
  ): SB<ShipmentRow>

  // ── Returns ───────────────────────────────────────────────────────────────
  updateReturnStatus(id: number, status: ReturnStatus): SB<ReturnRow>
  listPendingReturns(sellerId?: number): SBL<ReturnRow & {
    return_items: ReturnItemRow[]
    orders: Pick<OrderRow, 'order_number' | 'buyer_account_id'> | null
  }>

  // ── Refunds ───────────────────────────────────────────────────────────────
  createRefund(input: Database['public']['Tables']['refunds']['Insert']): SB<RefundRow>
  updateRefundStatus(id: number, status: RefundStatus, journalEntryId?: number): SB<RefundRow>
  listPendingRefunds(): SBL<RefundRow & {
    payments: Pick<PaymentRow, 'organization_id' | 'buyer_account_id'> | null
  }>

  // ── Seller payouts ────────────────────────────────────────────────────────
  createPayout(input: Database['public']['Tables']['seller_payouts']['Insert']): SB<SellerPayoutRow>
  updatePayoutStatus(id: number, status: PayoutStatus, journalEntryId?: number): SB<SellerPayoutRow>
  listPendingPayouts(): SBL<SellerPayoutRow & {
    seller_profiles: Pick<SellerProfileRow, 'display_name' | 'account_id'> | null
    wallets: Pick<WalletRow, 'current_balance' | 'currency'> | null
  }>
}

export function createAdminOrdersDb(supabase: SupabaseClient<Database>): AdminOrdersDb {
  return {
    // ── Orders ────────────────────────────────────────────────────

    createOrder(input: Database['public']['Tables']['orders']['Insert']) {
      return supabase.from('orders').insert(input).select().single()
    },

    updateOrderStatus(id: number, status: OrderStatus, extra?: Omit<OrderUpdate, 'id' | 'status'>) {
      return supabase
        .from('orders')
        .update({ status, ...extra })
        .eq('id', id)
        .select()
        .single()
    },

    addOrderItem(input: Database['public']['Tables']['order_items']['Insert']) {
      return supabase.from('order_items').insert(input).select().single()
    },

    recordOrderEvent(orderId: number, eventType: string, payload?: Json) {
      return supabase
        .from('order_events')
        .insert({ order_id: orderId, event_type: eventType, payload: payload ?? {} })
        .select()
        .single()
    },

    listOrdersByStatus(status: OrderStatus, options?: { limit?: number }) {
      let q = supabase
        .from('orders')
        .select('*, order_items(seller_id, snapshot_title, quantity)')
        .eq('status', status)
        .order('created_at', { ascending: false })
      if (options?.limit) q = q.limit(options.limit)
      return q
    },

    // ── Commissions ───────────────────────────────────────────────

    recordCommission(input: Database['public']['Tables']['commissions']['Insert']) {
      return supabase.from('commissions').insert(input).select().single()
    },

    listUnprocessedCommissions(sellerId?: number) {
      let q = supabase
        .from('commissions')
        .select('*')
        .is('journal_entry_id', null)
        .order('created_at')
      if (sellerId) q = q.eq('seller_id', sellerId)
      return q
    },

    markCommissionProcessed(id: number, journalEntryId: number) {
      return supabase
        .from('commissions')
        .update({ journal_entry_id: journalEntryId })
        .eq('id', id)
        .select()
        .single()
    },

    // ── Shipments ─────────────────────────────────────────────────

    createShipment(
      input: Database['public']['Tables']['shipments']['Insert'],
      items: Array<{ order_item_id: number; quantity: number }>,
    ) {
      return supabase
        .from('shipments')
        .insert(input)
        .select()
        .single()
        .then(async ({ data: shipment, error }) => {
          if (error || !shipment) return { data: null, error }
          const { error: itemsError } = await supabase
            .from('shipment_items')
            .insert(items.map(i => ({ shipment_id: shipment.id, ...i })))
          if (itemsError) {
            await supabase.from('shipments').delete().eq('id', shipment.id)
            return { data: null, error: itemsError }
          }
          return { data: shipment, error: null }
        })
    },

    updateShipmentStatus(
      id: number,
      status: ShipmentStatus,
      extra?: { tracking_number?: string; tracking_url?: string; carrier?: string; shipped_at?: string; delivered_at?: string },
    ) {
      return supabase
        .from('shipments')
        .update({ status, ...extra })
        .eq('id', id)
        .select()
        .single()
    },

    // ── Returns ───────────────────────────────────────────────────

    updateReturnStatus(id: number, status: ReturnStatus) {
      const extra: ReturnUpdate = { status }
      if (status === 'approved')  extra.approved_at  = new Date().toISOString()
      if (status === 'received')  extra.received_at  = new Date().toISOString()
      if (status === 'completed') extra.completed_at = new Date().toISOString()
      return supabase.from('returns').update(extra).eq('id', id).select().single()
    },

    async listPendingReturns(sellerId?: number) {
      let q = supabase
        .from('returns')
        .select('*, return_items(*), orders(order_number, buyer_account_id)')
        .in('status', ['requested', 'approved'] satisfies ReturnStatus[])
        .order('created_at')

      if (sellerId) {
        const { data, error: lookupError } = await supabase
          .from('order_items')
          .select('order_id')
          .eq('seller_id', sellerId)
        if (lookupError) return { data: null, error: lookupError, count: null, status: 400, statusText: lookupError.message, success: false as const }
        const orderIds = (data ?? []).map(r => r.order_id)
        if (orderIds.length === 0) return { data: [], error: null, count: 0, status: 200, statusText: 'OK', success: true as const }
        q = q.in('order_id', orderIds)
      }
      return q
    },

    // ── Refunds ───────────────────────────────────────────────────

    createRefund(input: Database['public']['Tables']['refunds']['Insert']) {
      return supabase.from('refunds').insert(input).select().single()
    },

    updateRefundStatus(id: number, status: RefundStatus, journalEntryId?: number) {
      const update: RefundUpdate = { status }
      if (status === 'completed') update.processed_at = new Date().toISOString()
      if (journalEntryId)         update.journal_entry_id = journalEntryId
      return supabase.from('refunds').update(update).eq('id', id).select().single()
    },

    listPendingRefunds() {
      return supabase
        .from('refunds')
        .select('*, payments(organization_id, buyer_account_id)')
        .in('status', ['pending', 'processing'] satisfies RefundStatus[])
        .order('created_at')
    },

    // ── Seller payouts ────────────────────────────────────────────

    createPayout(input: Database['public']['Tables']['seller_payouts']['Insert']) {
      return supabase.from('seller_payouts').insert(input).select().single()
    },

    updatePayoutStatus(id: number, status: PayoutStatus, journalEntryId?: number) {
      const update: SellerPayoutUpdate = { status }
      if (status === 'completed') update.processed_at = new Date().toISOString()
      if (journalEntryId)         update.journal_entry_id = journalEntryId
      return supabase.from('seller_payouts').update(update).eq('id', id).select().single()
    },

    listPendingPayouts() {
      return supabase
        .from('seller_payouts')
        .select('*, seller_profiles(display_name, account_id), wallets(current_balance, currency)')
        .in('status', ['pending', 'processing'] satisfies PayoutStatus[])
        .order('created_at')
    },
  }
}
