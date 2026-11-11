import { describe, expect, test } from 'vitest'
import { emptyYearFile } from '@shared/defaults'
import { chronological, computeBookings, yearTotals } from '@shared/ledger'
import { bookingScope, calendarMonthFilters, createBookingFilters, filterBookings, hasBookingFilters } from '../bookingFilters'
import type { Booking, YearFile } from '@shared/types'

const booking = (id: string, patch: Partial<Booking> = {}): Booking => ({
  id, seq: 1, refNo: 1, categoryId: 'm', date: '2026-01-10', name: 'Test',
  description: id, amount: 10000, type: 'einnahme', isUmsatz: true,
  nonUmsatzAmount: 0, note: '', source: 'manuell', ...patch,
})
const file: YearFile = {
  ...emptyYearFile(2026),
  categories: [
    { id: 'm', name: 'Maskenball', code: 'M', active: true, sortOrder: 1 },
    { id: 'b', name: 'Beiträge', code: 'B', active: false, sortOrder: 2 },
  ],
  bookings: [
    booking('eintritt'),
    booking('getränke', { seq: 2, refNo: 2, type: 'ausgabe', amount: 2000, nonUmsatzAmount: 500 }),
    booking('wechselgeld', { seq: 3, refNo: 3, type: 'ausgabe', isUmsatz: false, date: '2026-02-01' }),
    booking('voll-ausgenommen', { seq: 4, refNo: 1, categoryId: 'b', nonUmsatzAmount: 10000 }),
    booking('rechnung-februar', { seq: 5, refNo: 4, type: 'ausgabe', amount: 7000,
      date: '2026-02-10', subcategory: 'Getränke', note: 'Lieferant' }),
    booking('folgejahr', { seq: 6, refNo: 5, date: '2027-01-05', isUmsatz: false }),
  ],
}
const rows = computeBookings(file)

describe('Vorausgefüllte Buchungsfilter aus der Übersicht', () => {
  test('behält im Clean Mode echte Kassenstände einschließlich ausgeblendeter Buchungen', () => {
    const history = chronological({ ...file, openingBalance: 10000, bookings: [
      booking('alt', { categoryId: 'b', date: '2026-01-01', amount: 5000 }),
      booking('ausgabe', { seq: 2, refNo: 2, type: 'ausgabe', date: '2026-01-02', amount: 2000 }),
      booking('februar', { seq: 3, refNo: 3, date: '2026-02-01', amount: 3000 }),
    ] })
    const selected = filterBookings(history, '', createBookingFilters({ categoryId: 'm', ...calendarMonthFilters(2026, 2) }))
    expect(selected.map((r) => [r.id, r.runningBalance])).toEqual([['februar', 16000]])
    expect(history.map((r) => r.runningBalance)).toEqual([15000, 13000, 16000])
  })

  test('startet ohne Einschränkungen und ersetzt andere Filter vollständig', () => {
    const filters = createBookingFilters()
    expect(hasBookingFilters(filters)).toBe(false)
    expect(filterBookings(rows, '', filters)).toEqual(rows)
    expect(createBookingFilters({ type: 'ausgabe' })).toEqual({
      categoryId: '', amount: '', subcategory: '', receiptStatus: '', type: 'ausgabe', dateFrom: '', dateTo: '', umsatzOnly: false,
    })
  })

  test('filtert Einnahmen und Ausgaben nach Buchungsart', () => {
    expect(filterBookings(rows, '', createBookingFilters({ type: 'einnahme' })).map((r) => r.id))
      .toEqual(['eintritt', 'voll-ausgenommen', 'folgejahr'])
    expect(filterBookings(rows, '', createBookingFilters({ type: 'ausgabe' })).map((r) => r.id))
      .toEqual(['getränke', 'wechselgeld', 'rechnung-februar'])
  })

  test('zeigt genau die positiven und negativen Beiträge zur Umsatz-Kachel', () => {
    const filtered = filterBookings(rows, '', createBookingFilters({ umsatzOnly: true }))
    expect(filtered.map((r) => r.id)).toEqual(['eintritt', 'getränke', 'rechnung-februar'])
    expect(filtered.reduce((sum, r) => sum + r.umsatzAmount, 0)).toBe(yearTotals(file).umsatz)
    expect(filtered.find((r) => r.id === 'getränke')!.umsatzAmount).toBe(-1500)
  })

  test('behält sich aufhebende Umsatzbeiträge auch bei Umsatzsumme null', () => {
    const opposite = computeBookings({ ...file, bookings: [booking('plus'), booking('minus', { type: 'ausgabe' })] })
    expect(filterBookings(opposite, '', createBookingFilters({ umsatzOnly: true }))).toHaveLength(2)
  })

  test('filtert nach Kategorie-ID, auch bei inaktiver Kategorie', () => {
    expect(filterBookings(rows, '', createBookingFilters({ categoryId: 'b' })).map((r) => r.id)).toEqual(['voll-ausgenommen'])
  })

  test('unterscheidet denselben Monat in unterschiedlichen Kalenderjahren', () => {
    expect(filterBookings(rows, '', createBookingFilters({ ...calendarMonthFilters(2026, 1) })).map((r) => r.id))
      .toEqual(['eintritt', 'getränke', 'voll-ausgenommen'])
    expect(filterBookings(rows, '', createBookingFilters({ ...calendarMonthFilters(2027, 1) })).map((r) => r.id)).toEqual(['folgejahr'])
  })

  test('kombiniert Vorauswahl mit Suche, Betrag und Unterkategorie', () => {
    const filters = { ...createBookingFilters({ categoryId: 'm', type: 'ausgabe', ...calendarMonthFilters(2026, 2), umsatzOnly: true }),
      amount: '70,00', subcategory: ' getränke ' }
    expect(filterBookings(rows, 'Lieferant', filters).map((r) => r.id)).toEqual(['rechnung-februar'])
    expect(filterBookings(rows, 'anderer Name', filters)).toEqual([])
  })

  test.each(['kaputt', '-1'])('liefert bei ungültigem Betragsfilter keine Treffer: %s', (amount) => {
    expect(filterBookings(rows, '', { ...createBookingFilters(), amount })).toEqual([])
  })

  test.each([
    { type: 'einnahme' as const }, { categoryId: 'm' }, { ...calendarMonthFilters(2026, 1) },
    { dateFrom: '2026-01-01' }, { dateTo: '2026-01-31' }, { umsatzOnly: true }, { amount: '0' }, { subcategory: 'Getränke' },
  ])('erkennt jeden aktiven Filter zum Zurücksetzen und Exportieren: %j', (patch) => {
    expect(hasBookingFilters({ ...createBookingFilters(), ...patch })).toBe(true)
  })

  test('bindet Navigationsfilter an Buch und Kassenjahr', () => {
    expect(bookingScope({ year: 2026 })).toBe('haupt:2026')
    expect(bookingScope({ konto: 'zweit', year: 2025 })).toBe('zweit:2025')
  })
})


