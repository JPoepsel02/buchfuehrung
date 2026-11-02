import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { rowHash } from '../../src/shared/csv'
import type { Booking, ImportDraftRow, YearFile } from '../../src/shared/types'

function draftRow(text: string, date: string, amount: number): ImportDraftRow {
  return {
    date, amount, bankText: text, hash: rowHash(date, amount, text), legacyHashes: [],
    name: 'Test GmbH', description: '', selected: true, categoryId: '',
    isUmsatz: false, receiptStatus: 'offen', receiptAvailable: false,
  }
}

function fixture(konto = 'haupt', refNo = 7): YearFile {
  const existing = draftRow('Bereits erfasst', '2026-01-01', -500)
  const booking: Booking = {
    id: 'bestehend', seq: 1, refNo, categoryId: 'm', date: existing.date,
    description: 'Bestehende Rechnung', name: 'Test GmbH', amount: 500, type: 'ausgabe',
    isUmsatz: false, nonUmsatzAmount: 0, note: existing.bankText, source: 'import',
    importHash: existing.hash, importHashVersion: 3, receiptStatus: 'vorhanden', receiptAvailable: true,
  }
  return {
    schemaVersion: 1, year: 2026, konto, clubName: 'Testverein', treasurerName: 'Test', openingBalance: 0,
    categories: [
      { id: 'm', name: 'Maskenball', code: 'M', active: true, sortOrder: 1 },
      { id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 2 },
    ],
    bookings: [booking],
    importDraft: { fileName: 'Testauszug.csv', skipped: 0, rows: [
      existing, draftRow('Erster neuer Umsatz', '2026-06-01', -1000),
      draftRow('Zweiter neuer Umsatz', '2026-06-02', -1200),
    ] },
  }
}

function setup(main = fixture(), bank = false) {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-'))
  const data = join(root, 'kassenwart', 'daten')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify(main))
  writeFileSync(join(data, 'kassenbuch-k2-2026.json'), JSON.stringify(fixture('zweit', 30)))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'hell',
    ...(bank ? { bankAccounts: [{ id: 'testbank', konto: 'haupt', label: 'Testbank',
      blz: '12345678', userId: 'Test', accountNumber: '123', fintsUrl: 'https://example.invalid' }] } : {}),
  }))
  return { root, data }
}

async function launch(root: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [resolve('tests/e2e/bootstrap.cjs')],
    env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root },
  })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'kassenwart'))
    const page = await app.firstWindow()
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: /Umsätze importieren/ }).click()
    await expect(page.getByRole('heading', { name: 'Umsätze importieren' })).toBeVisible()
    return { app, page }
  } catch (error) {
    await app.close()
    throw error
  }
}

const readYear = (data: string) => JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8')) as YearFile
const rows = (page: Page) => page.locator('tbody > tr').filter({ has: page.getByLabel('Umsatz importieren', { exact: true }) })

test('startet ohne Auswahl und übernimmt exakt die zuvor angezeigten Nummern', async ({}, testInfo) => {
  const { root, data } = setup()
  const originalBooking = fixture().bookings[0]
  const { app, page } = await launch(root)
  try {
    await expect(page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(rows(page)).toHaveCount(2)
    await expect(page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)

    const first = rows(page).nth(0)
    const second = rows(page).nth(1)
    await first.getByLabel('Umsatz importieren', { exact: true }).check()
    await first.getByLabel('Kategorie', { exact: true }).selectOption('m')
    await first.getByLabel('Belegstatus').selectOption('vorhanden')
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8')
    await first.getByLabel('Eigener Verwendungszweck').fill('Erste Rechnung')

    await second.getByLabel('Umsatz importieren', { exact: true }).check()
    await second.getByLabel('Kategorie', { exact: true }).selectOption('m')
    await second.getByLabel('Belegstatus').selectOption('vorhanden')
    await expect(second.getByRole('status')).toHaveText('Beleg-Nr. M9')
    await second.getByLabel('Eigener Verwendungszweck').fill('Zweite Rechnung')
    await first.getByLabel('Umsatz importieren', { exact: true }).uncheck()
    await second.getByRole('status').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('feste-belegnummern.png'), fullPage: true })
    await page.getByRole('button', { name: '1 Buchungen übernehmen', exact: true }).click()

    await expect.poll(() => readYear(data).bookings.length).toBe(2)
    expect(readYear(data).bookings[0]).toEqual(originalBooking)
    expect(readYear(data).bookings[1].refNo).toBe(9)
    await expect(rows(page).first().getByRole('status')).toHaveText('Beleg-Nr. M8')

    await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
    await page.getByRole('button', { name: /^Übersicht/ }).click()
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: /Umsätze importieren/ }).click()
    await expect(page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)
    await expect(rows(page).first().getByRole('status')).toHaveText('Beleg-Nr. M8')
    await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
    await page.getByRole('button', { name: '1 Buchungen übernehmen', exact: true }).click()
    await expect.poll(() => readYear(data).bookings.length).toBe(3)
    expect(readYear(data).bookings.map((b) => b.refNo)).toEqual([7, 9, 8])
    expect(readYear(data).bookings[0]).toEqual(originalBooking)

    await expect(page.getByRole('button', { name: /CSV-Kontoauszug/ })).toBeVisible()
    await page.getByLabel('Konto wählen').selectOption('zweit')
    await expect(page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)
    await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
    await rows(page).first().getByLabel('Kategorie', { exact: true }).selectOption('m')
    await rows(page).first().getByLabel('Belegstatus').selectOption('vorhanden')
    await expect(rows(page).first().getByRole('status')).toHaveText('Beleg-Nr. M31')
    await expect.poll(() => JSON.parse(readFileSync(join(data, 'kassenbuch-k2-2026.json'), 'utf8')).refNoCounters.m).toBe(31)
  } finally {
    await app.close()
  }

  const restarted = await launch(root)
  try {
    await restarted.page.getByLabel('Konto wählen').selectOption('zweit')
    await expect(restarted.page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(restarted.page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)
    await expect(rows(restarted.page).first().getByRole('status')).toHaveText('Beleg-Nr. M31')
  } finally {
    await restarted.app.close()
  }
})

