import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Speicherung der Jahresdateien als JSON im Benutzerdaten-Ordner.
 * Schreiben erfolgt atomar (temp + rename); vor jedem Schreiben wird ein
 * rotierendes Backup angelegt.
 */

const MAX_BACKUPS = 20

function dataDir(): string {
  const dir = join(app.getPath('userData'), 'daten')
  mkdirSync(dir, { recursive: true })
  return dir
}

function backupDir(): string {
  const dir = join(dataDir(), 'backups')
  mkdirSync(dir, { recursive: true })
  return dir
}

function fileFor(year: number): string {
  return join(dataDir(), `kassenbuch-${year}.json`)
}

export function listYears(): number[] {
  return readdirSync(dataDir())
    .map((f) => /^kassenbuch-(\d{4})\.json$/.exec(f)?.[1])
    .filter((y): y is string => Boolean(y))
    .map(Number)
    .sort((a, b) => b - a)
}

export function loadYear(year: number): unknown | null {
  const file = fileFor(year)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf-8'))
}

export function saveYear(year: number, data: unknown): void {
  const file = fileFor(year)
  if (existsSync(file)) {
    rotateBackup(year, file)
  }
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
}

function rotateBackup(year: number, file: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  copyFileSync(file, join(backupDir(), `kassenbuch-${year}-${stamp}.json`))
  const backups = readdirSync(backupDir())
    .filter((f) => f.startsWith(`kassenbuch-${year}-`))
    .sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) {
    try {
      rmSync(join(backupDir(), old))
    } catch {
      // Backup-Rotation darf das Speichern nie verhindern
    }
  }
}

function settingsFile(): string {
  return join(dataDir(), 'einstellungen.json')
}

export function loadSettings(): unknown {
  if (!existsSync(settingsFile())) return {}
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf-8'))
  } catch {
    return {}
  }
}

export function saveSettings(data: unknown): void {
  const tmp = settingsFile() + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, settingsFile())
}

/**
 * Löscht ein Kassenjahr, indem die Datei in den Backup-Ordner verschoben
 * wird – versehentliches Löschen bleibt damit wiederherstellbar.
 */
export function deleteYear(year: number): void {
  const file = fileFor(year)
  if (!existsSync(file)) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  renameSync(file, join(backupDir(), `kassenbuch-${year}-geloescht-${stamp}.json`))
}

export function dataDirPath(): string {
  return dataDir()
}
