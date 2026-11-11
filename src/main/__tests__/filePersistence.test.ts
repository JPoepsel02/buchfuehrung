import { afterEach, describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFilePersistence, JOURNAL_NAME } from '../filePersistence'

const directories: string[] = []
const oldSettings = { organization: { assignments: { old: ['I'] } } }
const oldYear = { bookings: ['old'], importDraft: ['source'] }
const nextSettings = { organization: { assignments: { old: ['I'], imported: ['Z'] } } }
const nextYear = { bookings: ['old', 'imported'] }
const settingsName = 'einstellungen.json'
const yearName = 'kassenbuch-2026.json'
const json = (value: unknown) => JSON.stringify(value, null, 2)

function setup() {
  const directory = fs.mkdtempSync(join(tmpdir(), 'buchfuehrung-persistence-'))
  directories.push(directory)
  fs.writeFileSync(join(directory, settingsName), json(oldSettings))
  fs.writeFileSync(join(directory, yearName), json(oldYear))
  return directory
}
const writes = () => [{ name: settingsName, content: json(nextSettings) }, { name: yearName, content: json(nextYear) }]
const read = (directory: string, name: string) => JSON.parse(fs.readFileSync(join(directory, name), 'utf8'))
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })

describe('recoverable file persistence', () => {
  test('commits settings and year as one snapshot and retains their previous versions', () => {
    const directory = setup()
    const store = createFilePersistence(directory)
    store.commit(writes())
    expect(read(directory, settingsName)).toEqual(nextSettings)
    expect(read(directory, yearName)).toEqual(nextYear)
    expect(fs.existsSync(join(directory, JOURNAL_NAME))).toBe(false)
    const backups = fs.readdirSync(join(directory, 'backups'))
    expect(backups).toHaveLength(2)
    expect(backups.some((name) => name.startsWith('einstellungen-'))).toBe(true)
    expect(backups.some((name) => name.startsWith('kassenbuch-2026-'))).toBe(true)
  })

  test.each([settingsName, yearName, 'journal-marker'])('restores the entire old snapshot after a failure in %s', (target) => {
    const directory = setup()
    let journalWrites = 0
    let failed = false
    const store = createFilePersistence(directory, { io: { writeFile(file, content) {
      if (file.includes(JOURNAL_NAME)) journalWrites++
      const shouldFail = target === 'journal-marker' ? file.includes(JOURNAL_NAME) && journalWrites === 2 : file.includes(`${target}.`)
      if (shouldFail && !failed) { failed = true; throw new Error(`Simulierter Fehler ${target}`) }
      fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } } })
    expect(() => store.commit(writes())).toThrow('Simulierter Fehler')
    expect(read(directory, settingsName)).toEqual(oldSettings)
    expect(read(directory, yearName)).toEqual(oldYear)
    expect(fs.existsSync(join(directory, JOURNAL_NAME))).toBe(false)
  })

  test('retains its journal if rollback fails and recovers before the next read after restart', () => {
    const directory = setup()
    let failed = false
    const broken = createFilePersistence(directory, { io: { writeFile(file, content) {
      if (file.includes(`${yearName}.`)) failed = true
      if (failed && (file.includes(`${yearName}.`) || file.includes(`${settingsName}.`))) throw new Error('Datenträger nicht beschreibbar')
      fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } } })
    expect(() => broken.commit(writes())).toThrow(/Wiederherstellung|Datenträger/)
    expect(fs.existsSync(join(directory, JOURNAL_NAME))).toBe(true)
    expect(() => broken.readJson(yearName)).toThrow(/Wiederherstellung|Datenträger/)
    const reopened = createFilePersistence(directory)
    expect(reopened.readJson(yearName)).toEqual(oldYear)
    expect(reopened.readSettings()).toEqual(oldSettings)
    expect(fs.existsSync(join(directory, JOURNAL_NAME))).toBe(false)
  })

  test('recovers an interrupted multi-file transaction and removes newly created files', () => {
    const directory = setup()
    const created = 'kassenbuch-k3-2026.json'
    fs.writeFileSync(join(directory, settingsName), json(nextSettings))
    fs.writeFileSync(join(directory, created), json({ bookings: ['new'] }))
    fs.writeFileSync(join(directory, JOURNAL_NAME), json({ version: 1, status: 'prepared', entries: [
      { name: settingsName, before: json(oldSettings) }, { name: created, before: null },
    ] }))
    const reopened = createFilePersistence(directory)
    expect(reopened.list()).not.toContain(created)
    expect(reopened.readSettings()).toEqual(oldSettings)
  })

  test('keeps a committed snapshot when cleanup was interrupted', () => {
    const directory = setup()
    fs.writeFileSync(join(directory, settingsName), json(nextSettings))
    fs.writeFileSync(join(directory, yearName), json(nextYear))
    fs.writeFileSync(join(directory, JOURNAL_NAME), json({ version: 1, status: 'committed', entries: [
      { name: settingsName, before: json(oldSettings) }, { name: yearName, before: json(oldYear) },
    ] }))
    const reopened = createFilePersistence(directory)
    expect(reopened.readSettings()).toEqual(nextSettings)
    expect(reopened.readJson(yearName)).toEqual(nextYear)
    expect(fs.existsSync(join(directory, JOURNAL_NAME))).toBe(false)
  })

  test.each(['{broken', 'null', '[]', '42'])('rejects damaged settings without overwriting them: %s', (content) => {
    const directory = setup()
    fs.writeFileSync(join(directory, settingsName), content)
    const store = createFilePersistence(directory)
    expect(() => store.readSettings()).toThrow(/Einstellungen/)
    expect(() => store.writeJson(settingsName, nextSettings)).toThrow(/Einstellungen/)
    expect(() => store.writeJson(yearName, nextYear)).toThrow(/Einstellungen/)
    expect(fs.readFileSync(join(directory, settingsName), 'utf8')).toBe(content)
    expect(read(directory, yearName)).toEqual(oldYear)
  })

  test('rotates settings backups without collisions during rapid saves', () => {
    const directory = setup()
    const store = createFilePersistence(directory)
    for (let index = 0; index < 25; index++) store.writeJson(settingsName, { value: index })
    const backups = fs.readdirSync(join(directory, 'backups')).filter((name) => name.startsWith('einstellungen-'))
    expect(backups).toHaveLength(20)
    expect(new Set(backups).size).toBe(20)
    expect(read(directory, settingsName)).toEqual({ value: 24 })
    expect(read(join(directory, 'backups'), backups.sort().at(-1)!)).toEqual({ value: 23 })
  })

  test('preserves deleted years in backups and rejects duplicate/path-traversing targets', () => {
    const directory = setup()
    const store = createFilePersistence(directory)
    store.removeToBackup(yearName)
    expect(store.readJson(yearName)).toBeNull()
    expect(fs.readdirSync(join(directory, 'backups')).some((name) => name.includes('-geloescht-'))).toBe(true)
    expect(() => store.commit([{ name: '../outside.json', content: '{}' }])).toThrow(/Dateiname/)
    expect(() => store.commit([writes()[0], writes()[0]])).toThrow(/doppelt/)
  })

  test.each(['{broken', JSON.stringify({ version: 1, status: 'prepared', entries: [{ name: '../outside.json', before: '{}' }] })])(
    'fails closed on an unreadable or unsafe journal', (content) => {
      const directory = setup()
      fs.writeFileSync(join(directory, JOURNAL_NAME), content)
      const store = createFilePersistence(directory)
      expect(() => store.readJson(yearName)).toThrow(/Transaktion|Journal/)
      expect(() => store.writeJson(settingsName, nextSettings)).toThrow(/Transaktion|Journal/)
      expect(read(directory, settingsName)).toEqual(oldSettings)
    })
})
