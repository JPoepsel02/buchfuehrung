import { describe, expect, test } from 'vitest'
import {
  AREA_DEFINITIONS, allOrganizationBookings, allocationError, bookingKey, buildOrganizationReport,
  createTransfer, makeAssignment, organizationDefaults, suggestedArea, validateOrganizationConfig,
} from '../organization'
import type {
  ActivityAllocation, BookingReference, OrganizationConfig, OrganizationTransfer,
} from '../organization'
import type { Booking, YearFile } from '../types'

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1', date: '2026-06-15', categoryId: 'category', description: 'Beispiel', type: 'einnahme',
    amount: 10000, isUmsatz: true, nonUmsatzAmount: 0, note: '', seq: 1, refNo: 1,
    source: 'manuell', ...overrides,
  }
}

function year(overrides: Partial<YearFile> = {}): YearFile {
  return {
    schemaVersion: 1, year: 2026, konto: 'haupt', kontoName: 'Hauptkonto', openingBalance: 20000,
    clubName: 'Beispielverein', treasurerName: 'Erika Muster',
    categories: [{ id: 'category', name: 'Veranstaltung', code: 'V', active: true, sortOrder: 1 }],
    bookings: [], ...overrides,
  }
}

const ref = (konto = 'haupt', year = 2026, bookingId = 'b1'): BookingReference => ({ konto, year, bookingId })
const period = { from: '2026-01-01', to: '2026-12-31' }
const config = (patch: Partial<OrganizationConfig> = {}): OrganizationConfig => ({
  name: 'Beispielverein', treasurerName: 'Erika Muster', rules: [], assignments: {}, transfers: [], ...patch,
})
const allocations: ActivityAllocation[] = [{ area: 'I', amount: 6000 }, { area: 'Z', amount: 4000 }]

function frozen<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(frozen)
    Object.freeze(value)
  }
  return value
}

function transferFixture(): { files: YearFile[]; transfer: OrganizationTransfer } {
  const files = [
    year({ year: 2025, bookings: [booking({ id: 'out', date: '2025-12-31', type: 'ausgabe' })] }),
    year({ year: 2026, openingBalance: 10000 }),
    year({ konto: 'zweit', kontoName: 'Barkasse', openingBalance: 5000,
      bookings: [booking({ id: 'in', date: '2026-01-02' })] }),
  ]
  return { files, transfer: createTransfer(files, ref('haupt', 2025, 'out'), ref('zweit', 2026, 'in')) }
}

describe('Vereinskonfiguration und Referenzen', () => {
  test('behält vier feste Bereiche und kollisionsfreie Konto-/Jahr-/Buchungsreferenzen', () => {
    expect(AREA_DEFINITIONS.map((area) => area.id)).toEqual(['I', 'V', 'Z', 'W'])
    const keys = [ref(), ref('zweit'), ref('haupt', 2025), ref('haupt', 2026, 'a:b:2025')].map(bookingKey)
    expect(new Set(keys).size).toBe(4)
    expect(JSON.parse(keys[0])).toEqual(['haupt', 2026, 'b1'])
  })

  test('übernimmt Stammdaten aus dem neuesten Hauptkonto ohne Quelldaten zu verändern', () => {
    const files = frozen([
      year({ year: 2025, clubName: 'Alter Name' }),
      year({ konto: 'zweit', year: 2027, clubName: 'Anderes Buch' }),
      year({ year: 2026, clubName: 'Aktueller Name' }),
    ])
    expect(organizationDefaults(files)).toEqual(config({ name: 'Aktueller Name' }))
    expect(files.map((file) => file.year)).toEqual([2025, 2027, 2026])
    expect(organizationDefaults([])).toEqual(config({ name: '', treasurerName: '' }))
    expect(organizationDefaults([year({ konto: 'k3', kontoName: undefined, clubName: 'Fallback' })]).name).toBe('Fallback')
    expect(organizationDefaults([year({ clubName: '', treasurerName: '' }), year({ konto: 'zweit', clubName: 'Fallback' })]).name).toBe('Fallback')
  })

  test('Kategorie-Vorgaben gelten je Konto und werden nicht automatisch als bestätigt ausgewertet', () => {
    const rules = [{ id: 'r1', konto: 'haupt', categoryId: 'category', area: 'Z' as const }]
    const organization = config({ rules })
    expect(suggestedArea(organization, 'haupt', 'category')).toBe('Z')
    expect(suggestedArea(organization, 'zweit', 'category')).toBeUndefined()
    const rows = allOrganizationBookings([year({ bookings: [booking()] })], organization)
    expect(rows[0]).toMatchObject({ suggestedArea: 'Z', status: 'open', allocations: [] })
    const report = buildOrganizationReport([year({ bookings: [booking()] })], organization, period)
    expect(report.openCount).toBe(1)
    expect(report.unassignedIncome).toBe(10000)
    expect(report.areas.every((area) => area.income === 0)).toBe(true)
  })
})

