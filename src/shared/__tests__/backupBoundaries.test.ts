import { describe, expect, test } from 'vitest'
import { buildBackup, validateBackup } from '../backup'
import type { YearFile } from '../types'

function data() {
  const file: YearFile = { schemaVersion: 1, year: 2026, openingBalance: 0, clubName: 'Test', treasurerName: 'Test',
    categories: [{ id: 'b', name: 'Beiträge', code: 'B', sortOrder: 1, active: true }],
    bookings: [{ id: 'b1', date: '2026-02-01', seq: 1, refNo: 1, categoryId: 'b', description: 'Test',
      amount: 1000, nonUmsatzAmount: 0, type: 'einnahme', isUmsatz: false, note: '', source: 'manuell' }],
  }
  return buildBackup([file], undefined, '2026-11-01T00:00:00Z')
}

describe('backup boundaries', () => {
  test.each(['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-01'])('refuses impossible booking and draft dates: %s', (date) => {
    const backup = data()
    backup.years[0].bookings[0].date = date
    expect(validateBackup(backup).ok).toBe(false)
    backup.years[0].bookings[0].date = '2026-02-01'
    backup.years[0].importDraft = { fileName: 'test.csv', skipped: 0, rows: [{ date, bankText: 'Test', amount: 100,
      hash: 'h', name: '', description: '', selected: false, categoryId: '', isUmsatz: false }] }
    expect(validateBackup(backup).ok).toBe(false)
  })
  test('accepts real leap days', () => {
    const backup = data(); backup.years[0].year = 2024; backup.years[0].bookings[0].date = '2024-02-29'
    expect(validateBackup(backup).ok).toBe(true)
  })
  test.each(['amount', 'nonUmsatzAmount', 'seq', 'refNo'] as const)('refuses unsafe booking integers: %s', (field) => {
    const backup = data(); backup.years[0].bookings[0][field] = Number.MAX_SAFE_INTEGER + 1
    expect(validateBackup(backup).ok).toBe(false)
  })
  test('refuses unsafe opening balances, draft amounts, and split amounts', () => {
    const backup = data(); backup.years[0].openingBalance = Number.MAX_SAFE_INTEGER + 1
    expect(validateBackup(backup).ok).toBe(false)
    backup.years[0].openingBalance = 0
    backup.years[0].importDraft = { fileName: 'test.csv', skipped: 0, rows: [{ date: '2026-02-01', bankText: 'Test', amount: Number.MAX_SAFE_INTEGER + 1,
      hash: 'h', name: '', description: '', selected: false, categoryId: '', isUmsatz: false }] }
    expect(validateBackup(backup).ok).toBe(false)
    backup.years[0].importDraft.rows[0].amount = 100
    backup.years[0].importDraft.rows[0].splits = [{ id: 's', description: '', categoryId: '', amount: Number.MAX_SAFE_INTEGER + 1, isUmsatz: false }]
    expect(validateBackup(backup).ok).toBe(false)
  })

  test('refuses overflowing income totals even when each booking and the final balance are safe', () => {
    const backup = data(), first = backup.years[0].bookings[0]
    backup.years[0].bookings = [
      { ...first, amount: Number.MAX_SAFE_INTEGER, seq: 1 },
      { ...first, id: 'expense', amount: Number.MAX_SAFE_INTEGER, type: 'ausgabe', seq: 2 },
      { ...first, id: 'income', amount: 1, seq: 3 },
    ]
    expect(validateBackup(backup).ok).toBe(false)
  })

  test.each(['einnahme', 'ausgabe'] as const)('refuses an overflowing chronological %s balance', (type) => {
    const backup = data()
    backup.years[0].openingBalance = type === 'einnahme' ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER
    backup.years[0].bookings[0] = { ...backup.years[0].bookings[0], type, amount: 1 }
    expect(validateBackup(backup).ok).toBe(false)
  })

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid reserved account sequence: %j', (kontoSequence) => {
    const backup = data()
    backup.settings = { kontoSequence }
    expect(validateBackup(backup).ok).toBe(false)
  })

  test.each(['k9999999999999999999', 'k9007199254740992'])('refuses account identifiers outside the exact integer range: %s', (konto) => {
    const backup = data()
    backup.years[0].konto = konto
    expect(validateBackup(backup).ok).toBe(false)
  })
})
