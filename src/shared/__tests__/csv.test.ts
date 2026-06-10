import { describe, expect, test } from 'vitest'
import { parseBankCsv, parseGermanDate, splitCsvLine } from '../csv'
import { parseAmountToCents } from '../money'

describe('parseAmountToCents', () => {
  test.each([
    ['1.234,56', 123456],
    ['12,5', 1250],
    ['300', 30000],
    ['-58,99', -5899],
    ['12.50', 1250],
    ['1.000', 100000],
    ['€ 5,00', 500],
  ])('parst %s zu %i Cent', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected)
  })

  test('lehnt ungültige Eingaben ab', () => {
    expect(parseAmountToCents('abc')).toBeNull()
    expect(parseAmountToCents('')).toBeNull()
    expect(parseAmountToCents('1,2,3')).toBeNull()
  })
})

describe('parseGermanDate', () => {
  test('versteht deutsche und ISO-Daten', () => {
    expect(parseGermanDate('01.03.2026')).toBe('2026-03-01')
    expect(parseGermanDate('1.3.26')).toBe('2026-03-01')
    expect(parseGermanDate('2026-03-01')).toBe('2026-03-01')
    expect(parseGermanDate('kein Datum')).toBeNull()
  })
})

describe('splitCsvLine', () => {
  test('beachtet Anführungszeichen mit Trennzeichen darin', () => {
    expect(splitCsvLine('"a;b";c;"d""e"', ';')).toEqual(['a;b', 'c', 'd"e'])
  })
})

describe('parseBankCsv', () => {
  test('parst Sparkassen-CSV (CAMT-Format)', () => {
    const csv = [
      '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer";"BLZ";"Betrag";"Waehrung";"Info"',
      '"DE12";"05.01.2026";"05.01.2026";"GUTSCHR. UEBERWEISUNG";"Beitrag 2026";"Max Mustermann";"DE99";"WELADED1";"29,00";"EUR";"Umsatz gebucht"',
      '"DE12";"10.02.2026";"10.02.2026";"AUSZAHLUNG";"Wechselgeld";"";"";"";"-500,00";"EUR";"Umsatz gebucht"',
    ].join('\n')
    const result = parseBankCsv(csv)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({ date: '2026-01-05', amount: 2900 })
    expect(result.rows[0].description).toContain('Beitrag 2026')
    expect(result.rows[0].description).toContain('Max Mustermann')
    expect(result.rows[1].amount).toBe(-50000)
    expect(result.skipped).toBe(0)
  })

  test('parst Volksbank/GLS-CSV mit Vorspann-Zeilen', () => {
    const csv = [
      'Umsatzanzeige;;;;',
      'Konto: 123456;;;;',
      'Buchungstag;Valuta;Name Zahlungsbeteiligter;Verwendungszweck;Betrag',
      '03.04.2026;03.04.2026;Getränke Meier;RE 4711;-584,80',
    ].join('\n')
    const result = parseBankCsv(csv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ date: '2026-04-03', amount: -58480 })
  })

  test('gleiche Umsätze bekommen gleiche Hashes (Duplikat-Erkennung)', () => {
    const csv = [
      'Buchungstag;Verwendungszweck;Betrag',
      '05.01.2026;Beitrag;29,00',
      '05.01.2026;Beitrag;29,00',
    ].join('\n')
    const { rows } = parseBankCsv(csv)
    expect(rows[0].hash).toBe(rows[1].hash)
  })

  test('liefert leeres Ergebnis ohne erkennbare Kopfzeile', () => {
    const result = parseBankCsv('foo;bar\n1;2')
    expect(result.rows).toHaveLength(0)
    expect(result.skipped).toBeGreaterThan(0)
  })
})
