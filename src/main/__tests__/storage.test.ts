import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyYearFile } from '../../shared/defaults'

const runtime = vi.hoisted(() => ({ directory: '', mirrorAllowed: true }))
vi.mock('electron', () => ({ app: { getPath: () => runtime.directory } }))
vi.mock('../experiment', () => ({ allowedMirrorPath: () => runtime.mirrorAllowed }))
import { commitSnapshot, loadSettings, loadYear, listKontos, listYears, saveSettings, saveYear, deleteYear, syncCloudNow } from '../storage'

let root = ''
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'buchfuehrung-storage-'))
  runtime.directory = join(root, 'profile')
  runtime.mirrorAllowed = true
})
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })
const dataPath = (name: string) => join(runtime.directory, 'daten', name)
const baseYear = emptyYearFile(2026)
const main = () => ({ ...baseYear, konto: 'haupt' })

describe('storage integration', () => {
  test('keeps filenames compatible and mirrors only the complete committed snapshot', () => {
    const mirror = join(root, 'cloud')
    saveSettings({ cloudBackupEnabled: true, cloudBackupDir: mirror })
    saveYear('haupt', 2026, main())
    const extra = { ...main(), konto: 'zweit', kontoName: 'Zweitkonto' }
    commitSnapshot({ settings: { cloudBackupEnabled: true, cloudBackupDir: mirror, theme: 'dunkel' }, years: [
      { konto: 'haupt', year: 2026, data: { ...main(), treasurerName: 'Neu' } },
      { konto: 'zweit', year: 2026, data: extra },
    ] })
    expect(listKontos()).toEqual(['haupt', 'zweit'])
    expect(listYears('zweit')).toEqual([2026])
    expect(loadYear('zweit', 2026)).toEqual(extra)
    for (const name of ['einstellungen.json', 'kassenbuch-2026.json', 'kassenbuch-k2-2026.json']) {
      expect(fs.readFileSync(join(mirror, name), 'utf8')).toBe(fs.readFileSync(dataPath(name), 'utf8'))
    }
    expect(syncCloudNow()).toMatchObject({ enabled: true, fileCount: 3 })
    deleteYear('zweit', 2026)
    expect(fs.existsSync(join(mirror, 'kassenbuch-k2-2026.json'))).toBe(false)
    expect(fs.readdirSync(join(runtime.directory, 'daten', 'backups')).some((name) => name.includes('geloescht'))).toBe(true)
  })

  test.each(['{broken', JSON.stringify({ organization: {} })])('does not replace damaged settings or save years behind that error: %s', (damaged) => {
    fs.mkdirSync(join(runtime.directory, 'daten'), { recursive: true })
    fs.writeFileSync(dataPath('einstellungen.json'), damaged)
    expect(() => loadSettings()).toThrow(/Einstellungen/)
    expect(() => saveSettings({ theme: 'hell' })).toThrow(/Einstellungen/)
    expect(() => saveYear('haupt', 2026, main())).toThrow(/Einstellungen/)
    expect(fs.readFileSync(dataPath('einstellungen.json'), 'utf8')).toBe(damaged)
    expect(fs.existsSync(dataPath('kassenbuch-2026.json'))).toBe(false)
  })

  test('recovers before listing and preserves current source files when cloud access fails', () => {
    saveYear('haupt', 2026, main())
    const old = fs.readFileSync(dataPath('kassenbuch-2026.json'), 'utf8')
    fs.writeFileSync(dataPath('kassenbuch-2026.json'), '{interrupted')
    fs.writeFileSync(dataPath('.snapshot-journal.json'), JSON.stringify({ version: 1, status: 'prepared', entries: [{ name: 'kassenbuch-2026.json', before: old }] }))
    expect(listYears('haupt')).toEqual([2026])
    expect(loadYear('haupt', 2026)).toEqual(main())
    const mirror = join(root, 'blocked-cloud')
    fs.writeFileSync(mirror, 'not a directory')
    saveSettings({ cloudBackupEnabled: true, cloudBackupDir: mirror })
    expect(syncCloudNow()).toMatchObject({ enabled: true, lastError: expect.any(String) })
    expect(loadYear('haupt', 2026)).toEqual(main())
  })

  test('validates snapshots before touching files and respects cloud isolation', () => {
    expect(() => saveYear('../escape', 2026, main())).toThrow()
    expect(() => commitSnapshot({ years: [{ konto: 'zweit', year: 2026, data: main() }] })).toThrow()
    expect(() => saveSettings({ theme: 'invalid' })).toThrow()
    runtime.mirrorAllowed = false
    const mirror = join(root, 'forbidden-cloud')
    saveSettings({ cloudBackupEnabled: true, cloudBackupDir: mirror })
    expect(syncCloudNow()).toEqual({ enabled: false })
    expect(fs.existsSync(mirror)).toBe(false)
  })
})
