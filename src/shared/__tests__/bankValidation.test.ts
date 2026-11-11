import { describe, expect, test } from 'vitest'
import {
  assertBankAccountConfig, assertBankAccountId, assertBankFetchOptions, assertBankSessionId,
  assertBankTan, bankInfoFilename, validateBankAccountConfig, validateBankAccounts,
} from '../bankValidation'
import { buildBackup, validateBackup } from '../backup'
import { emptyYearFile } from '../defaults'
import type { BankAccountConfig } from '../types'

const account = (patch: Partial<BankAccountConfig> = {}): BankAccountConfig => ({
  id: 'bank_2026-01', label: 'Hauptkonto', blz: '12345678', fintsUrl: 'https://bank.example/fints',
  userId: 'Testkunde', ...patch,
})

describe('Bank-ID und Dateipfad', () => {
  test.each(['bank_2026-01', 'a', '24fde230-997a-4a48-ad5b-cc2e1d656ae1', 'x'.repeat(128)])('erhält gültige ID %s', (id) => {
    expect(() => assertBankAccountId(id)).not.toThrow()
    expect(bankInfoFilename(id)).toBe(`fints-${id}.json`)
  })
  test.each([undefined, null, 1, {}, '', '..', '../../daten/einstellungen', 'a/../../b', 'a\\..\\b',
    'a%2f..', '/tmp/test', 'bank.json', 'bank\u0000id', 'bank id', 'x'.repeat(129), '__proto__', 'prototype', 'constructor'])('weist unsichere ID ab: %j', (id) => {
    expect(() => assertBankAccountId(id)).toThrow('Kennung')
    expect(() => bankInfoFilename(id)).toThrow('Kennung')
  })
})

describe('Bankkonfiguration und Backupimport', () => {
  test('erhält alte Konfiguration ohne Konto sowie optionale Bankangaben', () => {
    expect(validateBankAccountConfig(account())).toEqual([])
    const complete = account({ konto: 'zweit', accountNumber: '0000123456', iban: 'DE00123456780000123456', fintsUrl: 'https://bank.example:8443/fints?version=3' })
    expect(validateBankAccountConfig(complete)).toEqual([])
    expect(() => assertBankAccountConfig(complete)).not.toThrow()
    expect(validateBankAccounts([account(), { ...complete, id: 'other' }])).toEqual([])
    expect(validateBankAccounts([])).toEqual([])
  })
  test.each([null, [], 'Bank', 1])('weist Nichtobjekte ab: %j', (value) => {
    expect(validateBankAccountConfig(value).length).toBeGreaterThan(0)
    expect(() => assertBankAccountConfig(value)).toThrow()
  })
  test.each([
    ['id', '../../outside'], ['konto', 'k2'], ['label', ''], ['label', 'x'.repeat(201)], ['label', 'Bank\nName'],
    ['blz', '1234'], ['blz', '1234567a'], ['fintsUrl', 'not a url'], ['fintsUrl', 'file:///tmp/bank'],
    ['fintsUrl', 'http://bank.example/fints'], ['fintsUrl', 'https://user:password@bank.example/fints'],
    ['fintsUrl', 'https://bank.example/fints#part'], ['fintsUrl', 'https://bank.example/\npath'],
    ['fintsUrl', 'https://bank.example/' + 'x'.repeat(2048)], ['userId', ''], ['userId', 7], ['userId', 'x'.repeat(257)],
    ['accountNumber', {}], ['accountNumber', 'x'.repeat(65)], ['iban', 7], ['iban', 'x'.repeat(65)],
  ])('weist ungültiges Feld ab: %s', (field, value) => {
    expect(validateBankAccountConfig({ ...account(), [field]: value }).length).toBeGreaterThan(0)
  })
  test.each([null, {}, 'Bank', new Array(1001).fill(account()), [account(), account()]])('weist ungültige Kontoliste ab', (value) => {
    expect(validateBankAccounts(value).length).toBeGreaterThan(0)
  })
  test('prüft auch ungültige Listeneinträge und doppelte IDs', () => {
    expect(validateBankAccounts([null, { label: 'Fehlt' }, { id: 1 }, account()]).length).toBeGreaterThan(0)
    expect(validateBankAccounts([account(), account()])).toContain('Eine Bankverbindung ist mehrfach vorhanden.')
  })
  test('lässt gültige Bankverbindungen im Backup unverändert und blockiert Path Traversal', () => {
    const valid = buildBackup([emptyYearFile(2026)], { bankAccounts: [account()] }, '2026-11-03T00:00:00Z')
    expect(validateBackup(valid)).toEqual({ ok: true, backup: valid })
    const unsafe = { ...valid, settings: { bankAccounts: [account({ id: '../../production' })] } }
    const result = validateBackup(unsafe)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some(error => error.includes('Online-Banking'))).toBe(true)
  })
})

describe('Bankabruf-IPC-Angaben', () => {
  test.each([{}, { pin: '', savePin: false, from: '' }, { pin: 'PIN!123', savePin: true, from: '2024-02-29' }])('erhält gültige Abrufoptionen', (value) => {
    expect(() => assertBankFetchOptions(value)).not.toThrow()
  })
  test.each([null, [], 'Abruf', { pin: 1 }, { pin: 'x'.repeat(1025) }, { pin: 'PIN\n' }, { savePin: 'ja' },
    { from: '2025-02-29' }, { from: '2026-13-01' }, { from: '03.11.2026' }, { from: 1 }, { from: '9999-99-99' }])('weist ungültige Abrufoptionen ab', (value) => {
    expect(() => assertBankFetchOptions(value)).toThrow()
  })
  test('validiert TAN und Sitzungs-ID ohne Inhalte in Fehlermeldungen zu schreiben', () => {
    expect(() => assertBankSessionId('24fde230-997a-4a48-ad5b-cc2e1d656ae1')).not.toThrow()
    expect(() => assertBankTan(undefined)).not.toThrow()
    expect(() => assertBankTan('123456')).not.toThrow()
    expect(() => assertBankTan('')).not.toThrow()
    expect(() => assertBankSessionId('../../outside')).toThrow('Ungültige Abruf-Sitzung.')
    expect(() => assertBankSessionId({})).toThrow()
    expect(() => assertBankTan('secret\n')).toThrow('Die TAN enthält ungültige Angaben.')
    expect(() => assertBankTan('x'.repeat(1025))).toThrow()
    expect(() => assertBankTan(123456)).toThrow()
  })
})
