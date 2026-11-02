import { test, expect } from '@playwright/test'
import { _electron as electron, type Page } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Booking, YearFile } from '../../src/shared/types'

function fixture(konto = 'haupt', year = 2026, fiscalStartMonth = 1): YearFile {
  const booking = (id: string, patch: Partial<Booking> = {}): Booking => ({
    id, seq: 1, refNo: 1, categoryId: 'm', date: '2026-01-10', name: 'Test GmbH',
    description: id, amount: 10000, type: 'einnahme', isUmsatz: true,
    nonUmsatzAmount: 0, note: '', source: 'manuell', receiptStatus: 'vorhanden', receiptAvailable: true, ...patch,
  })
  return {
    schemaVersion: 1, konto, year, fiscalStartMonth, clubName: 'Testverein', treasurerName: 'Test', openingBalance: 0,
    categories: [
      { id: 'm', name: 'Maskenball', code: 'M', active: true, sortOrder: 1 },
      { id: 'b', name: 'Beiträge', code: 'B', active: false, sortOrder: 2 },
    ],
    refNoCounters: { m: 3, b: 2 },
    bookings: [
      booking('eintritt-januar'),
      booking('rechnung-januar', { seq: 2, refNo: 2, type: 'ausgabe', date: '2026-01-20', amount: 2000, nonUmsatzAmount: 500 }),
      booking('wechselgeld-februar', { seq: 3, refNo: 3, type: 'ausgabe', date: '2026-02-01', amount: 3000, isUmsatz: false }),
      booking('beitrag-februar', { seq: 4, categoryId: 'b', date: '2026-02-10', amount: 7000, nonUmsatzAmount: 7000 }),
      booking('kosten-februar', { seq: 5, refNo: 2, categoryId: 'b', type: 'ausgabe', date: '2026-02-12', amount: 4000, nonUmsatzAmount: 1000 }),
    ],
  }
}

async function launch() {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-'))
  const data = join(root, 'kassenwart', 'daten')
  mkdirSync(data, { recursive: true })
  const main = fixture()
  const second = fixture('zweit', 2025, 11)
  second.bookings = [
    { ...second.bookings[0], id: 'fiscal-november', description: 'fiscal-november', date: '2025-11-15' },
    { ...second.bookings[1], id: 'fiscal-januar', description: 'fiscal-januar', date: '2026-01-15' },
  ]
  writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify(main))
  const previous = fixture('haupt', 2025)
  previous.bookings = [{ ...previous.bookings[0], id: 'vorjahr', description: 'Vorjahr', date: '2025-12-15' }]
  writeFileSync(join(data, 'kassenbuch-2025.json'), JSON.stringify(previous))
  writeFileSync(join(data, 'kassenbuch-k2-2025.json'), JSON.stringify(second))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'hell' }))
  const app = await electron.launch({ args: [resolve('tests/e2e/bootstrap.cjs')], env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root } })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'kassenwart'))
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: /Übersicht/ })).toBeVisible()
    return { app, page, data, main }
  } catch (error) {
    await app.close()
    throw error
  }
}

const ids = (page: Page) => page.locator('[data-booking-id]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-booking-id')))
const overview = (page: Page) => page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: /^Übersicht/ }).click()

test('öffnet die Kennzahlen mit sichtbaren, änderbaren Filtern ohne Datenänderung', async ({}, testInfo) => {
  const { app, page, data, main } = await launch()
  try {
    await expect(page.getByRole('button', { name: 'Einnahmen: Buchungen anzeigen' })).toHaveAccessibleDescription(/170,00/)
    await expect(page.getByRole('button', { name: 'Ausgaben: Buchungen anzeigen' })).toHaveAccessibleDescription(/90,00/)
    await expect(page.getByRole('button', { name: 'Umsatz: Buchungen anzeigen' })).toHaveAccessibleDescription(/55,00/)
    await page.getByRole('button', { name: 'Einnahmen: Buchungen anzeigen' }).click()
    await expect(page.getByLabel('Buchungsart')).toHaveValue('einnahme')
    expect(await ids(page)).toEqual(['beitrag-februar', 'eintritt-januar'])
    await page.getByLabel('Alle sichtbaren Buchungen auswählen').check()
    await page.getByLabel('Buchungsart').selectOption('ausgabe')
    expect(await ids(page)).toEqual(['kosten-februar', 'wechselgeld-februar', 'rechnung-januar'])
    await expect(page.locator('[data-booking-id] input:checked')).toHaveCount(0)
    await page.getByLabel('Von', { exact: true }).fill('2026-02-01')
    await page.getByLabel('Bis', { exact: true }).fill('2026-02-28')
    expect(await ids(page)).toEqual(['kosten-februar', 'wechselgeld-februar'])
    await page.getByLabel('Buchungen durchsuchen').fill('kosten')
    await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click()
    await expect(page.getByLabel('Buchungen durchsuchen')).toHaveValue('')
    expect(await ids(page)).toHaveLength(5)

    await overview(page)
    await page.getByRole('button', { name: 'Ausgaben: Buchungen anzeigen' }).click()
    await expect(page.getByLabel('Buchungsart')).toHaveValue('ausgabe')
    expect(await ids(page)).toHaveLength(3)
    await overview(page)
    await page.getByRole('button', { name: 'Umsatz: Buchungen anzeigen' }).click()
    await expect(page.getByLabel('Nur Umsatzbuchungen')).toBeChecked()
    expect(await ids(page)).toEqual(['kosten-februar', 'rechnung-januar', 'eintritt-januar'])
    await page.screenshot({ path: testInfo.outputPath('gefilterte-buchungen.png'), fullPage: true })
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8'))).toEqual(main)
  } finally { await app.close() }
})

