import { describe, expect, test } from 'vitest'
import { buildReportHtml } from '../report'
import type { Booking, YearFile } from '@shared/types'

function booking(partial: Partial<Booking> & Pick<Booking, 'id' | 'seq' | 'date' | 'categoryId' | 'type' | 'amount'>): Booking {
  return {
    description: 'Testbuchung',
    name: 'Max Mustermann',
    isUmsatz: false,
    nonUmsatzAmount: 0,
    note: '',
    source: 'manuell',
    ...partial,
  }
}

function year(overrides: Partial<YearFile> = {}): YearFile {
  return {
    schemaVersion: 1,
    year: 2026,
    konto: 'haupt',
    kontoName: 'Hauptkonto',
    openingBalance: 0,
    clubName: 'Testverein',
    treasurerName: 'Jannik',
    categories: [{ id: 'k', name: 'Karneval', code: 'K', sortOrder: 10, active: true }],
    bookings: [booking({ id: 'b1', seq: 1, date: '2026-01-10', categoryId: 'k', type: 'einnahme', amount: 2000 })],
    ...overrides,
  }
}

describe('buildReportHtml', () => {
  test('trennt Hauptkonto und Zweitkonto mit eigenen Konto-Berichtsüberschriften', () => {
    const main = year({
      audit: {
        konto1: 'IBAN Hauptkonto',
        konto2: 'IBAN Karneval',
        pruefDatum: '2026-12-31',
        wahlDatum: '1.1.26',
        gvDatum: '1.1.',
      },
    })
    const second = year({
      year: 2025,
      konto: 'zweit',
      kontoName: 'Karnevalskonto',
      fiscalStartMonth: 11,
      bookings: [
        booking({
          id: 'b2',
          seq: 1,
          date: '2025-11-01',
          categoryId: 'k',
          type: 'ausgabe',
          amount: 1000,
          receiptAvailable: false,
          subcategory: 'Beiträge',
        }),
        booking({
          id: 'b3',
          seq: 2,
          date: '2025-11-02',
          categoryId: 'k',
          type: 'einnahme',
          amount: 2000,
          receiptAvailable: true,
          subcategory: 'Beiträge',
        }),
      ],
    })

    const html = buildReportHtml(main, null, [second])

    expect(html).toContain('1. Bericht Hauptkonto · IBAN Hauptkonto')
    expect(html).toContain('2. Bericht Karnevalskonto · IBAN Karneval')
    expect(html).toContain('3. Kassenprüfbericht')
    expect(html).toContain('im Beisein von Jannik')
    expect(html).toContain('31.12.2026')
    expect(html).toContain('01.01.2026')
    expect(html).toContain('<th>Beleg</th>')
    expect(html).toContain('<th>Name</th>')
    expect(html).toContain('Max Mustermann')
    expect(html).toContain('▤ = Beleg im Ordner, □ = noch prüfen, — = nicht erforderlich')
    expect(html).toContain('<span class="receipt-state">▤</span>')
    expect(html).toContain('<span class="receipt-state">▤ 1/2</span>')
    expect(html).toContain('<td></td>\n          <td>Beiträge</td>')
    expect(html).not.toContain('Beleg geprüft')
    expect(html).not.toContain('Bericht Konto')
  })
})
