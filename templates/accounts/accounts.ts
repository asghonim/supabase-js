import type { Account, AccountProfile } from './accounts.types'

export function createAccountLookup(accounts: Account[]): Map<string, Account> {
  return new Map(accounts.map((account) => [account.id, account]))
}

export function normalizeAccountProfile(account: AccountProfile): AccountProfile {
  return {
    ...account,
    displayName: account.displayName?.trim() ?? null,
    avatarUrl: account.avatarUrl?.trim() ?? null,
  }
}
