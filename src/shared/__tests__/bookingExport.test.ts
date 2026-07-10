import { describe, expect, test } from 'vitest'
import { bookingsToCsv } from '../bookingExport'
import type { ComputedBooking } from '../types'

function row(overrides: Partial<ComputedBooking> = {}): ComputedBooking {
  return {
    id: 'b1',
    seq: 1,
    refNo: 1,
    ref: 'K1',
    date: '2026-02-14',
    categoryId: 'karneval',
    categoryName: 'Karneval',
    name: 'Muster; GmbH',
    description: 'Getränke "Event A"',
    subcategory: 'Getränke',
    type: 'ausgabe',
    amount: 123456,
    signedAmount: -123456,
    isUmsatz: true,
    umsatzAmount: -123456,
    nonUmsatzAmount: 0,
    receiptStatus: 'nicht_erforderlich',
    receiptAvailable: false,
    note: 'Originaltext',
    source: 'import',
    ...overrides,
  }
}

describe('bookingsToCsv', () => {
  test('exportiert deutsch lesbare Beträge, Belegstatus und korrekt gequotete Felder', () => {
    const csv = bookingsToCsv([row()])

    expect(csv).toContain('Datum;Beleg-Nr.;Kategorie;Unterkategorie;Art;Name;Verwendungszweck;Betrag (€);Umsatz (€);Belegstatus;Herkunft;Notiz')
    expect(csv).toContain('14.02.2026;K1;Karneval;Getränke;Ausgabe;"Muster; GmbH";"Getränke ""Event A""";-1.234,56;-1.234,56;Kein Beleg erforderlich;Import;Originaltext')
  })
})