test('zeigt bei Aufteilungen jede endgültige Belegnummer sofort an', async () => {
  const { root, data } = setup()
  const { app, page } = await launch(root)
  try {
    const first = rows(page).first()
    await first.getByLabel('Umsatz importieren', { exact: true }).check()
    await first.getByLabel('Kategorie', { exact: true }).selectOption('m')
    await first.getByLabel('Eigener Verwendungszweck').fill('Geteilte Rechnung')
    await first.getByLabel('Belegstatus').selectOption('vorhanden')
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8')
    await first.getByRole('button', { name: 'Aufteilen', exact: true }).click()
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8 · M9')
    await page.getByLabel('Split-Verwendungszweck').nth(1).fill('Zweiter Teil')
    await page.getByLabel('Split-Kategorie').nth(1).selectOption('b')
    await expect(first.getByRole('status')).toHaveText('Beleg-Nr. M8 · B1')
    await page.getByRole('button', { name: '2 Buchungen übernehmen', exact: true }).click()
    await expect.poll(() => readYear(data).bookings.length).toBe(3)
    expect(readYear(data).bookings.map((b) => [b.categoryId, b.refNo])).toEqual([['m', 7], ['m', 8], ['b', 1]])
  } finally {
    await app.close()
  }
})

test('zählt in Übersicht, Seitenleiste und Importliste ausschließlich neue Umsätze', async () => {
  const main = fixture()
  const soft = draftRow('Manuell bereits erfasst', '2026-05-01', -700)
  main.bookings = [...main.bookings, { ...main.bookings[0], id: 'manuell', source: 'manuell',
    importHash: undefined, refNo: 6, date: soft.date, amount: 700 }]
  main.importDraft!.rows = [main.importDraft!.rows[0], soft, main.importDraft!.rows[1],
    { ...main.importDraft!.rows[1] }, main.importDraft!.rows[2]]
  const { root, data } = setup(main)
  const { app, page } = await launch(root)
  try {
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
    await expect(nav.getByRole('button', { name: /Umsätze importieren/ }).getByText('2', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Testauszug.csv · 2 neue Umsätze/ })).toBeVisible()
    await expect(rows(page)).toHaveCount(2)
    await expect(page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(page.getByText('Bereits erfasst', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Manuell bereits erfasst', { exact: true })).toHaveCount(0)
    await nav.getByRole('button', { name: /^Übersicht/ }).click()
    await expect(page.getByRole('button', { name: /Import weiterführen/ })).toContainText('2 Umsätze warten auf Zuweisung')
    await page.getByRole('button', { name: /Import weiterführen/ }).click()
    await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
    await rows(page).first().getByLabel('Eigener Verwendungszweck').fill('Nur die neue Zeile')
    await expect.poll(() => readYear(data).importDraft!.rows[2].description).toBe('Nur die neue Zeile')
    expect(readYear(data).importDraft!.rows[0].description).toBe(main.importDraft!.rows[0].description)
    expect(readYear(data).bookings).toEqual(main.bookings)
  } finally {
    await app.close()
  }
})

test('zeigt nach Bankabrufen nur neue Umsätze und lässt einen erledigten Entwurf erneut abrufen', async () => {
  const main = fixture()
  main.importDraft!.rows = [main.importDraft!.rows[0]]
  const { root } = setup(main, true)
  const { app, page } = await launch(root)
  try {
    const fetched = (r: ImportDraftRow) => ({ date: r.date, amount: r.amount, name: r.name, description: r.bankText })
    const old = fetched(main.importDraft!.rows[0])
    const first = fetched(draftRow('Neuer Bankumsatz A', '2026-06-01', -1000))
    const second = fetched(draftRow('Neuer Bankumsatz B', '2026-06-02', -1200))
    await app.evaluate(({ ipcMain }, responses) => {
      let index = 0
      ipcMain.removeHandler('bank:fetch')
      ipcMain.handle('bank:fetch', () => ({ status: 'ok', rows: responses[Math.min(index++, responses.length - 1)] }))
    }, [[old], [old, first, { ...first }, second]])
    const dialogs: string[] = []
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss() })
    await expect(page.getByRole('button', { name: /CSV-Kontoauszug/ })).toBeVisible()
    await page.getByRole('button', { name: /^Online-Banking/ }).click()
    await page.getByRole('button', { name: 'Umsätze abrufen', exact: true }).click()
    await expect(page.getByText('Keine neuen Umsätze vorhanden.', { exact: true })).toBeVisible()
    expect(dialogs).toEqual([])
    await page.getByRole('button', { name: 'Umsätze abrufen', exact: true }).click()
    await expect(rows(page)).toHaveCount(2)
    await expect(page.getByRole('heading', { name: /2 neue Umsätze/ })).toBeVisible()
    await expect(page.getByText('2 neue Umsätze abgerufen – unten zuweisen und übernehmen.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Nur neue anzeigen')).toHaveCount(0)
    await expect(page.getByText('Bereits erfasst', { exact: true })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
