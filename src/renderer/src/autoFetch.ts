import { api } from './api'
import { legacyRowHashes, rowHash } from '@shared/csv'
import { appendToDraft } from '@shared/importDraft'
import { formatDate } from '@shared/money'
import type { StatementRow } from '@shared/csv'
import type { BankFetchResult, BankFetchedRow } from '@shared/bank'
import type { BankAccountConfig, KontoId, YearFile } from '@shared/types'

const AUTO_FETCH_DAYS = 30

interface StartupFetchOptions {
  accounts: readonly BankAccountConfig[]
  applyToAccount: (konto: KontoId, year: number, mutate: (file: YearFile) => YearFile, bankAccountId?: string) => Promise<void>
  onError?: (accountLabel: string, error: Error) => void
}

export async function runStartupBankFetch(opts: StartupFetchOptions): Promise<string | null> {
  const results: string[] = []
  for (const account of opts.accounts) {
    if (!account.accountNumber) continue
    try {
      const years = await api.listYears(account.konto ?? 'haupt')
      if (years.length === 0) continue
      if (!(await api.bankPinExists(account.id))) continue
      const added = await fetchAccount(account, Math.max(...years), opts.applyToAccount)
      if (added > 0) results.push(`${account.label}: ${added} neue Umsätze`)
    } catch (failure) {
      opts.onError?.(account.label, failure instanceof Error ? failure : new Error('Bankabruf fehlgeschlagen.'))
    }
  }
  return results.length ? `${results.join(' · ')} – unter Umsätze importieren zuweisen.` : null
}

async function fetchAccount(
  account: BankAccountConfig,
  year: number,
  applyToAccount: StartupFetchOptions['applyToAccount'],
): Promise<number> {
  const from = new Date()
  from.setDate(from.getDate() - AUTO_FETCH_DAYS)
  const result = (await api.bankFetch(account, { from: from.toISOString().slice(0, 10) })) as BankFetchResult
  if (result.status === 'tan' || result.status === 'tanPending') {
    await api.bankCancel(result.sessionId)
    return 0
  }
  if (result.status === 'error') throw new Error(result.message)
  if (result.status !== 'ok' || result.rows.length === 0) return 0

  const statementRows: StatementRow[] = result.rows.map((row: BankFetchedRow) => ({
    ...row,
    hash: rowHash(row.date, row.amount, row.description),
    legacyHashes: legacyRowHashes(row.date, row.amount, row.description),
  }))
  const sourceName = `${account.label} · Abruf vom ${formatDate(new Date().toISOString().slice(0, 10))}`
  const konto = account.konto ?? 'haupt'
  let added = 0
  await applyToAccount(konto, year, (current) => {
    const merge = appendToDraft(current, statementRows, sourceName)
    added = merge.added
    return merge.mutate(current)
  }, account.id)
  return added
}
