import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

export type WalletRow         = Database['public']['Tables']['wallets']['Row']
export type WalletHoldRow     = Database['public']['Tables']['wallet_holds']['Row']
export type LedgerAccountRow  = Database['public']['Tables']['ledger_accounts']['Row']
export type JournalEntryRow   = Database['public']['Tables']['journal_entries']['Row']
export type JournalLineRow    = Database['public']['Tables']['journal_lines']['Row']
export type WalletOwnerType   = Database['public']['Enums']['wallet_owner_type']
export type WalletHoldStatus  = Database['public']['Enums']['wallet_hold_status']
export type LedgerAccountType = Database['public']['Enums']['ledger_account_type']

// ── User-facing (authenticated, RLS-scoped) ───────────────────────────────────

export function createWalletsDb(supabase: SupabaseClient<Database>) {
  return {
    getWallet(id: number) {
      return supabase
        .from('wallets')
        .select('*')
        .eq('id', id)
        .single()
    },

    getWalletByOwner(ownerType: WalletOwnerType, ownerId: number, currency = 'USD') {
      return supabase
        .from('wallets')
        .select('*')
        .eq('owner_type', ownerType)
        .eq('owner_id', ownerId)
        .eq('currency', currency)
        .maybeSingle()
    },

    // Returns journal lines (with their parent entry) for a wallet,
    // ordered newest-first. Uses ledger_account_id from the wallet row.
    async listJournalLines(
      walletId: number,
      options?: { limit?: number; before?: string },
    ) {
      const { data: wallet, error: wErr } = await supabase
        .from('wallets')
        .select('ledger_account_id')
        .eq('id', walletId)
        .single()

      if (wErr || !wallet) return { data: null, error: wErr }

      let query = supabase
        .from('journal_lines')
        .select('*, journal_entries(*)')
        .eq('ledger_account_id', wallet.ledger_account_id)
        .order('created_at', { ascending: false })

      if (options?.before) query = query.lt('created_at', options.before)
      if (options?.limit)  query = query.limit(options.limit)

      return query
    },

    listActiveHolds(walletId: number) {
      return supabase
        .from('wallet_holds')
        .select('*')
        .eq('wallet_id', walletId)
        .eq('status', 'active' satisfies WalletHoldStatus)
        .order('created_at', { ascending: false })
    },

    listSystemLedgerAccounts(currency?: string) {
      let query = supabase
        .from('ledger_accounts')
        .select('*')
        .eq('is_active', true)
        .neq('account_type', 'wallet' satisfies LedgerAccountType)
        .order('name')

      if (currency) query = query.eq('currency', currency)

      return query
    },
  }
}

export type WalletsDb = ReturnType<typeof createWalletsDb>

// ── Admin / service-role operations ──────────────────────────────────────────

