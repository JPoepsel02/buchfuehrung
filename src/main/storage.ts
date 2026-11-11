import { app } from 'electron'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allowedMirrorPath } from './experiment'
import { isKontoId } from '../shared/types'
import { validateSettings, validateSnapshot } from '../shared/snapshot'
import { atomicWrite, createFilePersistence } from './filePersistence'

export interface CloudSyncStatus {
  enabled: boolean
  lastSuccessAt?: string
  lastError?: string
  fileCount?: number
}

const MIRROR_FILE = /^(kassenbuch(-k\d+)?-\d{4}|einstellungen)\.json$/
function persistence() { return createFilePersistence(join(app.getPath('userData'), 'daten')) }
function dataDir(): string { return persistence().directory() }

function prefixFor(konto: string): string {
  if (konto === 'haupt') return 'kassenbuch'
  return `kassenbuch-${konto === 'zweit' ? 'k2' : konto}`
}
function nameFor(konto: string, year: number): string {
  if (!isKontoId(konto) || !Number.isInteger(year) || year < 1900 || year > 9998) throw new Error('Ungültiges Konto oder Kassenjahr.')
  return `${prefixFor(konto)}-${year}.json`
}

export function listYears(konto: string): number[] {
  if (!isKontoId(konto)) throw new Error('Ungültiges Konto.')
  const re = new RegExp(`^${prefixFor(konto)}-(\\d{4})\\.json$`)
  return persistence().list().map((file) => re.exec(file)?.[1])
    .filter((year): year is string => Boolean(year)).map(Number).sort((a, b) => b - a)
}

export function listKontos(): string[] {
  const found = new Set<string>(['haupt'])
  for (const file of persistence().list()) {
    const match = /^kassenbuch-(k\d+)-\d{4}\.json$/.exec(file)
    if (match) found.add(match[1] === 'k2' ? 'zweit' : match[1])
  }
  const number = (konto: string) => konto === 'zweit' ? 2 : Number(konto.slice(1))
  return ['haupt', ...[...found].filter((konto) => konto !== 'haupt').sort((a, b) => number(a) - number(b))]
}

export function loadYear(konto: string, year: number): unknown | null {
  return persistence().readJson(nameFor(konto, year))
}

export interface StorageSnapshot {
  settings?: unknown
  years: Array<{ konto: string; year: number; data: unknown }>
}

/** Year data and shared assignments are committed and recovered together. */
export function commitSnapshot(payload: StorageSnapshot): void {
  const errors = validateSnapshot(payload)
  if (errors.length) throw new Error(errors[0])
  loadSettings()
  const writes = [
    ...(payload.settings === undefined ? [] : [{ name: 'einstellungen.json', content: JSON.stringify(payload.settings, null, 2) }]),
    ...payload.years.map((entry) => ({ name: nameFor(entry.konto, entry.year), content: JSON.stringify(entry.data, null, 2) })),
  ]
  persistence().commit(writes)
  syncDataToCloud()
}

export function saveYear(konto: string, year: number, data: unknown): void {
  commitSnapshot({ years: [{ konto, year, data }] })
}

export function loadSettings(): unknown {
  const settings = persistence().readSettings()
  const errors = validateSettings(settings)
  if (errors.length) throw new Error(`Die Einstellungen sind beschädigt und wurden nicht überschrieben. ${errors[0]} Bitte eine Einstellungssicherung aus dem Ordner „backups“ wiederherstellen.`)
  return settings
}
export function saveSettings(data: unknown): void {
  const errors = validateSettings(data)
  if (errors.length) throw new Error(errors[0])
  loadSettings()
  persistence().writeJson('einstellungen.json', data)
  syncDataToCloud(data)
}

export function deleteYear(konto: string, year: number): void {
  loadSettings()
  persistence().removeToBackup(nameFor(konto, year))
  syncDataToCloud()
}
export function dataDirPath(): string {
  const directory = join(app.getPath('userData'), 'daten')
  mkdirSync(directory, { recursive: true })
  return directory
}

function cloudStatusFile(): string { return join(dataDir(), '.cloud-sync-status.json') }
function writeCloudStatus(status: CloudSyncStatus): void {
  try { atomicWrite(cloudStatusFile(), JSON.stringify(status)) }
  catch { /* A status hint must not prevent a local save. */ }
}

export function cloudSyncStatus(settings: unknown = loadSettings()): CloudSyncStatus {
  if (!cloudBackupDir(settings)) return { enabled: false }
  try { return { ...JSON.parse(readFileSync(cloudStatusFile(), 'utf8')), enabled: true } }
  catch { return { enabled: true } }
}

function syncDataToCloud(settings: unknown = loadSettings()): void {
  const directory = cloudBackupDir(settings)
  if (!directory) return
  try {
    mkdirSync(directory, { recursive: true })
    const source = dataDir()
    const sourceNames = readdirSync(source).filter((name) => MIRROR_FILE.test(name))
    const names = new Set(sourceNames)
    const mirror = createFilePersistence(directory)
    // Stale files are removed in the same recoverable transaction as new copies.
    const writes = [
      ...sourceNames.map((name) => ({ name, content: readFileSync(join(source, name), 'utf8') })),
      ...mirror.list().filter((name) => MIRROR_FILE.test(name) && !names.has(name)).map((name) => ({ name, content: null })),
    ]
    if (writes.length) mirror.commit(writes, { backup: false })
    writeCloudStatus({ enabled: true, lastSuccessAt: new Date().toISOString(), fileCount: sourceNames.length })
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure)
    writeCloudStatus({ ...cloudSyncStatus(settings), enabled: true, lastError: message })
  }
}

export function syncCloudNow(): CloudSyncStatus { syncDataToCloud(); return cloudSyncStatus() }

function cloudBackupDir(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object') return null
  const data = settings as { cloudBackupEnabled?: unknown; cloudBackupDir?: unknown }
  if (data.cloudBackupEnabled !== true || typeof data.cloudBackupDir !== 'string'
    || !data.cloudBackupDir.trim() || !allowedMirrorPath(data.cloudBackupDir)) return null
  return data.cloudBackupDir
}
