import type {
  Booking,
  CategoryGroup,
  ChronoRow,
  ComputedBooking,
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
 * Berechnet Beleg-Nr. (Kürzel + Zähler in Erfassungsreihenfolge, wie
 * COUNTIF in der Excel) und alle abgeleiteten Beträge.
 */
export function computeBookings(file: YearFile): ComputedBooking[] {
  const byId = new Map(file.categories.map((c) => [c.id, c]))
  const counters = new Map<string, number>()
  return [...file.bookings]
    .sort((a, b) => a.seq - b.seq)
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

export function monthSummaries(file: YearFile): MonthSummary[] {
  const chrono = chronological(file)
  const result: MonthSummary[] = []
  let balance = file.openingBalance
  for (let month = 1; month <= 12; month++) {
    const rows = chrono.filter((r) => Number(r.date.slice(5, 7)) === month)
    const einnahmen = sum(rows.filter((r) => r.type === 'einnahme').map((r) => r.amount))
    const ausgaben = sum(rows.filter((r) => r.type === 'ausgabe').map((r) => r.amount))
    balance += einnahmen - ausgaben
    result.push({
      month,
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

export function nextSeq(file: YearFile): number {
  return file.bookings.reduce((max, b) => Math.max(max, b.seq), 0) + 1
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
