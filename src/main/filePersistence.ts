import * as fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

export const JOURNAL_NAME = '.snapshot-journal.json'
const SETTINGS_NAME = 'einstellungen.json'
const MAX_BACKUPS = 20
const DATA_NAME = /^(?:einstellungen|kassenbuch(?:-k[1-9]\d*)?-\d{4})\.json$/

export interface FileWrite { name: string; content: string | null }
interface JournalEntry { name: string; before: string | null }
interface Journal { version: 1; status: 'prepared' | 'committed'; entries: JournalEntry[] }
export interface FileIo {
  writeFile(path: string, content: string): void
  rename(from: string, to: string): void
  remove(path: string): void
  copy(from: string, to: string): void
}

const defaultIo: FileIo = {
  writeFile: (path, content) => fs.writeFileSync(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
  rename: (from, to) => fs.renameSync(from, to),
  remove: (path) => fs.rmSync(path, { force: true }),
  copy: (from, to) => fs.copyFileSync(from, to),
}

function syncDirectory(path: string): void {
  if (process.platform === 'win32') return
  const descriptor = fs.openSync(path, 'r')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

/** A unique temporary file prevents overlapping saves from sharing staging bytes. */
export function atomicWrite(path: string, content: string, io: FileIo = defaultIo): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    io.writeFile(temporary, content)
    const descriptor = fs.openSync(temporary, 'r')
    try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
    io.rename(temporary, path)
    syncDirectory(dirname(path))
  } finally {
    if (fs.existsSync(temporary)) {
      try { io.remove(temporary) }
      catch (failure) { console.error('Temporäre Speicherdatei konnte nicht entfernt werden:', failure instanceof Error ? failure.message : 'Dateisystemfehler') }
    }
  }
}

function message(failure: unknown): string { return failure instanceof Error ? failure.message : 'Speichern fehlgeschlagen.' }
function checkedName(name: string): string {
  if (!DATA_NAME.test(name)) throw new Error('Ungültiger Dateiname für die Buchführung.')
  return name
}
function serialize(value: unknown): string {
  const content = JSON.stringify(value, null, 2)
  if (typeof content !== 'string') throw new Error('Die Daten enthalten keinen speicherbaren JSON-Wert.')
  return content
}

function settingsObject(content: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(content)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Einstellungen')
    return value as Record<string, unknown>
  } catch {
    throw new Error('Die Einstellungen sind beschädigt und wurden nicht überschrieben. Bitte eine Einstellungssicherung aus dem Ordner „backups“ wiederherstellen.')
  }
}

