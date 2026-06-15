import type { SupabaseClient, PostgrestSingleResponse, PostgrestMaybeSingleResponse, PostgrestResponse, PostgrestError } from '@supabase/supabase-js'
import type { Database } from './database'

type SB<T>       = PromiseLike<PostgrestSingleResponse<T>>
type SBM<T>      = PromiseLike<PostgrestMaybeSingleResponse<T>>
type SBL<T>      = PromiseLike<PostgrestResponse<T>>
type PGResult<T> = PromiseLike<{ data: T | null; error: PostgrestError | null }>

export type SellerProfileRow        = Database['public']['Tables']['seller_profiles']['Row']
export type ListingRow              = Database['public']['Tables']['listings']['Row']
export type ListingImageRow         = Database['public']['Tables']['listing_images']['Row']
export type ListingAttributeRow     = Database['public']['Tables']['listing_attributes']['Row']
export type AuctionRow              = Database['public']['Tables']['auctions']['Row']
export type AuctionBidRow           = Database['public']['Tables']['auction_bids']['Row']
export type ProxyBidRow             = Database['public']['Tables']['proxy_bids']['Row']
export type AuctionStatisticsRow    = Database['public']['Tables']['auction_statistics']['Row']
export type ListingWatcherRow       = Database['public']['Tables']['listing_watchers']['Row']
export type CartRow                 = Database['public']['Tables']['carts']['Row']
export type CartItemRow             = Database['public']['Tables']['cart_items']['Row']
export type CheckoutSessionRow      = Database['public']['Tables']['checkout_sessions']['Row']
export type CheckoutItemRow         = Database['public']['Tables']['checkout_items']['Row']
export type InventoryReservationRow = Database['public']['Tables']['inventory_reservations']['Row']
export type PromotionRow            = Database['public']['Tables']['promotions']['Row']
export type PromotionRedemptionRow  = Database['public']['Tables']['promotion_redemptions']['Row']
export type ListingType             = Database['public']['Enums']['listing_type']
export type ListingStatus           = Database['public']['Enums']['listing_status']
export type AuctionStatus           = Database['public']['Enums']['auction_status']
export type CartStatus              = Database['public']['Enums']['cart_status']
export type CheckoutStatus          = Database['public']['Enums']['checkout_status']
export type ReservationStatus       = Database['public']['Enums']['reservation_status']
export type PromotionType           = Database['public']['Enums']['promotion_type']

// ── User-facing (authenticated, RLS-scoped) ───────────────────────────────────

export interface MarketplaceDb {
  // ── Seller profiles ─────────────────────────────────────────────────────
  getSellerProfile(id: number): SB<SellerProfileRow>
  getMySellerProfile(accountId: number): SBM<SellerProfileRow>
  updateMySellerProfile(id: number, input: Pick<Database['public']['Tables']['seller_profiles']['Update'], 'display_name' | 'bio'>): SB<SellerProfileRow>

  // ── Listings ─────────────────────────────────────────────────────────────
  getListing(id: number): SB<ListingRow & {
    listing_images: ListingImageRow[]
    listing_attributes: ListingAttributeRow[]
    seller_profiles: SellerProfileRow | null
    auctions: AuctionRow | null
  }>
  listActiveListings(options?: { sellerId?: number; type?: ListingType; limit?: number; offset?: number }): SBL<ListingRow & {
    listing_images: ListingImageRow[]
    seller_profiles: Pick<SellerProfileRow, 'display_name' | 'rating'> | null
  }>
  listMyListings(sellerId: number, status?: ListingStatus): SBL<ListingRow>
  createListing(input: Database['public']['Tables']['listings']['Insert']): SB<ListingRow>
  updateListing(id: number, input: Database['public']['Tables']['listings']['Update']): SB<ListingRow>
  addListingImage(input: Database['public']['Tables']['listing_images']['Insert']): SB<ListingImageRow>
  deleteListingImage(id: number): SB<null>
  upsertListingAttribute(input: Database['public']['Tables']['listing_attributes']['Insert']): SB<ListingAttributeRow>

