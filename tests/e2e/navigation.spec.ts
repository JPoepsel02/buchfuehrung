import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AppSettings, YearFile } from '../../src/shared/types'

const requireDemo = createRequire(resolve('package.json'))
const { buildDemoData } = requireDemo(resolve('scripts/demo-data.cjs')) as {
  buildDemoData(): { files: YearFile[]; settings: AppSettings }
}

async function launch() {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-navigation-'))
  const directory = join(root, 'kassenwart', 'daten')
  mkdirSync(directory, { recursive: true })
  const { files, settings } = buildDemoData()
  for (const file of files) {
    const suffix = file.konto === 'zweit' ? '-k2' : file.konto && file.konto !== 'haupt' ? `-${file.konto}` : ''
    writeFileSync(join(directory, `kassenbuch${suffix}-${file.year}.json`), JSON.stringify(file))
  }
  writeFileSync(join(directory, 'einstellungen.json'), JSON.stringify({ ...settings, theme: 'hell' }))
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: [resolve('tests/e2e/bootstrap.cjs')], env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root } })
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: 'Vereinsübersicht', exact: true })).toBeVisible()
    return { app, page, root }
  } catch (failure) {
    try { await app?.close() } finally { rmSync(root, { recursive: true, force: true }) }
    throw failure
  }
}

async function close(app: ElectronApplication, root: string) {
  try { await app.close() } finally { rmSync(root, { recursive: true, force: true }) }
}

const navigation = (page: Page, scope: 'Verein' | 'Hauptnavigation') => page.getByRole('navigation', { name: scope, exact: true })

