import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import JSZip from 'jszip'
import { legacyRowHashes, rowHash } from '../../src/shared/csv'
import type { AppSettings, YearFile } from '../../src/shared/types'

const requireHere = createRequire(resolve('package.json'))
const { createPackage } = requireHere('@electron/asar') as { createPackage(source: string, target: string): Promise<void> }

function fixture(): YearFile {
  return { schemaVersion: 1, konto: 'haupt', kontoName: 'Hauptkonto', year: 2026,
    openingBalance: 10000, clubName: 'Produktionstestverein', treasurerName: 'Testperson',
    categories: [{ id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 1 }],
    refNoCounters: { b: 1 }, bookings: [{ id: 'b1', seq: 1, refNo: 1, categoryId: 'b',
      date: '2026-02-01', name: 'Mitglied Muster', description: 'Testbeitrag', type: 'einnahme', amount: 4200,
      isUmsatz: true, nonUmsatzAmount: 0, note: '', source: 'manuell', receiptStatus: 'vorhanden', receiptAvailable: true }],
  }
}

function setup(settings: AppSettings = { theme: 'hell', bankAccounts: [] }) {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-production-ready-'))
  const data = join(root, 'kassenwart', 'daten')
  const output = join(root, 'exports')
  mkdirSync(data, { recursive: true }); mkdirSync(output)
  writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify(fixture()))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify(settings))
  return { root, data, output }
}

async function launch(root: string, archive?: string, damaged = false, bank = false, delayBank = false) {
  const app = await electron.launch({ args: [resolve('tests/e2e/production-bootstrap.cjs')],
    env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root, BUCHFUEHRUNG_TEST_BANK: bank ? '1' : '0',
      BUCHFUEHRUNG_TEST_BANK_DELAY: delayBank ? '1' : '0',
      ...(archive ? { BUCHFUEHRUNG_TEST_ARCHIVE: archive } : {}) },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: damaged ? 'Kassenbuch konnte nicht geöffnet werden' : 'Vereinsübersicht', exact: true })).toBeVisible()
    expect(realpathSync(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(realpathSync(join(root, 'kassenwart')))
    expect(await app.evaluate(({ app }) => app.getName())).toBe('Buchführung')
    return { app, page }
  } catch (error) { await app.close(); throw error }
}

async function close(app: ElectronApplication, root: string) {
  try { await app.close() } finally { rmSync(root, { recursive: true, force: true }) }
}

async function stubDialogs(app: ElectronApplication, directory: string) {
  await app.evaluate(({ dialog, shell }, output) => {
    const runtime = globalThis as typeof globalThis & { __productionExportDefaults: string[] }
    runtime.__productionExportDefaults = []
    let index = 0
    dialog.showSaveDialog = async (...args: unknown[]) => {
      const options = args[args.length - 1] as { defaultPath?: string }
      runtime.__productionExportDefaults.push(options.defaultPath ?? '')
      const name = (options.defaultPath ?? 'export').split(/[\\/]/).pop()!
      return { canceled: false, filePath: `${output}/${++index}-${name}` }
    }
    shell.showItemInFolder = () => {}
  }, directory)
}

async function exported(page: Page, directory: string, button: string, extension: string) {
  const before = new Set(readdirSync(directory))
  await page.getByRole('button', { name: button, exact: true }).click()
  const added = () => readdirSync(directory).filter((name) => !before.has(name) && name.endsWith(extension))
  await expect.poll(() => added().length).toBe(1)
  return join(directory, added()[0])
}

async function failNextSettingsWrite(app: ElectronApplication, message: string) {
  await app.evaluate(async (_electron, faultMessage) => {
    const fs = (globalThis as typeof globalThis & { __readinessFs: typeof import('node:fs') }).__readinessFs
    const original = fs.writeFileSync
    let failed = false
    const runtime = globalThis as typeof globalThis & { __restoreBankTestWrites(): void }
    runtime.__restoreBankTestWrites = () => { fs.writeFileSync = original }
    fs.writeFileSync = ((file: unknown, ...args: unknown[]) => {
      if (!failed && /einstellungen\.json\.[^.]+\.tmp$/.test(String(file))) {
        failed = true
        throw new Error(faultMessage)
      }
      return Reflect.apply(original, fs, [file, ...args])
    }) as typeof fs.writeFileSync
  }, message)
}

