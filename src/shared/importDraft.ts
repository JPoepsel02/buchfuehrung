import { inFiscalYear } from './fiscal'
import { classifyDraftDuplicates, reconcileImportedBookings } from './ledger'
import type { StatementRow } from './csv'
import type { ImportDraftRow, YearFile } from './types'

export function receiptAvailableForImport(row: { receiptAvailable?: boolean }): boolean {
  return row.receiptAvailable === true
}

/**
 * Baut aus eingelesenen Umsätzen (CSV-Datei oder Online-Banking-Abruf) den
 * Import-Entwurf: chronologisch sortieren, bestehende Buchungen abgleichen,
 * Duplikate vorab abwählen. Liefert die Mutation für store.update() plus
 * Hinweise über nachgezogene Zuordnungen.
 */
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
  const rows: ImportDraftRow[] = sorted.map(({ r }, i) => ({
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
    receiptAvailable: false,
  }))
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
): string[] {
  if (!categoryId) return []
  return [
    ...new Set(
      bookings
        .filter((booking) => booking.categoryId === categoryId)
        .map((booking) => (booking.subcategory ?? '').trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'de'))
}