describe('Bestätigte Bereichszuordnung', () => {
  test('speichert eine centgenaue Aufteilung mit Fingerprint und unabhängigen Kopien', () => {
    const input = frozen(booking())
    const parts = frozen(allocations.map((part) => ({ ...part })))
    expect(allocationError(input.amount, parts)).toBeNull()
    const assignment = makeAssignment(input, parts)
    expect(assignment).toEqual({ allocations, amount: 10000, type: 'einnahme', date: '2026-06-15', categoryId: 'category' })
    expect(assignment.allocations).not.toBe(parts)
    expect(assignment.allocations[0]).not.toBe(parts[0])
    const organization = frozen(config({ assignments: { [bookingKey(ref())]: assignment } }))
    const report = buildOrganizationReport(frozen([year({ bookings: [input] })]), organization, period)
    expect(report.openCount).toBe(0)
    expect(report.areas.find((area) => area.area === 'I')).toMatchObject({ income: 6000, expenses: 0, result: 6000 })
    expect(report.areas.find((area) => area.area === 'Z')).toMatchObject({ income: 4000, expenses: 0, result: 4000 })
    expect(report.bookings[0].allocations).not.toBe(assignment.allocations)
  })

  test.each([
    [0, allocations], [-1, allocations], [1.5, allocations], [Number.MAX_SAFE_INTEGER + 1, allocations],
    [10000, []], [10000, [{ area: 'I', amount: 9999 }]],
    [10000, [{ area: 'I', amount: 5000 }, { area: 'I', amount: 5000 }]],
    [10000, [{ area: 'I', amount: 0 }, { area: 'Z', amount: 10000 }]],
    [10000, [{ area: 'I', amount: -1 }, { area: 'Z', amount: 10001 }]],
    [10000, [{ area: 'I', amount: 0.5 }, { area: 'Z', amount: 9999.5 }]],
    [10000, [{ area: 'unbekannt', amount: 10000 }]], [10000, [null]],
    [10000, null], [10000, new Array(5).fill({ area: 'I', amount: 2000 })],
  ])('lehnt eine ungültige Cent-Aufteilung ab: %j', (amount, parts) => {
    expect(allocationError(amount as number, parts as ActivityAllocation[])).not.toBeNull()
    expect(() => makeAssignment(booking({ amount: amount as number }), parts as ActivityAllocation[])).toThrow()
  })

  test.each([
    { date: '2026-02-30' }, { categoryId: '' }, { type: 'falsch' as Booking['type'] },
  ])('bestätigt keine Buchung mit ungültigen Angaben: %j', (patch) => {
    expect(() => makeAssignment(booking(patch), allocations)).toThrow(/ungültige Angaben/)
  })

  test.each([
    { amount: 12000 }, { type: 'ausgabe' as const }, { date: '2026-06-16' }, { categoryId: 'andere' },
  ])('macht die Zuordnung bei finanziell geänderter Buchung wieder prüfpflichtig: %j', (patch) => {
    const original = booking()
    const organization = config({ assignments: { [bookingKey(ref())]: makeAssignment(original, allocations) } })
    const report = buildOrganizationReport([year({ bookings: [booking(patch)] })], organization, period)
    expect(report.bookings[0]).toMatchObject({ status: 'invalid', allocations: [] })
    expect(report.openCount).toBe(1)
    expect(report.issues.some((issue) => issue.includes('erneut geprüft'))).toBe(true)
    expect(report.unassignedIncome + report.unassignedExpenses).toBe(patch.amount ?? 10000)
  })

  test('verändert eine Zuordnung durch Text-/Belegpflege nicht', () => {
    const organization = config({ assignments: { [bookingKey(ref())]: makeAssignment(booking(), allocations) } })
    const rows = allOrganizationBookings([year({ bookings: [booking({ description: 'Neuer Text', note: 'Notiz', refNo: 7 })] })], organization)
    expect(rows[0].status).toBe('assigned')
    expect(rows[0].booking.ref).toBe('V7')
  })

  test('gleiche Buchungs-IDs in verschiedenen Konten oder Jahren bleiben getrennt', () => {
    const files = [year({ bookings: [booking()] }), year({ konto: 'zweit', bookings: [booking()] }), year({ year: 2025, bookings: [booking({ date: '2025-06-15' })] })]
    const organization = config({ assignments: { [bookingKey(ref())]: makeAssignment(booking(), allocations) } })
    const rows = allOrganizationBookings(files, organization)
    expect(rows).toHaveLength(3)
    expect(rows.filter((row) => row.status === 'assigned')).toHaveLength(1)
    expect(rows.find((row) => row.reference.konto === 'zweit')?.kontoName).toBe('Hauptkonto')
  })
})

