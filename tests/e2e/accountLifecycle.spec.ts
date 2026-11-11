import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AppSettings, YearFile } from '../../src/shared/types'

function fixture(konto: string, year: number, openingBalance = 10000, fiscalStartMonth = 1): YearFile {
  return { schemaVersion: 1, konto, kontoName: konto === 'haupt' ? 'Hauptkonto' : 'Altes Festkonto', year, fiscalStartMonth,
    clubName: 'Lifecycle-Testverein', treasurerName: 'Testperson', openingBalance,
    categories: [{ id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 1 }], refNoCounters: { b: 1 },
    bookings: [{ id: `${konto}-${year}`, seq: 1, refNo: 1, categoryId: 'b', date: `${year}-12-01`,
      name: 'Testmitglied', description: 'Beitrag', amount: 4200, type: 'einnahme', isUmsatz: true,
      nonUmsatzAmount: 0, note: '', source: 'manuell', receiptStatus: 'vorhanden', receiptAvailable: true }],
  }
}
const yearName = (file: Pick<YearFile, 'konto' | 'year'>) => `kassenbuch${file.konto === 'haupt' ? '' : `-${file.konto === 'zweit' ? 'k2' : file.konto}`}-${file.year}.json`

function setup(files: YearFile[], settings: AppSettings = {}) {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-account-life-'))
  const data = join(root, 'kassenwart', 'daten')
  mkdirSync(data, { recursive: true })
  for (const file of files) writeFileSync(join(data, yearName(file)), JSON.stringify(file))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'hell', bankAccounts: [], ...settings }))
  return { root, data }
}
async function launch(root: string) {
  const app = await electron.launch({ args: [resolve('tests/e2e/bootstrap.cjs')], env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Vereinsübersicht', exact: true })).toBeVisible()
    return { app, page }
  } catch (failure) { await app.close(); throw failure }
}
async function close(app: ElectronApplication, root: string) { try { await app.close() } finally { rmSync(root, { recursive: true, force: true }) } }
const readYear = (data: string, konto: string, year: number) => JSON.parse(readFileSync(join(data, yearName({ konto, year })), 'utf8')) as YearFile
const readSettings = (data: string) => JSON.parse(readFileSync(join(data, 'einstellungen.json'), 'utf8')) as AppSettings
async function accountSettings(page: Page, konto: string) {
  await page.getByLabel('Konto wählen', { exact: true }).selectOption(konto)
  await page.getByRole('navigation', { name: 'Hauptnavigation', exact: true }).getByRole('button', { name: 'Kontoeinstellungen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kontoeinstellungen', exact: true })).toBeVisible()
}
const yearRow = (page: Page, year: number) => page.locator('table').first().getByRole('row').filter({ hasText: String(year) })
async function removeYear(page: Page, year: number, confirm = true) {
  await page.evaluate((accept) => { window.confirm = () => accept }, confirm)
  await yearRow(page, year).getByRole('button', { name: 'Löschen', exact: true }).click()
}
async function createAccount(page: Page, name: string, year = 2027) {
  await page.getByRole('button', { name: 'Konto anlegen', exact: true }).click()
  await page.getByLabel('Name des Kontos', { exact: true }).fill(name)
  await page.getByLabel('Kassenjahr beginnt im', { exact: true }).selectOption('11')
  await page.getByLabel(/Startjahr/).fill(String(year))
  await page.getByLabel('Anfangssaldo (€)', { exact: true }).fill('-123,45')
  await page.getByRole('button', { name: 'Konto anlegen', exact: true }).click()
}

