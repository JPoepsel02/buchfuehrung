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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-'))
  const data = join(root, 'kassenwart', 'daten')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify(fixture()))
  writeFileSync(join(data, 'kassenbuch-k2-2026.json'), JSON.stringify(fixture('zweit', 30)))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'hell' }))
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
    await page.getByRole('button', { name: /Umsätze importieren/ }).click()
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
    await expect(page.getByLabel('Nur neue anzeigen')).toBeChecked()
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
    await page.getByRole('button', { name: /Umsätze importieren/ }).click()
    await expect(page.locator('input[aria-label="Umsatz importieren"]:checked')).toHaveCount(0)
    await expect(rows(page).first().getByRole('status')).toHaveText('Beleg-Nr. M8')
    await rows(page).first().getByLabel('Umsatz importieren', { exact: true }).check()
    await page.getByRole('button', { name: '1 Buchungen übernehmen', exact: true }).click()
    await expect.poll(() => readYear(data).bookings.length).toBe(3)
    expect(readYear(data).bookings.map((b) => b.refNo)).toEqual([7, 9, 8])
    expect(readYear(data).bookings[0]).toEqual(originalBooking)

    await page.getByLabel('Nur neue anzeigen').uncheck()
    await page.getByLabel('Konto wählen').selectOption('zweit')
    await expect(page.getByLabel('Nur neue anzeigen')).toBeChecked()
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
    await expect(restarted.page.getByLabel('Nur neue anzeigen')).toBeChecked()
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
