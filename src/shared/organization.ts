import { makeId } from './defaults'
import { fiscalRange } from './fiscal'
import { computeBookings } from './ledger'
import { isKontoId } from './types'
import type { Booking, ComputedBooking, YearFile } from './types'

export type ActivityAreaId = 'I' | 'V' | 'Z' | 'W'
export const AREA_DEFINITIONS: ReadonlyArray<{ id: ActivityAreaId; name: string }> = [
  { id: 'I', name: 'Ideeller Bereich' },
  { id: 'V', name: 'Vermögensverwaltung' },
  { id: 'Z', name: 'Zweckbetrieb' },
  { id: 'W', name: 'Wirtschaftlicher Geschäftsbetrieb' },
]
export interface ActivityAllocation { area: ActivityAreaId; amount: number }
export interface BookingReference { konto: string; year: number; bookingId: string }
export interface CategoryAreaRule { id: string; konto: string; categoryId: string; area: ActivityAreaId }
export interface OrganizationAssignment {
  allocations: ActivityAllocation[]
  amount: number
  type: 'einnahme' | 'ausgabe'
  date: string
  categoryId: string
}
export interface OrganizationTransfer {
  id: string
  from: BookingReference
  to: BookingReference
  amount: number
  fromDate: string
  toDate: string
}
export interface OrganizationConfig {
  name: string
  treasurerName: string
  rules: CategoryAreaRule[]
  assignments: Record<string, OrganizationAssignment>
  transfers: OrganizationTransfer[]
}
export interface OrganizationPeriod { from: string; to: string; kontos?: string[] }
export interface OrganizationBooking {
  key: string
  reference: BookingReference
  booking: ComputedBooking
  file: YearFile
  kontoName: string
  allocations: ActivityAllocation[]
  suggestedArea?: ActivityAreaId
  transferId?: string
  status: 'assigned' | 'open' | 'invalid'
}
export interface OrganizationAccountTotal {
  konto: string
  name: string
  income: number
  expenses: number
  result: number
  openingBalance: number | null
  closingBalance: number | null
  balanceCarriedFrom?: string
}
export interface OrganizationReport {
  period: OrganizationPeriod
  bookings: OrganizationBooking[]
  areas: { area: ActivityAreaId; income: number; expenses: number; result: number }[]
  accounts: OrganizationAccountTotal[]
  income: number
  expenses: number
  result: number
  unassignedIncome: number
  unassignedExpenses: number
  openCount: number
  transferCount: number
  transferVolume: number
  issues: string[]
}

