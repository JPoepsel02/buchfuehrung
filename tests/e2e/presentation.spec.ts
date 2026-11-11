import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import JSZip from 'jszip'
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AppSettings, YearFile } from '../../src/shared/types'

const requireDemo = createRequire(resolve('package.json'))
const { buildDemoData } = requireDemo(resolve('scripts/demo-data.cjs')) as {
  buildDemoData(): { files: YearFile[]; settings: AppSettings }
}
const organizationNav = (page: Page) => page.getByRole('navigation', { name: 'Verein', exact: true })

async function launch(prepare?: (files: YearFile[]) => YearFile[]) {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-presentation-'))
  const data = join(root, 'kassenwart', 'daten')
  const output = join(root, 'exports')
  mkdirSync(data, { recursive: true }); mkdirSync(output)
  const demo = buildDemoData()
  const files = prepare ? prepare(demo.files) : demo.files
  for (const file of files) {
    const suffix = file.konto === 'zweit' ? '-k2' : file.konto && file.konto !== 'haupt' ? `-${file.konto}` : ''
    writeFileSync(join(data, `kassenbuch${suffix}-${file.year}.json`), JSON.stringify(file))
  }
  writeFileSync(join(data, 'einstellungen.json'), JSON.stringify({ ...demo.settings, theme: 'hell' }))
  try {
    const app = await electron.launch({ args: [resolve('tests/e2e/bootstrap.cjs')],
      env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root } })
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Vereinsübersicht', exact: true })).toBeVisible()
    await app.evaluate(({ dialog, shell }, directory) => {
      let index = 0
      dialog.showSaveDialog = async (...args: unknown[]) => {
        const options = args[args.length - 1] as { defaultPath?: string }
        const name = (options.defaultPath ?? 'export').split(/[\\/]/).pop()!
        return { canceled: false, filePath: `${directory}/${++index}-${name}` }
      }
      shell.showItemInFolder = () => {}
    }, output)
    return { app, page, root, output }
  } catch (failure) { rmSync(root, { recursive: true, force: true }); throw failure }
}

async function close(app: ElectronApplication, root: string) {
  try { await app.close() } finally { rmSync(root, { recursive: true, force: true }) }
}

async function exportFile(page: Page, directory: string, button: string, extension: string) {
  const before = new Set(readdirSync(directory))
  await page.getByRole('button', { name: button, exact: true }).click()
  const files = () => readdirSync(directory).filter((name) => !before.has(name) && name.endsWith(extension))
  await expect.poll(() => files().length).toBe(1)
  return join(directory, files()[0])
}

