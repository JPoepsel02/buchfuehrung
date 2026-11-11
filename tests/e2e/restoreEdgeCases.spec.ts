import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildBackup } from '../../src/shared/backup'
import { bookingKey, makeAssignment } from '../../src/shared/organization'
import { legacyRowHashes, rowHash } from '../../src/shared/csv'
import type { AppSettings, Booking, YearFile } from '../../src/shared/types'
import type { OrganizationConfig, OrganizationTransfer } from '../../src/shared/organization'

function year(konto: string, number = 2026, type: Booking['type'] = 'einnahme', amount = 1000): YearFile {
  return { schemaVersion: 1, konto, kontoName: konto === 'haupt' ? 'Hauptkonto' : konto === 'zweit' ? 'Importkonto' : konto,
    year: number, openingBalance: 0, clubName: 'Bestandsverein', treasurerName: 'Testperson', refNoCounters: { b: 1 },
    categories: [{ id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 1 }], bookings: [{
      id: `${konto}-${number}`, seq: 1, refNo: 1, date: `${number}-02-01`, categoryId: 'b', type, amount,
      name: 'Testperson', description: 'Bestand', isUmsatz: false, nonUmsatzAmount: 0, note: '', source: 'manuell',
      receiptStatus: 'nicht_erforderlich', receiptAvailable: false,
    }],
  }
}
const nameFor = (file: YearFile) => `kassenbuch${file.konto === 'zweit' ? '-k2' : file.konto && file.konto !== 'haupt' ? `-${file.konto}` : ''}-${file.year}.json`
const key = (file: YearFile) => bookingKey({ konto: file.konto ?? 'haupt', year: file.year, bookingId: file.bookings[0].id })
const transfer = (id: string, from: YearFile, to: YearFile): OrganizationTransfer => ({ id,
  from: { konto: from.konto!, year: from.year, bookingId: from.bookings[0].id },
  to: { konto: to.konto!, year: to.year, bookingId: to.bookings[0].id },
  amount: from.bookings[0].amount, fromDate: from.bookings[0].date, toDate: to.bookings[0].date,
})

function setup(cloud = false) {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-restore-edge-'))
  const data = join(root, 'kassenwart', 'daten'), output = join(root, 'exports')
  mkdirSync(data, { recursive: true }); mkdirSync(output)
  const files = [year('haupt', 2025), year('haupt'), year('k3', 2026, 'ausgabe', 500), year('k4', 2026, 'einnahme', 500)]
  const organization: OrganizationConfig = { name: 'Bestandsverein', treasurerName: 'Testperson', rules: [
    { id: 'old-rule', konto: 'k3', categoryId: 'b', area: 'I' },
  ], assignments: { [key(files[0])]: makeAssignment(files[0].bookings[0], [{ area: 'Z', amount: 1000 }]),
    [key(files[1])]: makeAssignment(files[1].bookings[0], [{ area: 'I', amount: 1000 }]) },
  transfers: [transfer('old-transfer', files[2], files[3])] }
  const settings: AppSettings = { theme: 'hell', kontoSequence: 4, bankAccounts: [], organization,
    accountNumbers: { haupt: 'DE111', k3: 'DE333', k4: 'DE444' }, cloudBackupEnabled: cloud,
    cloudBackupDir: cloud ? join(root, '.local-backups', 'previous') : null,
  }
  for (const file of files) writeFileSync(join(data, nameFor(file)), JSON.stringify(file))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify(settings))
  return { root, data, output, files, settings }
}

