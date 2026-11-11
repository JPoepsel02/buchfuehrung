import { isKontoId } from './types'
import type { AppSettings } from './types'

export function accountNumberFor(konto: string, settings: AppSettings): string {
  const manual = settings.accountNumbers?.[konto]
  if (typeof manual === 'string' && manual.trim()) return manual.trim()
  const bank = settings.bankAccounts?.find(account => (account.konto ?? 'haupt') === konto)
  return bank?.iban?.trim() || bank?.accountNumber?.trim() || ''
}

export function validateAccountNumbers(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['Kontoangaben müssen ein Objekt sein.']
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return ['Kontoangaben müssen ein einfaches Objekt sein.']
  const entries = Object.entries(value)
  if (entries.length > 1000) return ['Es sind höchstens 1000 Kontoangaben erlaubt.']
  return entries.flatMap(([konto, number]) => [
    ...(!isKontoId(konto) ? ['Kontoangaben enthalten eine ungültige Konto-Kennung.'] : []),
    ...(typeof number !== 'string' || number.length > 80 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(number)
      ? ['Kontoangaben müssen Texte mit höchstens 80 Zeichen ohne Steuerzeichen sein.'] : []),
  ])
}