function parseJournal(content: string): Journal {
  let value: unknown
  try { value = JSON.parse(content) } catch { throw new Error('Das Transaktionsjournal ist beschädigt. Die Sicherungen im Datenordner müssen geprüft werden.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiges Transaktionsjournal.')
  const record = value as Partial<Journal>
  if (record.version !== 1 || !['prepared', 'committed'].includes(String(record.status)) || !Array.isArray(record.entries)
    || record.entries.length === 0 || record.entries.length > 1000) throw new Error('Ungültiges Transaktionsjournal.')
  const names = new Set<string>()
  for (const entry of record.entries) {
    if (!entry || typeof entry.name !== 'string' || !DATA_NAME.test(entry.name) || names.has(entry.name)
      || (entry.before !== null && typeof entry.before !== 'string')) throw new Error('Ungültige Dateien im Transaktionsjournal.')
    names.add(entry.name)
  }
  return record as Journal
}

export function createFilePersistence(directory: string, options: { io?: Partial<FileIo> } = {}) {
  const io: FileIo = { ...defaultIo, ...options.io }
  const journalPath = join(directory, JOURNAL_NAME)
  const backupsPath = join(directory, 'backups')

  function recover(): void {
    fs.mkdirSync(directory, { recursive: true })
    if (!fs.existsSync(journalPath)) return
    if (fs.statSync(journalPath).size > 256_000_000) throw new Error('Das Transaktionsjournal ist zu groß. Die Sicherungen müssen geprüft werden.')
    const journal = parseJournal(fs.readFileSync(journalPath, 'utf8'))
    try {
      if (journal.status === 'prepared') {
        for (const entry of journal.entries) {
          const file = join(directory, entry.name)
          if (entry.before === null) io.remove(file)
          else atomicWrite(file, entry.before, io)
        }
      }
      io.remove(journalPath)
      syncDirectory(directory)
    } catch (failure) {
      throw new Error(`Die Wiederherstellung der letzten Transaktion ist noch nicht abgeschlossen: ${message(failure)}`)
    }
  }

  function parseSettings(): Record<string, unknown> {
    const file = join(directory, SETTINGS_NAME)
    if (!fs.existsSync(file)) return {}
    return settingsObject(fs.readFileSync(file, 'utf8'))
  }

  function rotateBackup(name: string, tag = ''): void {
    const file = join(directory, name)
    if (!fs.existsSync(file)) return
    fs.mkdirSync(backupsPath, { recursive: true })
    const prefix = name.replace(/\.json$/, '')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const sequence = process.hrtime.bigint().toString().padStart(20, '0')
    io.copy(file, join(backupsPath, `${prefix}-${tag}${stamp}-${sequence}-${randomUUID()}.json`))
    const backups = fs.readdirSync(backupsPath).filter((entry) => entry.startsWith(`${prefix}-`) && entry.endsWith('.json')).sort()
    for (const old of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) io.remove(join(backupsPath, old))
  }

  function commit(writes: readonly FileWrite[], commitOptions: { backup?: boolean; backupTag?: string } = {}): void {
    recover()
    parseSettings()
    if (writes.length === 0) return
    if (writes.length > 1000) throw new Error('Der Snapshot enthält zu viele Dateien.')
    const names = new Set<string>()
    const entries = writes.map((write) => {
      checkedName(write.name)
      if (names.has(write.name)) throw new Error('Ein Dateiname ist im Snapshot doppelt enthalten.')
      if (write.content !== null && typeof write.content !== 'string') throw new Error('Ungültiger Dateiinhalt im Snapshot.')
      if (write.name === SETTINGS_NAME && write.content !== null) settingsObject(write.content)
      names.add(write.name)
      const file = join(directory, write.name)
      return { name: write.name, before: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null }
    })
    const journal: Journal = { version: 1, status: 'prepared', entries }
    const prepared = serialize(journal)
    if (Buffer.byteLength(prepared, 'utf8') > 256_000_000) throw new Error('Das Transaktionsjournal würde zu groß. Bitte weniger Kassenjahre gleichzeitig speichern.')
    atomicWrite(journalPath, prepared, io)
    let committed = false
    try {
      for (const write of writes) {
        if (commitOptions.backup !== false) rotateBackup(write.name, commitOptions.backupTag)
        if (write.content === null) io.remove(join(directory, write.name))
        else atomicWrite(join(directory, write.name), write.content, io)
      }
      atomicWrite(journalPath, serialize({ ...journal, status: 'committed' }), io)
      committed = true
      io.remove(journalPath)
      syncDirectory(directory)
    } catch (failure) {
      if (!committed) {
        try { recover() }
        catch (recoveryFailure) { throw new Error(`${message(failure)} ${message(recoveryFailure)}`) }
      }
      throw failure
    }
  }

  return {
    recover,
    commit,
    directory() { recover(); return directory },
    list() { recover(); return fs.readdirSync(directory) },
    readSettings() { recover(); return parseSettings() },
    readJson(name: string): unknown | null {
      checkedName(name); recover()
      if (name === SETTINGS_NAME) return parseSettings()
      const file = join(directory, name)
      if (!fs.existsSync(file)) return null
      try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
      catch { throw new Error(`Die Datei ${name} ist beschädigt. Bitte eine Sicherung aus dem Ordner „backups“ wiederherstellen.`) }
    },
    writeJson(name: string, value: unknown) { commit([{ name, content: serialize(value) }]) },
    removeToBackup(name: string) { commit([{ name, content: null }], { backupTag: 'geloescht-' }) },
  }
}
