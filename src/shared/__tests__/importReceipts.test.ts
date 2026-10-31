import { describe, expect, test } from 'vitest'
import { emptyYearFile } from '../defaults'
import { clearImportSelection, importSelectedRows } from '../importDraft'
import { computeBookings, nextRefNo } from '../ledger'
import { importReceiptLabel, reserveImportReceiptNumbers } from '../importReceipts'
import type { Booking, ImportDraftRow, YearFile } from '../types'

const row = (hash: string, patch: Partial<ImportDraftRow> = {}): ImportDraftRow => ({
  hash, date: '2026-06-01', amount: -1000, bankText: hash, name: 'Test GmbH',
  description: 'Rechnung', categoryId: 'm', isUmsatz: true, selected: true,
  receiptStatus: 'vorhanden', ...patch,
})

const booking = (refNo: number, patch: Partial<Booking> = {}): Booking => ({
  id: `b${refNo}`, seq: refNo, refNo, date: '2026-01-01', categoryId: 'm',
  description: 'Bestehend', amount: 500, type: 'ausgabe', isUmsatz: false,
  nonUmsatzAmount: 0, note: '', source: 'manuell', ...patch,
})

function file(rows: ImportDraftRow[] = [], bookings: Booking[] = []): YearFile {
  return {
    ...emptyYearFile(2026), bookings,
    categories: [
      { id: 'm', code: 'M', name: 'Maskenball', active: true, sortOrder: 1 },
      { id: 'b', code: 'B', name: 'Beiträge', active: true, sortOrder: 2 },
    ],
    importDraft: { fileName: 'Test.csv', skipped: 0, rows },
  }
}

const refs = (f: YearFile) => f.importDraft!.rows.map((r) => importReceiptLabel(f, r))

