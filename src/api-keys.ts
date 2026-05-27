import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

export type ApiKeyContext = {
  keyId:     number
  orgId:     number
  accountId: number
  scopes:    string[]
  expiresAt: string
}

const KEY_PREFIX = 'sk_live_'
/** Number of chars from the full key stored for display (prefix + 8 random chars). */
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 8

/** PBKDF2 settings for API key hashing (deterministic for DB lookup). */
const API_KEY_HASH_ITERATIONS = 210_000
const API_KEY_HASH_KEYLEN = 32
const API_KEY_HASH_DIGEST = 'sha256'
const API_KEY_HASH_SALT = process.env.API_KEY_HASH_SALT

export interface GeneratedApiKey {
  /** Full plaintext key — shown ONCE, never stored. */
  key: string
  /** SHA-256 hex digest — stored in the database. */
  hash: string
  /** First {@link DISPLAY_PREFIX_LENGTH} chars — stored for display. */
  prefix: string
}

/** Generates a new API key. The plaintext `key` must be shown to the user immediately and never persisted. */
export function generateApiKey(): GeneratedApiKey {
  const random = crypto.randomBytes(32).toString('base64url')
  const key = `${KEY_PREFIX}${random}`
  return {
    key,
    hash: hashApiKey(key),
    prefix: key.substring(0, DISPLAY_PREFIX_LENGTH),
  }
}

/** Computes a PBKDF2 hex digest of a key string. Used for deterministic lookups. */
export function hashApiKey(key: string): string {
  if (!API_KEY_HASH_SALT) {
    throw new Error('Missing API_KEY_HASH_SALT environment variable')
  }

  return crypto
    .pbkdf2Sync(key, API_KEY_HASH_SALT, API_KEY_HASH_ITERATIONS, API_KEY_HASH_KEYLEN, API_KEY_HASH_DIGEST)
    .toString('hex')
}

export function createApiKeysDb(supabase: SupabaseClient<Database>) {
  const db = supabase

  return {
    // ── Queries ───────────────────────────────────────────────────

    listByOrg(orgId: number) {
      return db
        .from('api_keys')
        .select('id, org_id, account_id, name, key_prefix, scopes, expires_at, last_used_at, revoked_at, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
    },

    getById(id: number) {
      return db
        .from('api_keys')
        .select('id, org_id, account_id, name, key_prefix, scopes, expires_at, last_used_at, revoked_at, created_at')
        .eq('id', id)
        .single()
    },

    // ── Mutations ──────────────────────────────────────────────────

    create(data: {
      org_id: number
      account_id: number
      name: string
      key_prefix: string
      key_hash: string
      scopes: string[]
      expires_at?: string | null
    }) {
      return db
        .from('api_keys')
        .insert(data)
        .select('id, org_id, account_id, name, key_prefix, scopes, expires_at, last_used_at, revoked_at, created_at')
        .single()
    },

    revoke(id: number) {
      return db
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .select('id, revoked_at')
        .single()
    },

    updateScopes(id: number, scopes: string[]) {
      return db
        .from('api_keys')
        .update({ scopes })
        .eq('id', id)
        .select('id, scopes')
        .single()
    },

    // ── API scopes ────────────────────────────────────────────────

    listApiScopes() {
      return db.from('api_scopes').select('*').order('key')
    },
  }
}

export type ApiKeysDb = ReturnType<typeof createApiKeysDb>
