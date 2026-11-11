import { describe, expect, test } from 'vitest'
import { buildBackup, validateBackup } from '../backup'
import { bookingKey } from '../organization'
import type { OrganizationConfig } from '../organization'
import type { YearFile } from '../types'

function year(konto = 'haupt', yearNumber = 2026): YearFile {
  return {
    schemaVersion: 1, konto, year: yearNumber, openingBalance: 0,
    clubName: 'Historischer Vereinsname', treasurerName: 'Historische Kassenführung',
    categories: [{ id: 'beitrag', name: 'Beiträge', code: 'B', sortOrder: 10, active: true, praesentation: 'aus' }],
    bookings: [{ id: 'b1', categoryId: 'beitrag', date: `${yearNumber}-02-01`, description: 'Beitrag',
      type: 'einnahme', amount: 10000, isUmsatz: false, nonUmsatzAmount: 0, note: '', seq: 1, refNo: 1, source: 'manuell' }],
  }
}

function organization(): OrganizationConfig {
  return {
    name: 'Neuer Vereinsname', treasurerName: 'Aktuelle Kassenführung',
    rules: [{ id: 'r1', konto: 'haupt', categoryId: 'beitrag', area: 'I' }],
    assignments: { [bookingKey({ konto: 'haupt', year: 2026, bookingId: 'b1' })]: {
      allocations: [{ area: 'I', amount: 6000 }, { area: 'Z', amount: 4000 }],
      amount: 10000, type: 'einnahme', date: '2026-02-01', categoryId: 'beitrag',
    } },
    transfers: [],
  }
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

describe('Vereinsdaten in vollständigen Sicherungen', () => {
  test('erhält alle Kontojahre, Stammdaten, Regeln und Centaufteilungen unverändert', () => {
    const files = [year(), year('zweit'), year('zweit', 2025)]
    const settings = { organization: organization(), theme: 'system' as const, fintsProductId: 'Produkt' }
    const backup = clone(buildBackup(files, settings, '2026-11-03T12:00:00Z'))
    const result = validateBackup(backup)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup).toEqual(backup)
    expect(result.backup.years[0].clubName).toBe('Historischer Vereinsname')
    expect(result.backup.settings?.organization?.name).toBe('Neuer Vereinsname')
  })

  test('akzeptiert vorhandene Sicherungen ohne Vereinsebene weiterhin', () => {
    const result = validateBackup(clone(buildBackup([year()], { logoDataUrl: null }, '2026-11-03T12:00:00Z')))
    expect(result.ok).toBe(true)
  })

  test('exportiert den übergebenen aktuellen Arbeitsspeicherstand', () => {
    const original = year()
    const current = { ...original, bookings: [{ ...original.bookings[0], description: 'Gerade geändert' }] }
    const backup = clone(buildBackup([current], { organization: organization() }, '2026-11-03T12:00:00Z'))
    expect(backup.years[0].bookings[0].description).toBe('Gerade geändert')
    expect(original.bookings[0].description).toBe('Beitrag')
  })

  test.each([null, [], 'Verein', { name: 42 }, { ...organization(), rules: null }, { ...organization(), transfers: {} }])(
    'weist beschädigte gemeinsame Einstellungen zurück: %j', (invalid) => {
      const backup = clone(buildBackup([year()], { organization: organization() }, '2026-11-03T12:00:00Z'))
      ;(backup.settings as Record<string, unknown>).organization = invalid
      expect(validateBackup(backup).ok).toBe(false)
    },
  )

  test('weist unvollständige Centaufteilungen zurück', () => {
    const broken = organization()
    const key = Object.keys(broken.assignments)[0]
    const invalid = { ...broken, assignments: { ...broken.assignments,
      [key]: { ...broken.assignments[key], allocations: [{ area: 'I' as const, amount: 9999 }] },
    } }
    expect(validateBackup(clone(buildBackup([year()], { organization: invalid }, '2026-11-03T12:00:00Z'))).ok).toBe(false)
  })

  test('erhält gültige Transferreferenzen und lehnt ungültige Kontokennungen ab', () => {
    const transfer = { id: 't1', from: { konto: 'haupt', year: 2026, bookingId: 'aus' },
      to: { konto: 'zweit', year: 2026, bookingId: 'ein' }, amount: 10000,
      fromDate: '2026-02-01', toDate: '2026-02-02' }
    const valid = { ...organization(), transfers: [transfer] }
    expect(validateBackup(clone(buildBackup([year()], { organization: valid }, '2026-11-03T12:00:00Z'))).ok).toBe(true)
    const invalid = { ...valid, transfers: [{ ...transfer, to: { ...transfer.to, konto: '../fremde-daten' } }] }
    expect(validateBackup(clone(buildBackup([year()], { organization: invalid }, '2026-11-03T12:00:00Z'))).ok).toBe(false)
  })
})
