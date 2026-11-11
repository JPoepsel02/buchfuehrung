import { describe, expect, test } from 'vitest'
import { BACKUP_FORMAT, BACKUP_VERSION, buildBackup, validateBackup } from '../backup'
import type { YearFile } from '../types'

function year(overrides: Partial<YearFile> = {}): YearFile {
  return {
    schemaVersion: 1,
    year: 2026,
    openingBalance: 123456,
    clubName: 'Testverein',
    treasurerName: 'Erika Muster',
    categories: [{ id: 'm', name: 'Maskenball', code: 'M', sortOrder: 10, active: true }],
    bookings: [
      {
        id: 'b1',
        date: '2026-02-14',
        categoryId: 'm',
        description: 'Kasse',
        type: 'einnahme',
        amount: 234567,
        isUmsatz: true,
        nonUmsatzAmount: 10000,
        note: '',
        seq: 1,
        source: 'manuell',
      },
    ],
    ...overrides,
  }
}

function backup(y: YearFile[] = [year()]) {
  return JSON.parse(JSON.stringify(buildBackup(y, { theme: 'system' }, '2026-06-12T10:00:00Z')))
}

describe('validateBackup', () => {
  test('prüft und erhält die Bestätigung des ersten Kassenjahres', () => {
    const data = backup([year({ isFirstFiscalYear: true })])
    expect(validateBackup(data)).toEqual({ ok: true, backup: data })
    data.years[0].isFirstFiscalYear = 'true'
    expect(validateBackup(data).ok).toBe(false)
  })

  test('sichert ein leeres Kassenjahr ohne übernommene Kategorien', () => {
    const data = backup([year({ categories: [], bookings: [] })])
    const result = validateBackup(data)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup).toEqual(data)
  })

  test('lehnt Buchungen ohne passende Kategorie ab', () => {
    expect(validateBackup(backup([year({ categories: [] })])).ok).toBe(false)
  })

  test.each([true, false])('sichert die Clean-Mode-Einstellung ohne Buchungsänderungen: %j', (bookingsCleanMode) => {
    const data = backup()
    data.settings.bookingsCleanMode = bookingsCleanMode
    const result = validateBackup(data)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup).toEqual(data)
  })

  test.each(['ja', null, 0])('lehnt eine beschädigte Clean-Mode-Einstellung ab: %j', (bookingsCleanMode) => {
    const data = backup()
    data.settings.bookingsCleanMode = bookingsCleanMode
    expect(validateBackup(data).ok).toBe(false)
  })

  test.each([
    ['date', '01.06.2026'], ['bankText', null], ['hash', ''], ['name', 42],
    ['description', null], ['selected', 'ja'], ['categoryId', null], ['isUmsatz', 'nein'],
  ])('verhindert beschädigte Importzuweisungen vor dem Wiederherstellen: %s', (field, value) => {
    const data = backup()
    data.years[0].importDraft = { fileName: 'Test.csv', skipped: 0, rows: [{
      date: '2026-06-01', amount: -1000, bankText: 'Test', hash: 'h', name: 'Test',
      description: 'Rechnung', selected: false, categoryId: 'm', isUmsatz: false,
      receiptRef: { categoryId: 'm', refNo: 8 }, [field]: value,
    }] }
    expect(validateBackup(data).ok).toBe(false)
  })

  test.each([0, -1, 1.5, 'M7'])('verhindert ungültige bestehende Belegnummern: %j', (refNo) => {
    const data = backup()
    data.years[0].bookings[0].refNo = refNo
    expect(validateBackup(data).ok).toBe(false)
  })

  test.each(['haupt', 'zweit', 'k3', 'k10'])('erhält Nummern und Buchzuordnung beim Wiederherstellen: %s', (konto) => {
    const data = backup()
    data.years[0].konto = konto
    data.years[0].bookings[0].refNo = 7
    data.years[0].refNoCounters = { m: 9 }
    const result = validateBackup(data)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup.years[0]).toEqual(data.years[0])
  })

  test.each([null, [], '7', { m: '7' }, { m: -1 }, { m: 1.5 }, { m: Number.MAX_SAFE_INTEGER + 1 }])(
    'lehnt beschädigte gespeicherte Belegzähler ab: %j', (refNoCounters) => {
      const data = backup()
      data.years[0].refNoCounters = refNoCounters
      expect(validateBackup(data).ok).toBe(false)
    },
  )

  test('erhält Belegzähler auch für inzwischen entfernte Kategorien', () => {
    const data = backup()
    data.years[0].refNoCounters = { entfernt: 12, m: 7 }
    const result = validateBackup(data)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup.years[0].refNoCounters).toEqual({ entfernt: 12, m: 7 })
  })

  test.each([null, [], 'M7', { categoryId: '', refNo: 7 }, { categoryId: 'm', refNo: '7' }, { categoryId: 'm', refNo: -1 }])(
    'lehnt beschädigte Belegreservierungen in Zeilen und Aufteilungen ab: %j', (receiptRef) => {
      const draftRow = {
        date: '2026-06-01', amount: -1000, bankText: 'Test', hash: 'h', name: 'Test',
        description: 'Rechnung', selected: false, categoryId: 'm', isUmsatz: false,
      }
      const data = backup()
      data.years[0].importDraft = { fileName: 'Test.csv', skipped: 0, rows: [{ ...draftRow, receiptRef }] }
      expect(validateBackup(data).ok).toBe(false)
      data.years[0].importDraft.rows = [{ ...draftRow, splits: [{
        id: 's', categoryId: 'm', description: 'Teil', amount: 1000, isUmsatz: false, receiptRef,
      }] }]
      expect(validateBackup(data).ok).toBe(false)
    },
  )

  test('sichert und lädt feste Entwurfsnummern ohne Änderungen', () => {
    const data = backup()
    data.years[0].refNoCounters = { m: 8 }
    data.years[0].importDraft = { fileName: 'Test.csv', skipped: 0, rows: [{
      date: '2026-06-01', amount: -1000, bankText: 'Test', hash: 'h', name: 'Test',
      description: 'Rechnung', selected: false, categoryId: 'm', isUmsatz: false,
      receiptRef: { categoryId: 'm', refNo: 8 },
      splits: [{ id: 's', categoryId: 'm', description: 'Teil', amount: 1000, isUmsatz: false,
        receiptRef: { categoryId: 'm', refNo: 8 } }],
    }] }
    const result = validateBackup(data)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup).toEqual(data)
  })

  test('akzeptiert eine gültige Sicherung', () => {
    const result = validateBackup(backup())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup.years[0].year).toBe(2026)
  })

  test('lehnt fremde Dateien ohne Format-Kennung ab', () => {
    expect(validateBackup({ jahre: [] }).ok).toBe(false)
    expect(validateBackup('text').ok).toBe(false)
    expect(validateBackup(null).ok).toBe(false)
  })

  test('lehnt unbekannte Versionen ab', () => {
    const b = backup()
    b.version = 99
    const r = validateBackup(b)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('Version')
  })

  test('meldet ungültige Daten: Datum, Betrag, Kategorie-Verweis', () => {
    const b = backup()
    b.years[0].bookings[0].date = '14.02.2026'
    b.years[0].bookings[0].amount = -5
    b.years[0].bookings[0].categoryId = 'fehlt'
    const r = validateBackup(b)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.join(' ')).toContain('Datum')
      expect(r.errors.join(' ')).toContain('Betrag')
      expect(r.errors.join(' ')).toContain('unbekannte Kategorie')
    }
  })

  test('meldet "davon kein Umsatz" über dem Betrag', () => {
    const b = backup()
    b.years[0].bookings[0].nonUmsatzAmount = 999999999
    const r = validateBackup(b)
    expect(r.ok).toBe(false)
  })

  test('lehnt ungültiges Beleg-Kennzeichen ab', () => {
    const b = backup()
    b.years[0].bookings[0].receiptAvailable = 'ja'
    const r = validateBackup(b)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('Beleg')
  })

  test('akzeptiert den neuen Belegstatus und lehnt unbekannte Werte ab', () => {
    const valid = backup()
    valid.years[0].bookings[0].receiptStatus = 'nicht_erforderlich'
    expect(validateBackup(valid).ok).toBe(true)

    const invalid = backup()
    invalid.years[0].bookings[0].receiptStatus = 'vielleicht'
    const result = validateBackup(invalid)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('Beleg-Status')
  })

  test('akzeptiert alte und neue Import-Hash-Versionen', () => {
    const version2 = backup()
    version2.years[0].bookings[0].importHash = 'alter-hash'
    version2.years[0].bookings[0].importHashVersion = 2
    expect(validateBackup(version2).ok).toBe(true)

    const version3 = backup()
    version3.years[0].bookings[0].importHash = 'neuer-hash'
    version3.years[0].bookings[0].importHashVersion = 3
    expect(validateBackup(version3).ok).toBe(true)

    const invalid = backup()
    invalid.years[0].bookings[0].importHashVersion = 4
    expect(validateBackup(invalid).ok).toBe(false)
  })

  test('lehnt ungültige Hashlisten in offenen Importentwürfen ab', () => {
    const invalid = backup()
    invalid.years[0].importDraft = {
      fileName: 'Kontoauszug.csv',
      skipped: 0,
      rows: [{
        date: '2026-05-17',
        bankText: 'Beitrag – Überweisungsgutschr.',
        amount: 7300,
        hash: 'aktueller-hash',
        legacyHashes: 1,
        name: 'Testperson Beispiel',
        description: '',
        selected: true,
        categoryId: '',
        isUmsatz: false,
      }],
    }

    const result = validateBackup(invalid)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('Entwurf')
  })

  test('lehnt beschädigte Aufteilungen in offenen Importentwürfen ab', () => {
    const invalid = backup()
    invalid.years[0].importDraft = {
      fileName: 'Kontoauszug.csv',
      skipped: 0,
      rows: [{
        date: '2026-05-17',
        bankText: 'Getränkerechnung',
        amount: -100000,
        hash: 'hash',
        name: 'Getränkehandel',
        description: '',
        selected: true,
        categoryId: '',
        isUmsatz: false,
        splits: [null],
      }],
    }

    expect(validateBackup(invalid).ok).toBe(false)
  })

  test('lehnt einen ungültigen Namen ab', () => {
    const b = backup()
    b.years[0].bookings[0].name = 123
    const r = validateBackup(b)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('Name')
  })

  test('meldet doppelte Kassenjahre', () => {
    const r = validateBackup(backup([year(), year()]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('doppelt')
  })

  test('lehnt Nicht-Cent-Beträge (Kommazahlen) ab', () => {
    const b = backup()
    b.years[0].bookings[0].amount = 123.45
    expect(validateBackup(b).ok).toBe(false)
  })

  test('lehnt Logo ohne Bild-Data-URL ab', () => {
    const b = backup()
    b.settings = { logoDataUrl: 'https://example.com/x.png' }
    const r = validateBackup(b)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('Logo')
  })

  test('Konstanten bleiben stabil (Format der Export-Dateien)', () => {
    expect(BACKUP_FORMAT).toBe('buchfuehrung-sicherung')
    expect(BACKUP_VERSION).toBe(1)
  })
})
