import { describe, expect, it } from 'vitest'
import { createClient, SupabaseClient } from './lib/SupabaseClient'

describe('createClient', () => {
  const URL = 'https://test.supabase.co'
  const KEY = 'test-anon-key'

  it('returns a SupabaseClient instance', () => {
    const client = createClient(URL, KEY)
    expect(client).toBeInstanceOf(SupabaseClient)
  })

  it('throws when supabaseUrl is missing', () => {
    expect(() => createClient('', KEY)).toThrow('supabaseUrl is required.')
  })

  it('throws when supabaseKey is missing', () => {
    expect(() => createClient(URL, '')).toThrow('supabaseKey is required.')
  })
})
