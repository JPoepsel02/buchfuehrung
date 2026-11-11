import type { Backup } from './backup'
import type { AppSettings, YearFile } from './types'
import type { SnapshotPayload } from './snapshot'
import { bookingKey } from './organization'
import type { OrganizationConfig } from './organization'
import { makeId } from './defaults'

const scope = (konto: string, year: number) => JSON.stringify([konto, year])
const ruleKey = (rule: { konto: string; categoryId: string }) => JSON.stringify([rule.konto, rule.categoryId])

function assignmentScope(key: string): string {
  try {
    const value = JSON.parse(key)
    return Array.isArray(value) ? scope(value[0], value[1]) : ''
  } catch { return '' }
}

function appendWithUniqueIds<T extends { id: string }>(existing: readonly T[], imported: readonly T[]): T[] {
  const used = new Set(existing.map((entry) => entry.id))
  return [...existing, ...imported.map((entry, index) => {
    let id = entry.id, suffix = 0
    while (used.has(id)) id = `restored-${index}-${++suffix}`
    used.add(id)
    return id === entry.id ? entry : { ...entry, id }
  })]
}

function restoreOrganization(backup: Backup, current?: OrganizationConfig): OrganizationConfig | undefined {
  const imported = backup.settings?.organization
  const replaced = new Set(backup.years.map((year) => scope(year.konto ?? 'haupt', year.year)))
  const categories = new Set(backup.years.flatMap((year) => year.categories.map((category) => ruleKey({ konto: year.konto ?? 'haupt', categoryId: category.id }))))
  const touches = (reference: { konto: string; year: number }) => replaced.has(scope(reference.konto, reference.year))
  const keptAssignments = Object.fromEntries(Object.entries(current?.assignments ?? {}).filter(([key]) => !replaced.has(assignmentScope(key))))
  if (!imported) return current ? { ...current, assignments: keptAssignments,
    transfers: current.transfers.filter((transfer) => !touches(transfer.from) && !touches(transfer.to)) } : undefined
  const importedAssignments = Object.fromEntries(Object.entries(imported.assignments).filter(([key]) => replaced.has(assignmentScope(key))))
  const importedTransfers = imported.transfers.filter((transfer) => touches(transfer.from) || touches(transfer.to))
  const claimed = new Set([...Object.keys(importedAssignments), ...importedTransfers.flatMap((transfer) => [bookingKey(transfer.from), bookingKey(transfer.to)])])
  const currentTransfers = (current?.transfers ?? []).filter((transfer) => {
    if (touches(transfer.from) && touches(transfer.to)) return false
    return !(touches(transfer.from) && claimed.has(bookingKey(transfer.from))) && !(touches(transfer.to) && claimed.has(bookingKey(transfer.to)))
  })
  return {
    ...imported,
    rules: appendWithUniqueIds((current?.rules ?? []).filter((rule) => !categories.has(ruleKey(rule))),
      imported.rules.filter((rule) => categories.has(ruleKey(rule)))),
    assignments: { ...keptAssignments, ...importedAssignments },
    transfers: appendWithUniqueIds(currentTransfers, importedTransfers),
  }
}

function reservedSequence(settings: AppSettings, files: readonly YearFile[]): number {
  const organization = settings.organization
  const assignmentKontos = Object.keys(organization?.assignments ?? {}).flatMap((key) => {
    try { const reference = JSON.parse(key); return Array.isArray(reference) ? [reference[0]] : [] } catch { return [] }
  })
  const identifiers = [
    ...files.map((file) => file.konto ?? 'haupt'), ...Object.keys(settings.accountNumbers ?? {}),
    ...(settings.bankAccounts ?? []).map((account) => account.konto ?? 'haupt'),
    ...(organization?.rules ?? []).map((rule) => rule.konto), ...assignmentKontos,
    ...(organization?.transfers ?? []).flatMap((transfer) => [transfer.from.konto, transfer.to.konto]),
  ]
  return identifiers.reduce((highest, id) => {
    const number = id === 'haupt' ? 1 : id === 'zweit' ? 2 : typeof id === 'string' && /^k\d+$/.test(id) ? Number(id.slice(1)) : 1
    return Math.max(highest, Number.isSafeInteger(number) ? number : Number.MAX_SAFE_INTEGER)
  }, Math.max(1, settings.kontoSequence ?? 1))
}

/** Only the included account-years are replaced; references outside them survive. */
export function buildRestoreSnapshot(backup: Backup, current: AppSettings, currentYears: readonly YearFile[] = []): SnapshotPayload {
  const imported = backup.settings
  const kontos = new Set(backup.years.map((year) => year.konto ?? 'haupt'))
  const accountNumbers = imported?.accountNumbers === undefined ? current.accountNumbers : {
    ...Object.fromEntries(Object.entries(current.accountNumbers ?? {}).filter(([konto]) => !kontos.has(konto))),
    ...Object.fromEntries(Object.entries(imported.accountNumbers).filter(([konto]) => kontos.has(konto))),
  }
  const bankAccounts = imported?.bankAccounts === undefined ? current.bankAccounts : appendWithUniqueIds(
    (current.bankAccounts ?? []).filter((account) => !kontos.has(account.konto ?? 'haupt')),
    imported.bankAccounts.filter((account) => kontos.has(account.konto ?? 'haupt')).map((account) => ({ ...account, id: `restored-${makeId()}` })),
  )
  return {
    years: backup.years.map((year) => ({ konto: year.konto ?? 'haupt', year: year.year, data: year })),
    settings: { ...current, ...imported, accountNumbers, bankAccounts,
      kontoSequence: Math.max(reservedSequence(current, currentYears), reservedSequence(imported ?? {}, backup.years)),
      organization: restoreOrganization(backup, current.organization), cloudBackupEnabled: false, cloudBackupDir: null },
  }
}
