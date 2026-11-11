import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { YearFile } from '../../src/shared/types'

const fixture: YearFile = {
  schemaVersion: 1, konto: 'haupt', year: 2026, openingBalance: 0,
  clubName: 'Layout-Testverein', treasurerName: 'Testperson',
  categories: [
    { id: 'a', name: 'Testkategorie A', code: 'A', active: true, sortOrder: 1, praesentation: 'sammel' },
    { id: 'b', name: 'Testkategorie B', code: 'B', active: true, sortOrder: 2, praesentation: 'monat', praesentationMonat: 3 },
    { id: 'c', name: 'Testkategorie C', code: 'C', active: true, sortOrder: 3, praesentation: 'aus' },
  ],
  refNoCounters: {}, bookings: [],
}

for (const viewport of [{ width: 1280, height: 840 }, { width: 960, height: 640 }]) {
  test(`hält Kategorie-Darstellungen und Aktionen bei ${viewport.width} × ${viewport.height} getrennt erreichbar`, async ({}, testInfo) => {
    const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-category-layout-'))
    const data = join(root, 'kassenwart', 'daten')
    const book = join(data, 'kassenbuch-2026.json')
    mkdirSync(data, { recursive: true })
    writeFileSync(book, JSON.stringify(fixture))
    writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ theme: 'hell' }))
    const app = await electron.launch({
      args: [resolve('tests/e2e/bootstrap.cjs')],
      env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root },
    })
    try {
      expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'kassenwart'))
      const page = await app.firstWindow()
      await page.setViewportSize(viewport)
      await expect(page.getByRole('heading', { level: 1, name: 'Vereinsübersicht', exact: true })).toBeVisible()
      await page.getByLabel('Konto wählen', { exact: true }).selectOption('haupt')
      await page.getByRole('navigation', { name: 'Hauptnavigation' })
        .getByRole('button', { name: 'Kontoeinstellungen', exact: true }).click()
      const table = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Präsentation', exact: true }) })
      const rows = table.locator('tbody tr')
      await expect(rows).toHaveCount(3)
      await expect(table.getByLabel('Darstellung in der Jahres-Präsentation')).toHaveCount(3)
      await expect(table.getByLabel('Monat im Jahresverlauf')).toHaveValue('3')

      for (const row of await rows.all()) {
        await row.scrollIntoViewIfNeeded()
        const geometry = await row.evaluate((element) => {
          const rect = (node: Element) => {
            const { left, top, right, bottom } = node.getBoundingClientRect()
            return { left, top, right, bottom }
          }
          const selects = Array.from(element.querySelectorAll('select'))
          return {
            cell: rect(selects[0].closest('td')!),
            cells: selects.map((select) => rect(select.closest('td')!)),
            selects: selects.map(rect),
            actions: Array.from(element.querySelectorAll('button')).map(rect),
          }
        })
        for (const [index, select] of geometry.selects.entries()) {
          const cell = geometry.cells[index]
          expect(select.left).toBeGreaterThanOrEqual(cell.left - 1)
          expect(select.top).toBeGreaterThanOrEqual(cell.top - 1)
          expect(select.right, 'Kategoriefeld ragt aus seiner Tabellenzelle').toBeLessThanOrEqual(cell.right + 1)
          expect(select.bottom).toBeLessThanOrEqual(cell.bottom + 1)
        }
        const overlaps = (a: typeof geometry.cell, b: typeof geometry.cell) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
        for (let index = 0; index < geometry.selects.length; index++) {
          const select = geometry.selects[index]
          for (const other of [...geometry.selects.slice(index + 1), ...geometry.actions]) {
            expect(overlaps(select, other), 'Darstellungsfelder überdecken einander oder Kategorieaktionen').toBe(false)
          }
        }
        for (const action of await row.getByRole('button').all()) {
          if (await action.isEnabled()) await action.click({ trial: true })
        }
      }
      const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Veranstaltungen / Kategorien', exact: true }) })
      await section.screenshot({ path: testInfo.outputPath('kategorie-layout.png'), animations: 'disabled' })
      expect(JSON.parse(readFileSync(book, 'utf8'))).toEqual(fixture)
    } finally { await app.close() }
  })
}
