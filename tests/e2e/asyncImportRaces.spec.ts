import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { YearFile } from '../../src/shared/types'

function fixture(konto: string, year: number): YearFile {
  return { schemaVersion: 1, konto, kontoName: konto === 'haupt' ? 'Hauptkonto' : 'Nebenkonto', year,
    clubName: 'Importtestverein', treasurerName: 'Testperson', openingBalance: 0, bookings: [],
    categories: [{ id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 1 }] }
}

async function launch() {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-import-races-'))
  const data = join(root, 'kassenwart', 'daten')
  mkdirSync(data, { recursive: true })
  for (const konto of ['haupt', 'zweit']) for (const year of [2025, 2026]) {
    const name = `kassenbuch${konto === 'zweit' ? '-k2' : ''}-${year}.json`
    writeFileSync(join(data, name), JSON.stringify(fixture(konto, year)))
  }
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'hell', bankAccounts: ['haupt', 'zweit'].map((konto) => ({
    id: `test-${konto}`, konto, label: `Testbank ${konto}`, blz: '12345678', fintsUrl: 'https://example.invalid/fints',
    userId: 'Testperson', accountNumber: '123',
  })) }))
  const app = await electron.launch({ args: [resolve('tests/e2e/bootstrap.cjs')], env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Vereinsübersicht', exact: true })).toBeVisible()
    return { app, page, data, async close() { try { await app.close() } finally { rmSync(root, { recursive: true, force: true }) } } }
  } catch (failure) { await app.close(); rmSync(root, { recursive: true, force: true }); throw failure }
}

async function openImport(page: Page, konto = 'haupt') {
  await page.getByLabel('Konto wählen', { exact: true }).selectOption(konto)
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: /Umsätze importieren/ }).click()
  await expect(page.getByRole('heading', { name: 'Umsätze importieren', exact: true })).toBeVisible()
}

async function defer(app: ElectronApplication, source: 'csv' | 'bank', tan = false) {
  await app.evaluate(({ ipcMain }, options) => {
    const pending: Array<(value: unknown) => void> = []
    const cancelled: string[] = []
    const runtime = globalThis as typeof globalThis & {
      __asyncImport: { pending: typeof pending; cancelled: string[]; release(index: number, text: string): void }
    }
    runtime.__asyncImport = { pending, cancelled, release(index, text) {
      const result = options.source === 'csv'
        ? { name: `${text}.csv`, content: `Buchungstag;Name;Verwendungszweck;Betrag\n01.06.2026;Testmitglied;${text};12,00\n` }
        : options.tan ? { status: 'tan', sessionId: '11111111-1111-4111-8111-111111111111', challenge: 'Testfreigabe', decoupled: false }
          : { status: 'ok', rows: [{ date: '2026-06-01', name: 'Testmitglied', description: text, amount: 1200 }] }
      pending[index](result)
    } }
    const channel = options.source === 'csv' ? 'csv:open' : 'bank:fetch'
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => new Promise((resolveResponse) => pending.push(resolveResponse)))
    ipcMain.removeHandler('bank:cancel')
    ipcMain.handle('bank:cancel', (_event, sessionId) => { cancelled.push(sessionId) })
  }, { source, tan })
}

async function pending(app: ElectronApplication, count: number) {
  await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { __asyncImport: { pending: unknown[] } }).__asyncImport.pending.length)).toBe(count)
}
async function release(app: ElectronApplication, index: number, text: string) {
  await app.evaluate((_electron, response) => (globalThis as typeof globalThis & {
    __asyncImport: { release(index: number, text: string): void }
  }).__asyncImport.release(response.index, response.text), { index, text })
}
const read = (data: string, konto = 'haupt', year = 2026) => JSON.parse(readFileSync(join(data, `kassenbuch${konto === 'zweit' ? '-k2' : ''}-${year}.json`), 'utf8')) as YearFile

