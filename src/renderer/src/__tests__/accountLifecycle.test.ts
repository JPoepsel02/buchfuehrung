import { describe, expect, test } from 'vitest'
import { emptyYearFile } from '@shared/defaults'
import { makeAssignment, organizationDefaults } from '@shared/organization'
import { nextKontoIdentity, assertNewYear, usedKontoSequence } from '../accountLifecycle'

describe('account lifecycle', () => {
  test('never reuses an account identifier after it has been retired', () => {
    expect(nextKontoIdentity(['haupt'], {})).toEqual({ id: 'zweit', sequence: 2 })
    expect(nextKontoIdentity(['haupt'], { kontoSequence: 4 })).toEqual({ id: 'k5', sequence: 5 })
    expect(nextKontoIdentity(['haupt', 'k4'], { kontoSequence: 2 })).toEqual({ id: 'k5', sequence: 5 })
    expect(usedKontoSequence(['haupt', 'zweit'], {})).toBe(2)
  })

  test('reserves legacy account references before a sequence has been recorded', () => {
    expect(nextKontoIdentity(['haupt'], { accountNumbers: { zweit: 'DE123', k6: '123' } })).toEqual({ id: 'k7', sequence: 7 })
    expect(nextKontoIdentity(['haupt'], { bankAccounts: [{ id: 'bank', konto: 'k8', label: 'Bank',
      blz: '12345678', userId: 'Test', fintsUrl: 'https://bank.example.test' }] })).toEqual({ id: 'k9', sequence: 9 })
    const assignment = makeAssignment({ id: 'booking', seq: 1, amount: 100, type: 'einnahme', categoryId: 'b', date: '2026-01-01',
      name: '', description: '', isUmsatz: false, nonUmsatzAmount: 0, note: '', source: 'manuell' }, [{ area: 'I', amount: 100 }])
    expect(nextKontoIdentity(['haupt'], { organization: { ...organizationDefaults([]), rules: [
      { id: 'old', konto: 'k3', categoryId: 'old', area: 'I' },
    ], assignments: { '["k10",2026,"booking"]': assignment, malformed: assignment } } })).toEqual({ id: 'k11', sequence: 11 })
    expect(nextKontoIdentity(['haupt'], { organization: { ...organizationDefaults([]), assignments: { 'null': assignment } } })).toEqual({ id: 'zweit', sequence: 2 })
  })

  test('refuses to overwrite an existing fiscal year or create an unsupported year', () => {
    const original = { ...emptyYearFile(2026), konto: 'zweit', openingBalance: 9999 }
    expect(() => assertNewYear([original], 'zweit', 2026)).toThrow('bereits vorhanden')
    expect(original.openingBalance).toBe(9999)
    expect(() => assertNewYear([original], 'haupt', 2026)).not.toThrow()
    for (const year of [1999, 2101, 2026.5, NaN]) expect(() => assertNewYear([], 'haupt', year)).toThrow('2000 und 2100')
    expect(() => assertNewYear([], 'haupt', 2100)).not.toThrow()
  })

  test('fails clearly before assigning an imprecise account identifier', () => {
    expect(() => nextKontoIdentity(['haupt'], { kontoSequence: Number.MAX_SAFE_INTEGER })).toThrow('Konto-Kennung')
  })
})