function sourceBackup(settings = true) {
  const main = year('haupt', 2026, 'ausgabe'), second = year('zweit')
  const text = 'Offener importierter Entwurf'
  main.importDraft = { fileName: 'Noch-offen.csv', skipped: 0, rows: [{ date: '2026-03-01', amount: -400,
    bankText: text, bankName: 'Originalname', hash: rowHash('2026-03-01', -400, text),
    legacyHashes: legacyRowHashes('2026-03-01', -400, text), name: 'Testname', description: 'Noch zu buchen',
    selected: false, categoryId: 'b', isUmsatz: false, allocations: [{ area: 'W', amount: 400 }],
    receiptStatus: 'nicht_erforderlich', receiptAvailable: false,
  }] }
  const organization: OrganizationConfig = { name: 'Importverein', treasurerName: 'Importperson',
    assignments: {}, rules: [{ id: 'new-rule', konto: 'haupt', categoryId: 'b', area: 'W' }],
    transfers: [transfer('new-transfer', main, second)],
  }
  return buildBackup([main, second], settings ? { organization, kontoSequence: 2, bankAccounts: [],
    accountNumbers: { haupt: 'DE222', zweit: 'DE555' }, cloudBackupEnabled: true, cloudBackupDir: '/never-use-imported-cloud',
  } : undefined, '2026-11-01T00:00:00Z')
}

