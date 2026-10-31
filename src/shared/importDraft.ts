import { inFiscalYear } from './fiscal'
import { checkedRefNo, classifyDraftDuplicates, nextRefNo, nextSeq, reconcileImportedBookings } from './ledger'
import { IMPORT_HASH_VERSION, legacyRowHashes, rowHash } from './csv'
import { receiptAvailable, receiptStatus, withReceiptStatus } from './receipt'
import { makeId } from './defaults'
import { reserveImportReceiptNumbers } from './importReceipts'
import type { StatementRow } from './csv'
import type { ImportDraftRow, ImportDraftSplit, YearFile } from './types'

/**
 * Berechnet ausschließlich die technischen Kennungen offener Entwurfszeilen
 * neu. Alle bereits vorgenommenen Zuweisungen bleiben unverändert erhalten.
 */
export function migrateImportDraftHashes(
  file: YearFile,
): { file: YearFile; migratedCount: number } {
  if (!file.importDraft) return { file, migratedCount: 0 }
  let migratedCount = 0
  const rows = file.importDraft.rows.map((row) => {
    const hash = rowHash(row.date, row.amount, row.bankText)
    const legacyHashes = [
      ...(row.legacyHashes ?? []),
      row.hash,
      ...legacyRowHashes(row.date, row.amount, row.bankText),
    ].filter((candidate, index, all) => candidate !== hash && all.indexOf(candidate) === index)
    if (
      hash === row.hash &&
      legacyHashes.length === (row.legacyHashes?.length ?? 0) &&
      legacyHashes.every((candidate, index) => candidate === row.legacyHashes?.[index])
    ) return row
    migratedCount++
    return { ...row, hash, legacyHashes }
  })
  if (migratedCount === 0) return { file, migratedCount: 0 }
  return {
    file: { ...file, importDraft: { ...file.importDraft, rows } },
    migratedCount,
  }
}

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
    ...(file.importDraft?.rows.flatMap((r) => [r.hash, ...(r.legacyHashes ?? [])]) ?? []),
    ...file.bookings.flatMap((b) => [
      ...(b.importHash ? [b.importHash] : []),
      ...(b.legacyImportHashes ?? []),
    ]),
  ])
  const fresh = parsedRows
    .filter((r) => ![r.hash, ...r.legacyHashes].some((hash) => known.has(hash)))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (fresh.length === 0) return { mutate: (f) => f, added: 0 }
  const newRows: ImportDraftRow[] = fresh.map((r) => withReceiptStatus({
    date: r.date,
    bankText: r.description,
    amount: r.amount,
    hash: r.hash,
    legacyHashes: r.legacyHashes,
    name: r.name,
    description: '',
    selected: false,
    categoryId: '',
    isUmsatz: false,
  }, 'offen'))
  return {
    added: newRows.length,
    mutate: (f) => {
      const existingHashes = new Set(
        f.importDraft?.rows.flatMap((r) => [r.hash, ...(r.legacyHashes ?? [])]) ?? [],
      )
      const rows = newRows.filter(
        (r) => ![r.hash, ...(r.legacyHashes ?? [])].some((hash) => existingHashes.has(hash)),
      )
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
  const rows: ImportDraftRow[] = sorted.map(({ r }) => withReceiptStatus({
    date: r.date,
    bankText: r.description,
    amount: r.amount,
    hash: r.hash,
    legacyHashes: r.legacyHashes,
    name: r.name,
    description: '',
    selected: false,
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

/** Auswahl ist beim erneuten Öffnen leer; die Zuweisungen bleiben erhalten. */
export function clearImportSelection(file: YearFile): YearFile {
  const draft = file.importDraft
  if (!draft?.rows.some((row) => row.selected)) return file
  return {
    ...file,
    importDraft: { ...draft, rows: draft.rows.map((row) => row.selected ? { ...row, selected: false } : row) },
  }
}

export function bookingParts(row: ImportDraftRow): ImportDraftSplit[] {
  if (row.splits?.length) return row.splits
  return [{
    id: row.hash, description: row.description, categoryId: row.categoryId,
    amount: Math.abs(row.amount), isUmsatz: row.isUmsatz, receiptRef: row.receiptRef,
  }]
}

export function sumSplits(splits: ImportDraftSplit[] | undefined): number {
  return splits?.reduce((sum, split) => sum + split.amount, 0) ?? 0
}

export function rowIsImportable(row: ImportDraftRow): boolean {
  const parts = bookingParts(row)
  if (!(row.name ?? '').trim()) return false
  if (parts.some((part) => !part.description.trim() || !part.categoryId || part.amount <= 0)) return false
  return !row.splits?.length || sumSplits(row.splits) === Math.abs(row.amount)
}

/** Prüft den aktuellen Entwurf erneut und übernimmt reservierte Nummern unverändert. */
export function importSelectedRows(file: YearFile): YearFile {
  if (!file.importDraft) return file
  const prepared = reserveImportReceiptNumbers(file)
  const draft = prepared.importDraft!
  const dupes = classifyDraftDuplicates(prepared.bookings, draft.rows)
  const selected = new Set(draft.rows.flatMap((row, i) =>
    row.selected && rowIsImportable(row) && inFiscalYear(prepared, row.date) && !dupes.hard[i] && !dupes.repeated[i] ? [i] : [],
  ))
  if (selected.size === 0) return prepared
  let seq = nextSeq(prepared)
  const counters = new Map<string, number>()
  const takeRefNo = (part: ImportDraftSplit) => {
    if (part.receiptRef?.categoryId === part.categoryId) return checkedRefNo(part.receiptRef.refNo)
    const refNo = checkedRefNo(counters.get(part.categoryId) ?? nextRefNo(prepared, part.categoryId))
    counters.set(part.categoryId, refNo + 1)
    return refNo
  }
  const added = draft.rows.filter((_, i) => selected.has(i)).flatMap((row) =>
    bookingParts(row).map((part) => ({
      id: makeId(), seq: seq++, refNo: takeRefNo(part), date: row.date,
      categoryId: part.categoryId, name: row.name.trim(), description: part.description.trim(),
      subcategory: row.splits?.length ? undefined : (row.subcategory ?? '').trim() || undefined,
      type: row.amount < 0 ? ('ausgabe' as const) : ('einnahme' as const),
      amount: part.amount, isUmsatz: part.isUmsatz,
      ...withReceiptStatus({}, receiptStatus(row, 'offen')),
      nonUmsatzAmount: 0, note: row.bankText, source: 'import' as const,
      importHash: row.hash, legacyImportHashes: row.legacyHashes, importHashVersion: IMPORT_HASH_VERSION,
    })),
  )
  const remaining = draft.rows.filter((_, i) => !selected.has(i))
  return reserveImportReceiptNumbers({
    ...prepared, bookings: [...prepared.bookings, ...added],
    importDraft: remaining.length > 0 ? { ...draft, rows: remaining } : null,
  })
}