const validArea = (value: unknown): value is ActivityAreaId => AREA_DEFINITIONS.some((area) => area.id === value)
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim().length > 0
const validYear = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1000 && Number(value) <= 9998
const positiveCents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function nextDay(value: string): string {
  const day = new Date(`${value}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

function validReference(value: unknown): value is BookingReference {
  return record(value) && isKontoId(value.konto) && validYear(value.year) && text(value.bookingId)
}

export function bookingKey(reference: BookingReference): string {
  return JSON.stringify([reference.konto, reference.year, reference.bookingId])
}

export function allocationError(amount: number, allocations: readonly ActivityAllocation[]): string | null {
  if (!positiveCents(amount)) return 'Der Buchungsbetrag muss ein positiver Centbetrag sein.'
  if (!Array.isArray(allocations) || allocations.length === 0) return 'Bitte mindestens einen Tätigkeitsbereich auswählen.'
  if (allocations.length > AREA_DEFINITIONS.length) return 'Ein Tätigkeitsbereich darf nur einmal vorkommen.'
  if (allocations.some((part) => !record(part) || !validArea(part.area))) return 'Unbekannter Tätigkeitsbereich.'
  if (allocations.some((part) => !positiveCents(part.amount))) return 'Teilbeträge müssen positive ganze Centbeträge sein.'
  if (new Set(allocations.map((part) => part.area)).size !== allocations.length) return 'Ein Tätigkeitsbereich darf nur einmal vorkommen.'
  const total = allocations.reduce((sum, part) => sum + part.amount, 0)
  if (!Number.isSafeInteger(total) || total !== amount) return 'Die Teilbeträge müssen genau dem Buchungsbetrag entsprechen.'
  return null
}

export function makeAssignment(booking: Booking, allocations: readonly ActivityAllocation[]): OrganizationAssignment {
  const error = allocationError(booking.amount, allocations)
  if (error) throw new Error(error)
  if (!validDate(booking.date) || !text(booking.categoryId) || !['einnahme', 'ausgabe'].includes(booking.type)) {
    throw new Error('Die Buchung enthält ungültige Angaben.')
  }
  return {
    allocations: allocations.map((part) => ({ area: part.area, amount: part.amount })),
    amount: booking.amount,
    type: booking.type,
    date: booking.date,
    categoryId: booking.categoryId,
  }
}

export function organizationDefaults(files: readonly YearFile[]): OrganizationConfig {
  const ordered = [...files].sort((a, b) => b.year - a.year)
  const primary = ordered.find((file) => (file.konto ?? 'haupt') === 'haupt')
  const fallback = ordered.find((file) => file.clubName.trim())
  return {
    name: primary?.clubName || fallback?.clubName || '',
    treasurerName: primary?.treasurerName || fallback?.treasurerName || '',
    rules: [], assignments: {}, transfers: [],
  }
}

export function suggestedArea(config: OrganizationConfig, konto: string, categoryId: string): ActivityAreaId | undefined {
  return config.rules.find((rule) => rule.konto === konto && rule.categoryId === categoryId)?.area
}

export function categoryAllocations(config: OrganizationConfig, konto: string, categoryId: string, amount: number): ActivityAllocation[] {
  const area = suggestedArea(config, konto, categoryId)
  return positiveCents(amount) && validArea(area) ? [{ area, amount }] : []
}

export function categoryDefaultCandidates(files: readonly YearFile[], config: OrganizationConfig): OrganizationBooking[] {
  return allOrganizationBookings(files, config).filter((entry) => entry.status === 'open' && !entry.transferId &&
    !Object.prototype.hasOwnProperty.call(config.assignments, entry.key) &&
    categoryAllocations(config, entry.reference.konto, entry.booking.categoryId, entry.booking.amount).length > 0)
}

export function applyCategoryDefaultReferences(
  files: readonly YearFile[], config: OrganizationConfig, references: readonly BookingReference[],
): OrganizationConfig {
  if (!references.length) return config
  const candidates = new Map(categoryDefaultCandidates(files, config).map((entry) => [entry.key, entry]))
  const selected = [...new Map(references.map((reference) => [bookingKey(reference), reference])).keys()]
  if (selected.some((key) => !candidates.has(key))) throw new Error('Die Auswahl hat sich geändert. Bitte die offenen Zuordnungen erneut prüfen.')
  const additions = Object.fromEntries(selected.map((key) => {
    const entry = candidates.get(key)!
    return [key, makeAssignment(entry.booking, categoryAllocations(config, entry.reference.konto, entry.booking.categoryId, entry.booking.amount))]
  }))
  return { ...config, assignments: { ...config.assignments, ...additions } }
}

function accountName(konto: string, files: readonly YearFile[]): string {
  const latest = files.filter((file) => (file.konto ?? 'haupt') === konto).sort((a, b) => b.year - a.year)[0]
  return latest?.kontoName || (konto === 'haupt' ? 'Hauptkonto' : konto === 'zweit' ? 'Zweitkonto' : `Konto ${konto.slice(1)}`)
}

interface Snapshot {
  rows: OrganizationBooking[]
  byKey: Map<string, OrganizationBooking>
  duplicates: Set<string>
  issues: string[]
}

function assignmentMatches(booking: Booking, assignment: OrganizationAssignment): boolean {
  return assignment.amount === booking.amount && assignment.type === booking.type && assignment.date === booking.date &&
    assignment.categoryId === booking.categoryId && allocationError(booking.amount, assignment.allocations) === null
}

function snapshot(files: readonly YearFile[], config: OrganizationConfig): Snapshot {
  const byKey = new Map<string, OrganizationBooking>()
  const duplicates = new Set<string>()
  const issues: string[] = []
  for (const file of files) {
    const konto = file.konto ?? 'haupt'
    for (const booking of computeBookings(file)) {
      const reference = { konto, year: file.year, bookingId: booking.id }
      const key = bookingKey(reference)
      if (byKey.has(key)) {
        duplicates.add(key)
        issues.push(`${accountName(konto, files)} ${file.year}: Buchung ${booking.id} ist mehrfach vorhanden.`)
        continue
      }
      const assignment = config.assignments[key]
      const assigned = assignment ? assignmentMatches(booking, assignment) : false
      byKey.set(key, {
        key, reference, booking, file, kontoName: accountName(konto, files),
        allocations: assigned ? assignment.allocations.map((part) => ({ ...part })) : [],
        suggestedArea: suggestedArea(config, konto, booking.categoryId),
        status: booking.amount === 0 ? 'assigned' : assignment ? assigned ? 'assigned' : 'invalid' : 'open',
      })
    }
  }
  return { rows: [...byKey.values()], byKey, duplicates, issues }
}

interface TransferResolution {
  byBooking: Map<string, OrganizationTransfer>
  invalidBookings: Set<string>
  issues: string[]
}

function resolveTransfers(source: Snapshot, transfers: readonly OrganizationTransfer[]): TransferResolution {
  const counts = new Map<string, number>()
  const ids = new Map<string, number>()
  for (const transfer of transfers) {
    ids.set(transfer.id, (ids.get(transfer.id) ?? 0) + 1)
    for (const reference of [transfer.from, transfer.to]) {
      const key = bookingKey(reference)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const byBooking = new Map<string, OrganizationTransfer>()
  const invalidBookings = new Set<string>()
  const issues: string[] = []
  for (const transfer of transfers) {
    const fromKey = bookingKey(transfer.from), toKey = bookingKey(transfer.to)
    const from = source.byKey.get(fromKey), to = source.byKey.get(toKey)
    const valid = validReference(transfer.from) && validReference(transfer.to) && from && to &&
      !source.duplicates.has(fromKey) && !source.duplicates.has(toKey) && ids.get(transfer.id) === 1 &&
      counts.get(fromKey) === 1 && counts.get(toKey) === 1 &&
      from.reference.konto !== to.reference.konto && from.booking.type === 'ausgabe' && to.booking.type === 'einnahme' &&
      positiveCents(transfer.amount) && transfer.amount === from.booking.amount && transfer.amount === to.booking.amount &&
      validDate(transfer.fromDate) && validDate(transfer.toDate) &&
      transfer.fromDate === from.booking.date && transfer.toDate === to.booking.date
    if (!valid) {
      issues.push(`Umbuchung ${transfer.id}: Verknüpfung ist unvollständig oder wurde durch geänderte Buchungen ungültig.`)
      invalidBookings.add(fromKey)
      invalidBookings.add(toKey)
    } else {
      byBooking.set(fromKey, transfer)
      byBooking.set(toKey, transfer)
    }
  }
  return { byBooking, invalidBookings, issues }
}

function resolvedSnapshot(files: readonly YearFile[], config: OrganizationConfig): { rows: OrganizationBooking[]; issues: string[] } {
  const source = snapshot(files, config)
  const transfers = resolveTransfers(source, config.transfers)
  const rows = source.rows.map((row) => {
    const transfer = transfers.byBooking.get(row.key)
    if (transfer) return { ...row, transferId: transfer.id, status: 'assigned' as const, allocations: [] }
    if (source.duplicates.has(row.key) || transfers.invalidBookings.has(row.key)) {
      return { ...row, status: 'invalid' as const, allocations: [] }
    }
    return row
  })
  return { rows, issues: [...source.issues, ...transfers.issues] }
}

export function allOrganizationBookings(files: readonly YearFile[], config: OrganizationConfig): OrganizationBooking[] {
  return resolvedSnapshot(files, config).rows
    .sort((a, b) => b.booking.date.localeCompare(a.booking.date) || a.key.localeCompare(b.key))
}

export function createTransfer(files: readonly YearFile[], first: BookingReference, second: BookingReference): OrganizationTransfer {
  if (!validReference(first) || !validReference(second)) throw new Error('Ungültige Buchungsreferenz.')
  if (first.konto === second.konto) throw new Error('Eine Umbuchung benötigt zwei verschiedene eigene Konten.')
  const source = snapshot(files, organizationDefaults(files))
  const aKey = bookingKey(first), bKey = bookingKey(second)
  const a = source.byKey.get(aKey), b = source.byKey.get(bKey)
  if (!a || !b || source.duplicates.has(aKey) || source.duplicates.has(bKey)) throw new Error('Beide Buchungen müssen eindeutig vorhanden sein.')
  if (a.booking.type === b.booking.type) throw new Error('Eine Umbuchung benötigt eine Ausgabe und eine Einnahme.')
  if (!positiveCents(a.booking.amount) || a.booking.amount !== b.booking.amount) throw new Error('Die Beträge beider Buchungen müssen gleich und positiv sein.')
  if (!validDate(a.booking.date) || !validDate(b.booking.date)) throw new Error('Die Buchungsdaten sind ungültig.')
  const from = a.booking.type === 'ausgabe' ? a : b
  const to = a.booking.type === 'einnahme' ? a : b
  return {
    id: makeId(), from: { ...from.reference }, to: { ...to.reference }, amount: from.booking.amount,
    fromDate: from.booking.date, toDate: to.booking.date,
  }
}

function coverageIssues(files: readonly YearFile[], konto: string, period: OrganizationPeriod): string[] {
  const name = accountName(konto, files)
  const ranges = files.filter((file) => (file.konto ?? 'haupt') === konto)
    .map((file) => ({ file, ...fiscalRange(file) }))
    .filter((range) => range.end >= period.from && range.start <= period.to)
    .sort((a, b) => a.start.localeCompare(b.start))
  const issues: string[] = []
  let cursor = period.from
  let previousEnd = ''
  for (const range of ranges) {
    const start = range.start > period.from ? range.start : period.from
    if (start > cursor) issues.push(`${name}: Kassenjahr für ${cursor} fehlt.`)
    if (previousEnd && range.start <= previousEnd) issues.push(`${name}: Kassenjahre überschneiden sich ab ${start}.`)
    if (range.end >= cursor) cursor = nextDay(range.end)
    if (range.end > previousEnd) previousEnd = range.end
  }
  if (cursor <= period.to) issues.push(`${name}: Kassenjahr für ${cursor} fehlt.`)
  return issues
}

function balanceAt(files: readonly YearFile[], konto: string, date: string, includeDate: boolean): number | null {
  const candidates = files.filter((file) => {
    const range = fiscalRange(file)
    return (file.konto ?? 'haupt') === konto && range.start <= date && range.end >= date
  })
  if (candidates.length !== 1) return null
  const file = candidates[0]
  const range = fiscalRange(file)
  if (!Number.isSafeInteger(file.openingBalance) || file.bookings.some((booking) =>
    !validDate(booking.date) || booking.date < range.start || booking.date > range.end ||
    !Number.isSafeInteger(booking.amount) || booking.amount < 0)) return null
  const movements = file.bookings.filter((booking) => includeDate ? booking.date <= date : booking.date < date)
  const balance = movements.reduce((sum, booking) => sum + (booking.type === 'einnahme' ? booking.amount : -booking.amount), file.openingBalance)
  return Number.isSafeInteger(balance) ? balance : null
}

function carryForwardBalance(files: readonly YearFile[], konto: string, period: OrganizationPeriod) {
  const accountFiles = files.filter((file) => (file.konto ?? 'haupt') === konto)
  const latest = accountFiles.map((file) => ({ file, ...fiscalRange(file) }))
    .sort((a, b) => b.end.localeCompare(a.end))[0]
  if (!latest || latest.end >= period.to || !validDate(latest.start) || !validDate(latest.end)) return null

  // The carried closing balance depends on the whole source fiscal year.
  const from = period.from < latest.start ? period.from : latest.start
  if (coverageIssues(accountFiles, konto, { from, to: latest.end }).length > 0) return null
  if (new Set(latest.file.bookings.map((booking) => booking.id)).size !== latest.file.bookings.length) return null
  if (accountFiles.some((file) => file.bookings.some((booking) =>
    booking.date > latest.end && booking.date <= period.to,
  ))) return null

  const amount = balanceAt(accountFiles, konto, latest.end, true)
  return amount === null ? null : { date: latest.end, amount }
}

function continuityIssues(files: readonly YearFile[], konto: string, period: OrganizationPeriod): string[] {
  const ordered = files.filter((file) => (file.konto ?? 'haupt') === konto)
    .map((file) => ({ file, ...fiscalRange(file) }))
    .sort((a, b) => a.start.localeCompare(b.start))
  return ordered.flatMap((entry, index) => {
    const previous = ordered[index - 1]
    if (!previous || entry.start <= period.from || entry.start > period.to || nextDay(previous.end) !== entry.start) return []
    const closing = balanceAt(files, konto, previous.end, true)
    return closing !== null && closing !== entry.file.openingBalance
      ? [`${accountName(konto, files)}: Anfangssaldo ${entry.file.year} stimmt nicht mit dem Vorjahresabschluss überein.`]
      : []
  })
}

export function buildOrganizationReport(
  files: readonly YearFile[], config: OrganizationConfig, period: OrganizationPeriod,
  { carryForwardBalances = false }: { carryForwardBalances?: boolean } = {},
): OrganizationReport {
  const result: OrganizationReport = {
    period: { ...period, ...(period.kontos ? { kontos: [...period.kontos] } : {}) },
    bookings: [], areas: AREA_DEFINITIONS.map((area) => ({ area: area.id, income: 0, expenses: 0, result: 0 })),
    accounts: [], income: 0, expenses: 0, result: 0,
    unassignedIncome: 0, unassignedExpenses: 0, openCount: 0,
    transferCount: 0, transferVolume: 0, issues: [],
  }
  if (!validDate(period.from) || !validDate(period.to) || period.from > period.to) {
    return { ...result, issues: ['Bitte einen gültigen Berichtszeitraum auswählen.'] }
  }
  const source = resolvedSnapshot(files, config)
  const selected = [...new Set(period.kontos ?? files.map((file) => file.konto ?? 'haupt'))]
  const bookings = source.rows.filter((row) => selected.includes(row.reference.konto) && row.booking.date >= period.from && row.booking.date <= period.to)
    .sort((a, b) => a.booking.date.localeCompare(b.booking.date) || a.key.localeCompare(b.key))
  const external = bookings.filter((row) => !row.transferId)
  const income = external.filter((row) => row.booking.type === 'einnahme').reduce((sum, row) => sum + row.booking.amount, 0)
  const expenses = external.filter((row) => row.booking.type === 'ausgabe').reduce((sum, row) => sum + row.booking.amount, 0)
  const unresolved = external.filter((row) => row.status !== 'assigned')
  const transferIds = new Set(bookings.flatMap((row) => row.transferId ? [row.transferId] : []))
  const issues = [...source.issues]
  for (const row of bookings) {
    const range = fiscalRange(row.file)
    if (row.booking.date < range.start || row.booking.date > range.end) issues.push(`${row.kontoName}: Buchung ${row.booking.ref} liegt außerhalb ihres Kassenjahres.`)
    if (row.status === 'invalid' && !row.transferId) issues.push(`${row.kontoName}: Zuordnung von ${row.booking.ref} muss erneut geprüft werden.`)
  }
  const accountTotals = selected.map((konto) => {
    const knownClosingBalance = balanceAt(files, konto, period.to, true)
    const carried = carryForwardBalances && knownClosingBalance === null ? carryForwardBalance(files, konto, period) : null
    if (!carried) issues.push(...coverageIssues(files, konto, period))
    issues.push(...continuityIssues(files, konto, period))
    const accountRows = external.filter((row) => row.reference.konto === konto)
    const accountIncome = accountRows.filter((row) => row.booking.type === 'einnahme').reduce((sum, row) => sum + row.booking.amount, 0)
    const accountExpenses = accountRows.filter((row) => row.booking.type === 'ausgabe').reduce((sum, row) => sum + row.booking.amount, 0)
    const openingBalance = carried && period.from > carried.date ? carried.amount : balanceAt(files, konto, period.from, false)
    const closingBalance = carried?.amount ?? knownClosingBalance
    if (openingBalance === null || closingBalance === null) issues.push(`${accountName(konto, files)}: Bestand am Berichtsanfang oder -ende ist nicht eindeutig ermittelbar.`)
    return { konto, name: accountName(konto, files), income: accountIncome, expenses: accountExpenses,
      result: accountIncome - accountExpenses, openingBalance, closingBalance, ...(carried ? { balanceCarriedFrom: carried.date } : {}) }
  })
  const areaTotals = AREA_DEFINITIONS.map(({ id }) => {
    const allocated = (type: Booking['type']) => external.filter((row) => row.booking.type === type)
      .reduce((sum, row) => sum + row.allocations.filter((part) => part.area === id).reduce((total, part) => total + part.amount, 0), 0)
    const areaIncome = allocated('einnahme'), areaExpenses = allocated('ausgabe')
    return { area: id, income: areaIncome, expenses: areaExpenses, result: areaIncome - areaExpenses }
  })
  if (![income, expenses, income - expenses].every(Number.isSafeInteger)) issues.push('Die Summen überschreiten den sicheren Cent-Zahlenbereich.')
  return {
    ...result, bookings, areas: areaTotals, accounts: accountTotals, income, expenses, result: income - expenses,
    unassignedIncome: unresolved.filter((row) => row.booking.type === 'einnahme').reduce((sum, row) => sum + row.booking.amount, 0),
    unassignedExpenses: unresolved.filter((row) => row.booking.type === 'ausgabe').reduce((sum, row) => sum + row.booking.amount, 0),
    openCount: unresolved.length, transferCount: transferIds.size,
    transferVolume: config.transfers.filter((transfer) => transferIds.has(transfer.id)).reduce((sum, transfer) => sum + transfer.amount, 0),
    issues: [...new Set(issues)],
  }
}

function validateAssignment(value: unknown): string | null {
  if (!record(value)) return 'Zuordnung ist kein Objekt.'
  if (!validDate(value.date) || !text(value.categoryId) || !['einnahme', 'ausgabe'].includes(String(value.type))) return 'Zuordnung enthält ungültige Buchungsangaben.'
  if (!positiveCents(value.amount)) return 'Zuordnung enthält keinen gültigen Centbetrag.'
  return allocationError(value.amount, value.allocations as ActivityAllocation[])
}

function referenceFromKey(key: string): BookingReference | null {
  try {
    const parts: unknown = JSON.parse(key)
    if (!Array.isArray(parts) || parts.length !== 3) return null
    const reference = { konto: parts[0], year: parts[1], bookingId: parts[2] }
    return validReference(reference) && bookingKey(reference) === key ? reference : null
  } catch {
    return null
  }
}

function validateRules(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10000) return ['Kategorie-Vorgaben fehlen oder sind zu umfangreich.']
  const errors: string[] = [], ids = new Set<string>(), categories = new Set<string>()
  for (const rule of value) {
    if (!record(rule) || !text(rule.id) || !isKontoId(rule.konto) || !text(rule.categoryId) || !validArea(rule.area)) {
      errors.push('Kategorie-Vorgabe ist ungültig.')
      continue
    }
    const categoryKey = JSON.stringify([rule.konto, rule.categoryId])
    if (ids.has(rule.id) || categories.has(categoryKey)) errors.push('Kategorie-Vorgabe ist mehrfach vorhanden.')
    ids.add(rule.id)
    categories.add(categoryKey)
  }
  return errors
}

function validateAssignments(value: unknown): string[] {
  if (!record(value)) return ['Buchungszuordnungen fehlen oder sind ungültig.']
  const entries = Object.entries(value)
  if (entries.length > 100000) return ['Zu viele Buchungszuordnungen.']
  return entries.flatMap(([key, assignment]) => {
    const error = validateAssignment(assignment)
    return [
      ...(!referenceFromKey(key) ? ['Buchungszuordnung hat eine ungültige Referenz.'] : []),
      ...(error ? [error] : []),
    ]
  })
}

function validateTransfers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100000) return ['Umbuchungen fehlen oder sind zu umfangreich.']
  const errors: string[] = [], ids = new Set<string>(), booked = new Set<string>()
  for (const transfer of value) {
    if (!record(transfer) || !text(transfer.id) || !validReference(transfer.from) || !validReference(transfer.to) ||
      !positiveCents(transfer.amount) || !validDate(transfer.fromDate) || !validDate(transfer.toDate) || transfer.from.konto === transfer.to.konto) {
      errors.push('Umbuchung enthält ungültige Angaben.')
      continue
    }
    if (ids.has(transfer.id)) errors.push('Umbuchungs-ID ist mehrfach vorhanden.')
    ids.add(transfer.id)
    for (const reference of [transfer.from, transfer.to]) {
      const key = bookingKey(reference)
      if (booked.has(key)) errors.push('Eine Buchung ist mehreren Umbuchungen zugeordnet.')
      booked.add(key)
    }
  }
  return errors
}

export function validateOrganizationConfig(value: unknown): string[] {
  if (!record(value)) return ['Vereinseinstellungen sind kein Objekt.']
  const errors: string[] = []
  if (typeof value.name !== 'string' || value.name.length > 200) errors.push('Vereinsname ist ungültig oder zu lang.')
  if (typeof value.treasurerName !== 'string' || value.treasurerName.length > 200) errors.push('Name der Kassenführung ist ungültig oder zu lang.')
  return [...new Set([...errors, ...validateRules(value.rules), ...validateAssignments(value.assignments), ...validateTransfers(value.transfers)])]
}
