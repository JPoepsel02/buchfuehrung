import { describe, expect, test } from 'vitest'
import { emptyYearFile } from '../defaults'
import { validateSettings, validateSnapshot } from '../snapshot'

describe('snapshot validation', () => {
  const data = { ...emptyYearFile(2026), konto: 'haupt' }
  test('accepts a settings/year snapshot and rejects mismatched file identities', () => {
    expect(validateSnapshot({ settings: { theme: 'hell' }, years: [{ konto: 'haupt', year: 2026, data }] })).toEqual([])
    for (const entry of [{ konto: '../escape', year: 2026, data }, { konto: 'haupt', year: 2025, data }, { konto: 'zweit', year: 2026, data }]) {
      expect(validateSnapshot({ years: [entry] }).length).toBeGreaterThan(0)
    }
    expect(validateSnapshot({ years: [{ konto: 'haupt', year: 2026, data }, { konto: 'haupt', year: 2026, data }] }).length).toBeGreaterThan(0)
  })
  test('rejects invalid settings even without a year file', () => {
    for (const settings of [null, [], { organization: {} }, { logoDataUrl: 'https://invalid/logo.png' }, { cloudBackupEnabled: 'yes' }, { cloudBackupDir: 5 }, { theme: 'invalid' }, { bookingsCleanMode: 'yes' }, { fintsProductId: 7 }]) {
      expect(validateSnapshot({ settings, years: [] }).length).toBeGreaterThan(0)
    }
    expect(validateSnapshot({ settings: {}, years: [] })).toEqual([])
    expect(validateSettings({ accountNumbers: { haupt: 'DE123' }, bankAccounts: [], cloudBackupEnabled: false })).toEqual([])
  })
  test.each([null, [], {}, { years: [] }, { years: 'invalid' }, { years: [{}] }])('rejects incomplete payloads', (payload) => {
    expect(validateSnapshot(payload).length).toBeGreaterThan(0)
  })
})
