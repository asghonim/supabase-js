import type { SupabaseClientOptions } from '../types'

export class SupabaseClient {
  protected supabaseUrl: string
  protected supabaseKey: string

  constructor(supabaseUrl: string, supabaseKey: string) {
    if (!supabaseUrl) throw new Error('supabaseUrl is required.')
    if (!supabaseKey) throw new Error('supabaseKey is required.')

    this.supabaseUrl = supabaseUrl
    this.supabaseKey = supabaseKey
  }
}

/**
 * Creates a new Supabase client.
 * @param supabaseUrl - The URL of the Supabase project.
 * @param supabaseKey - The anon/public key of the Supabase project.
 */
export function createClient(
  supabaseUrl: string,
  supabaseKey: string,
  _options?: Partial<SupabaseClientOptions>
): SupabaseClient {
  return new SupabaseClient(supabaseUrl, supabaseKey)
}
