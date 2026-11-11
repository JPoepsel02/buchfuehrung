import { describe, expect, test } from 'vitest'
import type { Booking, Category, YearFile } from '@shared/types'
import { buildPresentationData } from '../presentationData'
import { buildPresentationHtml, praesentationsModus } from '../presentation'

function fixture(count = 9, mode: Category['praesentation'] = 'monat'): YearFile {
  const categories: Category[] = Array.from({ length: count }, (_, index) => ({
    id: `c${index}`, name: `Veranstaltung ${index}`, code: `V${index}`, sortOrder: index, active: true, praesentation: mode,
  }))
  const bookings: Booking[] = categories.map((category, index) => ({
    id: `b${index}`, seq: index + 1, date: `2026-${String(index % 12 + 1).padStart(2, '0')}-10`, categoryId: category.id,
    description: category.name, type: index % 2 ? 'ausgabe' : 'einnahme', amount: 1001 + index,
    isUmsatz: true, nonUmsatzAmount: 0, note: '', source: 'manuell',
  }))
  return { schemaVersion: 1, year: 2026, openingBalance: 12345, clubName: 'Testverein', treasurerName: 'Test', categories, bookings }
}

describe('annual presentation', () => {
  test('retains category modes and balanced timeline chunks without mutating data', () => {
    const file = fixture()
    const before = JSON.stringify(file)
    const data = buildPresentationData(file)
    expect(data.timeline.map((chunk) => chunk.length)).toEqual([3, 3, 3])
    expect(data.timeline.flat().map((station) => station.name)).toEqual(file.categories.map((category) => category.name))
    expect(data.totals.closingBalance).toBe(13350)
    expect(JSON.stringify(file)).toBe(before)
    expect(praesentationsModus({ ...file.categories[0], praesentation: undefined, name: 'Spenden' })).toBe('sammel')
  })

  test('paginates summary categories and preserves all values', () => {
    const file = fixture(9, 'sammel')
    const data = buildPresentationData(file)
    expect(data.timeline).toEqual([])
    expect(data.summaries.map((chunk) => chunk.length)).toEqual([3, 3, 3])
    const html = buildPresentationHtml(file)
    expect(html.match(/class="sammel-item"/g)).toHaveLength(9)
    expect(html.match(/class="slide /g)).toHaveLength(7)
  })

  test('retains every timeline category, positive and negative values, and embedded logos across pages', () => {
    const file = fixture()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    const html = buildPresentationHtml(file, png)
    for (const category of file.categories) expect(html).toContain(category.name)
    expect(html.match(/class="slide /g)).toHaveLength(7)
    expect(html.match(/class="station /g)).toHaveLength(9)
    expect(html).toContain('Der Jahresverlauf · 3/3')
    expect(html).toContain('Januar – März')
    expect(html).toContain('+ 10,01')
    expect(html).toContain('− 10,02')
    expect(html).toContain(`<img class="center-logo" src="${png}"`)
    expect(html).not.toContain('src="null"')
  })

  test('uses 16:9 print geometry, fiscal-year dates and safe logos', () => {
    const file = { ...fixture(0), year: 2025, fiscalStartMonth: 11, clubName: '<Verein> & Test' }
    const html = buildPresentationHtml(file, 'https://example.invalid/logo.png')
    expect(html).toContain('size: 13.333333in 7.5in')
    expect(html).toContain('width: 1280px; height: 720px')
    expect(html).toContain('01.11.2025')
    expect(html).toContain('31.10.2026')
    expect(html).toContain('2025/2026')
    expect(html).toContain('&lt;Verein&gt; &amp; Test')
    expect(html).not.toContain('example.invalid')
    expect(html.match(/class="slide /g)).toHaveLength(4)
  })
})