  // ── Auctions ─────────────────────────────────────────────────────────────
  getAuction(listingId: number): SBM<AuctionRow & { auction_statistics: AuctionStatisticsRow | null }>
  listActiveBids(auctionId: number): SBL<AuctionBidRow & { accounts: { uid: string } | null }>
  placeBid(auctionId: number, bidderId: number, amount: number): SB<AuctionBidRow>
  setProxyBid(auctionId: number, bidderId: number, maximumAmount: number): SB<ProxyBidRow>
  getMyProxyBid(auctionId: number, bidderId: number): SBM<ProxyBidRow>

  // ── Watchlist ─────────────────────────────────────────────────────────────
  watchListing(listingId: number, accountId: number): SB<null>
  unwatchListing(listingId: number, accountId: number): SB<null>
  listWatchedListings(accountId: number): SBL<{
    listing_id: number
    created_at: string
    listings: (ListingRow & { listing_images: ListingImageRow[] }) | null
  }>

  // ── Cart ─────────────────────────────────────────────────────────────────
  getActiveCart(accountId: number, currency?: string): SBM<CartRow & {
    cart_items: Array<CartItemRow & {
      listings: (Pick<ListingRow, 'id' | 'title' | 'price' | 'currency' | 'listing_type' | 'status' | 'seller_id'> & { listing_images: ListingImageRow[] }) | null
    }>
  }>
  getOrCreateCart(accountId: number, currency?: string): PGResult<CartRow>
  upsertCartItem(cartId: number, listingId: number, quantity: number): SB<CartItemRow>
  removeCartItem(cartId: number, listingId: number): SB<null>
  clearCart(cartId: number): SB<null>

  // ── Checkout sessions ─────────────────────────────────────────────────────
  getCheckoutSession(id: number): SB<CheckoutSessionRow & { checkout_items: CheckoutItemRow[] }>
  listMyCheckoutSessions(accountId: number): SBL<CheckoutSessionRow & { checkout_items: CheckoutItemRow[] }>

  // ── Promotions ────────────────────────────────────────────────────────────
  getPromotionByCode(code: string): SBM<PromotionRow>
  listMyRedemptions(accountId: number): SBL<PromotionRedemptionRow & {
    promotions: Pick<PromotionRow, 'name' | 'promotion_type' | 'value'> | null
  }>
}

