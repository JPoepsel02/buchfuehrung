import { test, expect } from '@playwright/test'
import { _electron as electron, type Page } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Booking, YearFile } from '../../src/shared/types'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-'))
  const data = join(root, 'kassenwart', 'daten')
  mkdirSync(data, { recursive: true })
  const booking = (id: string, patch: Partial<Booking> = {}): Booking => ({
    id, seq: 1, refNo: 1, date: '2026-01-10', categoryId: 'b', name: 'Test GmbH',
    description: id, type: 'einnahme', amount: 5000, isUmsatz: true,
    nonUmsatzAmount: 0, note: '', source: 'manuell', receiptStatus: 'vorhanden', receiptAvailable: true, ...patch,
  })
  const main: YearFile = {
    schemaVersion: 1, konto: 'haupt', year: 2026, openingBalance: 10000,
    clubName: 'Testverein', treasurerName: 'Test', refNoCounters: { m: 2, b: 2 },
    categories: [
      { id: 'm', name: 'Maskenball', code: 'M', active: true, sortOrder: 1 },
      { id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 2 },
    ],
    bookings: [booking('vorher'),
      booking('ausgabe-januar', { seq: 2, categoryId: 'm', type: 'ausgabe', date: '2026-01-15', amount: 2000 }),
      booking('einnahme-februar', { seq: 3, categoryId: 'm', refNo: 2, date: '2026-02-01', amount: 3000 }),
      booking('ausgabe-februar', { seq: 4, refNo: 2, type: 'ausgabe', date: '2026-02-02', amount: 1000 }),
    ],
  }
  const second = { ...main, konto: 'zweit', bookings: [booking('andere-rechnung', { description: 'Andere Rechnung', type: 'ausgabe' })] }
  writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify(main))
  writeFileSync(join(data, 'kassenbuch-k2-2026.json'), JSON.stringify(second))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'hell' }))
  return { root, data, main }
}

async function launch(root: string) {
  const app = await electron.launch({ args: [resolve('tests/e2e/bootstrap.cjs')], env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root } })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'kassenwart'))
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: /Übersicht/ })).toBeVisible()
    return { app, page }
  } catch (error) { await app.close(); throw error }
}
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name, exact: true }).click()
const ids = (page: Page) => page.locator('[data-booking-id]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-booking-id')))
const readSettings = (data: string) => JSON.parse(readFileSync(join(data, 'einstellungen.json'), 'utf8'))

test('zeigt eine ruhige chronologische Leseansicht und bewahrt Filter sowie ungespeicherte Eingaben', async ({}, testInfo) => {
  const { root, data, main } = setup()
  const { app, page } = await launch(root)
  try {
    await nav(page, 'Buchungen')
    await page.getByLabel('Name', { exact: true }).fill('Ungespeicherter Name')
    await page.getByLabel('Verwendungszweck', { exact: true }).fill('Entwurf behalten')
    await page.getByLabel('Kategorie', { exact: true }).selectOption('m')
    await page.getByLabel('Alle sichtbaren Buchungen auswählen').check()
    await page.getByRole('button', { name: 'Clean Mode', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Clean Mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: 'Neue Buchung erfassen' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Löschen', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Alle sichtbaren Buchungen auswählen')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Treffer auswählen/ })).toHaveCount(0)
    expect(await ids(page)).toEqual(['ausgabe-januar', 'einnahme-februar'])
    await page.locator('[data-booking-id="ausgabe-januar"]').click()
    await expect(page.getByRole('heading', { name: 'Buchung bearbeiten' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Filter anzeigen', exact: true }).click()
    await expect(page.getByLabel('Kategorie', { exact: true })).toHaveValue('m')
    await expect(page.getByLabel('Nur Umsatzbuchungen')).toBeVisible()
    await page.getByLabel('Monat', { exact: true }).selectOption('2026-02')
    expect(await ids(page)).toEqual(['einnahme-februar'])
    await expect(page.locator('[data-booking-id="einnahme-februar"]').getByRole('cell').last()).toContainText('160,00')
    await expect(page.getByText('Der Kassenstand berücksichtigt auch ausgeblendete Buchungen.', { exact: true })).toBeVisible()
    const csv = join(root, 'clean.csv')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, csv)
    await page.getByRole('button', { name: 'CSV exportieren …', exact: true }).click()
    await expect.poll(() => existsSync(csv)).toBe(true)
    expect(readFileSync(csv, 'utf8')).toContain('einnahme-februar')
    expect(readFileSync(csv, 'utf8')).not.toContain('ausgabe-januar')
    await page.getByRole('button', { name: 'Filter ausblenden', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('clean-mode.png'), fullPage: true })
    await page.getByRole('button', { name: 'Clean Mode', exact: true }).click()
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Ungespeicherter Name')
    await expect(page.getByLabel('Verwendungszweck', { exact: true })).toHaveValue('Entwurf behalten')
    await expect(page.locator('[data-booking-id] input:checked')).toHaveCount(0)
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8'))).toEqual(main)
  } finally { await app.close() }
})

test('merkt die Moduswahl, öffnet explizite Bearbeitung vorübergehend und bewahrt die Chronologisch-Ansicht', async () => {
  const { root, data } = setup()
  const first = await launch(root)
  try {
    await nav(first.page, 'Buchungen')
    await first.page.getByRole('button', { name: 'Clean Mode', exact: true }).click()
    await expect.poll(() => readSettings(data).bookingsCleanMode).toBe(true)
    await nav(first.page, 'Chronologisch')
    expect(await ids(first.page)).toEqual(['vorher', 'ausgabe-januar', 'einnahme-februar', 'ausgabe-februar'])
    await expect(first.page.getByRole('row', { name: /Abschlusssaldo 31.12.2026/ })).toContainText('150,00')
    await nav(first.page, 'Buchungen')
    await expect(first.page.getByRole('button', { name: 'Clean Mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await first.page.getByLabel('Konto wählen').selectOption('zweit')
    await expect(first.page.getByRole('button', { name: 'Clean Mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await first.page.keyboard.press('Control+f')
    await first.page.getByRole('dialog').getByRole('textbox').fill('Andere Rechnung')
    await first.page.getByRole('dialog').getByRole('button', { name: /Andere Rechnung/ }).click()
    await expect(first.page.getByRole('heading', { name: 'Buchung bearbeiten' })).toBeVisible()
    await expect(first.page.getByRole('button', { name: 'Clean Mode', exact: true })).toHaveAttribute('aria-pressed', 'false')
    expect(readSettings(data).bookingsCleanMode).toBe(true)
    await nav(first.page, 'Übersicht')
    await first.page.getByRole('button', { name: /Neue Buchung/ }).click()
    await expect(first.page.getByRole('heading', { name: 'Neue Buchung erfassen' })).toBeVisible()
    await expect(first.page.getByRole('button', { name: 'Clean Mode', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await nav(first.page, 'Übersicht')
    await first.page.getByRole('button', { name: 'Ausgaben: Buchungen anzeigen' }).click()
    await expect(first.page.getByRole('button', { name: 'Clean Mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(first.page.getByRole('heading', { name: 'Neue Buchung erfassen' })).toHaveCount(0)
  } finally { await first.app.close() }
  const restarted = await launch(root)
  try {
    await nav(restarted.page, 'Buchungen')
    await expect(restarted.page.getByRole('button', { name: 'Clean Mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(restarted.page.getByRole('heading', { name: 'Neue Buchung erfassen' })).toHaveCount(0)
  } finally { await restarted.app.close() }
})
