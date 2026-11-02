import { describe, expect, test } from 'vitest'
import { emptyYearFile } from '../defaults'
import { appendToDraft, importSelectedRows } from '../importDraft'
import { reserveImportReceiptNumbers } from '../importReceipts'
import { newImportRows } from '../importRows'
import type { Booking, ImportDraftRow, YearFile } from '../types'

const row = (hash: string, patch: Partial<ImportDraftRow> = {}): ImportDraftRow => ({
  date: '2026-06-01', amount: -1000, bankText: hash, hash, name: 'Test',
  description: 'Rechnung', categoryId: 'm', selected: true, isUmsatz: false,
  receiptStatus: 'vorhanden', ...patch,
})
const booking = (patch: Partial<Booking> = {}): Booking => ({
  id: 'bestehend', seq: 1, refNo: 1, categoryId: 'm', date: '2026-06-01',
  description: 'Erfasst', amount: 1000, type: 'ausgabe', isUmsatz: false,
  nonUmsatzAmount: 0, note: '', source: 'manuell', ...patch,
})
const file = (rows: ImportDraftRow[], bookings: Booking[] = []): YearFile => ({
  ...emptyYearFile(2026), bookings,
  categories: [{ id: 'm', name: 'Maskenball', code: 'M', sortOrder: 1, active: true }],
  importDraft: { fileName: 'Test.csv', skipped: 0, rows },
})

describe('Ausschließlich neue Importumsätze', () => {
  test('liefert ohne offenen Entwurf keine neuen Umsätze', () => {
    expect(newImportRows({ ...file([]), importDraft: null })).toEqual([])
    expect(newImportRows(file([]))).toEqual([])
  })

  test('blendet importierte, manuell vorhandene und wiederholte Zeilen aus', () => {
    const original = file([
      row('importiert'), row('manuell'), row('neu', { amount: -2000 }),
      row('neu', { amount: -2000 }),
    ], [booking(), booking({ id: 'import', importHash: 'importiert', source: 'import', refNo: 2 })])
    const snapshot = JSON.stringify(original)
    expect(newImportRows(original)).toEqual([{ row: original.importDraft!.rows[2], index: 2 }])
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  test('erkennt auch frühere Importkennungen in Buchungen und Entwürfen', () => {
    const original = file([row('aktuell', { legacyHashes: ['alt'] }), row('neuer-hash')], [
      booking({ importHash: 'alt', source: 'import' }),
      booking({ id: 'b2', importHash: 'migriert', legacyImportHashes: ['neuer-hash'], source: 'import' }),
    ])
    expect(newImportRows(original)).toEqual([])
  })

  test('behält ursprüngliche Indizes und verbraucht manuelle Treffer nur einmal', () => {
    const original = file([row('alt'), row('anderer-umsatz')], [booking()])
    expect(newImportRows(original).map(({ index }) => index)).toEqual([1])
    expect(newImportRows(original).map(({ row }) => row.hash)).toEqual(['anderer-umsatz'])
    expect(original.importDraft!.rows).toHaveLength(2)
  })

  test('übernimmt keine unsichtbaren vorausgewählten manuellen Duplikate', () => {
    const original = file([
      row('alt', { receiptRef: { categoryId: 'm', refNo: 2 } }),
      row('neu', { amount: -2000, receiptRef: { categoryId: 'm', refNo: 3 } }),
    ], [booking()])
    const next = importSelectedRows(original)
    expect(next.bookings.map((b) => [b.importHash, b.refNo])).toEqual([[undefined, 1], ['neu', 3]])
    expect(next.bookings[0]).toEqual(original.bookings[0])
    expect(next.importDraft!.rows).toEqual([original.importDraft!.rows[0]])
    expect(newImportRows(next)).toEqual([])
    expect(next.refNoCounters!.m).toBe(3)
  })

  test('vergibt für unsichtbare manuelle Duplikate keine neuen Belegnummern', () => {
    const original = file([row('alt'), row('neu', { amount: -2000 })], [booking()])
    const next = reserveImportReceiptNumbers(original)
    expect(next.importDraft!.rows[0].receiptRef).toBeUndefined()
    expect(next.importDraft!.rows[1].receiptRef).toEqual({ categoryId: 'm', refNo: 2 })
  })

  test('zählt beim Hintergrundabruf nur neue Zeilen im vollständigen Entwurf', () => {
    const original = file([row('manuell')], [booking()])
    const incoming = { date: '2026-06-01', amount: -1000, hash: 'zweiter',
      name: 'Test', description: 'Andere Zahlung', legacyHashes: [] }
    const result = appendToDraft(original, [incoming, { ...incoming }], 'Bank')
    const next = result.mutate(original)
    expect(result.added).toBe(1)
    expect(next.importDraft!.rows).toHaveLength(3)
    expect(newImportRows(next).map(({ index }) => index)).toEqual([1])
    expect(next.importDraft!.rows[0]).toEqual(original.importDraft!.rows[0])
  })

  test('meldet bei ausschließlich bereits vorhandenen Bankumsätzen null neue', () => {
    const original = file([], [booking()])
    const result = appendToDraft(original, [{
      date: '2026-06-01', amount: -1000, hash: 'manuell', name: 'Test',
      description: 'Schon erfasst', legacyHashes: [],
    }], 'Bank')
    expect(result.added).toBe(0)
    expect(newImportRows(result.mutate(original))).toEqual([])
  })
})