export function createAdminWalletsDb(supabase: SupabaseClient<Database>) {
  return {
    // ── Wallet provisioning ───────────────────────────────────────────

    async createWallet(
      ownerType: WalletOwnerType,
      ownerId: number,
      currency = 'USD',
      name?: string,
    ): Promise<{ data: WalletRow | null; error: unknown }> {
      const { data: walletId, error } = await supabase.rpc('wallet_create', {
        p_owner_type: ownerType,
        p_owner_id:   ownerId,
        p_currency:   currency,
        p_name:       name,
      })

      if (error || walletId == null) return { data: null, error }

      return supabase.from('wallets').select('*').eq('id', walletId).single()
    },

    getWallet(id: number) {
      return supabase.from('wallets').select('*').eq('id', id).single()
    },

    getWalletByOwner(ownerType: WalletOwnerType, ownerId: number, currency = 'USD') {
      return supabase
        .from('wallets')
        .select('*')
        .eq('owner_type', ownerType)
        .eq('owner_id', ownerId)
        .eq('currency', currency)
        .maybeSingle()
    },

    // ── Ledger accounts ───────────────────────────────────────────────

    getLedgerAccount(id: number) {
      return supabase.from('ledger_accounts').select('*').eq('id', id).single()
    },

    getLedgerAccountByName(name: string, currency = 'USD') {
      return supabase
        .from('ledger_accounts')
        .select('*')
        .eq('name', name)
        .eq('currency', currency)
        .maybeSingle()
    },

    listLedgerAccounts(options?: { currency?: string; type?: LedgerAccountType }) {
      let query = supabase
        .from('ledger_accounts')
        .select('*')
        .eq('is_active', true)
        .order('account_type')

      if (options?.currency) query = query.eq('currency', options.currency)
      if (options?.type)     query = query.eq('account_type', options.type)

      return query
    },

    // ── Money movement ────────────────────────────────────────────────

    deposit(
      walletId: number,
      amount: number,
      sourceAccountId: number,
      description: string,
      options?: { idempotencyKey?: string; referenceType?: string; referenceId?: number },
    ) {
      return supabase.rpc('wallet_deposit', {
        p_wallet_id:         walletId,
        p_amount:            amount,
        p_source_account_id: sourceAccountId,
        p_description:       description,
        p_idempotency_key:   options?.idempotencyKey,
        p_reference_type:    options?.referenceType,
        p_reference_id:      options?.referenceId,
      })
    },

    spend(
      walletId: number,
      amount: number,
      destAccountId: number,
      description: string,
      options?: { idempotencyKey?: string; referenceType?: string; referenceId?: number },
    ) {
      return supabase.rpc('wallet_spend', {
        p_wallet_id:       walletId,
        p_amount:          amount,
        p_dest_account_id: destAccountId,
        p_description:     description,
        p_idempotency_key: options?.idempotencyKey,
        p_reference_type:  options?.referenceType,
        p_reference_id:    options?.referenceId,
      })
    },

    transfer(
      fromWalletId: number,
      toWalletId: number,
      amount: number,
      description: string,
      options?: { idempotencyKey?: string; referenceType?: string; referenceId?: number },
    ) {
      return supabase.rpc('wallet_transfer', {
        p_from_wallet_id:  fromWalletId,
        p_to_wallet_id:    toWalletId,
        p_amount:          amount,
        p_description:     description,
        p_idempotency_key: options?.idempotencyKey,
        p_reference_type:  options?.referenceType,
        p_reference_id:    options?.referenceId,
      })
    },

    availableBalance(walletId: number) {
      return supabase.rpc('wallet_available_balance', { p_wallet_id: walletId })
    },

    // ── Holds ─────────────────────────────────────────────────────────

    createHold(
      walletId: number,
      amount: number,
      description: string,
      options?: {
        expiresAt?: string
        referenceType?: string
        referenceId?: number
        idempotencyKey?: string
      },
    ) {
      return supabase
        .from('wallet_holds')
        .insert({
          wallet_id:       walletId,
          amount,
          description,
          expires_at:      options?.expiresAt,
          reference_type:  options?.referenceType,
          reference_id:    options?.referenceId,
          idempotency_key: options?.idempotencyKey,
        })
        .select()
        .single()
    },

    updateHoldStatus(holdId: number, status: Exclude<WalletHoldStatus, 'active'>) {
      return supabase
        .from('wallet_holds')
        .update({ status })
        .eq('id', holdId)
        .eq('status', 'active' satisfies WalletHoldStatus)
        .select()
        .maybeSingle()
    },

    // ── History ───────────────────────────────────────────────────────

    async listJournalLines(walletId: number, options?: { limit?: number; before?: string }) {
      const { data: wallet, error: wErr } = await supabase
        .from('wallets')
        .select('ledger_account_id')
        .eq('id', walletId)
        .single()

      if (wErr || !wallet) return { data: null, error: wErr }

      let query = supabase
        .from('journal_lines')
        .select('*, journal_entries(*)')
        .eq('ledger_account_id', wallet.ledger_account_id)
        .order('created_at', { ascending: false })

      if (options?.before) query = query.lt('created_at', options.before)
      if (options?.limit)  query = query.limit(options.limit)

      return query
    },

    listHolds(walletId: number, options?: { status?: WalletHoldStatus; limit?: number }) {
      let query = supabase
        .from('wallet_holds')
        .select('*')
        .eq('wallet_id', walletId)
        .order('created_at', { ascending: false })

      if (options?.status) query = query.eq('status', options.status)
      if (options?.limit)  query = query.limit(options.limit)

      return query
    },
  }
}

export type AdminWalletsDb = ReturnType<typeof createAdminWalletsDb>
