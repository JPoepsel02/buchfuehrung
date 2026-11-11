import { describe, expect, test } from 'vitest'
import { buildReportHtml } from '../report'
import type { AppSettings, BankAccountConfig, Booking, YearFile } from '@shared/types'

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
    treasurerName: 'Erika Muster',
    categories: [{ id: 'k', name: 'Karneval', code: 'K', sortOrder: 10, active: true }],
    bookings: [booking({ id: 'b1', seq: 1, date: '2026-01-10', categoryId: 'k', type: 'einnahme', amount: 2000 })],
    ...overrides,
  }
}

function bankAccount(overrides: Partial<BankAccountConfig> = {}): BankAccountConfig {
  return { id: 'test-bank', label: 'Testbank', blz: '00000000', fintsUrl: 'https://example.invalid', userId: 'test', ...overrides }
}

function bookingRowCells(html: string, description: string): string[][] {
  return [...html.matchAll(/<tr>\s*([\s\S]*?)<\/tr>/g)]
    .filter((row) => row[1].includes(`<td>${description}</td>`))
    .map((row) => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]))
}

describe('buildReportHtml', () => {
  test.each([
    { receiptStatus: 'vorhanden' as const, expected: '✓' },
    { receiptStatus: 'offen' as const, expected: '' },
    { receiptStatus: 'nicht_erforderlich' as const, expected: '' },
    { receiptAvailable: true, expected: '✓' },
    { receiptAvailable: false, expected: '' },
    { expected: '✓' },
  ])('zeigt im Belegfeld nur bei vorhandenem Beleg einen Haken: %j', (state) => {
    const { expected, ...receipt } = state
    const file = year({ bookings: [booking({ id: 'receipt', seq: 1, date: '2026-01-10', categoryId: 'k',
      type: 'einnahme', amount: 2000, description: 'Belegstatus-Test', ...receipt })] })
    const before = JSON.stringify(file)
    const html = buildReportHtml(file)
    const rows = bookingRowCells(html, 'Belegstatus-Test')
    expect(rows).toHaveLength(2)
    for (const cells of rows) expect(cells[2].replace(/<[^>]+>/g, '')).toBe(expected)
    expect(html).not.toMatch(/noch prüfen|nicht erforderlich|▤|□/)
    expect(JSON.stringify(file)).toBe(before)
  })

  test.each([undefined, '', '   ', 'nicht erforderlich', ' Nicht Erforderlich '])('lässt nicht ausgefüllte oder nicht benötigte Namensfelder leer: %j', (name) => {
    const html = buildReportHtml(year({ bookings: [booking({ id: 'name', seq: 1, date: '2026-01-10', categoryId: 'k',
      type: 'einnahme', amount: 2000, description: 'Namensfeld-Test', name })] }))
    const rows = bookingRowCells(html, 'Namensfeld-Test')
    expect(rows).toHaveLength(2)
    for (const cells of rows) expect(cells[3]).toBe('')
  })

  test('zeigt tatsächlich ausgefüllte Namen getrimmt und maskiert in beiden Belegübersichten', () => {
    const html = buildReportHtml(year({ bookings: [booking({ id: 'name', seq: 1, date: '2026-01-10', categoryId: 'k',
      type: 'einnahme', amount: 2000, description: 'Namensfeld-Test', name: '  Max & <Muster>  ' })] }))
    const rows = bookingRowCells(html, 'Namensfeld-Test')
    expect(rows).toHaveLength(2)
    for (const cells of rows) expect(cells[3]).toBe('Max &amp; &lt;Muster&gt;')
  })

  test('trennt Hauptkonto und Zweitkonto mit eigenen Konto-Berichtsüberschriften', () => {
    const main = year({
      audit: {
        konto1: 'Veraltete manuelle Kontoangabe 1',
        konto2: 'Veraltete manuelle Kontoangabe 2',
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

    const html = buildReportHtml(main, null, [second], {
      accountNumbers: { haupt: '1234567890', zweit: '9876543210' },
    })

    expect(html).toContain('1. Bericht Hauptkonto 1234567890')
    expect(html).toContain('2. Bericht Karnevalskonto 9876543210')
    expect(html).toContain('Geprüft wurde das Konto Hauptkonto 1234567890')
    expect(html).toContain('Geprüft wurde das Konto Karnevalskonto 9876543210')
    expect(html).not.toContain('Hauptkonto · 1234567890')
    expect(html).not.toContain('Veraltete manuelle Kontoangabe')
    expect(html).toContain('3. Kassenprüfbericht')
    expect(html).toContain('im Beisein von Erika Muster')
    expect(html).toContain('31.12.2026')
    expect(html).toContain('01.01.2026')
    expect(html).toContain('<th>Beleg</th>')
    expect(html).toContain('<th>Name</th>')
    expect(html).toContain('Max Mustermann')
    expect(html).not.toContain('noch prüfen')
    expect(html).not.toContain('nicht erforderlich')
    expect(html).toContain('<span class="receipt-state">✓</span>')
    expect(html).toContain('<span class="receipt-state">✓ 1/2</span>')
    expect(html).toContain('<td></td>\n          <td>Beiträge</td>')
    expect(html).not.toContain('Beleg geprüft')
    expect(html).not.toContain('Bericht Konto')
  })

  test('übernimmt mehr als zwei ausgewählte Konten in dieselben Berichts- und Prüfblöcke', () => {
    const main = year()
    const second = year({ konto: 'zweit', kontoName: 'Karnevalskonto' })
    const third = year({ konto: 'k3', kontoName: 'Barkasse' })
    const fourth = year({ konto: 'k4', kontoName: 'Rücklagenkonto' })
    const html = buildReportHtml(main, null, [second, third, fourth], {
      accountNumbers: { haupt: '100', zweit: '200', k4: '400' },
    })

    expect(html).toContain('1. Bericht Hauptkonto 100')
    expect(html).toContain('2. Bericht Karnevalskonto 200')
    expect(html).toContain('3. Bericht Barkasse</h2>')
    expect(html).toContain('4. Bericht Rücklagenkonto 400')
    expect(html).toContain('5. Kassenprüfbericht')
    expect(html.match(/class="account-report"/g)).toHaveLength(4)
    expect(html.match(/class="konto-head"/g)).toHaveLength(4)
    for (const label of ['Hauptkonto 100', 'Karnevalskonto 200', 'Barkasse', 'Rücklagenkonto 400']) {
      expect(html).toContain(`Geprüft wurde das Konto ${label}`)
    }
  })

  test('lässt das abgewählte Hauptkonto und weitere abgewählte Konten vollständig aus', () => {
    const main = year({
      reportExcludedKontos: ['haupt', 'k3'],
      bookings: [booking({ id: 'main-only', seq: 1, date: '2026-01-10', categoryId: 'k', type: 'einnahme', amount: 2000, description: 'Nur im Hauptkonto sichtbar' })],
    })
    const second = year({ konto: 'zweit', kontoName: 'Karnevalskonto', bookings: [] })
    const third = year({ konto: 'k3', kontoName: 'Barkasse', bookings: [] })
    const html = buildReportHtml(main, null, [second, third], { accountNumbers: { zweit: '200' } })

    expect(html).toContain('1. Bericht Karnevalskonto 200')
    expect(html).toContain('2. Kassenprüfbericht')
    expect(html).toContain('Geprüft wurde das Konto Karnevalskonto 200')
    expect(html).not.toContain('Bericht Hauptkonto')
    expect(html).not.toContain('Geprüft wurde das Konto Hauptkonto')
    expect(html).not.toContain('Bericht Barkasse')
    expect(html).not.toContain('Geprüft wurde das Konto Barkasse')
    expect(html).not.toContain('Nur im Hauptkonto sichtbar')
    expect(html.match(/class="account-report"/g)).toHaveLength(1)
    expect(html.match(/class="konto-head"/g)).toHaveLength(1)
  })

  test('zeigt ohne hinterlegte Nummer ausschließlich den Kontonamen', () => {
    const html = buildReportHtml(year())
    expect(html).toContain('1. Bericht Hauptkonto</h2>')
    expect(html).toContain('Geprüft wurde das Konto Hauptkonto</div>')
    expect(html).not.toContain('Bericht Hauptkonto ·')
    expect(html).not.toContain('undefined')
  })

  test('bevorzugt manuelle Kontonummern vor der Bankverbindung und IBAN vor Kontonummer', () => {
    const settings: AppSettings = {
      accountNumbers: { haupt: '  12345  ' },
      bankAccounts: [
        bankAccount({ konto: 'haupt', iban: 'DE-HAUPT-IBAN', accountNumber: 'HAUPT-NUMMER' }),
        bankAccount({ id: 'bank-2', konto: 'zweit', iban: 'DE-ZWEIT-IBAN', accountNumber: 'ZWEIT-NUMMER' }),
      ],
    }
    const html = buildReportHtml(year(), null, [year({ konto: 'zweit', kontoName: 'Karnevalskonto' })], settings)
    expect(html).toContain('Bericht Hauptkonto 12345')
    expect(html).toContain('Bericht Karnevalskonto DE-ZWEIT-IBAN')
    expect(html).not.toContain('DE-HAUPT-IBAN')
    expect(html).not.toContain('HAUPT-NUMMER')
    expect(html).not.toContain('ZWEIT-NUMMER')
  })

  test('ordnet eine alte Bankverbindung ohne konto dem Hauptkonto zu und nutzt eine einfache Kontonummer als Fallback', () => {
    const html = buildReportHtml(year(), null, [year({ konto: 'zweit', kontoName: 'Karnevalskonto' })], {
      accountNumbers: { haupt: '   ' },
      bankAccounts: [bankAccount({ iban: '  ', accountNumber: '  432100  ' })],
    })
    expect(html).toContain('Bericht Hauptkonto 432100')
    expect(html).toContain('Geprüft wurde das Konto Hauptkonto 432100')
    expect(html).toContain('Bericht Karnevalskonto</h2>')
    expect(html).not.toContain('Karnevalskonto 432100')
  })

  test('maskiert Kontonamen und automatische Nummern in Bericht und Prüfblöcken', () => {
    const html = buildReportHtml(year({ kontoName: '<Kasse & "Verein">' }), null, [], {
      accountNumbers: { haupt: '<img src=x onerror="alert(1)">' },
    })
    const label = '&lt;Kasse &amp; &quot;Verein&quot;&gt; &lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    expect(html).toContain(`Bericht ${label}`)
    expect(html).toContain(`Geprüft wurde das Konto ${label}`)
    expect(html).not.toContain('<Kasse')
    expect(html).not.toContain('<img src=x')
  })

  test('weist eine vollständig leere Kontoauswahl mit einem klaren Fehler zurück', () => {
    const main = year({ reportExcludedKontos: ['haupt', 'zweit'] })
    expect(() => buildReportHtml(main, null, [year({ konto: 'zweit', kontoName: 'Karnevalskonto' })]))
      .toThrow(/mindestens ein Konto|kein Konto ausgewählt/i)
  })
})
