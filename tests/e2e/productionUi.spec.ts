import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Booking, YearFile } from '../../src/shared/types'

async function launch() {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-production-ui-'))
  const data = join(root, 'kassenwart', 'daten')
  mkdirSync(data, { recursive: true })
  const booking: Booking = {
    id: 'beitrag-maerz', seq: 1, refNo: 1, categoryId: 'b', date: '2026-03-12',
    name: 'Mitglied Muster', description: 'Mitgliedsbeitrag März', amount: 4200,
    type: 'einnahme', isUmsatz: true, nonUmsatzAmount: 0, note: '', source: 'manuell',
    receiptStatus: 'vorhanden', receiptAvailable: true,
  }
  const year: YearFile = {
    schemaVersion: 1, konto: 'haupt', year: 2026, openingBalance: 10000,
    clubName: 'Vereinsrunde Musterstadt', treasurerName: 'Kassenperson Muster',
    categories: [{ id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 1 }],
    refNoCounters: { b: 2 },
    bookings: [booking, { ...booking, id: 'beitrag-april', seq: 2, refNo: 2,
      date: '2026-04-15', description: 'Mitgliedsbeitrag April', amount: 5300 }],
  }
  const fixtures = {
    'kassenbuch-2026.json': JSON.stringify(year),
    'einstellungen.json': JSON.stringify({ theme: 'hell' }),
  }
  for (const [name, content] of Object.entries(fixtures)) writeFileSync(join(data, name), content)
  const app = await electron.launch({
    args: [resolve('tests/e2e/bootstrap.cjs')],
    env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root },
  }).catch((error) => {
    rmSync(root, { recursive: true, force: true })
    throw error
  })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'kassenwart'))
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: /Übersicht/ })).toBeVisible()
    const assertUnchanged = () => {
      for (const [name, content] of Object.entries(fixtures)) expect(readFileSync(join(data, name), 'utf8')).toBe(content)
    }
    const close = async () => {
      try { await app.close() } finally { rmSync(root, { recursive: true, force: true }) }
    }
    return { app, page, assertUnchanged, close }
  } catch (error) {
    try { await app.close() } finally { rmSync(root, { recursive: true, force: true }) }
    throw error
  }
}

async function clickMenu(app: ElectronApplication, id: string) {
  await app.evaluate(({ Menu, BrowserWindow }, menuId) => {
    const window = BrowserWindow.getAllWindows()[0]
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) throw new Error(`Anwendungsmenü fehlt: ${menuId}`)
    window.show()
    window.focus()
    item.click(item, window, {})
  }, id)
}

test('behält App-Identität, Vereinsdaten und den ursprünglichen Update-Einstieg bei', async () => {
  const { app, page, assertUnchanged, close } = await launch()
  try {
    const identity = await app.evaluate(({ app, BrowserWindow }) => ({
      name: app.getName(), title: BrowserWindow.getAllWindows()[0].getTitle(),
    }))
    expect.soft(identity.name).toBe('Buchführung')
    expect.soft(identity.title).toBe('Buchführung')
    await expect.soft(page.getByText('Vereinsrunde Musterstadt', { exact: true }).first()).toBeVisible()
    await expect.soft(page.getByText(/Designvorschau/)).toHaveCount(0)
    const result = await page.evaluate(() => window.kassenwart.installUpdate({ current: '1', latest: '1', hasUpdate: false }))
    expect.soft(result).toEqual({ ok: false, error: 'Kein Installer gefunden.' })
    assertUnchanged()
  } finally { await close() }
})

test('führt native Ansichtsmenüs einmal aus und öffnet zuletzt gebuchte Einträge ohne Speichern', async () => {
  const { app, page, assertUnchanged, close } = await launch()
  try {
    const sidebar = page.locator('#app-sidebar')
    await expect(sidebar).toBeVisible()
    await sidebar.evaluate((element) => {
      element.setAttribute('data-test-toggle-count', '0')
      new MutationObserver((records) => {
        element.setAttribute('data-test-toggle-count', String(Number(element.getAttribute('data-test-toggle-count')) + records.length))
      }).observe(element, { attributes: true, attributeFilter: ['hidden'] })
    })
    await clickMenu(app, 'toggle-sidebar')
    await expect(sidebar).toBeHidden()
    await expect(page.getByRole('button', { name: 'Seitenleiste einblenden', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(sidebar).toHaveAttribute('data-test-toggle-count', '1')
    await clickMenu(app, 'toggle-sidebar')
    await expect(sidebar).toBeVisible()
    await expect(sidebar).toHaveAttribute('data-test-toggle-count', '2')
    await clickMenu(app, 'search-bookings')
    const search = page.getByRole('dialog', { name: 'Buchungen durchsuchen', exact: true })
    await expect(search).toHaveAttribute('aria-modal', 'true')
    await expect(search.getByRole('textbox')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)
    await page.getByRole('region', { name: 'Zuletzt gebucht', exact: true })
      .getByRole('button', { name: /Mitgliedsbeitrag April/ }).click()
    await expect(page.getByRole('heading', { name: 'Buchung bearbeiten', exact: true })).toBeVisible()
    await expect(page.getByLabel('Verwendungszweck', { exact: true })).toHaveValue('Mitgliedsbeitrag April')
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Mitglied Muster')
    assertUnchanged()
  } finally { await close() }
})
