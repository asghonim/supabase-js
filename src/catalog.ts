import type { SupabaseClient, PostgrestSingleResponse, PostgrestMaybeSingleResponse, PostgrestResponse } from '@supabase/supabase-js'
import type { Database } from './database'

type SB<T>  = PromiseLike<PostgrestSingleResponse<T>>
type SBM<T> = PromiseLike<PostgrestMaybeSingleResponse<T>>
type SBL<T> = PromiseLike<PostgrestResponse<T>>

export type ProductCategoryRow  = Database['public']['Tables']['product_categories']['Row']
export type ProductRow          = Database['public']['Tables']['products']['Row']
export type ProductVariantRow   = Database['public']['Tables']['product_variants']['Row']
export type AttributeRow        = Database['public']['Tables']['attributes']['Row']
export type AttributeValueRow   = Database['public']['Tables']['attribute_values']['Row']
export type VariantAttrValueRow = Database['public']['Tables']['variant_attribute_values']['Row']
export type WarehouseRow        = Database['public']['Tables']['warehouses']['Row']
export type InventoryTxnRow     = Database['public']['Tables']['inventory_transactions']['Row']
export type PriceRow            = Database['public']['Tables']['prices']['Row']
export type ProductStatus       = Database['public']['Enums']['product_status']
export type VariantStatus       = Database['public']['Enums']['variant_status']

// ── User-facing (authenticated, RLS-scoped) ───────────────────────────────────

export interface CatalogDb {
  listCategories(parentId?: number | null): SBL<ProductCategoryRow>
  getProduct(id: number): SB<ProductRow & { product_variants: ProductVariantRow[] }>
  listProducts(options?: { categoryId?: number; limit?: number; offset?: number }): SBL<ProductRow & { product_variants: ProductVariantRow[] }>
  getVariant(id: number): SB<ProductVariantRow & {
    products: ProductRow | null
    variant_attribute_values: Array<VariantAttrValueRow & {
      attribute_values: (AttributeValueRow & { attributes: AttributeRow }) | null
    }>
  }>
  getCurrentPrice(variantId: number, currency?: string): SBM<PriceRow>
  listAttributes(): SBL<AttributeRow & { attribute_values: AttributeValueRow[] }>
}

