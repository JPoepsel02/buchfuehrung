import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Booking, YearFile } from '../../src/shared/types'

function fixture(konto = 'haupt', year = 2026): YearFile {
  const booking: Booking = {
    id: `${konto}-${year}`, seq: 1, refNo: 1, categoryId: 'b', date: `${year}-02-12`,
    name: 'Testperson', description: konto === 'haupt' ? 'Testbeitrag' : 'Historischer Testbeitrag',
    amount: 4200, type: 'einnahme', isUmsatz: true, nonUmsatzAmount: 0,
    note: '', source: 'manuell', receiptStatus: 'vorhanden', receiptAvailable: true,
  }
  return {
    schemaVersion: 1, konto, year, openingBalance: 10000,
    clubName: 'Design-Testverein', treasurerName: 'Testperson',
    categories: [{ id: 'b', name: 'Testbeiträge', code: 'B', active: true, sortOrder: 1 }],
    refNoCounters: { b: 1 }, bookings: [booking],
  }
}

async function launch() {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-redesign-'))
  const data = join(root, 'kassenwart', 'daten')
  mkdirSync(data, { recursive: true })
  const main = fixture()
  const second = fixture('zweit', 2025)
  writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify(main))
  writeFileSync(join(data, 'kassenbuch-k2-2025.json'), JSON.stringify(second))
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'hell' }))
  const app = await electron.launch({
    args: [resolve('tests/e2e/bootstrap.cjs')],
    env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root },
  })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'kassenwart'))
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: /Übersicht/ })).toBeVisible()
    return { app, page, data, main, second }
  } catch (error) {
    await app.close()
    throw error
  }
}

test('ergänzt die Jahresgrafik und bewahrt die zugänglichen Monats- und Kategorienwerte', async () => {
  const { app, page, data, main } = await launch()
  try {
    await expect(page.getByRole('heading', { name: 'Einnahmen & Ausgaben', exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Einnahmen und Ausgaben im Kassenjahr', exact: true })).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
    await expect(nav.getByRole('button', { name: 'Übersicht', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Buchungen für Februar 2026 anzeigen', exact: true }) })).toContainText('42,00')
    await expect(page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Buchungen für Testbeiträge anzeigen', exact: true }) })).toContainText('42,00')
    await nav.getByRole('button', { name: 'Chronologisch', exact: true }).click()
    await expect(nav.getByRole('button', { name: 'Chronologisch', exact: true })).toHaveAttribute('aria-current', 'page')
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8'))).toEqual(main)
  } finally { await app.close() }
})

test('gibt der Übersicht mehr Platz und stellt die Seitenleiste samt Auswahl wieder her', async () => {
  const { app, page } = await launch()
  try {
    const hide = page.getByRole('button', { name: 'Seitenleiste ausblenden', exact: true })
    await expect(hide).toHaveAttribute('aria-expanded', 'true')
    await hide.click()
    await expect(page.locator('#app-sidebar')).toBeHidden()
    await expect(page.getByRole('heading', { level: 1, name: /Übersicht/ })).toBeVisible()
    const show = page.getByRole('button', { name: 'Seitenleiste einblenden', exact: true })
    await expect(show).toHaveAttribute('aria-expanded', 'false')
    await show.click()
    await expect(page.locator('#app-sidebar')).toBeVisible()
    await expect(page.getByLabel('Konto wählen')).toHaveValue('haupt')
    await expect(page.getByLabel('Jahr wählen')).toHaveValue('2026')
  } finally { await app.close() }
})

test('macht die globale Suche sichtbar und führt über Konten und Jahre ohne Datenänderung', async () => {
  const { app, page, data, main, second } = await launch()
  try {
    const search = page.getByRole('button', { name: 'Buchungen suchen', exact: true })
    await search.click()
    const dialog = page.getByRole('dialog', { name: 'Buchungen durchsuchen', exact: true })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog.getByRole('textbox')).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Suche schließen', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(search).toBeFocused()
    await search.click()
    await dialog.getByRole('button', { name: 'Suche schließen', exact: true }).click()
    await expect(search).toBeFocused()
    await search.click()
    await dialog.getByRole('textbox').fill('Historischer Testbeitrag')
    await dialog.getByRole('button', { name: /Historischer Testbeitrag/ }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel('Konto wählen')).toHaveValue('zweit')
    await expect(page.getByLabel('Jahr wählen')).toHaveValue('2025')
    await expect(page.getByRole('heading', { name: 'Buchung bearbeiten', exact: true })).toBeVisible()
    await expect(page.getByLabel('Verwendungszweck', { exact: true })).toHaveValue('Historischer Testbeitrag')
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-2026.json'), 'utf8'))).toEqual(main)
    expect(JSON.parse(readFileSync(join(data, 'kassenbuch-k2-2025.json'), 'utf8'))).toEqual(second)
  } finally { await app.close() }
})