export function createMarketplaceDb(supabase: SupabaseClient<Database>): MarketplaceDb {
  return {
    // ── Seller profiles ───────────────────────────────────────────

    getSellerProfile(id: number) {
      return supabase.from('seller_profiles').select('*').eq('id', id).single()
    },

    getMySellerProfile(accountId: number) {
      return supabase
        .from('seller_profiles')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle()
    },

    updateMySellerProfile(
      id: number,
      input: Pick<Database['public']['Tables']['seller_profiles']['Update'], 'display_name' | 'bio'>,
    ) {
      return supabase.from('seller_profiles').update(input).eq('id', id).select().single()
    },

    // ── Listings ──────────────────────────────────────────────────

    getListing(id: number) {
      return supabase
        .from('listings')
        .select('*, listing_images(*), listing_attributes(*), seller_profiles(*), auctions(*)')
        .eq('id', id)
        .single()
    },

    listActiveListings(options?: {
      sellerId?: number
      type?: ListingType
      limit?: number
      offset?: number
    }) {
      let q = supabase
        .from('listings')
        .select('*, listing_images(*), seller_profiles(display_name, rating)')
        .eq('status', 'active' satisfies ListingStatus)
        .order('created_at', { ascending: false })

      if (options?.sellerId) q = q.eq('seller_id', options.sellerId)
      if (options?.type)     q = q.eq('listing_type', options.type)
      if (options?.limit)    q = q.limit(options.limit)
      if (options?.offset)   q = q.range(options.offset, options.offset + (options.limit ?? 20) - 1)

      return q
    },

    listMyListings(sellerId: number, status?: ListingStatus) {
      let q = supabase
        .from('listings')
        .select('*')
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })
      if (status) q = q.eq('status', status)
      return q
    },

    createListing(input: Database['public']['Tables']['listings']['Insert']) {
      return supabase.from('listings').insert(input).select().single()
    },

    updateListing(id: number, input: Database['public']['Tables']['listings']['Update']) {
      return supabase.from('listings').update(input).eq('id', id).select().single()
    },

    addListingImage(input: Database['public']['Tables']['listing_images']['Insert']) {
      return supabase.from('listing_images').insert(input).select().single()
    },

    deleteListingImage(id: number) {
      return supabase.from('listing_images').delete().eq('id', id)
    },

    upsertListingAttribute(input: Database['public']['Tables']['listing_attributes']['Insert']) {
      return supabase
        .from('listing_attributes')
        .upsert(input, { onConflict: 'listing_id,name' })
        .select()
        .single()
    },

    // ── Auctions ──────────────────────────────────────────────────

    getAuction(listingId: number) {
      return supabase
        .from('auctions')
        .select('*, auction_statistics(*)')
        .eq('listing_id', listingId)
        .maybeSingle()
    },

    listActiveBids(auctionId: number) {
      return supabase
        .from('auction_bids')
        .select('*, accounts(uid)')
        .eq('auction_id', auctionId)
        .order('amount', { ascending: false })
    },

    placeBid(auctionId: number, bidderId: number, amount: number) {
      return supabase
        .from('auction_bids')
        .insert({ auction_id: auctionId, bidder_id: bidderId, amount })
        .select()
        .single()
    },

    setProxyBid(auctionId: number, bidderId: number, maximumAmount: number) {
      return supabase
        .from('proxy_bids')
        .upsert(
          { auction_id: auctionId, bidder_id: bidderId, maximum_amount: maximumAmount },
          { onConflict: 'auction_id,bidder_id' },
        )
        .select()
        .single()
    },

    getMyProxyBid(auctionId: number, bidderId: number) {
      return supabase
        .from('proxy_bids')
        .select('*')
        .eq('auction_id', auctionId)
        .eq('bidder_id', bidderId)
        .maybeSingle()
    },

    // ── Watchlist ─────────────────────────────────────────────────

    watchListing(listingId: number, accountId: number) {
      return supabase
        .from('listing_watchers')
        .insert({ listing_id: listingId, account_id: accountId })
    },

    unwatchListing(listingId: number, accountId: number) {
      return supabase
        .from('listing_watchers')
        .delete()
        .eq('listing_id', listingId)
        .eq('account_id', accountId)
    },

    listWatchedListings(accountId: number) {
      return supabase
        .from('listing_watchers')
        .select('listing_id, created_at, listings(*, listing_images(*))')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
    },

    // ── Cart ──────────────────────────────────────────────────────

    getActiveCart(accountId: number, currency = 'USD') {
      return supabase
        .from('carts')
        .select('*, cart_items(*, listings(id, title, price, currency, listing_type, status, seller_id, listing_images(*)))')
        .eq('account_id', accountId)
        .eq('status', 'active' satisfies CartStatus)
        .eq('currency', currency)
        .maybeSingle()
    },

    async getOrCreateCart(accountId: number, currency = 'USD') {
      const { data: existing } = await supabase
        .from('carts')
        .select('*')
        .eq('account_id', accountId)
        .eq('status', 'active' satisfies CartStatus)
        .eq('currency', currency)
        .maybeSingle()

      if (existing) return { data: existing, error: null }

      return supabase
        .from('carts')
        .insert({ account_id: accountId, currency })
        .select()
        .single()
    },

    upsertCartItem(cartId: number, listingId: number, quantity: number) {
      return supabase
        .from('cart_items')
        .upsert({ cart_id: cartId, listing_id: listingId, quantity }, { onConflict: 'cart_id,listing_id' })
        .select()
        .single()
    },

    removeCartItem(cartId: number, listingId: number) {
      return supabase
        .from('cart_items')
        .delete()
        .eq('cart_id', cartId)
        .eq('listing_id', listingId)
    },

    clearCart(cartId: number) {
      return supabase.from('cart_items').delete().eq('cart_id', cartId)
    },

    // ── Checkout sessions ─────────────────────────────────────────

    getCheckoutSession(id: number) {
      return supabase
        .from('checkout_sessions')
        .select('*, checkout_items(*)')
        .eq('id', id)
        .single()
    },

    listMyCheckoutSessions(accountId: number) {
      return supabase
        .from('checkout_sessions')
        .select('*, checkout_items(*)')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(10)
    },

    // ── Promotions ────────────────────────────────────────────────

    getPromotionByCode(code: string) {
      const now = new Date().toISOString()
      return supabase
        .from('promotions')
        .select('*')
        .eq('code', code)
        .eq('is_active', true)
        .or(`start_date.is.null,start_date.lte.${now}`)
        .or(`end_date.is.null,end_date.gt.${now}`)
        .maybeSingle()
    },

    listMyRedemptions(accountId: number) {
      return supabase
        .from('promotion_redemptions')
        .select('*, promotions(name, promotion_type, value)')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
    },
  }
}