test('nutzt im Produktionsbuild die bisherigen Datenpfade und akzeptiert ein externes temporäres Cloud-Ziel', async () => {
  const { root, data } = setup()
  const { app, page } = await launch(root)
  try {
    const cloud = join(root, 'separate-cloud')
    const updated = { ...fixture(), treasurerName: 'Geprüfte Testperson', bookings: [{ ...fixture().bookings[0], amount: 4301 }] }
    await page.evaluate(async ({ file, target }) => {
      const settings = await window.kassenwart!.loadSettings() as AppSettings
      await window.kassenwart!.commitSnapshot({ settings: { ...settings, theme: 'dunkel', cloudBackupEnabled: true, cloudBackupDir: target },
        years: [{ konto: 'haupt', year: 2026, data: file }] })
    }, { file: updated, target: cloud })
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8'))).toEqual(updated)
    expect(readFileSync(join(cloud, 'kassenbuch-2026.json'), 'utf8')).toBe(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8'))
    expect(readFileSync(join(cloud, 'einstellungen.json'), 'utf8')).toBe(readFileSync(join(data, 'einstellungen.json'), 'utf8'))
    const settings = JSON.parse(readFileSync(join(data, 'einstellungen.json'), 'utf8')) as AppSettings
    expect(settings.cloudBackupDir).toBe(cloud)
    expect(readdirSync(join(data, 'backups')).some((name) => name.startsWith('einstellungen') && name.endsWith('.json'))).toBe(true)
    expect(await page.evaluate(() => window.kassenwart!.cloudSyncStatus())).toMatchObject({ enabled: true })
  } finally { await close(app, root) }
})

test('öffnet Produktionscode aus ASAR mit beschreibbarem Datenordner und exportiert PDF sowie lazy geladenes PowerPoint', async () => {
  test.setTimeout(90_000)
  const { root, output } = setup()
  const source = join(root, 'package-source')
  mkdirSync(source)
  cpSync(resolve('.production-out'), join(source, 'out'), { recursive: true })
  const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'buchfuehrung-production-test', version, main: 'out/main/index.js' }))
  const archive = join(root, 'app.asar')
  await createPackage(source, archive)
  const { app, page } = await launch(root, archive)
  try {
    expect(await page.evaluate(() => window.kassenwart!.listYears('haupt'))).toEqual([2026])
    await stubDialogs(app, output)
    await page.getByRole('navigation', { name: 'Verein', exact: true }).getByRole('button', { name: 'Berichte', exact: true }).click()
    await page.getByRole('button', { name: 'Jahrespräsentation', exact: true }).click()
    const pptx = await exported(page, output, 'PowerPoint exportieren', '.pptx')
    expect((await JSZip.loadAsync(readFileSync(pptx))).file('ppt/presentation.xml')).not.toBeNull()
    const pdf = await exported(page, output, 'PDF exportieren', '.pdf')
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
    const defaults = await app.evaluate(() => (globalThis as typeof globalThis & { __productionExportDefaults: string[] }).__productionExportDefaults)
    const downloads = await app.evaluate(({ app }) => app.getPath('downloads'))
    expect(defaults).toHaveLength(2)
    for (const name of defaults) { expect(dirname(name)).toBe(downloads); expect(name).not.toContain('app.asar') }
    mkdirSync(resolve('.validation/production-fixed'), { recursive: true })
    copyFileSync(pptx, resolve('.validation/production-fixed/ASAR-Jahrespraesentation.pptx'))
    copyFileSync(pdf, resolve('.validation/production-fixed/ASAR-Jahrespraesentation.pdf'))
  } finally { await close(app, root) }
})