test('exportiert editierbare 16:9-Folien als PowerPoint und PDF und passt die Vorschau vollständig ein', async () => {
  test.setTimeout(90_000)
  const { app, page, root, output } = await launch()
  try {
    await organizationNav(page).getByRole('button', { name: 'Berichte', exact: true }).click()
    await page.getByRole('button', { name: 'Jahrespräsentation', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Jahrespräsentation 2026', exact: true })).toBeVisible()
    const preview = page.frameLocator('iframe')
    await expect(preview.locator('.slide').first()).toBeVisible()
    const slideCount = await preview.locator('.slide').count()
    const pptx = await exportFile(page, output, 'PowerPoint exportieren', '.pptx')
    const zip = await JSZip.loadAsync(readFileSync(pptx))
    const presentationXml = await zip.file('ppt/presentation.xml')!.async('string')
    const size = presentationXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
    expect(size).not.toBeNull()
    expect(Number(size![1]) / Number(size![2])).toBeCloseTo(16 / 9, 4)
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    expect(slides).toHaveLength(slideCount)
    const text = (await Promise.all(slides.map((name) => zip.file(name)!.async('string')))).join('\n')
    expect(text).toContain('<a:t>')
    expect(text).toContain('2026')
    expect(text).toContain('22.980,00')
    const pdf = await exportFile(page, output, 'PDF exportieren', '.pdf')
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
    mkdirSync(resolve('.validation'), { recursive: true })
    copyFileSync(pptx, resolve('.validation/Jahrespraesentation-aktuell.pptx'))
    copyFileSync(pdf, resolve('.validation/Jahrespraesentation-aktuell.pdf'))

    for (const width of [1440, 960, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      const closeNavigation = page.getByRole('button', { name: 'Navigation schließen', exact: true })
      if (await closeNavigation.isVisible()) await closeNavigation.click()
      await expect.poll(async () => preview.locator('html').evaluate((html) => ({
        scroll: html.scrollWidth, width: html.clientWidth,
      })).then((size) => size.scroll <= size.width + 2)).toBe(true)
      const geometry = await preview.locator('.slide').first().evaluate((slide) => {
        const rect = slide.getBoundingClientRect()
        return { right: rect.right, width: rect.width, height: rect.height, viewport: innerWidth }
      })
      expect(geometry.width / geometry.height).toBeCloseTo(16 / 9, 3)
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 2)
      const watermarks = await preview.locator('.giant-year').evaluateAll((elements) => elements.map((element) => {
        const year = element.getBoundingClientRect()
        const slide = element.closest('.slide')!.getBoundingClientRect()
        return { large: year.width > slide.width * 0.7 && year.height > slide.height * 0.7,
          decorative: element.getAttribute('aria-hidden') === 'true' }
      }))
      expect(watermarks.length).toBeGreaterThan(0)
      for (const watermark of watermarks) expect(watermark).toEqual({ large: true, decorative: true })
      const pageWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
      expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.width + 2)
      await expect.poll(async () => page.locator('.main').evaluate((main) => main.scrollWidth <= main.clientWidth + 2)).toBe(true)
      await page.screenshot({ path: resolve(`.validation/Jahrespraesentation-Vorschau-${width}.png`), fullPage: true })
    }
  } finally { await close(app, root) }
})

test('druckt im Kassenprüfbericht nur vorhandene Belege und ausgefüllte Namen und bietet auch dort PowerPoint an', async () => {
  const { app, page, root, output } = await launch((files) => files.map((file) => file.konto !== 'haupt' ? file : {
    ...file, bookings: file.bookings.map((booking, index) => ({ ...booking, subcategory: undefined,
      description: index < 3 ? `Prüfbeleg ${index}` : booking.description,
      receiptStatus: index === 0 ? 'vorhanden' : index === 1 ? 'offen' : 'nicht_erforderlich',
      name: index === 0 ? 'Max Muster' : index === 1 ? '' : 'nicht erforderlich',
    })),
  }))
  try {
    await organizationNav(page).getByRole('button', { name: 'Berichte', exact: true }).click()
    await page.getByRole('button', { name: 'Kassenprüfbericht', exact: true }).click()
    const preview = page.frameLocator('iframe')
    for (const index of [0, 1, 2]) {
      const rows = preview.getByRole('row').filter({ has: preview.getByRole('cell', { name: `Prüfbeleg ${index}`, exact: true }) })
      await expect(rows).toHaveCount(2)
      for (const row of await rows.all()) {
        await expect(row.getByRole('cell').nth(2)).toHaveText(index === 0 ? '✓' : '')
        await expect(row.getByRole('cell').nth(3)).toHaveText(index === 0 ? 'Max Muster' : '')
      }
    }
    await expect(preview.locator('body')).not.toContainText(/noch prüfen|nicht erforderlich/i)
    const pptx = await exportFile(page, output, 'Jahres-Präsentation (PPTX) …', '.pptx')
    expect((await JSZip.loadAsync(readFileSync(pptx))).file('ppt/presentation.xml')).not.toBeNull()
  } finally { await close(app, root) }
})

test('weist ungültige PowerPoint-Exportdaten vor dem Speicherdialog zurück', async () => {
  const { app, page, root, output } = await launch()
  try {
    const failures = await page.evaluate(async () => {
      const invalid: Array<[string, Uint8Array]> = [
        ['test.txt', new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
        ['test.pptx', new Uint8Array([0, 1, 2, 3])],
        ['test.pptx', new Uint8Array()],
        ['test\n.pptx', new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
      ]
      return Promise.all(invalid.map(async ([name, bytes]) => {
        try { await window.kassenwart!.savePptx(name, bytes); return false }
        catch (failure) { return String(failure).includes('ungültige Exportdaten') }
      }))
    })
    expect(failures).toEqual([true, true, true, true])
    expect(readdirSync(output)).toHaveLength(0)
  } finally { await close(app, root) }
})
