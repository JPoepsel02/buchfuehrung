import { formatEur } from './money'
import { rowHash } from './csv'
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

/**
 * Migriert alle bereits gespeicherten Bankimporte auf den stabilen Hash aus
 * Datum, signiertem Originalbetrag und Banktext. Split-Buchungen teilen sich
 * einen alten importHash und werden deshalb vor der Berechnung summiert.
 */
export function migrateExistingImportHashes(
  bookings: Booking[],
): { bookings: Booking[]; migratedCount: number } {
  const groups = new Map<string, Booking[]>()
  for (const booking of bookings) {
    if (!booking.importHash || booking.importHashVersion === 2) continue
    const group = groups.get(booking.importHash) ?? []
    groups.set(booking.importHash, [...group, booking])
  }

  const migrationByHash = new Map<string, string>()
  for (const [oldHash, group] of groups) {
    const dates = new Set(group.map((booking) => booking.date))
    const notes = new Set(group.map((booking) => booking.note.trim()).filter(Boolean))
    if (dates.size !== 1 || notes.size !== 1) continue
    const amount = group.reduce((total, booking) => total + signedAmount(booking), 0)
    migrationByHash.set(oldHash, rowHash(group[0].date, amount, [...notes][0]))
  }

  let migratedCount = 0
  const next = bookings.map((booking) => {
    if (!booking.importHash) return booking
    if (booking.importHashVersion === 2) {
      if (booking.source === 'import') return booking
      migratedCount++
      return { ...booking, source: 'import' as const }
    }
    const hash = migrationByHash.get(booking.importHash)
    if (!hash) return booking
    migratedCount++
    return { ...booking, source: 'import' as const, importHash: hash, importHashVersion: 2 as const }
  })
  return { bookings: next, migratedCount }
}

export interface DraftDuplicateInput {
  /** Stabiler Import-Hash der Auszugszeile */
  hash: string
  /** ISO-Datum YYYY-MM-DD */
  date: string
  /** Vorzeichenbehafteter Betrag in Cent wie im Auszug (negativ = Ausgabe) */
  amount: number
}

/**
 * Markiert Auszugszeilen, die bereits als Buchung existieren – und zwar
 * sowohl frühere Importe als auch von Hand erfasste Buchungen:
 *
 * - "hard": exakt derselbe Import (Auszug-Hash steckt schon als importHash
 *   an einer Buchung) – sicheres Duplikat, kann nicht erneut importiert werden.
 * - "soft": gleiche Kombination aus Datum und vorzeichenbehaftetem Betrag wie
 *   eine bestehende MANUELLE Buchung (ohne importHash). Wahrscheinliches
 *   Duplikat, das aber überschreibbar bleibt (Datum + Betrag können sich
 *   selten auch bei verschiedenen Vorgängen decken).
 *
 * Mehrere bestehende Buchungen mit demselben Datum/Betrag werden eins-zu-eins
 * verbraucht, damit zwei gleich aussehende Auszugszeilen nicht beide auf
 * dieselbe einzelne Buchung verweisen.
 */
export function classifyDraftDuplicates(
  bookings: Booking[],
  rows: readonly DraftDuplicateInput[],
): { hard: boolean[]; soft: boolean[] } {
  const importHashes = new Set(bookings.map((b) => b.importHash).filter(Boolean))

  // Fingerabdruck-Vorrat nur aus MANUELLEN Buchungen – Importe deckt der
  // Hash-Abgleich bereits exakt ab.
  const pool = new Map<string, number>()
  for (const b of bookings) {
    if (b.importHash) continue
    const fp = `${b.date}|${signedAmount(b)}`
    pool.set(fp, (pool.get(fp) ?? 0) + 1)
  }

  const hard: boolean[] = []
  const soft: boolean[] = []
  for (const r of rows) {
    if (importHashes.has(r.hash)) {
      hard.push(true)
      soft.push(false)
      continue
    }
    const fp = `${r.date}|${r.amount}`
    const left = pool.get(fp) ?? 0
    if (left > 0) {
      pool.set(fp, left - 1)
      hard.push(false)
      soft.push(true)
    } else {
      hard.push(false)
      soft.push(false)
    }
  }
  return { hard, soft }
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
    const shouldSetVersion = booking.importHashVersion !== 2
    if (!shouldUpdateName && !shouldMigrateHash && !shouldCorrectSource && !shouldSetVersion) {
      return booking
    }

    if (shouldUpdateName) updatedNameCount++
    if (shouldMigrateHash) migratedHashCount++
    return {
      ...booking,
      source: 'import' as const,
      importHash: row.hash,
      importHashVersion: 2 as const,
      ...(shouldUpdateName ? { name } : {}),
    }
  })
  return { bookings: next, updatedNameCount, migratedHashCount }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