describe('Zeiträume, Kassenjahre und Bestände', () => {
  test('konsolidiert ein Kalenderjahr aus zwei November–Oktober-Dateien ohne Anfangssalden zu addieren', () => {
    const files = frozen([
      year({ konto: 'zweit', kontoName: 'Karneval', year: 2025, fiscalStartMonth: 11, openingBalance: 10000,
        bookings: [booking({ id: 'vorjahr', date: '2025-11-02', amount: 5000 }), booking({ id: 'januar', date: '2026-01-05', amount: 15000 }), booking({ id: 'oktober', date: '2026-10-31', amount: 4000, type: 'ausgabe' })] }),
      year({ konto: 'zweit', kontoName: 'Karneval', year: 2026, fiscalStartMonth: 11, openingBalance: 26000,
        bookings: [booking({ id: 'november', date: '2026-11-01', amount: 7000 })] }),
      year({ bookings: [booking({ amount: 3000 }), booking({ id: 'ende', date: '2026-12-31', type: 'ausgabe', amount: 1000 })] }),
    ])
    const report = buildOrganizationReport(files, config(), period)
    expect(report).toMatchObject({ income: 25000, expenses: 5000, result: 20000, openCount: 5, issues: [] })
    expect(report.bookings.map((row) => row.booking.id)).not.toContain('vorjahr')
    expect(report.accounts.find((account) => account.konto === 'zweit')).toMatchObject({ openingBalance: 15000, closingBalance: 33000, income: 22000, expenses: 4000 })
    expect(report.accounts.find((account) => account.konto === 'haupt')).toMatchObject({ openingBalance: 20000, closingBalance: 22000 })
    expect(report.accounts.reduce((sum, account) => sum + account.closingBalance!, 0)).toBe(55000)
  })

  test('begrenzt Datumsfilter einschließlich beider Randtage und berechnet den Bestand direkt davor', () => {
    const files = [year({ bookings: [booking({ id: 'vorher', date: '2026-06-14', amount: 3000 }), booking({ id: 'genau', amount: 2000 }), booking({ id: 'danach', date: '2026-06-16', amount: 4000 })] })]
    const report = buildOrganizationReport(files, config(), { from: '2026-06-15', to: '2026-06-15' })
    expect(report.income).toBe(2000)
    expect(report.bookings.map((row) => row.booking.id)).toEqual(['genau'])
    expect(report.accounts[0]).toMatchObject({ openingBalance: 23000, closingBalance: 25000 })
  })

  test('Kontenauswahl und leere Auswahl liefern keine fremden Einnahmen', () => {
    const files = [year({ bookings: [booking()] }), year({ konto: 'zweit', kontoName: undefined, bookings: [booking({ amount: 4000 })] })]
    const report = buildOrganizationReport(files, config(), { ...period, kontos: ['zweit', 'zweit'] })
    expect(report.income).toBe(4000)
    expect(report.accounts).toHaveLength(1)
    expect(report.accounts[0].name).toBe('Zweitkonto')
    const empty = buildOrganizationReport(files, config(), { ...period, kontos: [] })
    expect(empty.accounts).toEqual([])
    expect(empty.income).toBe(0)
    expect(empty.bookings).toEqual([])
    expect(allOrganizationBookings([year({ konto: 'k3', kontoName: undefined, bookings: [booking()] })], config())[0].kontoName).toBe('Konto 3')
  })

  test('meldet fehlende Jahre und ersetzt sie nicht durch ein neueres Kassenjahr', () => {
    const files = [year({ year: 2024, bookings: [booking({ date: '2024-06-15' })] }), year({ year: 2027 })]
    const report = buildOrganizationReport(files, config(), period)
    expect(report.income).toBe(0)
    expect(report.accounts[0]).toMatchObject({ openingBalance: null, closingBalance: null })
    expect(report.issues.join(' ')).toMatch(/fehlt/)
    expect(report.issues.join(' ')).toMatch(/nicht eindeutig/)
    const unknown = buildOrganizationReport([], config(), { ...period, kontos: ['k3'] })
    expect(unknown.accounts[0].name).toBe('Konto 3')
    expect(unknown.issues.length).toBeGreaterThan(0)
  })

  test('meldet unterbrochene Jahre und widersprüchliche Jahresübergänge', () => {
    const missing = buildOrganizationReport([year({ year: 2025 }), year({ year: 2027 })], config(), { from: '2025-01-01', to: '2027-12-31' })
    expect(missing.issues.join(' ')).toMatch(/2026-01-01 fehlt/)
    const mismatch = buildOrganizationReport([year({ year: 2025, openingBalance: 10000 }), year({ openingBalance: 50000 })], config(), { from: '2025-01-01', to: '2026-12-31' })
    expect(mismatch.issues.join(' ')).toMatch(/Anfangssaldo 2026/)
  })

  test('meldet überlappende Fiskaldateien und mehrdeutige Buchungsreferenzen', () => {
    const first = year({ bookings: [booking()] })
    const overlapping = year({ year: 2025, fiscalStartMonth: 11 })
    const report = buildOrganizationReport([first, overlapping], config(), period)
    expect(report.issues.join(' ')).toMatch(/überschneiden/)
    expect(report.accounts[0].openingBalance).toBeNull()
    const duplicate = buildOrganizationReport([first, first], config(), period)
    expect(duplicate.income).toBe(10000)
    expect(duplicate.issues.join(' ')).toMatch(/mehrfach vorhanden/)
    expect(duplicate.bookings[0].status).toBe('invalid')
  })

  test('macht Bestände bei fehlerhaften Ausgangsdaten sichtbar unbestimmt', () => {
    const outside = buildOrganizationReport([year({ bookings: [booking({ date: '2027-01-01' })] })], config(), { from: '2027-01-01', to: '2027-12-31' })
    expect(outside.income).toBe(10000)
    expect(outside.issues.join(' ')).toMatch(/außerhalb/)
    for (const file of [year({ openingBalance: 1.5 }), year({ bookings: [booking({ date: '2026-02-30' })] }), year({ bookings: [booking({ amount: -1 })] })]) {
      const report = buildOrganizationReport([file], config(), period)
      expect(report.accounts[0].closingBalance).toBeNull()
      expect(report.issues.join(' ')).toMatch(/nicht eindeutig/)
    }
  })

  test.each([
    { from: '', to: '2026-12-31' }, { from: '2026-02-30', to: '2026-12-31' },
    { from: '2026-02-01', to: '2026-01-31' }, { from: '2026-01-01', to: 'kein Datum' },
  ])('liefert bei ungültigem Zeitraum einen leeren Bericht mit Hinweis: %j', (invalid) => {
    const report = buildOrganizationReport([year({ bookings: [booking()] })], config(), invalid)
    expect(report.bookings).toEqual([])
    expect(report.issues).toEqual(['Bitte einen gültigen Berichtszeitraum auswählen.'])
  })

  test('weist Summen außerhalb des sicheren Centbereichs aus', () => {
    const report = buildOrganizationReport([year({ bookings: [booking({ amount: Number.MAX_SAFE_INTEGER }), booking({ id: 'b2', amount: 1 })] })], config(), period)
    expect(report.issues.join(' ')).toMatch(/sicheren Cent-Zahlenbereich/)
    expect(report.accounts[0].closingBalance).toBeNull()
  })

  test('Bereichssummen plus offene Beträge stimmen mit sämtlichen Außenbewegungen überein', () => {
    const assigned = booking({ id: 'assigned', type: 'ausgabe', amount: 12001 })
    const parts: ActivityAllocation[] = [{ area: 'Z', amount: 8001 }, { area: 'W', amount: 4000 }]
    const files = frozen([year({ bookings: [assigned, booking({ id: 'income' }), booking({ id: 'open-expense', type: 'ausgabe', amount: 999 })] })])
    const organization = frozen(config({ assignments: { [bookingKey(ref('haupt', 2026, 'assigned'))]: makeAssignment(assigned, parts) } }))
    const report = buildOrganizationReport(files, organization, period)
    expect(report.areas.reduce((sum, area) => sum + area.income, 0) + report.unassignedIncome).toBe(report.income)
    expect(report.areas.reduce((sum, area) => sum + area.expenses, 0) + report.unassignedExpenses).toBe(report.expenses)
    expect(report.areas.reduce((sum, area) => sum + area.result, 0) + report.unassignedIncome - report.unassignedExpenses).toBe(report.result)
    expect(report.result).toBe(-3000)
  })
})