for (const source of ['csv', 'bank'] as const) test(`${source}: verspätete Antwort bleibt bei ursprünglichem Konto und Kassenjahr`, async () => {
  const { app, page, data, close } = await launch()
  try {
    await defer(app, source)
    await openImport(page)
    if (source === 'csv') await page.getByRole('button', { name: /CSV-Kontoauszug/ }).click()
    else {
      await page.getByRole('button', { name: /^Online-Banking/ }).click()
      await page.getByRole('button', { name: 'Umsätze abrufen', exact: true }).click()
    }
    await pending(app, 1)
    await page.getByLabel('Konto wählen', { exact: true }).selectOption('zweit')
    await page.getByLabel('Jahr wählen', { exact: true }).selectOption('2025')
    await release(app, 0, 'Verspäteter Zielumsatz')
    await expect.poll(() => read(data).importDraft?.rows[0]?.bankText).toBe('Verspäteter Zielumsatz')
    expect(read(data, 'zweit', 2025).importDraft).toBeUndefined()
    expect(read(data, 'zweit', 2026).importDraft).toBeUndefined()
    expect(read(data, 'haupt', 2025).importDraft).toBeUndefined()
    await openImport(page)
    await expect(page.getByText('Verspäteter Zielumsatz', { exact: true })).toBeVisible()
  } finally { await close() }
})

test('CSV-Antworten in umgekehrter Reihenfolge erhalten zwischenzeitliche Kategorie- und Bereichszuordnungen', async () => {
  const { app, page, data, close } = await launch()
  try {
    await defer(app, 'csv')
    await openImport(page)
    await page.getByRole('button', { name: /CSV-Kontoauszug/ }).click()
    await pending(app, 1)
    await page.getByRole('button', { name: /CSV-Kontoauszug/ }).click()
    await pending(app, 2)
    await release(app, 1, 'Zuerst angekommen')
    const assigned = page.locator('tbody > tr').filter({ hasText: 'Zuerst angekommen' })
    await assigned.getByLabel('Umsatz importieren', { exact: true }).check()
    await assigned.getByLabel('Eigener Verwendungszweck', { exact: true }).fill('Bereits zugeordnet')
    await assigned.getByLabel('Kategorie', { exact: true }).selectOption('b')
    await assigned.getByLabel('Tätigkeitsbereich', { exact: true }).selectOption('I')
    await expect.poll(() => read(data).importDraft?.rows[0].allocations).toEqual([{ area: 'I', amount: 1200 }])
    await release(app, 0, 'Ältere Anfrage')
    await expect.poll(() => read(data).importDraft?.rows.length).toBe(2)
    expect(read(data).importDraft?.rows[0]).toMatchObject({ bankText: 'Zuerst angekommen', description: 'Bereits zugeordnet', categoryId: 'b', allocations: [{ area: 'I', amount: 1200 }] })
    await expect(page.getByText('Ältere Anfrage', { exact: true })).toBeVisible()
  } finally { await close() }
})

test('bricht eine erst nach Verlassen der Bankansicht eintreffende TAN-Sitzung ab', async () => {
  const { app, page, data, close } = await launch()
  try {
    await defer(app, 'bank', true)
    await openImport(page)
    await page.getByRole('button', { name: /^Online-Banking/ }).click()
    await page.getByRole('button', { name: 'Umsätze abrufen', exact: true }).click()
    await pending(app, 1)
    await page.getByRole('navigation', { name: 'Verein', exact: true }).getByRole('button', { name: 'Vereinsübersicht', exact: true }).click()
    await release(app, 0, 'TAN')
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & {
      __asyncImport: { cancelled: string[] }
    }).__asyncImport.cancelled)).toEqual(['11111111-1111-4111-8111-111111111111'])
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(read(data).importDraft).toBeUndefined()
  } finally { await close() }
})

test('bricht eine bereits geöffnete TAN-Sitzung beim Öffnen der Einstellungen ab', async () => {
  const { app, page, close } = await launch()
  try {
    await defer(app, 'bank', true)
    await openImport(page)
    await page.getByRole('button', { name: /^Online-Banking/ }).click()
    await page.getByRole('button', { name: 'Umsätze abrufen', exact: true }).click()
    await pending(app, 1)
    await release(app, 0, 'TAN')
    await expect(page.getByRole('dialog')).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('view:settings'))
    await expect(page.getByRole('heading', { name: 'Gemeinsame Einstellungen', exact: true })).toBeVisible()
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & {
      __asyncImport: { cancelled: string[] }
    }).__asyncImport.cancelled)).toEqual(['11111111-1111-4111-8111-111111111111'])
  } finally { await close() }
})