describe('Feste Belegnummern im Importentwurf', () => {
  test('lässt jede bestehende Buchung und Belegnummer bei Migration und Import unverändert', () => {
    const bookings = [
      booking(1), booking(7, { id: 'sieben', date: '2026-04-01' }),
      booking(4, { id: 'andere', categoryId: 'b', receiptStatus: 'offen' }),
    ]
    const original = file([row('rückdatiert', { date: '2026-01-01' })], bookings)
    const before = computeBookings(original).map((b) => ({ id: b.id, ref: b.ref }))
    const prepared = reserveImportReceiptNumbers(original)
    expect(prepared.bookings).toBe(original.bookings)
    expect(computeBookings(prepared).map((b) => ({ id: b.id, ref: b.ref }))).toEqual(before)
    const committed = importSelectedRows(prepared)
    expect(committed.bookings.slice(0, bookings.length)).toEqual(bookings)
    expect(computeBookings(committed).filter((b) => bookings.some((old) => old.id === b.id))
      .map((b) => ({ id: b.id, ref: b.ref }))).toEqual(before)
  })

  test('reserviert sofort nach Kategorie und Belegstatus, auch vor vollständiger Eingabe', () => {
    const original = file([row('neu', { description: '', name: '', selected: false })], [booking(7)])
    const next = reserveImportReceiptNumbers(original)
    expect(refs(next)).toEqual(['M8'])
    expect(nextRefNo(next, 'm')).toBe(9)
    expect(original.importDraft!.rows[0].receiptRef).toBeUndefined()
    expect(reserveImportReceiptNumbers(next)).toBe(next)
  })

  test('wartet auf beide Angaben und akzeptiert beide Eingabereihenfolgen', () => {
    const withoutCategory = reserveImportReceiptNumbers(file([row('a', { categoryId: '' })]))
    const withoutReceipt = reserveImportReceiptNumbers(file([row('b', { receiptStatus: 'offen' })]))
    expect(refs(withoutCategory)).toEqual([undefined])
    expect(refs(withoutReceipt)).toEqual([undefined])
    const categoryThenReceipt = reserveImportReceiptNumbers({ ...withoutReceipt, importDraft: {
      ...withoutReceipt.importDraft!, rows: [row('b')],
    } })
    const receiptThenCategory = reserveImportReceiptNumbers({ ...withoutCategory, importDraft: {
      ...withoutCategory.importDraft!, rows: [row('a')],
    } })
    expect(refs(categoryThenReceipt)).toEqual(['M1'])
    expect(refs(receiptThenCategory)).toEqual(['M1'])
  })

  test('behält zuerst vergebene Nummern unabhängig von Zeilenreihenfolge und Auswahl', () => {
    const laterFirst = reserveImportReceiptNumbers(file([
      row('früh', { receiptStatus: 'offen' }), row('spät'),
    ]))
    const prepared = reserveImportReceiptNumbers({ ...laterFirst, importDraft: {
      ...laterFirst.importDraft!, rows: laterFirst.importDraft!.rows.map((r) => ({ ...r, receiptStatus: 'vorhanden' })),
    } })
    expect(refs(prepared)).toEqual(['M2', 'M1'])
    const deselected = clearImportSelection(prepared)
    expect(refs(deselected)).toEqual(['M2', 'M1'])
    expect(refs(reserveImportReceiptNumbers(JSON.parse(JSON.stringify(deselected))))).toEqual(['M2', 'M1'])
  })

  test('behält eine beschriftete Nummer bei Belegstatuswechseln', () => {
    const prepared = reserveImportReceiptNumbers(file([row('a')]))
    const off = reserveImportReceiptNumbers({ ...prepared, importDraft: {
      ...prepared.importDraft!, rows: prepared.importDraft!.rows.map((r) => ({ ...r, receiptStatus: 'offen' })),
    } })
    expect(refs(off)).toEqual(['M1'])
    expect(nextRefNo(off, 'm')).toBe(2)
  })

  test('verwendet je Kategorie eigene Nummern und vergibt bei Kategoriewechsel neu', () => {
    const first = reserveImportReceiptNumbers(file([row('a')], [booking(3)]))
    const moved = reserveImportReceiptNumbers({ ...first, importDraft: {
      ...first.importDraft!, rows: first.importDraft!.rows.map((r) => ({ ...r, categoryId: 'b' })),
    } })
    expect(refs(moved)).toEqual(['B1'])
    expect(nextRefNo(moved, 'm')).toBe(5)
    expect(nextRefNo(moved, 'b')).toBe(2)
  })

  test('übernimmt exakt die angezeigten Nummern auch bei umgekehrten Teilimporten', () => {
    const prepared = reserveImportReceiptNumbers(file([row('a', { selected: false }), row('b')], [booking(4)]))
    expect(refs(prepared)).toEqual(['M5', 'M6'])
    const second = importSelectedRows(prepared)
    expect(computeBookings(second).find((b) => b.importHash === 'b')?.ref).toBe('M6')
    expect(refs(second)).toEqual(['M5'])
    const both = importSelectedRows({ ...second, importDraft: {
      ...second.importDraft!, rows: second.importDraft!.rows.map((r) => ({ ...r, selected: true })),
    } })
    expect(computeBookings(both).find((b) => b.importHash === 'a')?.ref).toBe('M5')
    expect(both.importDraft).toBeNull()
    expect(nextRefNo(both, 'm')).toBe(7)
  })

  test('hält Nummern für manuelle Buchungen und Stapel frei', () => {
    const prepared = reserveImportReceiptNumbers(file([row('a'), row('b')], [booking(1)]))
    const withManual = reserveImportReceiptNumbers({ ...prepared, bookings: [
      ...prepared.bookings, booking(nextRefNo(prepared, 'm')),
    ] })
    expect(nextRefNo(withManual, 'm')).toBe(5)
    const committed = importSelectedRows(withManual)
    expect(committed.bookings.map((b) => b.refNo)).toEqual([1, 4, 2, 3])
  })

  test('nummeriert auch Buchungen ohne Beleg nach reservierten Nummern', () => {
    const prepared = reserveImportReceiptNumbers(file([row('ohne', { receiptStatus: 'offen' }), row('mit')]))
    const committed = importSelectedRows(prepared)
    expect(committed.bookings.map((b) => b.refNo)).toEqual([2, 1])
  })

  test('reserviert für jede Teilbuchung eine eigene endgültige Nummer', () => {
    const prepared = reserveImportReceiptNumbers(file([row('split', { splits: [
      { id: 's1', categoryId: 'm', description: 'Getränke', amount: 300, isUmsatz: true },
      { id: 's2', categoryId: 'b', description: 'Beiträge', amount: 400, isUmsatz: true },
      { id: 's3', categoryId: 'm', description: 'Essen', amount: 300, isUmsatz: true },
    ] })]))
    expect(prepared.importDraft!.rows[0].splits!.map((s) => importReceiptLabel(prepared, s))).toEqual(['M1', 'B1', 'M2'])
    expect(computeBookings(importSelectedRows(prepared)).map((b) => b.ref)).toEqual(['M1', 'B1', 'M2'])
  })

  test('vergibt bereits benutzte Nummern auch nach Verwerfen und Löschen nicht erneut', () => {
    const prepared = reserveImportReceiptNumbers(file([row('a')], [booking(7)]))
    const removed = reserveImportReceiptNumbers({ ...prepared, bookings: [], importDraft: null })
    expect(nextRefNo(removed, 'm')).toBe(9)
  })

  test('lässt importierte, wiederholte und fremde Jahreszeilen ohne neue Reservierung', () => {
    const existing = booking(1, { importHash: 'importiert', source: 'import' })
    const prepared = reserveImportReceiptNumbers(file([
      row('importiert'), row('neu'), row('neu'), row('alt', { date: '2025-01-01' }),
      row('unbekannt', { categoryId: 'nicht-vorhanden' }),
    ], [existing]))
    expect(refs(prepared)).toEqual([undefined, 'M2', undefined, undefined, undefined])
  })

  test('prüft Duplikate und Vollständigkeit nochmals beim endgültigen Übernehmen', () => {
    const prepared = reserveImportReceiptNumbers(file([
      row('a'), row('leer', { description: '' }), row('a'),
    ]))
    const committed = importSelectedRows(prepared)
    expect(committed.bookings).toHaveLength(1)
    expect(committed.bookings[0].importHash).toBe('a')
    expect(importSelectedRows(committed).bookings).toHaveLength(1)
  })

  test('repariert kollidierende oder ungültige Entwurfsnummern ohne doppelte Belege', () => {
    const prepared = reserveImportReceiptNumbers(file([
      row('a', { receiptRef: { categoryId: 'm', refNo: 3 } }),
      row('b', { receiptRef: { categoryId: 'm', refNo: 3 } }),
      row('c', { receiptRef: { categoryId: 'm', refNo: -1 } }),
    ], [booking(3)]))
    expect(refs(prepared)).toEqual(['M4', 'M5', 'M6'])
  })

  test('ändert leere Jahresdateien und Dateien ohne Entwurf nicht unnötig', () => {
    const empty = { ...file(), importDraft: null }
    expect(reserveImportReceiptNumbers(empty)).toBe(empty)
    expect(importSelectedRows(empty)).toBe(empty)
    expect(clearImportSelection(empty)).toBe(empty)
  })

  test('bricht bei erschöpftem Zahlenbereich ab, statt eine unsichere Nummer zu vergeben', () => {
    const original = { ...file([row('a')]), refNoCounters: { m: Number.MAX_SAFE_INTEGER } }
    expect(() => nextRefNo(original, 'm')).toThrow('Belegnummer')
    expect(() => reserveImportReceiptNumbers(original)).toThrow('Belegnummer')
    expect(original.importDraft!.rows[0].receiptRef).toBeUndefined()
  })

  test('bricht auch einen Stapel ohne Belege vor unsicheren doppelten Nummern ab', () => {
    const original = { ...file([
      row('a', { receiptStatus: 'offen' }), row('b', { receiptStatus: 'offen' }),
      row('c', { receiptStatus: 'offen' }),
    ]), refNoCounters: { m: Number.MAX_SAFE_INTEGER - 1 } }
    expect(() => importSelectedRows(original)).toThrow('Belegnummer')
    expect(original.bookings).toEqual([])
  })
})

describe('Importauswahl beim Öffnen', () => {
  test('entfernt alle gespeicherten Auswahlen und bewahrt die gesamte Zuweisungsarbeit', () => {
    const prepared = reserveImportReceiptNumbers(file([row('a'), row('a'), row('alt', { date: '2025-01-01' })]))
    const cleared = clearImportSelection(prepared)
    expect(cleared.importDraft!.rows.every((r) => !r.selected)).toBe(true)
    expect(cleared.importDraft!.rows.map((r) => ({ ...r, selected: true }))).toEqual(prepared.importDraft!.rows)
    expect(prepared.importDraft!.rows.every((r) => r.selected)).toBe(true)
    expect(clearImportSelection(cleared)).toBe(cleared)
  })
})