async function start(root: string) {
  const app = await electron.launch({ args: [resolve('tests/e2e/bootstrap.cjs')],
    env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Vereinsübersicht', exact: true })).toBeVisible()
    await page.getByRole('navigation', { name: 'Verein', exact: true }).getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Gemeinsame Einstellungen', exact: true })).toBeVisible()
    return { app, page }
  } catch (error) { await app.close(); throw error }
}
const readSettings = (data: string) => JSON.parse(readFileSync(join(data, 'einstellungen.json'), 'utf8')) as AppSettings
const disk = (data: string) => Object.fromEntries(readdirSync(data).filter((name) => !name.startsWith('.') && name.endsWith('.json')).sort().map((name) => [name, readFileSync(join(data, name), 'utf8')]))
const importButton = (page: Page) => page.getByRole('button', { name: 'Sicherung importieren …', exact: true })

test('sperrt die Bearbeitung während einer laufenden Wiederherstellung', async () => {
  const { root, data } = setup(), { app, page } = await start(root)
  try {
    const before = disk(data)
    await dialogs(app, root, JSON.stringify(sourceBackup()))
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('data:commit')
      ipcMain.handle('data:commit', () => new Promise((_resolve, reject) => {
        Object.assign(globalThis, { __endRestoreTest: () => reject(new Error('Simulierter Wiederherstellungsfehler')) })
      }))
    })
    page.on('dialog', (dialog) => dialog.accept())
    await importButton(page).click()
    await expect(page.getByRole('status', { name: '', exact: true }).filter({ hasText: 'Sicherung wird wiederhergestellt' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0)
    await expect.poll(() => app.evaluate(() => typeof (globalThis as typeof globalThis & { __endRestoreTest?: () => void }).__endRestoreTest)).toBe('function')
    await app.evaluate(() => (globalThis as typeof globalThis & { __endRestoreTest: () => void }).__endRestoreTest())
    await expect(page.locator('.org-global-error[role="alert"]')).toContainText('Simulierter Wiederherstellungsfehler')
    expect(disk(data)).toEqual(before)
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})

async function dialogs(app: ElectronApplication, root: string, content: string, cancelSave = false) {
  const file = join(root, 'import.json'); writeFileSync(file, content)
  await app.evaluate(({ dialog, shell }, options) => {
    const state = globalThis as typeof globalThis & { __restoreDialogCalls: { open: number; save: number } }
    state.__restoreDialogCalls = { open: 0, save: 0 }
    dialog.showOpenDialog = async () => { state.__restoreDialogCalls.open++; return { canceled: false, filePaths: [options.file] } }
    dialog.showSaveDialog = async () => {
      state.__restoreDialogCalls.save++
      return { canceled: options.cancelSave, filePath: `${options.root}/exports/before-${state.__restoreDialogCalls.save}.json` }
    }
    shell.showItemInFolder = () => {}
  }, { root, file, cancelSave })
}

test('stellt mehrere Konten mit Entwurf und Umbuchung wieder her und bewahrt nicht enthaltene Jahre samt Zuordnungen', async () => {
  const context = setup(), { root, data } = context
  let { app, page } = await start(root)
  try {
    const retainedYear = readFileSync(join(data, 'kassenbuch-2025.json'), 'utf8')
    const backup = sourceBackup()
    await dialogs(app, root, JSON.stringify(backup))
    page.on('dialog', (dialog) => dialog.accept())
    const reload = page.waitForEvent('domcontentloaded')
    await importButton(page).click(); await reload
    await expect(page.getByRole('heading', { name: 'Vereinsübersicht', exact: true })).toBeVisible()
    const restored = readSettings(data)
    expect(readFileSync(join(data, 'kassenbuch-2025.json'), 'utf8')).toBe(retainedYear)
    expect(restored.organization?.assignments[key(context.files[0])]).toEqual(context.settings.organization!.assignments[key(context.files[0])])
    expect(restored.organization?.transfers.map((entry) => entry.id).sort()).toEqual(['new-transfer', 'old-transfer'])
    expect(restored.accountNumbers).toEqual({ haupt: 'DE222', zweit: 'DE555', k3: 'DE333', k4: 'DE444' })
    expect(restored.kontoSequence).toBeGreaterThanOrEqual(4)
    expect(restored).toMatchObject({ cloudBackupEnabled: false, cloudBackupDir: null })
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')).importDraft.rows[0]).toMatchObject({
      bankName: 'Originalname', description: 'Noch zu buchen', allocations: [{ area: 'W', amount: 400 }],
    })
    const previous = JSON.parse(readFileSync(join(root, 'exports', 'before-1.json'), 'utf8'))
    expect(previous.years).toHaveLength(4)
    expect(previous.settings.organization.assignments).toEqual(context.settings.organization!.assignments)
    await app.close(); ({ app, page } = await start(root))
    expect(readSettings(data).organization?.transfers).toHaveLength(2)
    await expect(page.getByLabel('Konto wählen', { exact: true }).locator('option')).toHaveCount(4)
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})

test('deaktiviert auch beim Import ohne Einstellungen die bisherige Cloud-Spiegelung', async () => {
  const { root, data, settings } = setup(true), { app, page } = await start(root)
  try {
    const mirror = settings.cloudBackupDir!
    const beforeMirror = existsSync(mirror) ? disk(mirror) : {}
    await dialogs(app, root, JSON.stringify(sourceBackup(false)))
    page.on('dialog', (dialog) => dialog.accept())
    const reload = page.waitForEvent('domcontentloaded')
    await importButton(page).click(); await reload
    expect(readSettings(data)).toMatchObject({ cloudBackupEnabled: false, cloudBackupDir: null, kontoSequence: 4 })
    expect(readSettings(data).organization?.assignments[JSON.stringify(['haupt', 2026, 'haupt-2026'])]).toBeUndefined()
    expect(readSettings(data).organization?.assignments[JSON.stringify(['haupt', 2025, 'haupt-2025'])]).toBeDefined()
    expect(existsSync(mirror) ? disk(mirror) : {}).toEqual(beforeMirror)
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})

for (const cancel of ['confirmation', 'before-backup'] as const) {
  test(`ändert nach Abbruch bei ${cancel} keine gespeicherten Daten`, async () => {
    const { root, data } = setup(), { app, page } = await start(root)
    try {
      const before = disk(data)
      await dialogs(app, root, JSON.stringify(sourceBackup()), cancel === 'before-backup')
      const confirm = page.waitForEvent('dialog')
      const click = importButton(page).click()
      const question = await confirm
      if (cancel === 'confirmation') await question.dismiss()
      else await question.accept()
      await click
      await expect(importButton(page)).toBeEnabled()
      if (cancel === 'before-backup') await expect(page.getByRole('status')).toContainText('Wiederherstellung abgebrochen')
      expect(disk(data)).toEqual(before)
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { __restoreDialogCalls: { save: number } }).__restoreDialogCalls.save)).toBe(cancel === 'confirmation' ? 0 : 1)
    } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
  })
}

