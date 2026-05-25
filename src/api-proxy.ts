import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdminClient } from './admin'
import { hashApiKey, ApiKeyContext, createApiKeysDb } from './api-keys'

/** Header name used to forward verified API key context to route handlers. */
export const API_KEY_CONTEXT_HEADER = 'x-api-key-context'

/**
 * Update session and enforce route protection.
 *
 * When the `x-api-key` header is present the request is authenticated via
 * the API key instead of the session cookie:
 *   - The key hash is looked up in the database (admin client, bypasses RLS).
 *   - On success the verified identity is forwarded to the route handler via
 *     the `x-api-key-context` request header.
 *   - On failure a 401 JSON response is returned immediately.
 *
 * The `x-api-key-context` header is always stripped from incoming requests
 * before being re-set (or not) by this middleware, preventing clients from
 * spoofing a verified identity.
 */
export async function updateSession(request: NextRequest) {
  // ── Strip incoming context header to prevent spoofing ───────────────────────
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete(API_KEY_CONTEXT_HEADER)

  const rawApiKey = request.headers.get('x-api-key')

  if (rawApiKey) {
    const keyHash = hashApiKey(rawApiKey)
    const admin = getSupabaseAdminClient()
    const apiKeysDb = createApiKeysDb(admin)
    const { data, error } = await apiKeysDb.verify(keyHash)

    if (error) {
      console.error('[proxy] api key verify error', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const row = data?.[0]
    if (!row) {
      return NextResponse.json({ error: 'Invalid or expired API key' }, { status: 401 })
    }

    const ctx: ApiKeyContext = {
      keyId:     row.id,
      orgId:     row.org_id,
      accountId: row.account_id,
      scopes:    row.scopes,
      expiresAt: row.expires_at,
    }
    requestHeaders.set(API_KEY_CONTEXT_HEADER, JSON.stringify(ctx));

    return NextResponse.next({ request: { headers: requestHeaders } })
  }
}