export function createCatalogDb(supabase: SupabaseClient<Database>): CatalogDb {
  return {
    listCategories(parentId?: number | null) {
      let q = supabase
        .from('product_categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (parentId !== undefined) q = q.eq('parent_id', parentId as number)
      return q
    },

    getProduct(id: number) {
      return supabase
        .from('products')
        .select('*, product_variants(*)')
        .eq('id', id)
        .eq('status', 'active' satisfies ProductStatus)
        .single()
    },

    listProducts(options?: { categoryId?: number; limit?: number; offset?: number }) {
      let q = supabase
        .from('products')
        .select('*, product_variants(*)')
        .eq('status', 'active' satisfies ProductStatus)
        .order('name')

      if (options?.categoryId) q = q.eq('category_id', options.categoryId)
      if (options?.limit)      q = q.limit(options.limit)
      if (options?.offset)     q = q.range(options.offset, options.offset + (options.limit ?? 20) - 1)

      return q
    },

    getVariant(id: number) {
      return supabase
        .from('product_variants')
        .select('*, products(*), variant_attribute_values(attribute_values(*, attributes(*)))')
        .eq('id', id)
        .single()
    },

    getCurrentPrice(variantId: number, currency = 'USD') {
      return supabase
        .from('prices')
        .select('*')
        .eq('variant_id', variantId)
        .eq('currency', currency)
        .lte('valid_from', new Date().toISOString())
        .or('valid_until.is.null,valid_until.gt.' + new Date().toISOString())
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle()
    },

    listAttributes() {
      return supabase
        .from('attributes')
        .select('*, attribute_values(*)')
        .order('name')
    },
  }
}

// ── Admin / service-role operations ──────────────────────────────────────────

export interface AdminCatalogDb {
  createCategory(input: Database['public']['Tables']['product_categories']['Insert']): SB<ProductCategoryRow>
  updateCategory(id: number, input: Database['public']['Tables']['product_categories']['Update']): SB<ProductCategoryRow>
  createProduct(input: Database['public']['Tables']['products']['Insert']): SB<ProductRow>
  updateProduct(id: number, input: Database['public']['Tables']['products']['Update']): SB<ProductRow>
  listAllProducts(options?: { status?: ProductStatus; limit?: number }): SBL<ProductRow>
  createVariant(input: Database['public']['Tables']['product_variants']['Insert']): SB<ProductVariantRow>
  updateVariant(id: number, input: Database['public']['Tables']['product_variants']['Update']): SB<ProductVariantRow>
  setVariantAttributeValues(variantId: number, attributeValueIds: number[]): SB<null>
  setCurrentPrice(variantId: number, amount: number, currency?: string): SB<PriceRow>
  listPriceHistory(variantId: number, currency?: string): SBL<PriceRow>
  createWarehouse(input: Database['public']['Tables']['warehouses']['Insert']): SB<WarehouseRow>
  recordInventoryTransaction(input: Database['public']['Tables']['inventory_transactions']['Insert']): SB<InventoryTxnRow>
  getStock(variantId: number, warehouseId?: number): SB<number>
  listInventoryTransactions(variantId: number, options?: { warehouseId?: number; limit?: number }): SBL<InventoryTxnRow & { warehouses: { name: string } | null }>
}

export function createAdminCatalogDb(supabase: SupabaseClient<Database>): AdminCatalogDb {
  return {
    createCategory(input: Database['public']['Tables']['product_categories']['Insert']) {
      return supabase.from('product_categories').insert(input).select().single()
    },

    updateCategory(id: number, input: Database['public']['Tables']['product_categories']['Update']) {
      return supabase.from('product_categories').update(input).eq('id', id).select().single()
    },

    createProduct(input: Database['public']['Tables']['products']['Insert']) {
      return supabase.from('products').insert(input).select().single()
    },

    updateProduct(id: number, input: Database['public']['Tables']['products']['Update']) {
      return supabase.from('products').update(input).eq('id', id).select().single()
    },

    listAllProducts(options?: { status?: ProductStatus; limit?: number }) {
      let q = supabase.from('products').select('*').order('created_at', { ascending: false })
      if (options?.status) q = q.eq('status', options.status)
      if (options?.limit)  q = q.limit(options.limit)
      return q
    },

    createVariant(input: Database['public']['Tables']['product_variants']['Insert']) {
      return supabase.from('product_variants').insert(input).select().single()
    },

    updateVariant(id: number, input: Database['public']['Tables']['product_variants']['Update']) {
      return supabase.from('product_variants').update(input).eq('id', id).select().single()
    },

    async setVariantAttributeValues(variantId: number, attributeValueIds: number[]) {
      let deleteQuery = supabase.from('variant_attribute_values').delete().eq('variant_id', variantId)
      if (attributeValueIds.length > 0) {
        deleteQuery = deleteQuery.not('attribute_value_id', 'in', `(${attributeValueIds.join(',')})`)
      }
      const { error } = await deleteQuery
      if (error) return { data: null, error, count: null, status: 400, statusText: error.message } as PostgrestSingleResponse<null>
      if (attributeValueIds.length === 0) return { data: null, error: null, count: 0, status: 200, statusText: 'OK' } as PostgrestSingleResponse<null>
      return supabase
        .from('variant_attribute_values')
        .upsert(attributeValueIds.map(av => ({ variant_id: variantId, attribute_value_id: av })))
        .select()
        .single() as unknown as PostgrestSingleResponse<null>
    },

    setCurrentPrice(variantId: number, amount: number, currency = 'USD') {
      return supabase
        .rpc('set_current_price', { p_variant_id: variantId, p_amount: amount, p_currency: currency })
        .single()
    },

    listPriceHistory(variantId: number, currency = 'USD') {
      return supabase
        .from('prices')
        .select('*')
        .eq('variant_id', variantId)
        .eq('currency', currency)
        .order('valid_from', { ascending: false })
    },

    createWarehouse(input: Database['public']['Tables']['warehouses']['Insert']) {
      return supabase.from('warehouses').insert(input).select().single()
    },

    recordInventoryTransaction(input: Database['public']['Tables']['inventory_transactions']['Insert']) {
      return supabase.from('inventory_transactions').insert(input).select().single()
    },

    getStock(variantId: number, warehouseId?: number) {
      return supabase.rpc('inventory_stock', {
        p_variant_id:   variantId,
        p_warehouse_id: warehouseId ?? undefined,
      })
    },

    listInventoryTransactions(variantId: number, options?: { warehouseId?: number; limit?: number }) {
      let q = supabase
        .from('inventory_transactions')
        .select('*, warehouses(name)')
        .eq('variant_id', variantId)
        .order('created_at', { ascending: false })

      if (options?.warehouseId) q = q.eq('warehouse_id', options.warehouseId)
      if (options?.limit)       q = q.limit(options.limit)

      return q
    },
  }
}