// ── Admin / service-role operations ──────────────────────────────────────────

export interface AdminMarketplaceDb {
  // ── Seller profiles ─────────────────────────────────────────────────────
  createSellerProfile(input: Database['public']['Tables']['seller_profiles']['Insert']): SB<SellerProfileRow>
  updateSellerProfile(id: number, input: Database['public']['Tables']['seller_profiles']['Update']): SB<SellerProfileRow>
  listSellerProfiles(options?: { status?: string; limit?: number }): SBL<SellerProfileRow>

  // ── Listings ─────────────────────────────────────────────────────────────
  updateListingStatus(id: number, status: ListingStatus): SB<ListingRow>

  // ── Auctions ─────────────────────────────────────────────────────────────
  createAuction(input: Database['public']['Tables']['auctions']['Insert']): SB<AuctionRow>
  updateAuction(id: number, input: Database['public']['Tables']['auctions']['Update']): SB<AuctionRow>
  updateAuctionStatus(id: number, status: AuctionStatus): SB<AuctionRow>
  listActiveAuctions(): SBL<AuctionRow & {
    listings: Pick<ListingRow, 'title' | 'currency'> | null
    auction_statistics: AuctionStatisticsRow | null
  }>
  listEndingSoonAuctions(withinMinutes?: number): SBL<AuctionRow & {
    listings: Pick<ListingRow, 'title' | 'currency'> | null
    auction_statistics: AuctionStatisticsRow | null
  }>

  // ── Checkout sessions ─────────────────────────────────────────────────────
  createCheckoutSession(input: Database['public']['Tables']['checkout_sessions']['Insert']): SB<CheckoutSessionRow>
  updateCheckoutSession(id: number, input: Database['public']['Tables']['checkout_sessions']['Update']): SB<CheckoutSessionRow>
  addCheckoutItem(input: Database['public']['Tables']['checkout_items']['Insert']): SB<CheckoutItemRow>

  // ── Inventory reservations ────────────────────────────────────────────────
  createReservation(input: Database['public']['Tables']['inventory_reservations']['Insert']): SB<InventoryReservationRow>
  releaseReservation(id: number): SBM<InventoryReservationRow>
  consumeReservation(id: number): SBM<InventoryReservationRow>
  listExpiredReservations(): SBL<InventoryReservationRow>

  // ── Promotions ────────────────────────────────────────────────────────────
  createPromotion(input: Database['public']['Tables']['promotions']['Insert']): SB<PromotionRow>
  updatePromotion(id: number, input: Database['public']['Tables']['promotions']['Update']): SB<PromotionRow>
  recordRedemption(input: Database['public']['Tables']['promotion_redemptions']['Insert']): SB<PromotionRedemptionRow>
}