describe('Eigene Umbuchungen', () => {
  test('verknüpft eine Ausgabe mit einer Einnahme unabhängig von der Auswahlreihenfolge', () => {
    const { files, transfer } = transferFixture()
    const reversed = createTransfer(frozen(files), transfer.to, transfer.from)
    expect(reversed).toMatchObject({ from: transfer.from, to: transfer.to, amount: 10000, fromDate: '2025-12-31', toDate: '2026-01-02' })
    expect(reversed.id.length).toBeGreaterThan(0)
  })

  test('validiert Transfers über den vollen Snapshot vor dem Zeitraum-/Kontenfilter', () => {
    const { files, transfer } = transferFixture()
    const report = buildOrganizationReport(frozen(files), frozen(config({ transfers: [transfer] })), { ...period, kontos: ['zweit'] })
    expect(report).toMatchObject({ income: 0, expenses: 0, result: 0, openCount: 0, transferCount: 1, transferVolume: 10000, issues: [] })
    expect(report.bookings[0]).toMatchObject({ transferId: transfer.id, status: 'assigned', allocations: [] })
    expect(report.accounts[0]).toMatchObject({ openingBalance: 5000, closingBalance: 15000 })
    const december = buildOrganizationReport(files, config({ transfers: [transfer] }), { from: '2025-12-01', to: '2025-12-31', kontos: ['haupt'] })
    expect(december).toMatchObject({ income: 0, expenses: 0, transferCount: 1, transferVolume: 10000 })
    expect(december.accounts[0]).toMatchObject({ openingBalance: 20000, closingBalance: 10000 })
  })

  test('erkennt eine geänderte oder entfernte Gegenbewegung statt Beträge verschwinden zu lassen', () => {
    const { files, transfer } = transferFixture()
    for (const changed of [files.filter((file) => file.konto !== 'haupt'), files.map((file) => file.year === 2025 ? { ...file, bookings: [] } : file), files.map((file) => file.year === 2025 ? { ...file, bookings: file.bookings.map((entry) => ({ ...entry, amount: 9999 })) } : file)]) {
      const report = buildOrganizationReport(changed, config({ transfers: [transfer] }), { ...period, kontos: ['zweit'] })
      expect(report.income).toBe(10000)
      expect(report.transferCount).toBe(0)
      expect(report.openCount).toBe(1)
      expect(report.issues.join(' ')).toMatch(/Umbuchung/)
    }
  })

  test('jede Bewegung darf nur einmal verknüpft sein; doppelte IDs neutralisieren nichts', () => {
    const { files, transfer } = transferFixture()
    for (const transfers of [[transfer, transfer], [transfer, { ...transfer, id: 'zweite-id' }]]) {
      const report = buildOrganizationReport(files, config({ transfers }), { ...period, kontos: ['zweit'] })
      expect(report.transferCount).toBe(0)
      expect(report.income).toBe(10000)
      expect(report.bookings[0].status).toBe('invalid')
    }
  })

  test('Gebühren bleiben eine eigenständige Ausgabe neben einer neutralen Umbuchung', () => {
    const { files, transfer } = transferFixture()
    const next = files.map((file) => file.konto === 'zweit' ? { ...file, bookings: [...file.bookings, booking({ id: 'gebuehr', amount: 123, type: 'ausgabe' })] } : file)
    const report = buildOrganizationReport(next, config({ transfers: [transfer] }), period)
    expect(report).toMatchObject({ income: 0, expenses: 123, result: -123, openCount: 1 })
  })

  test('verknüpft keine unbekannten, mehrdeutigen oder unpassenden Bewegungen', () => {
    const { files, transfer } = transferFixture()
    expect(() => createTransfer(files, { ...transfer.from, konto: '../daten' }, transfer.to)).toThrow(/Ungültige/)
    expect(() => createTransfer(files, transfer.from, { ...transfer.to, konto: 'haupt' })).toThrow(/verschiedene/)
    expect(() => createTransfer(files, transfer.from, ref('zweit', 2026, 'fehlt'))).toThrow(/eindeutig/)
    expect(() => createTransfer([...files, files[0]], transfer.from, transfer.to)).toThrow(/eindeutig/)
    const changed = (patch: Partial<Booking>) => files.map((file) => file.konto === 'zweit' ? { ...file, bookings: file.bookings.map((entry) => ({ ...entry, ...patch })) } : file)
    expect(() => createTransfer(changed({ type: 'ausgabe' }), transfer.from, transfer.to)).toThrow(/Ausgabe und eine Einnahme/)
    expect(() => createTransfer(changed({ amount: 9999 }), transfer.from, transfer.to)).toThrow(/gleich und positiv/)
    expect(() => createTransfer(changed({ date: '2026-02-30' }), transfer.from, transfer.to)).toThrow(/Buchungsdaten/)
  })
})