test('behält das Vereinsmenü über der nativen Kontoauswahl und merkt Ansicht und Kassenjahr pro Konto', async () => {
  const { app, page, root } = await launch()
  try {
    const selector = page.getByLabel('Konto wählen', { exact: true })
    await expect(selector).toHaveCount(1)
    await expect(selector).toHaveJSProperty('tagName', 'SELECT')
    await expect(selector).toHaveValue('haupt')
    await expect(selector.locator('option[value="haupt"]')).toHaveText('Hauptkonto')
    await expect(selector.locator('option[value="zweit"]')).toHaveText('Karnevalskonto')
    await expect(selector.locator('option[value="k3"]')).toHaveText('Barkasse')
    await expect(page.getByLabel('Arbeitsbereich', { exact: true })).toHaveCount(0)
    await expect(page.locator('.sidebar-account__toggle')).toHaveCount(0)
    await expect(page.locator('.org-active-account')).toHaveCount(0)
    await expect(navigation(page, 'Verein')).toBeVisible()
    await expect(navigation(page, 'Verein').getByRole('button')).toHaveCount(4)
    const order = await selector.evaluate((element) => ({
      globalBottom: document.querySelector('#app-sidebar nav[aria-label="Verein"]')!.getBoundingClientRect().bottom,
      selectorTop: element.getBoundingClientRect().top,
    }))
    expect(order.globalBottom).toBeLessThanOrEqual(order.selectorTop + 1)
    for (const name of ['Vereinsübersicht', 'Tätigkeitsbereiche', 'Berichte', 'Einstellungen']) {
      await expect(navigation(page, 'Verein').getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(navigation(page, 'Hauptnavigation')).toBeVisible()
    await expect(navigation(page, 'Hauptnavigation').getByRole('button')).toHaveCount(6)
    await expect(navigation(page, 'Hauptnavigation').locator('button[aria-current="page"]')).toHaveCount(0)
    await expect(page.getByLabel('Jahr wählen', { exact: true })).toHaveValue('2026')

    await selector.selectOption('haupt')
    await expect(page.getByRole('heading', { level: 1, name: /Übersicht/ })).toBeVisible()
    await expect(navigation(page, 'Verein')).toBeVisible()
    await expect(navigation(page, 'Hauptnavigation')).toHaveCount(1)
    await expect(navigation(page, 'Verein').getByRole('button', { name: 'Einstellungen', exact: true })).toHaveCount(1)
    await expect(navigation(page, 'Hauptnavigation').getByRole('button', { name: 'Kontoeinstellungen', exact: true })).toHaveCount(1)
    for (const label of ['Finanzen', 'Auswertungen', 'Werkzeuge', 'Verwaltung']) await expect(navigation(page, 'Hauptnavigation').getByRole('heading', { name: label, exact: true })).toBeVisible()
    await navigation(page, 'Hauptnavigation').getByRole('button', { name: 'Buchungen', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Buchungen', exact: true })).toBeVisible()
    await selector.selectOption('zweit')
    await expect(selector).toHaveValue('zweit')
    await expect(page.getByRole('heading', { level: 1, name: 'Buchungen', exact: true })).toBeVisible()
    await expect(navigation(page, 'Hauptnavigation').getByRole('button', { name: 'Buchungen', exact: true })).toHaveAttribute('aria-current', 'page')
    await page.getByLabel('Jahr wählen', { exact: true }).selectOption('2025')
    await selector.selectOption('haupt')
    await expect(page.getByRole('heading', { level: 1, name: 'Buchungen', exact: true })).toBeVisible()
    await expect(page.getByLabel('Jahr wählen', { exact: true })).toHaveValue('2026')
    await selector.selectOption('zweit')
    await expect(page.getByLabel('Jahr wählen', { exact: true })).toHaveValue('2025')

    await navigation(page, 'Verein').getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Gemeinsame Einstellungen', exact: true })).toBeVisible()
    await expect(navigation(page, 'Verein')).toBeVisible()
    await expect(navigation(page, 'Hauptnavigation')).toBeVisible()
    await expect(navigation(page, 'Hauptnavigation').locator('button[aria-current="page"]')).toHaveCount(0)
    await expect(selector).toHaveValue('zweit')
    await navigation(page, 'Verein').getByRole('button', { name: 'Berichte', exact: true }).click()
    await page.getByRole('navigation', { name: 'Berichtsarten', exact: true }).getByRole('button', { name: 'Kassenprüfbericht', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Kassenprüfbericht 2026', exact: true })).toBeVisible()
    await expect(selector).toHaveValue('zweit')
    await expect(page.getByLabel('Jahr wählen', { exact: true })).toHaveValue('2025')
    await selector.selectOption('zweit')
    await expect(page.getByRole('heading', { level: 1, name: 'Buchungen', exact: true })).toBeVisible()
    await expect(page.getByLabel('Jahr wählen', { exact: true })).toHaveValue('2025')
    await expect(navigation(page, 'Verein')).toBeVisible()
    await expect(navigation(page, 'Hauptnavigation').getByRole('button', { name: 'Buchungen', exact: true })).toHaveAttribute('aria-current', 'page')
    await selector.selectOption('haupt')
    await navigation(page, 'Hauptnavigation').getByRole('button', { name: 'Kontoeinstellungen', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Kontoeinstellungen', exact: true })).toBeVisible()
    await expect(navigation(page, 'Verein').getByRole('button', { name: 'Einstellungen', exact: true })).toHaveCount(1)
    await expect(navigation(page, 'Hauptnavigation').getByRole('button', { name: 'Kontoeinstellungen', exact: true })).toHaveCount(1)
    await navigation(page, 'Verein').getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Gemeinsame Einstellungen', exact: true })).toBeVisible()
    await expect(navigation(page, 'Verein')).toHaveCount(1)
    await expect(navigation(page, 'Hauptnavigation')).toHaveCount(1)
  } finally { await close(app, root) }
})

test('öffnet Berichtskacheln per Tastatur und kehrt mit erhaltenen Filtern zur Auswahl zurück', async () => {
  const { app, page, root } = await launch()
  try {
    await navigation(page, 'Verein').getByRole('button', { name: 'Berichte', exact: true }).click()
    const catalog = page.getByRole('navigation', { name: 'Berichtsarten', exact: true })
    await expect(catalog).toBeVisible()
    await expect(catalog.getByRole('button')).toHaveCount(5)
    await expect(catalog.getByRole('heading', { name: 'Auswertungen', exact: true })).toBeVisible()
    await expect(catalog.getByRole('heading', { name: 'Jahresabschluss', exact: true })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect(page.getByLabel('Von', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'PDF exportieren', exact: true })).toHaveCount(0)

    await catalog.getByRole('button', { name: 'Einnahmenüberschussrechnung (EÜR)', exact: true }).focus()
    await page.keyboard.press('Tab')
    const keyboardTile = catalog.getByRole('button', { name: 'Buchungsübersicht', exact: true })
    await expect(keyboardTile).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.frameLocator('iframe').getByRole('heading', { level: 1, name: 'Buchungsübersicht', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Alle Berichte', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Alle Berichte', exact: true }).click()
    await expect(catalog.getByRole('button')).toHaveCount(5)
    await expect(keyboardTile).toBeFocused()

    for (const title of ['Einnahmenüberschussrechnung (EÜR)', 'Buchungsübersicht', 'Veranstaltungsauswertung', 'Kassenprüfbericht', 'Jahrespräsentation']) {
      await catalog.getByRole('button', { name: title, exact: true }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Berichte', exact: true })).toBeVisible()
      await expect(catalog).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Alle Berichte', exact: true })).toBeVisible()
      await expect(navigation(page, 'Verein').getByRole('button', { name: 'Berichte', exact: true })).toHaveAttribute('aria-current', 'page')
      if (title === 'Kassenprüfbericht' || title === 'Jahrespräsentation') {
        await expect(page.getByRole('heading', { level: 2, name: `${title} 2026`, exact: true })).toBeVisible()
      } else {
        await expect(page.frameLocator('iframe').getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
      }
      await page.getByRole('button', { name: 'Alle Berichte', exact: true }).click()
      await expect(catalog).toBeVisible()
      await expect(catalog.getByRole('button')).toHaveCount(5)
      await expect(page.locator('iframe')).toHaveCount(0)
    }
    await catalog.getByRole('button', { name: 'Einnahmenüberschussrechnung (EÜR)', exact: true }).click()
    await page.getByLabel('Von', { exact: true }).fill('2026-02-01')
    await page.getByRole('checkbox', { name: 'Barkasse', exact: true }).uncheck()
    await page.getByRole('button', { name: 'Alle Berichte', exact: true }).click()
    await catalog.getByRole('button', { name: 'Buchungsübersicht', exact: true }).click()
    await expect(page.getByLabel('Von', { exact: true })).toHaveValue('2026-02-01')
    await expect(page.getByRole('checkbox', { name: 'Barkasse', exact: true })).not.toBeChecked()
    await expect(page.frameLocator('iframe').locator('header')).toContainText('01.02.2026')
    await expect(page.frameLocator('iframe').locator('header')).not.toContainText('Barkasse')
    await navigation(page, 'Verein').getByRole('button', { name: 'Tätigkeitsbereiche', exact: true }).click()
    await navigation(page, 'Verein').getByRole('button', { name: 'Berichte', exact: true }).click()
    await expect(catalog).toBeVisible()
    await expect(catalog.getByRole('button')).toHaveCount(5)
    await expect(page.locator('iframe')).toHaveCount(0)
  } finally { await close(app, root) }
})
