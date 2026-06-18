import { formatEur } from './money'
import type {
  Booking,
  CategoryGroup,
  ChronoRow,
  ComputedBooking,
  EventRow,
  MonthSummary,
  YearFile,
  YearTotals,
} from './types'

/**
 * Kernlogik des Kassenberichts – Nachbildung der Excel-Funktionen:
 * Beleg-Nr.-Vergabe, Vorzeichenbeträge, Umsatzberechnung, chronologische
 * Sortierung mit laufendem Saldo, Gruppierung nach Veranstaltung sowie
 * Monats- und Jahresauswertung.
 */

function signedAmount(b: Booking): number {
  return b.type === 'ausgabe' ? -Math.abs(b.amount) : Math.abs(b.amount)
}

function umsatzAmount(b: Booking): number {
  if (!b.isUmsatz) return 0
  const net = Math.max(0, Math.abs(b.amount) - Math.max(0, b.nonUmsatzAmount))
  return b.type === 'ausgabe' ? -net : net
}

/**
 * Berechnet Beleg-Nr. und alle abgeleiteten Beträge. Die Nummern werden je
 * Kategorie chronologisch vergeben (erster Umsatz des Jahres = kleinste
 * Nummer) – unabhängig davon, in welcher Reihenfolge erfasst oder
 * importiert wurde. Bei gleichem Datum zählt die Erfassungsreihenfolge.
 */
export function computeBookings(file: YearFile): ComputedBooking[] {
  const byId = new Map(file.categories.map((c) => [c.id, c]))
  const counters = new Map<string, number>()
  return [...file.bookings]
    .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq)
    .map((b) => {
      const cat = byId.get(b.categoryId)
      const count = (counters.get(b.categoryId) ?? 0) + 1
      counters.set(b.categoryId, count)
      return {
        ...b,
        ref: `${cat?.code ?? '?'}${count}`,
        categoryName: cat?.name ?? 'Unbekannt',
        signedAmount: signedAmount(b),
        umsatzAmount: umsatzAmount(b),
      }
    })
}

/** Chronologisch: nach Datum, bei gleichem Datum nach Erfassungsreihenfolge. */
export function chronological(file: YearFile): ChronoRow[] {
  const rows = computeBookings(file).sort(
    (a, b) => a.date.localeCompare(b.date) || a.seq - b.seq,
  )
  let balance = file.openingBalance
  return rows.map((r) => {
    balance += r.signedAmount
    return { ...r, runningBalance: balance }
  })
}

/**
 * Sortierung Veranstaltungen: Gruppen in Kategorien-Reihenfolge, innerhalb
 * der Gruppe chronologisch, mit Zwischensummen je Veranstaltung.
 */
export function byCategory(file: YearFile): CategoryGroup[] {
  const rows = computeBookings(file)
  const groups: CategoryGroup[] = []
  const sortedCats = [...file.categories].sort((a, b) => a.sortOrder - b.sortOrder)
  for (const category of sortedCats) {
    const catRows = rows
      .filter((r) => r.categoryId === category.id)
      .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq)
    if (catRows.length === 0) continue
    const einnahmen = sum(catRows.filter((r) => r.type === 'einnahme').map((r) => r.amount))
    const ausgaben = sum(catRows.filter((r) => r.type === 'ausgabe').map((r) => r.amount))
    groups.push({
      category,
      rows: catRows,
      einnahmen,
      ausgaben,
      saldo: einnahmen - ausgaben,
      umsatz: sum(catRows.map((r) => r.umsatzAmount)),
    })
  }
  return groups
}

/**
 * Monatsauswertung in Wirtschaftsjahr-Reihenfolge: beginnt beim
 * fiscalStartMonth (Standard Januar) und läuft 12 Monate, bei
 * abweichenden Wirtschaftsjahren ins Folgejahr hinein.
 */
export function monthSummaries(file: YearFile): MonthSummary[] {
  const start = file.fiscalStartMonth && file.fiscalStartMonth >= 1 && file.fiscalStartMonth <= 12 ? file.fiscalStartMonth : 1
  const chrono = chronological(file)
  const result: MonthSummary[] = []
  let balance = file.openingBalance
  for (let i = 0; i < 12; i++) {
    const month = ((start - 1 + i) % 12) + 1
    const year = start > 1 && month < start ? file.year + 1 : file.year
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const rows = chrono.filter((r) => r.date.startsWith(prefix))
    const einnahmen = sum(rows.filter((r) => r.type === 'einnahme').map((r) => r.amount))
    const ausgaben = sum(rows.filter((r) => r.type === 'ausgabe').map((r) => r.amount))
    balance += einnahmen - ausgaben
    result.push({
      month,
      year,
      einnahmen,
      ausgaben,
      saldo: einnahmen - ausgaben,
      umsatz: sum(rows.map((r) => r.umsatzAmount)),
      balanceEnd: balance,
      count: rows.length,
    })
  }
  return result
}

