const { chromium } = require('playwright')
const { expect } = require('@playwright/test')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve, join } = require('node:path')
const assert = require('node:assert/strict')
const { buildDemoData } = require('./demo-data.cjs')

async function run() {
  const directory = resolve('.validation/ui')
  mkdirSync(directory, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const checks = []
  const errors = []
  const variants = [
    { width: 1440, theme: 'light' }, { width: 960, theme: 'light' },
    { width: 760, theme: 'light' }, { width: 390, theme: 'light' },
    { width: 1440, theme: 'dark' }, { width: 1440, theme: 'light', fontSize: '200%' },
  ]
  try {
    for (const variant of variants) {
      const demo = buildDemoData()
      demo.files.find(file => file.konto === 'haupt').importDraft = {
        fileName: 'Beispiel-Kontoauszug.csv', skipped: 0,
        rows: [
          { date: '2026-06-15', amount: -12345, bankName: 'Beispiel Handel GmbH', name: 'Beispiel Handel GmbH',
            bankText: 'Überweisung Materialbestellung Vereinsveranstaltung · Referenz 12345 · 15.06.2026',
            hash: 'preview-first', categoryId: '', description: '', selected: false, isUmsatz: false, receiptStatus: 'offen' },
          { date: '2026-06-16', amount: 4567, bankName: 'Beispiel Person', name: 'Beispiel Person',
            bankText: 'Zweite Position', hash: 'preview-second', categoryId: '', description: '', selected: false, isUmsatz: false, receiptStatus: 'offen' },
        ],
      }
      const context = await browser.newContext({ viewport: { width: variant.width, height: 1000 }, colorScheme: variant.theme, reducedMotion: 'reduce' })
      await context.addInitScript(data => {
        if (localStorage.getItem('workflow-layout-seeded')) return
        for (const file of data.files) {
          const account = file.konto === 'haupt' ? 'jahr' : file.konto === 'zweit' ? 'k2' : file.konto
          localStorage.setItem(`vereinszentrale-lokal:${account}:${file.year}`, JSON.stringify(file))
        }
        localStorage.setItem('vereinszentrale-lokal:einstellungen', JSON.stringify(data.settings))
        localStorage.setItem('workflow-layout-seeded', '1')
      }, demo)
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('http://127.0.0.1:5190/')
      await page.getByRole('heading', { level: 1, name: 'Vereinsübersicht', exact: true }).waitFor()
      const openSidebar = async () => {
        if (!(await page.locator('#app-sidebar').isVisible())) await page.getByRole('button', { name: 'Seitenleiste einblenden', exact: true }).click()
      }
      await openSidebar()
      await page.getByLabel('Konto wählen', { exact: true }).selectOption('haupt')
      await openSidebar()
      await page.getByRole('navigation', { name: 'Hauptnavigation', exact: true }).getByRole('button', { name: /^Umsätze importieren/ }).click()
      await page.getByRole('button', { name: 'Einzeln zuordnen', exact: true }).first().click()
      const dialog = page.getByRole('dialog', { name: 'Umsätze einzeln zuordnen', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Eigener Verwendungszweck', { exact: true }).fill('Material für die Vereinsveranstaltung')
      await dialog.getByLabel('Kategorie', { exact: true }).selectOption('beitrag')
      await expect(dialog.getByLabel('Tätigkeitsbereich 1', { exact: true })).toHaveValue('I')
      await dialog.getByLabel('Tätigkeitsbereich 1', { exact: true }).selectOption('Z')
      await dialog.getByLabel('Belegstatus', { exact: true }).selectOption('vorhanden')
      if (variant.fontSize) await page.evaluate(size => { document.documentElement.style.fontSize = size }, variant.fontSize)
      const geometry = await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const body = element.querySelector('.import-review-body')
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: innerWidth, height: innerHeight, scroll: element.scrollWidth, client: element.clientWidth,
          bodyScroll: body.scrollWidth, bodyClient: body.clientWidth }
      })
      assert.ok(geometry.left >= -1 && geometry.right <= geometry.width + 1, JSON.stringify(geometry))
      assert.ok(geometry.top >= -1 && geometry.bottom <= geometry.height + 1, JSON.stringify(geometry))
      assert.ok(geometry.scroll <= geometry.client + 1 && geometry.bodyScroll <= geometry.bodyClient + 1, JSON.stringify(geometry))
      await dialog.getByRole('button', { name: 'Weiter', exact: true }).click({ trial: true })
      const heading = dialog.getByRole('heading', { name: 'Umsatz zuordnen', exact: true })
      await heading.focus()
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('button', { name: 'Weiter', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: 'Schließen', exact: true })).toBeFocused()
      await dialog.locator('.import-review-body').evaluate(element => element.scrollTo({ top: 0 }))
      const suffix = `${variant.width}-${variant.theme}${variant.fontSize ? '-200' : ''}`
      await page.screenshot({ path: join(directory, `Import-Einzelzuordnung-${suffix}.png`), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vereinszentrale-lokal:jahr:2026')))
      assert.equal(saved.bookings.length, demo.files.find(file => file.konto === 'haupt').bookings.length)
      assert.deepEqual(saved.importDraft.rows[0].allocations, [{ area: 'Z', amount: 12345 }])
      checks.push({ ...variant, ...geometry })
      await context.close()
    }
    assert.deepEqual(errors, [])
    writeFileSync('.validation/import-review-layout.json', JSON.stringify({ checks: checks.length, pageErrors: errors, variants: checks }, null, 2))
    console.log(JSON.stringify({ checks: checks.length, pageErrors: errors }))
  } finally { await browser.close() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