test('meldet beschädigte Einstellungen und überschreibt sie weder beim Start noch beim erneuten Speichern', async () => {
  const { root, data } = setup()
  const settingsFile = join(data, 'einstellungen.json')
  const damaged = '{"theme":'
  writeFileSync(settingsFile, damaged)
  const { app, page } = await launch(root, undefined, true)
  try {
    await expect(page.getByRole('alert')).toContainText(/Einstellungen|Sicherung|lesen|beschädigt/i)
    expect(readFileSync(settingsFile, 'utf8')).toBe(damaged)
    const refused = await page.evaluate(async () => {
      try { await window.kassenwart!.saveSettings({ theme: 'hell' }); return false } catch { return true }
    })
    expect(refused).toBe(true)
    expect(readFileSync(settingsFile, 'utf8')).toBe(damaged)
    await page.getByRole('button', { name: 'Erneut öffnen', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Kassenbuch konnte nicht geöffnet werden', exact: true })).toBeVisible()
    expect(readFileSync(settingsFile, 'utf8')).toBe(damaged)
  } finally { await close(app, root) }
})

test('weist widersprüchliche Snapshot- und Kontopfade vor Schreibzugriffen zurück', async () => {
  const { root, data } = setup()
  const beforeYear = readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')
  const beforeSettings = readFileSync(join(data, 'einstellungen.json'), 'utf8')
  const { app, page } = await launch(root)
  try {
    const failures = await page.evaluate(async (year) => {
      const requests = [
        { settings: { theme: 'hell' }, years: [{ konto: '../outside', year: 2026, data: year }] },
        { settings: { theme: 'hell' }, years: [{ konto: 'haupt', year: 2027, data: year }] },
      ]
      return Promise.all(requests.map(async (request) => {
        try { await window.kassenwart!.commitSnapshot(request); return false } catch { return true }
      }))
    }, fixture())
    expect(failures).toEqual([true, true])
    expect(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')).toBe(beforeYear)
    expect(readFileSync(join(data, 'einstellungen.json'), 'utf8')).toBe(beforeSettings)
    expect(existsSync(join(root, 'outside-2026.json'))).toBe(false)
  } finally { await close(app, root) }
})

test('stellt nach einem abgebrochenen gemeinsamen Speichervorgang vor dem Öffnen den letzten vollständigen Stand wieder her', async () => {
  const { root, data } = setup()
  const oldYear = readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')
  const oldSettings = readFileSync(join(data, 'einstellungen.json'), 'utf8')
  writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify({ ...fixture(), treasurerName: 'Unvollständige Änderung' }))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'dunkel', bankAccounts: [] }))
  writeFileSync(join(data, 'kassenbuch-k3-2026.json'), JSON.stringify({ ...fixture(), konto: 'k3' }))
  const journal = join(data, '.snapshot-journal.json')
  writeFileSync(journal, JSON.stringify({ version: 1, status: 'prepared', entries: [
    { name: 'einstellungen.json', before: oldSettings },
    { name: 'kassenbuch-2026.json', before: oldYear },
    { name: 'kassenbuch-k3-2026.json', before: null },
  ] }))
  const { app, page } = await launch(root)
  try {
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8'))).toEqual(JSON.parse(oldYear))
    expect(readFileSync(join(data, 'einstellungen.json'), 'utf8')).toBe(oldSettings)
    expect(existsSync(join(data, 'kassenbuch-k3-2026.json'))).toBe(false)
    expect(existsSync(journal)).toBe(false)
    expect(await page.evaluate(() => window.kassenwart!.listKontos())).toEqual(['haupt'])
  } finally { await close(app, root) }
})

test('behält einen vollständig bestätigten Snapshot bei einem Neustart und entfernt nur dessen Journal', async () => {
  const { root, data } = setup()
  const oldYear = readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')
  const oldSettings = readFileSync(join(data, 'einstellungen.json'), 'utf8')
  const updatedYear = { ...fixture(), treasurerName: 'Vollständig gespeichert' }
  const updatedSettings = { theme: 'dunkel', bankAccounts: [] }
  writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify(updatedYear))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify(updatedSettings))
  const journal = join(data, '.snapshot-journal.json')
  writeFileSync(journal, JSON.stringify({ version: 1, status: 'committed', entries: [
    { name: 'einstellungen.json', before: oldSettings }, { name: 'kassenbuch-2026.json', before: oldYear },
  ] }))
  const { app, page } = await launch(root)
  try {
    expect(await page.evaluate(() => window.kassenwart!.loadYear('haupt', 2026))).toEqual(updatedYear)
    expect(await page.evaluate(() => window.kassenwart!.loadSettings())).toEqual(updatedSettings)
    expect(existsSync(journal)).toBe(false)
  } finally { await close(app, root) }
})

test('öffnet keine zweite Produktionsinstanz für denselben Datenordner', async () => {
  const { root, data } = setup()
  const { app, page } = await launch(root)
  try {
    const before = readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const second = spawn(requireHere('electron') as string, [resolve('tests/e2e/production-bootstrap.cjs')], {
        env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root }, stdio: 'ignore',
      })
      const timeout = setTimeout(() => { second.kill(); reject(new Error('Zweite Instanz wurde nicht beendet.')) }, 10_000)
      second.once('error', (failure) => { clearTimeout(timeout); reject(failure) })
      second.once('exit', (code) => { clearTimeout(timeout); resolveExit(code) })
    })
    expect(exitCode).toBe(0)
    expect((await app.windows()).length).toBe(1)
    await expect(page.getByRole('heading', { name: 'Vereinsübersicht', exact: true })).toBeVisible()
    expect(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')).toBe(before)
  } finally { await close(app, root) }
})

