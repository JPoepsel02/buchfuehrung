import { describe, expect, test } from 'vitest'
import { accountNumberFor, validateAccountNumbers } from '../accountDetails'
import { buildBackup, validateBackup } from '../backup'
import { emptyYearFile } from '../defaults'
import type { AppSettings, BankAccountConfig } from '../types'

function bank(id: string, patch: Partial<BankAccountConfig> = {}): BankAccountConfig {
  return { id, label: 'Testbank', blz: '12345678', fintsUrl: 'https://bank.example/fints', userId: 'test', ...patch }
}

describe('accountNumberFor', () => {
  test('bevorzugt eine manuell hinterlegte Nummer und entfernt nur äußere Leerzeichen', () => {
    const settings: AppSettings = {
      accountNumbers: { haupt: '  DE12 3456 7890  ' },
      bankAccounts: [bank('bank-main', { konto: 'haupt', iban: 'DEBANK', accountNumber: '001122' })],
    }
    expect(accountNumberFor('haupt', settings)).toBe('DE12 3456 7890')
    expect(settings.accountNumbers?.haupt).toBe('  DE12 3456 7890  ')
  })

  test('hält die manuellen Nummern dreier Konten getrennt', () => {
    const settings: AppSettings = { accountNumbers: { haupt: '001100', zweit: '002200', k3: '003300' } }
    expect(['haupt', 'zweit', 'k3'].map(konto => accountNumberFor(konto, settings))).toEqual(['001100', '002200', '003300'])
  })

  test('nimmt je Konto die IBAN vor der Kontonummer aus der passenden Bankverbindung', () => {
    const settings: AppSettings = {
      bankAccounts: [
        bank('bank-main', { konto: 'haupt', iban: '  DEMAIN  ', accountNumber: '001100' }),
        bank('bank-second', { konto: 'zweit', iban: '  DESECOND  ', accountNumber: '002200' }),
        bank('bank-third', { konto: 'k3', accountNumber: '  003300  ' }),
      ],
    }
    expect(['haupt', 'zweit', 'k3'].map(konto => accountNumberFor(konto, settings))).toEqual(['DEMAIN', 'DESECOND', '003300'])
  })

  test('nutzt bei leerem manuellem Wert den Bankfallback und behandelt alte Bankeinträge als Hauptkonto', () => {
    const settings: AppSettings = {
      accountNumbers: { haupt: '   ', zweit: '' },
      bankAccounts: [bank('bank-legacy', { iban: 'DELEGACY' }), bank('bank-second', { konto: 'zweit', iban: '  ', accountNumber: '  000123  ' })],
    }
    expect(accountNumberFor('haupt', settings)).toBe('DELEGACY')
    expect(accountNumberFor('zweit', settings)).toBe('000123')
    expect(accountNumberFor('k3', settings)).toBe('')
  })

  test('verwendet den ersten passenden Bankeintrag und keine Verbindung eines anderen Kontos', () => {
    const settings: AppSettings = { bankAccounts: [
      bank('bank-second', { konto: 'zweit', iban: 'DESECOND' }),
      bank('bank-main-first', { accountNumber: 'MAIN-FIRST' }),
      bank('bank-main-later', { konto: 'haupt', iban: 'MAIN-LATER' }),
    ] }
    expect(accountNumberFor('haupt', settings)).toBe('MAIN-FIRST')
    expect(accountNumberFor('k4', settings)).toBe('')
  })

  test('liefert ohne Nummer einen leeren Wert und verwendet keine früheren Audit-Angaben', () => {
    expect(accountNumberFor('haupt', {})).toBe('')
    expect(accountNumberFor('haupt', { bankAccounts: [bank('empty')] })).toBe('')
    expect(accountNumberFor('haupt', { bankAccounts: [], ...{ audit: { konto1: 'ALT-1', konto2: 'ALT-2' } } })).toBe('')
  })
})

describe('validateAccountNumbers', () => {
  test.each([{}, { haupt: '', zweit: '0000123', k3: 'DE12 3456' }, { k123: 'x'.repeat(80) }])('erhält gültige Werte unverändert', value => {
    expect(validateAccountNumbers(value)).toEqual([])
  })

  test('akzeptiert auch eine JSON-kompatible Map ohne Prototyp', () => {
    const value = Object.assign(Object.create(null), { haupt: '001122' })
    expect(validateAccountNumbers(value)).toEqual([])
  })

  test.each([undefined, null, [], ['000123'], '000123', 123, true, new Date('2026-01-01')])('lehnt Nicht-Records ab: %j', value => {
    expect(validateAccountNumbers(value).length).toBeGreaterThan(0)
  })

  test.each(['k2', 'k1', 'k0', 'anderes', '../haupt', '__proto__', 'constructor'])('lehnt eine ungültige Kontokennung ab: %s', konto => {
    expect(validateAccountNumbers(Object.fromEntries([[konto, '001122']])).length).toBeGreaterThan(0)
  })

  test.each([123, null, undefined, true, {}, [], 'x'.repeat(81), 'A\nB', 'A\rB', 'A\tB', 'A\u0000B', 'A\u007fB', 'A\u0085B', 'A\u2028B', 'A\u2029B'])('lehnt ungültige Werte ab: %j', value => {
    expect(validateAccountNumbers({ haupt: value }).length).toBeGreaterThan(0)
  })

  test('begrenzt die Anzahl der Kontoangaben auf 1000', () => {
    const value = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`k${index + 3}`, '000123']))
    expect(validateAccountNumbers(value)).toEqual([])
    expect(validateAccountNumbers({ ...value, haupt: '000123' }).length).toBeGreaterThan(0)
  })
})

describe('Kontonummern in der Datensicherung', () => {
  test('erhält drei Kontonummern beim JSON-Roundtrip', () => {
    const settings: AppSettings = { accountNumbers: { haupt: '001122', zweit: 'DE123', k3: '' } }
    const backup = buildBackup([emptyYearFile(2026)], settings, '2026-11-03T00:00:00Z')
    const parsed = JSON.parse(JSON.stringify(backup))
    expect(validateBackup(parsed)).toEqual({ ok: true, backup: parsed })
    expect(parsed.settings.accountNumbers).toEqual(settings.accountNumbers)
  })

  test('erhält ältere Sicherungen ohne das optionale Feld', () => {
    const backup = buildBackup([emptyYearFile(2026)], { theme: 'system' }, '2026-11-03T00:00:00Z')
    expect(validateBackup(backup)).toEqual({ ok: true, backup })
  })

  test.each([null, [], { k2: '123' }, { haupt: 123 }, { haupt: '123\n456' }])('verhindert beschädigte Kontonummern beim Wiederherstellen', value => {
    const backup = { ...buildBackup([emptyYearFile(2026)], undefined, '2026-11-03T00:00:00Z'), settings: { accountNumbers: value } }
    const result = validateBackup(backup)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some(error => error.includes('Kontoangaben'))).toBe(true)
  })
})