describe('Kalenderfilter von–bis', () => {
  test.each([
    [2026, 2, '2026-02-01', '2026-02-28'],
    [2024, 2, '2024-02-01', '2024-02-29'],
    [2026, 4, '2026-04-01', '2026-04-30'],
    [2025, 12, '2025-12-01', '2025-12-31'],
  ])('verwendet tatsächliche Monatsgrenzen für %i/%i', (year, month, dateFrom, dateTo) => {
    expect(calendarMonthFilters(year, month)).toEqual({ dateFrom, dateTo })
  })

  test('schließt beide Grenztage ein und unterstützt einen Zeitraum über den Jahreswechsel', () => {
    expect(filterBookings(rows, '', createBookingFilters({ dateFrom: '2026-02-01', dateTo: '2026-02-10' })).map((r) => r.id))
      .toEqual(['wechselgeld', 'rechnung-februar'])
    expect(filterBookings(rows, '', createBookingFilters({ dateFrom: '2026-02-10', dateTo: '2027-01-05' })).map((r) => r.id))
      .toEqual(['rechnung-februar', 'folgejahr'])
  })

  test('erlaubt einseitig offene Zeiträume', () => {
    expect(filterBookings(rows, '', createBookingFilters({ dateFrom: '2026-02-10' })).map((r) => r.id))
      .toEqual(['rechnung-februar', 'folgejahr'])
    expect(filterBookings(rows, '', createBookingFilters({ dateTo: '2026-01-10' })).map((r) => r.id))
      .toEqual(['eintritt', 'getränke', 'voll-ausgenommen'])
  })

  test.each([
    { dateFrom: '2026-02-11', dateTo: '2026-02-10' },
    { dateFrom: '2026-02-29' }, { dateTo: '2026-04-31' },
    { dateFrom: '01.02.2026' }, { dateTo: '2026-13-01' },
  ])('liefert bei beschädigtem oder umgekehrtem Zeitraum keine Treffer: %j', (range) => {
    expect(filterBookings(rows, '', createBookingFilters(range))).toEqual([])
  })

  test.each([[2026, 0], [2026, 13], [2026, 1.5], [NaN, 1], [999, 1], [10000, 1]])('lehnt ungültige Monatsvorgaben ab: %s/%s', (year, month) => {
    expect(() => calendarMonthFilters(year, month)).toThrow(RangeError)
  })
})