for (const invalid of ['json', 'date'] as const) {
  test(`weist eine beschädigte Sicherung (${invalid}) ohne Sicherungs- oder Schreibdialog zurück`, async () => {
    const { root, data } = setup(), { app, page } = await start(root)
    try {
      const before = disk(data), source = sourceBackup()
      source.years[0].bookings[0].date = '2026-02-31'
      await dialogs(app, root, invalid === 'json' ? '{broken' : JSON.stringify(source))
      const message = page.waitForEvent('dialog')
      const click = importButton(page).click()
      const warning = await message
      expect(warning.type()).toBe('alert')
      expect(warning.message()).toMatch(invalid === 'json' ? /keine lesbare JSON/ : /NICHT importiert/)
      await warning.accept()
      await click
      await expect(importButton(page)).toBeEnabled()
      expect(disk(data)).toEqual(before)
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { __restoreDialogCalls: { save: number } }).__restoreDialogCalls.save)).toBe(0)
    } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
  })
}

test('rollt einen Fehler beim Wiederherstellen vollständig zurück und lässt einen erneuten Import zu', async () => {
  const { root, data } = setup(), { app, page } = await start(root)
  try {
    const before = disk(data)
    await dialogs(app, root, JSON.stringify(sourceBackup()))
    page.on('dialog', (dialog) => dialog.accept())
    await app.evaluate(() => {
      const fs = (globalThis as typeof globalThis & { __readinessFs: typeof import('node:fs') }).__readinessFs
      const original = fs.writeFileSync
      let failed = false
      const state = globalThis as typeof globalThis & { __restoreFileWrites(): void }
      state.__restoreFileWrites = () => { fs.writeFileSync = original }
      fs.writeFileSync = ((file: unknown, ...args: unknown[]) => {
        if (!failed && /kassenbuch-2026\.json\.[^.]+\.tmp$/.test(String(file))) {
          failed = true
          throw new Error('Simulierter Wiederherstellungsfehler')
        }
        return Reflect.apply(original, fs, [file, ...args])
      }) as typeof fs.writeFileSync
    })
    await importButton(page).click()
    await expect(page.locator('.org-global-error[role="alert"]')).toContainText('Simulierter Wiederherstellungsfehler')
    await expect(importButton(page)).toBeEnabled()
    expect(disk(data)).toEqual(before)
    expect(existsSync(join(data, '.snapshot-journal.json'))).toBe(false)
    await app.evaluate(() => (globalThis as typeof globalThis & { __restoreFileWrites(): void }).__restoreFileWrites())
    await page.getByRole('button', { name: 'Erneut speichern', exact: true }).click()
    await expect(page.locator('.org-global-error[role="alert"]')).toHaveCount(0)
    const reload = page.waitForEvent('domcontentloaded')
    await importButton(page).click(); await reload
    await expect(page.getByRole('heading', { name: 'Vereinsübersicht', exact: true })).toBeVisible()
    expect(readSettings(data).organization?.name).toBe('Importverein')
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})

test('öffnet bei einem Doppelklick nur einen Import und sperrt parallele Sicherungsaktionen', async () => {
  const { root, data } = setup(), { app, page } = await start(root)
  try {
    const before = disk(data)
    await app.evaluate(({ dialog }) => {
      const runtime = globalThis as typeof globalThis & { __restoreOpenCount: number; __releaseRestoreDialog(): void }
      runtime.__restoreOpenCount = 0
      dialog.showOpenDialog = async () => {
        runtime.__restoreOpenCount++
        await new Promise<void>((done) => { runtime.__releaseRestoreDialog = done })
        return { canceled: true, filePaths: [] }
      }
    })
    await importButton(page).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { __restoreOpenCount: number }).__restoreOpenCount)).toBe(1)
    await expect(importButton(page)).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Daten exportieren …', exact: true })).toBeDisabled()
    await app.evaluate(() => (globalThis as typeof globalThis & { __releaseRestoreDialog(): void }).__releaseRestoreDialog())
    await expect(importButton(page)).toBeEnabled()
    expect(disk(data)).toEqual(before)
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})