test('schützt das letzte Hauptjahr, sichert geschlossene Konten und vergibt nach Neustart niemals deren Kennung erneut', async () => {
  test.setTimeout(60_000)
  const { root, data } = setup([fixture('haupt', 2026), fixture('zweit', 2025), fixture('zweit', 2026)], {
    accountNumbers: { zweit: 'ALTE-NUMMER' }, organization: { name: 'Lifecycle-Testverein', treasurerName: 'Testperson',
      rules: [{ id: 'retired', konto: 'k4', categoryId: 'old', area: 'I' }], assignments: {}, transfers: [] },
  })
  let { app, page } = await launch(root)
  try {
    await accountSettings(page, 'haupt')
    await expect(yearRow(page, 2026).getByRole('button', { name: 'Löschen', exact: true })).toBeDisabled()
    await accountSettings(page, 'zweit')
    await removeYear(page, 2025, false)
    expect(existsSync(join(data, 'kassenbuch-k2-2025.json'))).toBe(true)
    await removeYear(page, 2025)
    await expect.poll(() => existsSync(join(data, 'kassenbuch-k2-2025.json'))).toBe(false)
    const backup = readdirSync(join(data, 'backups')).find((name) => name.startsWith('kassenbuch-k2-2025-geloescht-'))
    expect(backup).toBeTruthy()
    expect(JSON.parse(readFileSync(join(data, 'backups', backup!), 'utf8')).bookings).toHaveLength(1)
    await removeYear(page, 2026)
    await expect(page.getByLabel('Konto wählen', { exact: true })).toHaveValue('haupt')
    await expect(page.getByLabel('Konto wählen', { exact: true }).locator('option[value="zweit"]')).toHaveCount(0)
    expect(readSettings(data).kontoSequence).toBe(4)
    await createAccount(page, 'Neues Festkonto')
    await expect(page.getByLabel('Konto wählen', { exact: true })).toHaveValue('k5')
    await expect(page.getByLabel('IBAN / Kontonummer', { exact: true })).toHaveValue('')
    expect(readYear(data, 'k5', 2027)).toMatchObject({ kontoName: 'Neues Festkonto', fiscalStartMonth: 11, openingBalance: -12345, bookings: [] })
    await app.close()
    ;({ app, page } = await launch(root))
    await accountSettings(page, 'k5')
    await removeYear(page, 2027)
    await expect(page.getByLabel('Konto wählen', { exact: true })).toHaveValue('haupt')
    await createAccount(page, 'Noch ein Konto')
    await expect(page.getByLabel('Konto wählen', { exact: true })).toHaveValue('k6')
    expect(readSettings(data).kontoSequence).toBe(6)
  } finally { await close(app, root) }
})

test('legt einen abweichenden Jahresabschluss mit korrektem Vortrag an und verändert ein schon vorhandenes Folgejahr nicht', async () => {
  const { root, data } = setup([fixture('haupt', 2026), fixture('zweit', 2025, 10000, 11)])
  const { app, page } = await launch(root)
  try {
    await accountSettings(page, 'zweit')
    await page.evaluate(() => { window.confirm = () => true })
    await page.getByRole('button', { name: /Jahresabschluss → 2026/ }).click()
    await expect(page.getByLabel('Jahr wählen', { exact: true })).toHaveValue('2026')
    const next = readYear(data, 'zweit', 2026)
    expect(next).toMatchObject({ openingBalance: 14200, fiscalStartMonth: 11, bookings: [] })
    expect(next.categories).toEqual(readYear(data, 'zweit', 2025).categories)
    await page.getByLabel('Anfangssaldo (€)', { exact: true }).fill('999,99')
    await page.getByLabel('IBAN / Kontonummer', { exact: true }).focus()
    await expect.poll(() => readYear(data, 'zweit', 2026).openingBalance).toBe(99999)
    await page.getByLabel('Jahr wählen', { exact: true }).selectOption('2025')
    await page.getByRole('button', { name: /Jahresabschluss → 2026/ }).click()
    await expect(page.getByText(/Dieses Kassenjahr ist bereits vorhanden/)).toBeVisible()
    expect(readYear(data, 'zweit', 2026).openingBalance).toBe(99999)
    await expect(page.getByLabel('Jahr wählen', { exact: true })).toHaveValue('2025')
    await expect(page.locator('.org-global-error[role="alert"]')).toHaveCount(0)
  } finally { await close(app, root) }
})

