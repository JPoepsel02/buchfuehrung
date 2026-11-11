import type { AppSettings, YearFile } from './types'
import { isKontoId } from './types'
import { BACKUP_FORMAT, BACKUP_VERSION, validateBackup } from './backup'
import { validateAccountNumbers } from './accountDetails'
import { validateBankAccounts } from './bankValidation'
import { validateOrganizationConfig } from './organization'
import { isSafeLogoDataUrl } from './logo'

export interface SnapshotPayload {
  settings?: AppSettings
  years: Array<{ konto: string; year: number; data: YearFile }>
}

export function validateSettings(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Ungültige Einstellungen.']
  const settings = value as AppSettings
  return [
    ...(settings.kontoSequence === undefined || (Number.isSafeInteger(settings.kontoSequence) && settings.kontoSequence >= 1) ? [] : ['Ungültige reservierte Kontokennung.']),
    ...(settings.accountNumbers === undefined ? [] : validateAccountNumbers(settings.accountNumbers)),
    ...(settings.bankAccounts === undefined ? [] : validateBankAccounts(settings.bankAccounts)),
    ...(settings.organization === undefined ? [] : validateOrganizationConfig(settings.organization)),
    ...(settings.logoDataUrl == null || isSafeLogoDataUrl(settings.logoDataUrl) ? [] : ['Ungültiges Vereinslogo.']),
    ...(settings.cloudBackupEnabled === undefined || typeof settings.cloudBackupEnabled === 'boolean' ? [] : ['Ungültige Sicherungseinstellung.']),
    ...(settings.cloudBackupDir == null || typeof settings.cloudBackupDir === 'string' ? [] : ['Ungültiger Sicherungsordner.']),
    ...(settings.theme === undefined || ['hell', 'dunkel', 'system'].includes(settings.theme) ? [] : ['Ungültiges Farbschema.']),
    ...(settings.bookingsCleanMode === undefined || typeof settings.bookingsCleanMode === 'boolean' ? [] : ['Ungültige Buchungsansicht.']),
    ...(settings.fintsProductId == null || typeof settings.fintsProductId === 'string' ? [] : ['Ungültige FinTS-Produktkennung.']),
  ]
}

export function validateSnapshot(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Ungültiger Speicherstand.']
  const payload = value as Record<string, unknown>
  if (payload.settings !== undefined) {
    const errors = validateSettings(payload.settings)
    if (errors.length) return errors
  }
  if (!Array.isArray(payload.years) || payload.years.length > 1000 || (!payload.years.length && payload.settings === undefined)) return ['Der Speicherstand enthält keine gültigen Dateien.']
  for (const entry of payload.years) {
    if (!entry || typeof entry !== 'object' || !isKontoId(entry.konto) || !Number.isInteger(entry.year)
      || !entry.data || typeof entry.data !== 'object' || entry.year !== entry.data.year
      || entry.konto !== (entry.data.konto ?? 'haupt')) return ['Konto oder Kassenjahr des Speicherstands stimmen nicht überein.']
  }
  if (!payload.years.length) return []
  const checked = validateBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(), years: payload.years.map((entry) => entry.data), settings: payload.settings })
  return checked.ok ? [] : checked.errors
}