test('behält den automatischen Bankimport eines inaktiven Kontos auch nach einem vollständigen Speicher-Retry', async () => {
  const { root, data } = setup({ theme: 'hell', bankAccounts: [{ id: 'startup-test', konto: 'zweit',
    label: 'Testbank', blz: '12345678', userId: 'Testperson', accountNumber: '123', fintsUrl: 'https://example.invalid/fints' }] })
  const existingDraft = { date: '2026-10-01', amount: 1700, bankText: 'Bestehender Entwurf',
    hash: rowHash('2026-10-01', 1700, 'Bestehender Entwurf'),
    legacyHashes: legacyRowHashes('2026-10-01', 1700, 'Bestehender Entwurf'), name: 'Vorheriges Mitglied',
    description: 'Bereits zugeordnet', selected: false, categoryId: 'b', isUmsatz: true,
    receiptStatus: 'offen' as const, receiptAvailable: false, allocations: [{ area: 'I' as const, amount: 1700 }] }
  const second: YearFile = { ...fixture(), konto: 'zweit', kontoName: 'Nebenkonto',
    importDraft: { fileName: 'Vorheriger Import', skipped: 0, rows: [existingDraft] } }
  const secondFile = join(data, 'kassenbuch-k2-2026.json')
  writeFileSync(secondFile, JSON.stringify(second))
  const { app, page } = await launch(root, undefined, false, true)
  const readSecond = () => JSON.parse(readFileSync(secondFile, 'utf8')) as YearFile
  try {
    await expect.poll(() => readSecond().importDraft?.rows.length).toBe(2)
    expect(readSecond().importDraft?.rows[0]).toMatchObject(existingDraft)
    expect(await app.evaluate(() => (globalThis as typeof globalThis & {
      __productionBankCalls: Array<{ id: string; konto: string }>
    }).__productionBankCalls)).toEqual([{ id: 'startup-test', konto: 'zweit' }])

    // Vor dem ersten Kontowechsel muss der Gesamt-Snapshot bereits den neuen
    // Entwurf kennen; ein erneutes Laden von der Platte würde den Fehler verdecken.
    await failNextSettingsWrite(app, 'Simulierter Einstellungsfehler nach Bankimport')
    await page.getByRole('navigation', { name: 'Verein', exact: true }).getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await page.getByLabel('Farbschema', { exact: true }).selectOption('dunkel')
    await expect(page.locator('.org-global-error[role="alert"]')).toContainText('Simulierter Einstellungsfehler nach Bankimport')
    await app.evaluate(() => (globalThis as typeof globalThis & { __restoreBankTestWrites(): void }).__restoreBankTestWrites())
    await page.getByRole('button', { name: 'Erneut speichern', exact: true }).click()
    await expect(page.locator('.org-global-error[role="alert"]')).toHaveCount(0)
    expect(readSecond().importDraft?.rows).toHaveLength(2)
    expect(readSecond().importDraft?.rows[0]).toMatchObject(existingDraft)
    expect(readSecond().importDraft?.rows[1]).toMatchObject({ bankText: 'Automatischer Testumsatz', amount: 2450, bankName: 'Testmitglied' })
    expect(JSON.parse(readFileSync(join(data, 'einstellungen.json'), 'utf8')).theme).toBe('dunkel')

    await page.getByLabel('Konto wählen', { exact: true }).selectOption('zweit')
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: /Umsätze importieren/ }).click()
    await expect(page.getByText('Automatischer Testumsatz', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Eigener Verwendungszweck', { exact: true }).first()).toHaveValue('Bereits zugeordnet')
  } finally { await close(app, root) }
})

