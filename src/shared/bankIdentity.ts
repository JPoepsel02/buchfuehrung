import type { BankAccountConfig } from './types'

export function bankConnectionIdentity(account: Pick<BankAccountConfig, 'fintsUrl' | 'blz' | 'userId'>): string {
  return JSON.stringify([new URL(account.fintsUrl).href, account.blz, account.userId])
}

export function sameBankEndpoint(account: Pick<BankAccountConfig, 'fintsUrl' | 'blz'>, url: unknown, blz: unknown): boolean {
  if (typeof url !== 'string' || typeof blz !== 'string') return false
  try { return new URL(url).href === new URL(account.fintsUrl).href && blz === account.blz }
  catch { return false }
}

export function sameBankAccount(current: BankAccountConfig, imported: BankAccountConfig): boolean {
  return (current.konto ?? 'haupt') === (imported.konto ?? 'haupt')
    && sameBankEndpoint(current, imported.fintsUrl, imported.blz)
    && current.userId === imported.userId
    && current.accountNumber === imported.accountNumber
    && current.iban === imported.iban
}
