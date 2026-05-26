import { NextRequest } from "next/server"
import { API_KEY_CONTEXT_HEADER, updateSession as updateSessionFromApi } from "./api-proxy"
import { updateSession as updateSessionFromCookies } from "./cookies-proxy";

export async function updateSession(request: NextRequest) {
  // ── Strip incoming context header to prevent spoofing ───────────────────────
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete(API_KEY_CONTEXT_HEADER)

  const rawApiKey = request.headers.get('x-api-key')

  if (rawApiKey) {
    const response = await updateSessionFromApi(request);
    if (!response) {
      return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 })
    }
    if (response instanceof Error) {
      return new Response(JSON.stringify({ error: response.message }), { status: 500 })
    }
    return response;
  }
  return await updateSessionFromCookies(request);
}