test('öffnet Kategorien und Kalenderjahresmonate auch im abweichenden Wirtschaftsjahr', async () => {
  const { app, page } = await launch()
  try {
    await page.getByRole('button', { name: 'Buchungen für Maskenball anzeigen', exact: true }).press('Enter')
    await expect(page.getByLabel('Kategorie', { exact: true })).toHaveValue('m')
    expect(await ids(page)).toEqual(['wechselgeld-februar', 'rechnung-januar', 'eintritt-januar'])
    await overview(page)
    await page.getByRole('button', { name: 'Buchungen für Beiträge anzeigen', exact: true }).click()
    await expect(page.getByLabel('Kategorie', { exact: true })).toHaveValue('b')
    expect(await ids(page)).toEqual(['kosten-februar', 'beitrag-februar'])
    await overview(page)
    await page.getByRole('button', { name: 'Buchungen für Januar 2026 anzeigen', exact: true }).click()
    await expect(page.getByLabel('Von', { exact: true })).toHaveValue('2026-01-01')
    await expect(page.getByLabel('Bis', { exact: true })).toHaveValue('2026-01-31')
    expect(await ids(page)).toEqual(['rechnung-januar', 'eintritt-januar'])
    await overview(page)
    await page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Buchungen für Februar 2026 anzeigen', exact: true }) })
      .getByRole('cell').nth(2).click()
    await expect(page.getByLabel('Von', { exact: true })).toHaveValue('2026-02-01')
    await expect(page.getByLabel('Bis', { exact: true })).toHaveValue('2026-02-28')
    expect(await ids(page)).toEqual(['kosten-februar', 'beitrag-februar', 'wechselgeld-februar'])
    await page.getByLabel('Jahr wählen').selectOption('2025')
    await expect(page.getByLabel('Von', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Bis', { exact: true })).toHaveValue('')
    expect(await ids(page)).toEqual(['vorjahr'])
    await page.getByLabel('Konto wählen').selectOption('zweit')
    await expect(page.getByLabel('Von', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Bis', { exact: true })).toHaveValue('')
    expect(await ids(page)).toHaveLength(2)
    await overview(page)
    await page.getByRole('button', { name: 'Buchungen für Januar 2026 anzeigen', exact: true }).click()
    await expect(page.getByLabel('Von', { exact: true })).toHaveValue('2026-01-01')
    await expect(page.getByLabel('Bis', { exact: true })).toHaveValue('2026-01-31')
    expect(await ids(page)).toEqual(['fiscal-januar'])
  } finally { await app.close() }
})

test('zeigt globale Suchtreffer trotz zuvor gesetzter Filter und über Kontogrenzen', async () => {
  const { app, page } = await launch()
  try {
    await page.getByRole('button', { name: 'Einnahmen: Buchungen anzeigen' }).click()
    await page.keyboard.press('Control+f')
    await page.getByRole('dialog').getByRole('textbox').fill('fiscal-januar')
    await page.getByRole('dialog').getByRole('button', { name: /fiscal-januar/ }).click()
    await expect(page.getByLabel('Konto wählen')).toHaveValue('zweit')
    await expect(page.getByRole('heading', { name: 'Buchung bearbeiten' })).toBeVisible()
    await expect(page.getByLabel('Buchungsart')).toHaveValue('')
    await expect(page.getByLabel('Von', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Bis', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Verwendungszweck', { exact: true })).toHaveValue('fiscal-januar')
    await expect(page.locator('[data-booking-id="fiscal-januar"]')).toBeVisible()
  } finally { await app.close() }
})


test('filtert mit Kalendergrenzen einschließlich beider Tage und behandelt umgekehrte Zeiträume', async ({}, testInfo) => {
  const { app, page, data, main } = await launch()
  try {
    await page.getByRole('button', { name: 'Buchungen für Januar 2026 anzeigen', exact: true }).click()
    await expect(page.getByLabel('Von', { exact: true })).toHaveAttribute('type', 'date')
    await expect(page.getByLabel('Bis', { exact: true })).toHaveAttribute('type', 'date')
    await page.getByLabel('Von', { exact: true }).fill('2026-01-20')
    await page.getByLabel('Bis', { exact: true }).fill('2026-02-01')
    expect(await ids(page)).toEqual(['wechselgeld-februar', 'rechnung-januar'])
    await page.getByLabel('Von', { exact: true }).fill('2026-02-01')
    expect(await ids(page)).toEqual(['wechselgeld-februar'])
    await page.getByLabel('Bis', { exact: true }).fill('2026-01-31')
    await expect(page.locator('#booking-date-error')).toBeVisible()
    expect(await ids(page)).toEqual([])
    await expect(page.getByRole('button', { name: '0 Treffer auswählen', exact: true })).toBeDisabled()
    await page.getByLabel('Bis', { exact: true }).fill('')
    expect(await ids(page)).toHaveLength(3)
    await page.getByLabel('Von', { exact: true }).fill('')
    expect(await ids(page)).toHaveLength(5)
    await page.screenshot({ path: testInfo.outputPath('kompakte-buchungen.png'), fullPage: true })
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8'))).toEqual(main)
  } finally { await app.close() }
})