export function yearTotals(file: YearFile): YearTotals {
  const rows = computeBookings(file)
  const einnahmen = sum(rows.filter((r) => r.type === 'einnahme').map((r) => r.amount))
  const ausgaben = sum(rows.filter((r) => r.type === 'ausgabe').map((r) => r.amount))
  return {
    einnahmen,
    ausgaben,
    saldo: einnahmen - ausgaben,
    umsatz: sum(rows.map((r) => r.umsatzAmount)),
    closingBalance: file.openingBalance + einnahmen - ausgaben,
    count: rows.length,
  }
}

/**
 * Anzeigezeilen einer Veranstaltungs-Gruppe: Buchungen ohne Unterkategorie
 * bleiben einzelne Zeilen, Buchungen mit gleicher Unterkategorie werden zu
 * einer Summenzeile zusammengefasst (z. B. "Karnevalsbeiträge" = Summe
 * aller Beitrags-Buchungen). Sortiert nach dem (ersten) Buchungsdatum.
 */
export function eventRows(group: CategoryGroup): EventRow[] {
  const singles: EventRow[] = group.rows
    .filter((r) => !(r.subcategory ?? '').trim())
    .map((r) => ({
      kind: 'einzeln',
      date: r.date,
      refs: r.ref,
      label: r.description,
      name: (r.name ?? '').trim(),
      ausgaben: r.type === 'ausgabe' ? r.amount : 0,
      einnahmen: r.type === 'einnahme' ? r.amount : 0,
      count: 1,
      receiptAvailableCount: r.receiptAvailable === false ? 0 : 1,
    }))

  const bySub = new Map<string, ComputedBooking[]>()
  for (const r of group.rows) {
    const sub = (r.subcategory ?? '').trim()
    if (!sub) continue
    const list = bySub.get(sub) ?? []
    list.push(r)
    bySub.set(sub, list)
  }
  const aggregated: EventRow[] = [...bySub.entries()].map(([sub, rows]) => ({
    kind: 'unterkategorie',
    date: rows[0].date,
    refs: '',
    label: sub,
    name: [...new Set(rows.map((r) => (r.name ?? '').trim()).filter(Boolean))].join(', '),
    ausgaben: rows.filter((r) => r.type === 'ausgabe').reduce((a, r) => a + r.amount, 0),
    einnahmen: rows.filter((r) => r.type === 'einnahme').reduce((a, r) => a + r.amount, 0),
    count: rows.length,
    receiptAvailableCount: rows.filter((r) => r.receiptAvailable !== false).length,
  }))

  return [...singles, ...aggregated].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Treffer-Logik für die globale Suche UND den Filter der Buchungsliste –
 * beide müssen identisch suchen, sonst zeigt ein angeklickter Suchtreffer
 * (z. B. über den Betrag gefunden) in der Liste nichts an.
 */
export function bookingMatches(b: ComputedBooking, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    b.description.toLowerCase().includes(q) ||
    (b.name ?? '').toLowerCase().includes(q) ||
    b.note.toLowerCase().includes(q) ||
    (b.subcategory ?? '').toLowerCase().includes(q) ||
    b.categoryName.toLowerCase().includes(q) ||
    b.ref.toLowerCase().includes(q) ||
    formatEur(b.signedAmount).includes(q)
  )
}

export function nextSeq(file: YearFile): number {
  return file.bookings.reduce((max, b) => Math.max(max, b.seq), 0) + 1
}

interface ImportedStatementIdentity {
  hash: string
  legacyHashes?: readonly string[]
  name: string
}

/**
 * Gleicht bestehende Bankbuchungen mit einem erneut eingelesenen Auszug ab.
 * Alte Hash-Varianten werden dauerhaft ersetzt; vorhandene Namen bleiben
 * unverändert. Ein importHash ist das verlässliche Merkmal historischer
 * Importe, da ältere App-Versionen die Herkunft teils als "manuell" speicherten.
 */
export function reconcileImportedBookings(
  bookings: Booking[],
  statementRows: readonly ImportedStatementIdentity[],
): { bookings: Booking[]; updatedNameCount: number; migratedHashCount: number } {
  const rowsByHash = new Map<string, ImportedStatementIdentity>()
  for (const row of statementRows) {
    rowsByHash.set(row.hash, row)
    for (const legacyHash of row.legacyHashes ?? []) rowsByHash.set(legacyHash, row)
  }

  let updatedNameCount = 0
  let migratedHashCount = 0
  const next = bookings.map((booking) => {
    if (!booking.importHash) return booking
    const row = rowsByHash.get(booking.importHash)
    if (!row) return booking

    const name = row.name.trim()
    const shouldUpdateName = !(booking.name ?? '').trim() && Boolean(name)
    const shouldMigrateHash = booking.importHash !== row.hash
    const shouldCorrectSource = booking.source !== 'import'
    if (!shouldUpdateName && !shouldMigrateHash && !shouldCorrectSource) return booking

    if (shouldUpdateName) updatedNameCount++
    if (shouldMigrateHash) migratedHashCount++
    return {
      ...booking,
      source: 'import' as const,
      importHash: row.hash,
      ...(shouldUpdateName ? { name } : {}),
    }
  })
  return { bookings: next, updatedNameCount, migratedHashCount }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
