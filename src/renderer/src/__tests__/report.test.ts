import { describe, expect, test } from 'vitest'
import { buildReportHtml } from '../report'
import type { Booking, YearFile } from '@shared/types'

function booking(partial: Partial<Booking> & Pick<Booking, 'id' | 'seq' | 'date' | 'categoryId' | 'type' | 'amount'>): Booking {
  return {
    description: 'Testbuchung',
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
    const main = year()
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
        }),
      ],
    })

    const html = buildReportHtml(main, null, second)

    expect(html).toContain('1. Bericht Konto Hauptkonto')
    expect(html).toContain('2. Bericht Konto Karnevalskonto')
    expect(html).toContain('3. Kassenprüfbericht')
    expect(html).toContain('kein Beleg im Ordner')
    expect(html).not.toContain('4. Karnevalskonto')
  })
})