test('bricht eine Kontoanlage ohne neue Datei ab und begrenzt Jahresabschlüsse ohne weitere Änderungen zu blockieren', async () => {
  const { root, data } = setup([fixture('haupt', 2100)])
  const { app, page } = await launch(root)
  try {
    await page.getByRole('button', { name: 'Konto anlegen', exact: true }).click()
    await page.getByLabel('Name des Kontos', { exact: true }).fill('Nicht speichern')
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click()
    expect(readdirSync(data).filter((name) => name.startsWith('kassenbuch') && name.endsWith('.json'))).toEqual(['kassenbuch-2100.json'])
    await accountSettings(page, 'haupt')
    await page.evaluate(() => { window.confirm = () => true })
    await page.getByRole('button', { name: /Jahresabschluss → 2101/ }).click()
    await expect(page.getByText(/Das Kassenjahr muss zwischen 2000 und 2100 liegen/)).toBeVisible()
    expect(existsSync(join(data, 'kassenbuch-2101.json'))).toBe(false)
    await page.getByLabel('Konto-Name', { exact: true }).fill('Weiterhin bearbeitbar')
    await expect.poll(() => readYear(data, 'haupt', 2100).kontoName).toBe('Weiterhin bearbeitbar')
    await expect(page.locator('.org-global-error[role="alert"]')).toHaveCount(0)
  } finally { await close(app, root) }
})

test('reserviert auch eine gelöschte alte Kontokennung ohne zusätzliche Einstellungen dauerhaft', async () => {
  const { root, data } = setup([fixture('haupt', 2026), fixture('zweit', 2026)])
  let { app, page } = await launch(root)
  try {
    await accountSettings(page, 'zweit')
    await removeYear(page, 2026)
    await expect(page.getByLabel('Konto wählen', { exact: true })).toHaveValue('haupt')
    expect(readSettings(data).kontoSequence).toBe(2)
    await app.close()
    ;({ app, page } = await launch(root))
    await createAccount(page, 'Anderes Konto')
    await expect(page.getByLabel('Konto wählen', { exact: true })).toHaveValue('k3')
    expect(existsSync(join(data, 'kassenbuch-k2-2027.json'))).toBe(false)
  } finally { await close(app, root) }
})

test('zeigt einen Fehler bei der Kontoanlage, behält die Eingaben und wiederholt ohne doppelte Konten', async () => {
  const { root, data } = setup([fixture('haupt', 2026)], { kontoSequence: 10 })
  const { app, page } = await launch(root)
  try {
    await app.evaluate(() => {
      const fs = (globalThis as typeof globalThis & { __readinessFs: typeof import('node:fs') }).__readinessFs
      const original = fs.writeFileSync
      let failed = false
      fs.writeFileSync = ((path: unknown, ...args: unknown[]) => {
        if (!failed && /kassenbuch-k11-2027\.json\.[^.]+\.tmp$/.test(String(path))) {
          failed = true
          throw new Error('Simulierter Fehler bei Kontoanlage')
        }
        return Reflect.apply(original, fs, [path, ...args])
      }) as typeof fs.writeFileSync
    })
    await createAccount(page, 'Wiederholbares Konto')
    await expect(page.getByRole('alert')).toContainText('Simulierter Fehler bei Kontoanlage')
    await expect(page.getByLabel('Name des Kontos', { exact: true })).toHaveValue('Wiederholbares Konto')
    expect(existsSync(join(data, 'kassenbuch-k11-2027.json'))).toBe(false)
    expect(readSettings(data).kontoSequence).toBe(10)
    await page.getByRole('button', { name: 'Konto anlegen', exact: true }).dblclick()
    await expect(page.getByLabel('Konto wählen', { exact: true })).toHaveValue('k11')
    expect(readdirSync(data).filter((name) => /^kassenbuch-k\d+-2027\.json$/.test(name))).toEqual(['kassenbuch-k11-2027.json'])
    expect(readSettings(data).kontoSequence).toBe(11)
  } finally { await close(app, root) }
})
