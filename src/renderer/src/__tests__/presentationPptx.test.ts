import { describe, expect, test } from 'vitest'
import JSZip from 'jszip'
import { formatDate, formatEur } from '@shared/money'
import type { Booking, Category, YearFile } from '@shared/types'
import { buildPresentationData } from '../presentationData'
import { buildPresentationPptx } from '../presentationPptx'
import { buildPresentationHtml } from '../presentation'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLucAAAAASUVORK5CYII='
const WIDE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEUlEQVR4nGNQSnP5j4wZ0AUA6iYOWbqLAAoAAAAASUVORK5CYII='
const category = (id: string, overrides: Partial<Category> = {}): Category => ({
  id, name: id, code: id.toUpperCase(), sortOrder: 1, active: true, ...overrides,
})
const booking = (id: string, categoryId: string, amount: number, type: Booking['type'] = 'einnahme', date = '2026-01-10'): Booking => ({
  id, categoryId, amount, type, date, seq: 1, description: id, isUmsatz: true, nonUmsatzAmount: 0, note: '', source: 'manuell',
})
function fixture(overrides: Partial<YearFile> = {}): YearFile {
  return { schemaVersion: 1, year: 2026, openingBalance: 100_001, clubName: 'Verein & Jugend <Nord>', treasurerName: 'Erika Muster',
    categories: [category('Jugendfahrt'), category('Beiträge'), category('Versteckt', { praesentation: 'aus' })],
    bookings: [booking('b1', 'Jugendfahrt', 12_345), booking('b2', 'Jugendfahrt', 2_345, 'ausgabe'),
      booking('b3', 'Beiträge', 1_101), booking('b4', 'Versteckt', 501, 'ausgabe')], ...overrides }
}
async function readDeck(file: YearFile, logo?: string | null) {
  const binary = await buildPresentationPptx(file, logo)
  const zip = await JSZip.loadAsync(binary)
  const slidePaths = Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((left, right) => Number(left.match(/slide(\d+)/)![1]) - Number(right.match(/slide(\d+)/)![1]))
  const slides = await Promise.all(slidePaths.map((path) => zip.file(path)!.async('string')))
  return { binary, zip, slides, xml: slides.join('\n') }
}