export function createAdminMarketplaceDb(supabase: SupabaseClient<Database>): AdminMarketplaceDb {
  return {
    // ── Seller profiles ───────────────────────────────────────────

    createSellerProfile(input: Database['public']['Tables']['seller_profiles']['Insert']) {
      return supabase.from('seller_profiles').insert(input).select().single()
    },

    updateSellerProfile(id: number, input: Database['public']['Tables']['seller_profiles']['Update']) {
      return supabase.from('seller_profiles').update(input).eq('id', id).select().single()
    },

    listSellerProfiles(options?: { status?: string; limit?: number }) {
      let q = supabase.from('seller_profiles').select('*').order('created_at', { ascending: false })
      if (options?.status) q = q.eq('status', options.status)
      if (options?.limit)  q = q.limit(options.limit)
      return q
    },

    // ── Listings ──────────────────────────────────────────────────

    updateListingStatus(id: number, status: ListingStatus) {
      return supabase.from('listings').update({ status }).eq('id', id).select().single()
    },

    // ── Auctions ──────────────────────────────────────────────────

    createAuction(input: Database['public']['Tables']['auctions']['Insert']) {
      return supabase.from('auctions').insert(input).select().single()
    },

    updateAuction(id: number, input: Database['public']['Tables']['auctions']['Update']) {
      return supabase.from('auctions').update(input).eq('id', id).select().single()
    },

    updateAuctionStatus(id: number, status: AuctionStatus) {
      return supabase.from('auctions').update({ status }).eq('id', id).select().single()
    },

    listActiveAuctions() {
      return supabase
        .from('auctions')
        .select('*, listings(title, currency), auction_statistics(*)')
        .eq('status', 'active' satisfies AuctionStatus)
        .order('end_time')
    },

    listEndingSoonAuctions(withinMinutes = 60) {
      const cutoff = new Date(Date.now() + withinMinutes * 60_000).toISOString()
      return supabase
        .from('auctions')
        .select('*, listings(title, currency), auction_statistics(*)')
        .eq('status', 'active' satisfies AuctionStatus)
        .lte('end_time', cutoff)
        .order('end_time')
    },

    // ── Checkout sessions ─────────────────────────────────────────

    createCheckoutSession(input: Database['public']['Tables']['checkout_sessions']['Insert']) {
      return supabase.from('checkout_sessions').insert(input).select().single()
    },

    updateCheckoutSession(id: number, input: Database['public']['Tables']['checkout_sessions']['Update']) {
      return supabase.from('checkout_sessions').update(input).eq('id', id).select().single()
    },

    addCheckoutItem(input: Database['public']['Tables']['checkout_items']['Insert']) {
      return supabase.from('checkout_items').insert(input).select().single()
    },

    // ── Inventory reservations ────────────────────────────────────

    createReservation(input: Database['public']['Tables']['inventory_reservations']['Insert']) {
      return supabase.from('inventory_reservations').insert(input).select().single()
    },

    releaseReservation(id: number) {
      return supabase
        .from('inventory_reservations')
        .update({ status: 'released' satisfies ReservationStatus })
        .eq('id', id)
        .eq('status', 'active' satisfies ReservationStatus)
        .select()
        .maybeSingle()
    },

    consumeReservation(id: number) {
      return supabase
        .from('inventory_reservations')
        .update({ status: 'consumed' satisfies ReservationStatus })
        .eq('id', id)
        .eq('status', 'active' satisfies ReservationStatus)
        .select()
        .maybeSingle()
    },

    listExpiredReservations() {
      return supabase
        .from('inventory_reservations')
        .select('*')
        .eq('status', 'active' satisfies ReservationStatus)
        .lt('expires_at', new Date().toISOString())
    },

    // ── Promotions ────────────────────────────────────────────────

    createPromotion(input: Database['public']['Tables']['promotions']['Insert']) {
      return supabase.from('promotions').insert(input).select().single()
    },

    updatePromotion(id: number, input: Database['public']['Tables']['promotions']['Update']) {
      return supabase.from('promotions').update(input).eq('id', id).select().single()
    },

    recordRedemption(input: Database['public']['Tables']['promotion_redemptions']['Insert']) {
      return supabase.from('promotion_redemptions').insert(input).select().single()
    },
  }
}