test('wechselt bei verzögertem Bankabruf Konto und Jahr aus dem aktuellen Cache statt aus verspäteten Plattenantworten', async () => {
  const { root, data } = setup({ theme: 'hell', bankAccounts: [{ id: 'startup-test', konto: 'zweit',
    label: 'Testbank', blz: '12345678', userId: 'Testperson', accountNumber: '123', fintsUrl: 'https://example.invalid/fints' }] })
  const second = { ...fixture(), konto: 'zweit', kontoName: 'Nebenkonto' }
  writeFileSync(join(data, 'kassenbuch-k2-2026.json'), JSON.stringify(second))
  writeFileSync(join(data, 'kassenbuch-k2-2025.json'), JSON.stringify({ ...second, year: 2025,
    bookings: second.bookings.map((booking) => ({ ...booking, date: '2025-02-01' })) }))
  const { app, page } = await launch(root, undefined, false, true, true)
  const readSecond = () => JSON.parse(readFileSync(join(data, 'kassenbuch-k2-2026.json'), 'utf8')) as YearFile
  try {
    await expect.poll(async () => app.evaluate(() => (globalThis as typeof globalThis & {
      __productionBankCalls: unknown[]
    }).__productionBankCalls.length)).toBe(1)
    const readsBeforeSelection = await app.evaluate(() => {
      const runtime = globalThis as typeof globalThis & { __productionHoldYearLoads: boolean; __productionYearLoads: unknown[] }
      runtime.__productionHoldYearLoads = true
      return runtime.__productionYearLoads.length
    })

    // Ein nach dem Start ausgelöstes years:load würde eine alte Antwort
    // festhalten. Konto- und Jahreswahl müssen ohne diese Antwort funktionieren.
    await page.getByLabel('Konto wählen', { exact: true }).selectOption('zweit')
    await expect(page.getByRole('heading', { name: /^Übersicht 2026/ })).toBeVisible()
    await page.getByLabel('Jahr wählen', { exact: true }).selectOption('2025')
    await expect(page.getByRole('heading', { name: /^Übersicht 2025/ })).toBeVisible()
    await page.getByLabel('Jahr wählen', { exact: true }).selectOption('2026')
    await expect(page.getByRole('heading', { name: /^Übersicht 2026/ })).toBeVisible()
    expect(await app.evaluate(() => (globalThis as typeof globalThis & {
      __productionYearLoads: unknown[]
    }).__productionYearLoads.length)).toBe(readsBeforeSelection)

    await app.evaluate(() => (globalThis as typeof globalThis & { __productionReleaseBankFetch(): void }).__productionReleaseBankFetch())
    await expect.poll(() => readSecond().importDraft?.rows.length).toBe(1)
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: /Umsätze importieren/ }).click()
    await expect(page.getByText('Automatischer Testumsatz', { exact: true })).toBeVisible()

    await failNextSettingsWrite(app, 'Speicherfehler nach Konto- und Jahreswechsel')
    await page.getByRole('navigation', { name: 'Verein', exact: true }).getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await page.getByLabel('Farbschema', { exact: true }).selectOption('dunkel')
    await expect(page.locator('.org-global-error[role="alert"]')).toContainText('Speicherfehler nach Konto- und Jahreswechsel')
    await app.evaluate(() => (globalThis as typeof globalThis & { __restoreBankTestWrites(): void }).__restoreBankTestWrites())
    await page.getByRole('button', { name: 'Erneut speichern', exact: true }).click()
    await expect(page.locator('.org-global-error[role="alert"]')).toHaveCount(0)
    expect(readSecond().importDraft?.rows[0]).toMatchObject({ bankText: 'Automatischer Testumsatz', amount: 2450 })
    expect(await app.evaluate(() => (globalThis as typeof globalThis & {
      __productionYearLoads: unknown[]
    }).__productionYearLoads.length)).toBe(readsBeforeSelection)
  } finally {
    await app.evaluate(() => {
      const runtime = globalThis as typeof globalThis & { __productionReleaseBankFetch(): void; __productionReleaseYearLoads(): void }
      runtime.__productionReleaseBankFetch(); runtime.__productionReleaseYearLoads()
    })
    await close(app, root)
  }
})

test('verwendet bei einem manipulierten Updateauftrag keine vom Renderer eingeschleuste Downloadadresse', async () => {
  const { root } = setup()
  const { app, page } = await launch(root)
  try {
    const response = await page.evaluate(async () => {
      try {
        return await window.kassenwart!.installUpdate({ current: '1.17.0', latest: '999.0.0', hasUpdate: true,
          assetName: 'manipuliert.dmg', assetUrl: 'https://example.invalid/untrusted-installer.dmg' })
      } catch (failure) { return { ok: false, error: failure instanceof Error ? failure.message : String(failure) } }
    })
    expect(response.ok).toBe(false)
    expect(await app.evaluate(() => (globalThis as typeof globalThis & {
      __productionNetworkRequests: string[]
    }).__productionNetworkRequests)).toEqual(['https://api.github.com/repos/JPoepsel02/buchfuehrung/releases/latest'])
    await expect(page.getByRole('heading', { name: 'Vereinsübersicht', exact: true })).toBeVisible()
  } finally { await close(app, root) }
})
