import { describe, expect, test } from 'vitest'
import { bankDescription, parseBankCsv, parseGermanDate, rowHash, splitCsvLine } from '../csv'
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
  test('vereinheitlicht denselben Volksbank-Umsatz aus CSV und Online-Banking', () => {
    const date = '2026-06-25'
    const amount = 4000
    const csv = [
      'Buchungstag;Name Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag',
      '25.06.2026;Nina Pöpsel;Überweisungsgutschr.;Nina Pöpsel, M, Nina;40,00',
    ].join('\n')
    const csvRow = parseBankCsv(csv).rows[0]
    const onlineText = bankDescription('Nina Pöpsel, M, Nina', 'Überweisungsgutschr.')

    expect(csvRow.description).toBe(onlineText)
    expect(csvRow.hash).toBe(rowHash(date, amount, onlineText))
  })

  test('unterscheidet weiterhin tatsächlich verschiedene Banktexte', () => {
    expect(rowHash('2026-06-25', 4000, 'Mitgliedsbeitrag Nina')).not.toBe(
      rowHash('2026-06-25', 4000, 'T-Shirt Nina'),
    )
  })

  test('parst Sparkassen-CSV (CAMT-Format)', () => {
    const csv = [
      '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer";"BLZ";"Betrag";"Waehrung";"Info"',
      '"DE12";"05.01.2026";"05.01.2026";"GUTSCHR. UEBERWEISUNG";"Beitrag 2026";"Max Mustermann";"DE99";"WELADED1";"29,00";"EUR";"Umsatz gebucht"',
      '"DE12";"10.02.2026";"10.02.2026";"AUSZAHLUNG";"Wechselgeld";"";"";"";"-500,00";"EUR";"Umsatz gebucht"',
    ].join('\n')
    const result = parseBankCsv(csv)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      date: '2026-01-05',
      amount: 2900,
      name: 'Max Mustermann',
      description: 'Beitrag 2026 – GUTSCHR. UEBERWEISUNG',
    })
    expect(result.rows[0].description).toContain('Beitrag 2026')
    expect(result.rows[0].description).not.toContain('Max Mustermann')
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
    expect(result.rows[0]).toMatchObject({
      date: '2026-04-03',
      amount: -58480,
      name: 'Getränke Meier',
      description: 'RE 4711',
    })
  })

  test('nimmt bei Einnahmen den Auftraggeber und bei Ausgaben den Empfänger', () => {
    const csv = [
      'Buchungstag;Auftraggeber;Empfänger;Verwendungszweck;Betrag',
      '05.05.2026;Anna Einzahlerin;Unser Verein;Ausflug;20,00',
      '06.05.2026;Unser Verein;Busreisen Meier;Busfahrt;-450,00',
    ].join('\n')

    const { rows } = parseBankCsv(csv)

    expect(rows[0]).toMatchObject({ amount: 2000, name: 'Anna Einzahlerin' })
    expect(rows[1]).toMatchObject({ amount: -45000, name: 'Busreisen Meier' })
  })

  test('bildet den Import-Hash nur aus Datum, Betrag und Beschreibung', () => {
    const csv = [
      'Buchungstag;Auftraggeber;Empfänger;Verwendungszweck;Betrag',
      '05.05.2026;Anna Einzahlerin;Unser Verein;Ausflug;20,00',
      '05.05.2026;Bernd Einzahler;Unser Verein;Ausflug;20,00',
    ].join('\n')

    const { rows } = parseBankCsv(csv)

    expect(rows[0].hash).toBe(rowHash('2026-05-05', 2000, 'Ausflug'))
    expect(rows[1].hash).toBe(rows[0].hash)
    expect(rows[0].legacyHashes).toContain(
      rowHash('2026-05-05', 2000, 'Ausflug – Anna Einzahlerin'),
    )
  })

  test('erkennt alternative Sender- und Empfänger-Spalten', () => {
    const csv = [
      'Datum;Zahlungspflichtiger;Begünstigter;Beschreibung;Umsatz',
      '07.05.2026;Max Teilnehmer;Unser Verein;Teilnahmebeitrag;25,00',
      '08.05.2026;Unser Verein;Restaurant Beispiel;Abendessen;-120,00',
    ].join('\n')

    const { rows } = parseBankCsv(csv)

    expect(rows[0].name).toBe('Max Teilnehmer')
    expect(rows[1].name).toBe('Restaurant Beispiel')
  })

  test('verwendet bei Barbewegungen den Buchungstext als Name', () => {
    const csv = [
      'Buchungstag;Name Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag',
      '09.05.2026;;Bareinzahlung;Einnahmen Veranstaltung;300,00',
      '10.05.2026;;Barauszahlung;Wechselgeld;-100,00',
    ].join('\n')

    const { rows } = parseBankCsv(csv)

    expect(rows[0].name).toBe('Bareinzahlung')
    expect(rows[1].name).toBe('Barauszahlung')
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
