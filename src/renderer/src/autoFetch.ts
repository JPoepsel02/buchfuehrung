import { api } from './api'
import { legacyRowHashes, rowHash } from '@shared/csv'
import { appendToDraft } from '@shared/importDraft'
import { formatDate } from '@shared/money'
import type { StatementRow } from '@shared/csv'
import type { BankFetchResult, BankFetchedRow } from '@shared/bank'
import type { BankAccountConfig, KontoId, YearFile } from '@shared/types'

const AUTO_FETCH_DAYS = 30

/**
 * Stiller Umsatzabruf beim App-Start: für jede eingerichtete Bankverbindung
 * mit gespeicherter PIN werden die letzten Wochen abgerufen und NEUE Umsätze
 * an den Import-Entwurf des jeweiligen Kassenbuchs angehängt – bestehende
 * Entwurfszeilen und Zuweisungen bleiben unangetastet.
 *
 * Alles, was eine Interaktion bräuchte (PIN-Eingabe, TAN-Freigabe, erste
 * Kontoauswahl), wird kommentarlos übersprungen – der Start darf nie durch
 * einen Bank-Dialog blockiert werden.
 */
export async function runStartupBankFetch(opts: {
  accounts: readonly BankAccountConfig[]
  /** Aktives Buch: Änderungen laufen über store.update, damit der State stimmt */
  activeKonto: KontoId
  applyToActive: (mutate: (f: YearFile) => YearFile) => void
}): Promise<string | null> {
  const results: string[] = []
  for (const account of opts.accounts) {
    if (!account.accountNumber) continue
    if (!(await api.bankPinExists(account.id))) continue
    const added = await fetchAccount(account, opts).catch(() => 0)
    if (added > 0) results.push(`${account.label}: ${added} neue Umsätze`)
  }
  if (results.length === 0) return null
  return `${results.join(' · ')} – unter Umsätze importieren zuweisen.`
}

async function fetchAccount(
  account: BankAccountConfig,
  opts: { activeKonto: KontoId; applyToActive: (mutate: (f: YearFile) => YearFile) => void },
): Promise<number> {
  const from = new Date()
  from.setDate(from.getDate() - AUTO_FETCH_DAYS)
  const result = (await api.bankFetch(account, { from: from.toISOString().slice(0, 10) })) as BankFetchResult
  if (result.status === 'tan' || result.status === 'tanPending') {
    void api.bankCancel(result.sessionId)
    return 0
  }
  if (result.status !== 'ok' || result.rows.length === 0) return 0

  const statementRows: StatementRow[] = result.rows.map((r: BankFetchedRow) => ({
    ...r,
    hash: rowHash(r.date, r.amount, r.description),
    legacyHashes: legacyRowHashes(r.date, r.amount, r.description),
  }))
  const sourceName = `${account.label} · Abruf vom ${formatDate(new Date().toISOString().slice(0, 10))}`
  const konto = account.konto ?? 'haupt'

  if (konto === opts.activeKonto) {
    // Aktives Buch: über den Store, sonst würde der geladene State überschrieben
    let added = 0
    opts.applyToActive((f) => {
      // Falls der Nutzer während des Abrufs das Buch gewechselt hat: nichts anfassen
      if ((f.konto ?? 'haupt') !== konto) return f
      const merge = appendToDraft(f, statementRows, sourceName)
      added = merge.added
      return merge.mutate(f)
    })
    return added
  }

  // Nicht aktives Buch: Jahresdatei direkt laden, mergen, speichern
  const years = await api.listYears(konto)
  if (years.length === 0) return 0
  const file = (await api.loadYear(konto, years[0])) as YearFile | null
  if (!file) return 0
  const merge = appendToDraft(file, statementRows, sourceName)
  if (merge.added === 0) return 0
  await api.saveYear(konto, years[0], merge.mutate(file))
  return merge.added
}
