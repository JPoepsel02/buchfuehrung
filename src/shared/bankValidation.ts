import { isKontoId } from './types'
import type { BankAccountConfig } from './types'
import type { BankFetchOptions } from './bank'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const controlCharacters = /[\u0000-\u001f\u007f]/
const reservedIds = new Set(['__proto__', 'prototype', 'constructor'])

export function assertBankAccountId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || reservedIds.has(value)) {
    throw new Error('Ungültige Kennung der Bankverbindung.')
  }
}

export function bankInfoFilename(accountId: unknown): string {
  assertBankAccountId(accountId)
  return `fints-${accountId}.json`
}

function validText(value: unknown, max: number, required: boolean): boolean {
  return typeof value === 'string' && value.length <= max && !controlCharacters.test(value) && (!required || Boolean(value.trim()))
}

function validBankUrl(value: unknown): boolean {
  if (!validText(value, 2048, true)) return false
  try {
    const url = new URL(value as string)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}

export function validateBankAccountConfig(value: unknown): string[] {
  if (!record(value)) return ['Bankverbindung ist kein gültiges Objekt.']
  const errors: string[] = []
  try { assertBankAccountId(value.id) } catch { errors.push('Ungültige Kennung der Bankverbindung.') }
  if (value.konto !== undefined && !isKontoId(value.konto)) errors.push('Ungültige Konto-Zuordnung der Bankverbindung.')
  if (!validText(value.label, 200, true)) errors.push('Name der Bankverbindung fehlt oder ist ungültig.')
  if (typeof value.blz !== 'string' || !/^\d{8}$/.test(value.blz)) errors.push('Die Bankleitzahl muss acht Ziffern enthalten.')
  if (!validBankUrl(value.fintsUrl)) errors.push('Die FinTS-Adresse muss eine gültige HTTPS-Adresse ohne Zugangsdaten sein.')
  if (!validText(value.userId, 256, true)) errors.push('Anmeldename der Bankverbindung fehlt oder ist ungültig.')
  if (value.accountNumber !== undefined && !validText(value.accountNumber, 64, false)) errors.push('Kontonummer der Bankverbindung ist ungültig.')
  if (value.iban !== undefined && !validText(value.iban, 64, false)) errors.push('IBAN der Bankverbindung ist ungültig.')
  return errors
}

export function assertBankAccountConfig(value: unknown): asserts value is BankAccountConfig {
  const errors = validateBankAccountConfig(value)
  if (errors.length) throw new Error(errors[0])
}

export function validateBankAccounts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1000) return ['Bankverbindungen sind keine gültige Liste.']
  const errors: string[] = []
  const ids = new Set<string>()
  for (const account of value) {
    errors.push(...validateBankAccountConfig(account))
    if (!record(account) || typeof account.id !== 'string') continue
    if (ids.has(account.id)) errors.push('Eine Bankverbindung ist mehrfach vorhanden.')
    ids.add(account.id)
  }
  return [...new Set(errors)]
}

function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function assertBankFetchOptions(value: unknown): asserts value is BankFetchOptions {
  if (!record(value)) throw new Error('Ungültige Angaben für den Umsatzabruf.')
  if (value.pin !== undefined && !validText(value.pin, 1024, false)) throw new Error('Die PIN enthält ungültige Angaben.')
  if (value.savePin !== undefined && typeof value.savePin !== 'boolean') throw new Error('Ungültige Auswahl für das Speichern der PIN.')
  if (value.from !== undefined && value.from !== '' && !validDate(value.from)) throw new Error('Ungültiges Startdatum für den Umsatzabruf.')
}

export function assertBankSessionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Ungültige Abruf-Sitzung.')
  }
}

export function assertBankTan(value: unknown): asserts value is string | undefined {
  if (value !== undefined && !validText(value, 1024, false)) throw new Error('Die TAN enthält ungültige Angaben.')
}