describe('buildPresentationPptx', () => {
  test('retains the large translucent background year on the same slides as the PDF', async () => {
    const file = fixture()
    const { slides, xml } = await readDeck(file)
    const watermarks = (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []).filter((shape) => shape.includes('name="Hintergrundjahr"'))
    expect(watermarks).toHaveLength((buildPresentationHtml(file).match(/class="giant-year"/g) ?? []).length)
    expect(watermarks).toHaveLength(5)
    for (const watermark of watermarks) {
      expect(watermark).toContain('<a:t>2026</a:t>')
      expect(Number(watermark.match(/sz="(\d+)"/)?.[1])).toBeGreaterThan(30000)
      expect(watermark).toContain('<a:alpha val="4500"/>')
    }
    expect(slides[2]).not.toContain('name="Hintergrundjahr"')
  })

  test('creates a genuine 16:9 PowerPoint package with editable text and shared slide order', async () => {
    const file = fixture()
    const before = JSON.stringify(file)
    const data = buildPresentationData(file)
    const { binary, zip, slides, xml } = await readDeck(file)
    expect(binary).toBeInstanceOf(Uint8Array)
    expect([...binary.slice(0, 2)]).toEqual([0x50, 0x4b])
    expect(zip.file('[Content_Types].xml')).not.toBeNull()
    const presentation = await zip.file('ppt/presentation.xml')!.async('string')
    expect(presentation).toMatch(/<p:sldSz[^>]*cx="12192000"[^>]*cy="6858000"/)
    expect(slides).toHaveLength(4 + data.timeline.length + data.summaries.length)
    expect(slides[0]).toContain('Kassenbericht')
    expect(slides[1]).toContain(formatEur(file.openingBalance))
    expect(slides[2]).toContain('Jugendfahrt')
    expect(slides[3]).toContain('Beiträge')
    expect(slides.at(-2)).toContain(formatEur(Math.abs(data.totals.saldo)))
    expect(slides.at(-1)).toContain(formatEur(data.totals.closingBalance))
    expect(xml).toContain('<a:t>')
    expect(xml).toContain('Verein &amp; Jugend &lt;Nord&gt;')
    expect(xml).not.toContain('Versteckt')
    expect(xml).not.toContain('<p:pic>')
    expect(JSON.stringify(file)).toBe(before)
  })

  test('preserves cent amounts and fiscal dates including a negative annual result', async () => {
    const file = fixture({ year: 2025, fiscalStartMonth: 11, openingBalance: 5_001,
      categories: [category('Novemberfest'), category('Zuschüsse')],
      bookings: [booking('negative', 'Novemberfest', 10_003, 'ausgabe', '2025-11-22'),
        booking('positive', 'Zuschüsse', 1_001, 'einnahme', '2026-02-01')] })
    const data = buildPresentationData(file)
    const { xml, slides } = await readDeck(file)
    expect(xml).toContain('2025/2026')
    expect(xml).toContain(formatDate(data.range.start))
    expect(xml).toContain(formatDate(data.range.end))
    expect(xml).toContain(`− ${formatEur(10_003)}`)
    expect(xml).toContain(`+ ${formatEur(1_001)}`)
    expect(slides.at(-2)).toContain(`− ${formatEur(9_002)}`)
    expect(slides.at(-1)).toContain(formatEur(-4_001))
    expect(xml).not.toContain('NaN')
  })

  test('retains long category names and explicit month/summary/off modes across all paginated slides', async () => {
    const names = Array.from({ length: 9 }, (_, index) => `Veranstaltung ${index + 1} mit einem längeren vollständigen Kategorienamen`)
    const summaryNames = Array.from({ length: 9 }, (_, index) => `Sammelposten ${index + 1}`)
    const file = fixture({ categories: [
      ...names.map((name, index) => category(`m${index}`, { name, praesentation: 'monat', praesentationMonat: 12 })),
      ...summaryNames.map((name, index) => category(`s${index}`, { name, praesentation: 'sammel' })),
      category('Ausgeblendet', { praesentation: 'aus' }),
    ], bookings: [...names.map((_, index) => booking(`mb${index}`, `m${index}`, 101 + index)),
      ...summaryNames.map((_, index) => booking(`sb${index}`, `s${index}`, 201 + index)), booking('off', 'Ausgeblendet', 1)] })
    const { xml, slides } = await readDeck(file)
    expect(slides).toHaveLength(10)
    for (const name of [...names, ...summaryNames]) expect(xml).toContain(name)
    expect(xml).toContain('Dezember')
    expect(xml).not.toContain('Ausgeblendet')
  })

  test('creates four valid slides for an empty year with zero balances', async () => {
    const { slides, xml } = await readDeck(fixture({ openingBalance: 0, bookings: [], categories: [] }))
    expect(slides).toHaveLength(4)
    expect(xml).toContain(formatEur(0))
    expect(xml).not.toMatch(/NaN|undefined|Infinity/)
  })

  test('embeds a raster logo and keeps it proportional without external relationships', async () => {
    const { zip, xml } = await readDeck(fixture(), PNG)
    expect(Object.keys(zip.files).some((path) => /^ppt\/media\/.*\.png$/.test(path))).toBe(true)
    expect(xml).toContain('<p:pic>')
    for (const path of Object.keys(zip.files).filter((name) => name.endsWith('.rels'))) {
      expect(await zip.file(path)!.async('string')).not.toContain('TargetMode="External"')
    }
  })

  test.each([{ logo: PNG, ratio: 1 }, { logo: WIDE_PNG, ratio: 2 }])(
    'contains and centers an embedded logo at its true aspect ratio $ratio', async ({ logo, ratio }) => {
      const { slides } = await readDeck(fixture(), logo)
      const centerBox = [13.333333 / 2 - 0.45, 1.65, 0.9, 0.75]
      const headerBox = [11.35, 0.65, 1.1, 0.75]
      const boxes = [[0.85, 0.7, 1.6, 1.05], centerBox, headerBox, headerBox, centerBox, centerBox]
      expect(slides).toHaveLength(boxes.length)
      slides.forEach((slide, index) => {
        const picture = slide.match(/<p:pic>[\s\S]*?<\/p:pic>/)![0]
        const transform = picture.match(/<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/)![1]
        const [, x, y] = transform.match(/<a:off x="(\d+)" y="(\d+)"/)!.map(Number)
        const [, width, height] = transform.match(/<a:ext cx="(\d+)" cy="(\d+)"/)!.map(Number)
        const [boxX, boxY, boxW, boxH] = boxes[index].map((inches) => Math.round(inches * 914400))
        expect(width / height).toBeCloseTo(ratio, 5)
        if (ratio === 1) expect(width).toBe(height)
        expect(x).toBeGreaterThanOrEqual(boxX - 2)
        expect(y).toBeGreaterThanOrEqual(boxY - 2)
        expect(x + width).toBeLessThanOrEqual(boxX + boxW + 2)
        expect(y + height).toBeLessThanOrEqual(boxY + boxH + 2)
        expect(Math.abs(x + width / 2 - (boxX + boxW / 2))).toBeLessThanOrEqual(2)
        expect(Math.abs(y + height / 2 - (boxY + boxH / 2))).toBeLessThanOrEqual(2)
      })
    })

  test.each(['data:image/png;base64,AAAA', 'data:image/jpeg;base64,AAAA', 'data:image/webp;base64,AAAA'])(
    'reports a corrupt allowed raster logo clearly (case %#)', async (logo) => {
      await expect(buildPresentationPptx(fixture(), logo)).rejects.toThrow('Das Vereinslogo konnte nicht gelesen werden.')
    })

  test.each([null, '', 'https://example.invalid/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,AAAA" onerror="alert(1)', `data:image/png;base64,${'A'.repeat(8_000_001)}`])(
    'ignores unsafe, remote or oversized logos (case %#)', async (logo) => {
      const { zip, xml } = await readDeck(fixture(), logo)
      expect(Object.keys(zip.files).filter((path) => /^ppt\/media\/[^/]+$/.test(path))).toHaveLength(0)
      expect(xml).not.toContain('<p:pic>')
    })
})