describe('Validierung gespeicherter Vereinsdaten', () => {
  test('akzeptiert vollständige Einstellungen und prüfbare bestätigte Zuordnungen', () => {
    const { transfer } = transferFixture()
    expect(validateOrganizationConfig(config())).toEqual([])
    expect(validateOrganizationConfig(config({
      rules: [{ id: 'r1', konto: 'haupt', categoryId: 'category', area: 'I' }],
      assignments: { [bookingKey(ref())]: makeAssignment(booking(), allocations) }, transfers: [transfer],
    }))).toEqual([])
  })

  test.each([null, [], 42, 'Verein'])('lehnt ungültige Einstellungen als Ganzes ab: %j', (invalid) => {
    expect(validateOrganizationConfig(invalid).length).toBeGreaterThan(0)
  })

  test.each([
    { name: 42 }, { name: 'x'.repeat(201) }, { treasurerName: null }, { treasurerName: 'x'.repeat(201) },
    { rules: null }, { assignments: [] }, { transfers: {} },
  ])('prüft Stammdaten und Pflichtsammlungen: %j', (invalid) => {
    expect(validateOrganizationConfig({ ...config(), ...invalid }).length).toBeGreaterThan(0)
  })

  test('lehnt doppelte und fachlich ungültige Kategorie-Vorgaben ab', () => {
    const rule = { id: 'r', konto: 'haupt', categoryId: 'category', area: 'I' }
    for (const rules of [[null], [{ ...rule, area: 'falsch' }], [{ ...rule, konto: 'k2' }], [rule, rule], [rule, { ...rule, id: 'andere' }]]) {
      expect(validateOrganizationConfig({ ...config(), rules }).length).toBeGreaterThan(0)
    }
  })

  test('lehnt beschädigte Fingerprints und Referenzschlüssel ab', () => {
    const assignment = makeAssignment(booking(), allocations)
    for (const assignments of [
      { 'kein-json': assignment }, { '["haupt",2026]': assignment }, { '["../",2026,"b1"]': assignment },
      { [bookingKey(ref())]: null }, { [bookingKey(ref())]: { ...assignment, date: '2026-02-30' } },
      { [bookingKey(ref())]: { ...assignment, type: 'falsch' } }, { [bookingKey(ref())]: { ...assignment, allocations: [] } },
      { [bookingKey(ref())]: { ...assignment, amount: '10000' } },
    ]) expect(validateOrganizationConfig({ ...config(), assignments }).length).toBeGreaterThan(0)
  })

  test('lehnt ungültige und mehrfach verwendete Transferreferenzen ab', () => {
    const { transfer } = transferFixture()
    for (const transfers of [
      [null], [{ ...transfer, amount: -1 }], [{ ...transfer, amount: 1.5 }],
      [{ ...transfer, fromDate: '2026-02-30' }], [{ ...transfer, to: { ...transfer.to, year: '2026' } }],
      [{ ...transfer, to: { ...transfer.to, konto: 'haupt' } }], [transfer, transfer], [transfer, { ...transfer, id: 'andere' }],
    ]) expect(validateOrganizationConfig({ ...config(), transfers }).length).toBeGreaterThan(0)
  })
})
