import { inFiscalYear } from './fiscal'
import { classifyDraftDuplicates, reconcileImportedBookings } from './ledger'
import { receiptAvailable, receiptStatus, withReceiptStatus } from './receipt'
import type { StatementRow } from './csv'
import type { ImportDraftRow, YearFile } from './types'

export function receiptAvailableForImport(row: { receiptStatus?: import('./types').ReceiptStatus; receiptAvailable?: boolean }): boolean {
  return receiptAvailable(receiptStatus(row, 'offen'))
}

/**
 * Baut aus eingelesenen Umsätzen (CSV-Datei oder Online-Banking-Abruf) den
 * Import-Entwurf: chronologisch sortieren, bestehende Buchungen abgleichen,
 * Duplikate vorab abwählen. Liefert die Mutation für store.update() plus
 * Hinweise über nachgezogene Zuordnungen.
 */
/**
 * Hängt neu abgerufene Umsätze an den bestehenden Import-Entwurf an, ohne
 * vorhandene Zeilen (und damit bereits erledigte Zuweisungsarbeit) zu
 * verändern. Bereits bekannte Umsätze – im Entwurf oder als importierte
 * Buchung – werden übersprungen. Für den stillen Abruf beim App-Start.
 */
export function appendToDraft(
  file: YearFile,
  parsedRows: readonly StatementRow[],
  sourceName: string,
): { mutate: (f: YearFile) => YearFile; added: number } {
  const known = new Set<string>([
    ...(file.importDraft?.rows.map((r) => r.hash) ?? []),
    ...file.bookings.flatMap((b) => (b.importHash ? [b.importHash] : [])),
  ])
  const fresh = parsedRows
    .filter((r) => !known.has(r.hash))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (fresh.length === 0) return { mutate: (f) => f, added: 0 }
  const dupes = classifyDraftDuplicates(
    file.bookings,
    fresh.map((r) => ({ hash: r.hash, date: r.date, amount: r.amount })),
  )
  const newRows: ImportDraftRow[] = fresh.map((r, i) => withReceiptStatus({
    date: r.date,
    bankText: r.description,
    amount: r.amount,
    hash: r.hash,
    name: r.name,
    description: '',
    selected: !dupes.hard[i] && !dupes.soft[i] && inFiscalYear(file, r.date),
    categoryId: '',
    isUmsatz: false,
  }, 'offen'))
  return {
    added: newRows.length,
    mutate: (f) => {
      const existingHashes = new Set(f.importDraft?.rows.map((r) => r.hash) ?? [])
      const rows = newRows.filter((r) => !existingHashes.has(r.hash))
      if (rows.length === 0) return f
      return {
        ...f,
        importDraft: f.importDraft
          ? { ...f.importDraft, rows: [...f.importDraft.rows, ...rows] }
          : { fileName: sourceName, skipped: 0, rows },
      }
    },
  }
}

export function buildDraft(
  file: YearFile,
  parsedRows: readonly StatementRow[],
  sourceName: string,
  skipped: number,
): { mutate: (f: YearFile) => YearFile; messages: string[] } {
  // Chronologisch aufsteigend sortieren, damit die Beleg-Nr.-Vergabe auch
  // bei gleichem Datum der echten Reihenfolge folgt. Bank-Exporte sind
  // meist "neueste zuerst" – dann spiegelt der umgekehrte Zeilenindex die
  // tatsächliche Buchungsreihenfolge innerhalb eines Tages wider.
  const newestFirst = parsedRows.length > 1 && parsedRows[0].date > parsedRows[parsedRows.length - 1].date
  const sorted = parsedRows
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => a.r.date.localeCompare(b.r.date) || (newestFirst ? b.idx - a.idx : a.idx - b.idx))
  const preview = reconcileImportedBookings(file.bookings, parsedRows)
  // Bereits vorhandene Zeilen (Import ODER manuell erfasst) vorab abwählen.
  const sortedDupes = classifyDraftDuplicates(
    preview.bookings,
    sorted.map(({ r }) => ({ hash: r.hash, date: r.date, amount: r.amount })),
  )
  const rows: ImportDraftRow[] = sorted.map(({ r }, i) => withReceiptStatus({
    date: r.date,
    bankText: r.description,
    amount: r.amount,
    hash: r.hash,
    name: r.name,
    description: '',
    selected: !sortedDupes.hard[i] && !sortedDupes.soft[i] && inFiscalYear(file, r.date),
    // Bewusst leer: Die Kategorie muss je Umsatz aktiv gewählt werden
    categoryId: '',
    isUmsatz: false,
  }, 'offen'))
  const messages: string[] = []
  if (preview.migratedHashCount > 0) {
    messages.push(`${preview.migratedHashCount} bestehende Import-Zuordnungen aktualisiert`)
  }
  if (preview.updatedNameCount > 0) {
    messages.push(`${preview.updatedNameCount} fehlende Namen ergänzt`)
  }
  return {
    mutate: (f) => {
      const reconciled = reconcileImportedBookings(f.bookings, parsedRows)
      return {
        ...f,
        bookings: reconciled.bookings,
        importDraft: { fileName: sourceName, skipped, rows },
      }
    },
    messages,
  }
}

export function subcategorySuggestions(
  bookings: readonly { categoryId: string; subcategory?: string }[],
  categoryId: string,
  draftRows: readonly { categoryId: string; subcategory?: string }[] = [],
): string[] {
  if (!categoryId) return []
  return [
    ...new Set(
      [...bookings, ...draftRows]
        .filter((booking) => booking.categoryId === categoryId)
        .map((booking) => (booking.subcategory ?? '').trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'de'))
}
